import { describe, it, expect } from "vitest";
import { evaluateRubric, evaluateRubricV2 } from "../src/rubric.js";
import { createSessionTrace, finalizeTrace, addTurn } from "../../shared/src/trace-schema.js";
import type { STSTurnTrace } from "../../shared/src/types.js";

function makeTurn(i: number, overrides: Partial<STSTurnTrace> = {}): STSTurnTrace {
  return {
    turn: i,
    botMessage: `Bot message ${i}`,
    personaMessage: `Persona message ${i}`,
    trustLevel: 0.4 + i * 0.05,
    budgetRemaining: 100 - i * 5,
    playbookId: "p1",
    durationMs: 100,
    personaEntry: { personaId: "paula-mendes", mood: "neutral", endConversation: false },
    ...overrides,
  };
}

describe("evaluateRubric", () => {
  it("passes G1-G4 for a complete 3-turn trace", () => {
    const trace = createSessionTrace("paula-mendes");
    for (let i = 1; i <= 3; i++) addTurn(trace, makeTurn(i));
    const finalized = finalizeTrace(trace);
    const result = evaluateRubric(finalized, 3);
    expect(result.allMustPassGreen).toBe(true);
    expect(result.gates.find((g) => g.gate === "G1")!.passed).toBe(true);
    expect(result.gates.find((g) => g.gate === "G4")!.passed).toBe(true);
  });

  it("fails G2 when a bot message is empty", () => {
    const trace = createSessionTrace("paula-mendes");
    addTurn(trace, makeTurn(1, { botMessage: "" }));
    addTurn(trace, makeTurn(2));
    const finalized = finalizeTrace(trace);
    const result = evaluateRubric(finalized, 2);
    expect(result.gates.find((g) => g.gate === "G2")!.passed).toBe(false);
    expect(result.allMustPassGreen).toBe(false);
  });

  it("soft-fails G5 when trust drops sharply", () => {
    const trace = createSessionTrace("paula-mendes");
    addTurn(trace, makeTurn(1, { trustLevel: 0.8 }));
    addTurn(trace, makeTurn(2, { trustLevel: 0.3 }));
    const finalized = finalizeTrace(trace);
    const result = evaluateRubric(finalized, 2);
    expect(result.gates.find((g) => g.gate === "G5")!.passed).toBe(false);
    // G1-G4 still green
    expect(result.allMustPassGreen).toBe(true);
  });
});

describe("evaluateRubricV2", () => {
  it("returns NOT_TRIGGERED when trigger never happens", () => {
    const trace = createSessionTrace("paula-mendes");
    addTurn(trace, makeTurn(1));
    const finalized = finalizeTrace(trace);
    const result = evaluateRubricV2(finalized, {
      enabled: true,
      evaluator_mode: "external",
      subject_mode: "blind",
      subitems: [
        {
          id: "tc-001",
          title: "tutorial turn exists",
          role: "external_evaluator",
          visibility: "hidden_from_subject",
          severity: "blocker",
          trigger: { type: "outcome", when: "turn_with_tutorial_contract" },
          window: { start: "same_turn", end: "same_turn" },
          evidence: ["transcript"],
          pass_if: ["tutorial.move_type exists"],
        },
      ],
    });
    expect(result.enabled).toBe(true);
    expect(result.subitems[0]?.status).toBe("NOT_TRIGGERED");
  });

  it("passes when turn_with_tutorial_contract exists in motorTrace.plan.contextHints", () => {
    const trace = createSessionTrace("paula-mendes");
    addTurn(
      trace,
      makeTurn(1, {
        motorTrace: {
          plan: {
            contextHints: {
              tutorial: { move_type: "check" },
            },
          },
        },
      }),
    );
    const finalized = finalizeTrace(trace);
    const result = evaluateRubricV2(finalized, {
      enabled: true,
      evaluator_mode: "external",
      subject_mode: "blind",
      subitems: [
        {
          id: "tc-002",
          title: "tutorial turn exists",
          role: "external_evaluator",
          visibility: "hidden_from_subject",
          severity: "blocker",
          trigger: { type: "outcome", when: "turn_with_tutorial_contract" },
          window: { start: "same_turn", end: "same_turn" },
          evidence: ["transcript", "engine_trace", "context_hints"],
          pass_if: ["tutorial.move_type exists"],
        },
      ],
    });
    expect(result.subitems[0]?.status).toBe("PASS");
    expect(result.blockerFailures).toBe(0);
  });

  it("fails next_turn correction check when next turn opens explain", () => {
    const trace = createSessionTrace("paula-mendes");
    addTurn(trace, makeTurn(1, { personaMessage: "não sei" }));
    addTurn(
      trace,
      makeTurn(2, {
        motorTrace: {
          plan: {
            contextHints: {
              tutorial: { move_type: "explain" },
            },
          },
        },
      }),
    );
    const finalized = finalizeTrace(trace);
    const result = evaluateRubricV2(finalized, {
      enabled: true,
      evaluator_mode: "external",
      subject_mode: "blind",
      subitems: [
        {
          id: "tc-003",
          title: "wrong answer should trigger correction or check",
          role: "external_evaluator",
          visibility: "hidden_from_subject",
          severity: "blocker",
          trigger: { type: "outcome", when: "subject_answer_partial_or_wrong" },
          window: { start: "next_turn", end: "next_turn" },
          evidence: ["transcript", "engine_trace"],
          pass_if: ["tutorial.move_type in [check, correct]", "no_new_concept_opened"],
          fail_if: ["tutorial.move_type == explain"],
        },
      ],
    });
    expect(result.subitems[0]?.status).toBe("FAIL");
    expect(result.blockerFailures).toBe(1);
  });

  it("reads tutorial/mission/closure from engineTrace and top-level tutor fields when present", () => {
    const trace = createSessionTrace("paula-mendes");
    addTurn(
      trace,
      makeTurn(1, {
        engineTrace: {
          tutorial_contract: { move_type: "close" },
          session_mission: {
            mission_id: "mission:close-current-loop",
            label: "fechar o que foi trabalhado",
          },
          session_closure: {
            required: true,
            closure_style: "summary",
          },
        },
        sessionMission: {
          mission_id: "mission:close-current-loop",
          label: "fechar o que foi trabalhado",
        },
        sessionClosure: {
          required: true,
          closure_style: "summary",
        },
      }),
    );
    const finalized = finalizeTrace(trace);
    const result = evaluateRubricV2(finalized, {
      enabled: true,
      evaluator_mode: "external",
      subject_mode: "blind",
      subitems: [
        {
          id: "tc-004",
          title: "engine trace mission and closure visible",
          role: "external_evaluator",
          visibility: "hidden_from_subject",
          severity: "blocker",
          trigger: { type: "outcome", when: "session_end" },
          window: { start: "session_end", end: "session_end" },
          evidence: ["engine_trace", "context_hints"],
          pass_if: ["session_closure_present", "mission_identifiable"],
        },
      ],
    });

    expect(result.subitems[0]?.status).toBe("PASS");
  });
});
