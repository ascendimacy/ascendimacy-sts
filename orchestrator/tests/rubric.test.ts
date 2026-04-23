import { describe, it, expect } from "vitest";
import { evaluateRubric } from "../src/rubric.js";
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
