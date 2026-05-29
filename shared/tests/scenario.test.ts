import { describe, it, expect } from "vitest";
import {
  parseScenario,
  dayToIso,
  SCENARIO_EVENT_TYPES,
} from "../src/scenario.js";

const validYaml = {
  name: "test-scenario",
  start_date: "2026-05-01T00:00:00Z",
  end_date: "2026-05-05T00:00:00Z",
  personas: ["ryo", "kei"],
  parents: ["yuji"],
  events: [
    { day: 1, type: "solo_session", persona: "ryo", turns: 5 },
    { day: 2, type: "joint_session", personas: ["ryo", "kei"], turns: 10 },
  ],
};

describe("parseScenario — valid", () => {
  it("parses minimal valid scenario", () => {
    const r = parseScenario(validYaml);
    expect(r.valid).toBe(true);
    expect(r.scenario?.name).toBe("test-scenario");
    expect(r.scenario?.events).toHaveLength(2);
  });

  it("mock_llm defaults to true when omitted", () => {
    const r = parseScenario(validYaml);
    expect(r.scenario?.mock_llm).toBe(true);
  });

  it("mock_llm respects explicit false", () => {
    const r = parseScenario({ ...validYaml, mock_llm: false });
    expect(r.scenario?.mock_llm).toBe(false);
  });

  it("parses rubric_v2 with one subitem", () => {
    const r = parseScenario({
      ...validYaml,
      rubric_v2: {
        enabled: true,
        evaluator_mode: "external",
        subject_mode: "blind",
        parent_mode: "optional",
        subitems: [
          {
            id: "tc-001",
            title: "tutorial contract visible in trace",
            role: "external_evaluator",
            visibility: "hidden_from_subject",
            severity: "blocker",
            trigger: { type: "outcome", when: "turn_with_tutorial_contract" },
            window: { start: "same_turn", end: "same_turn" },
            evidence: ["transcript", "engine_trace", "context_hints"],
            pass_if: ["tutorial.move_type exists"],
          },
        ],
      },
    });
    expect(r.valid).toBe(true);
    expect(r.scenario?.rubric_v2?.enabled).toBe(true);
    expect(r.scenario?.rubric_v2?.subitems).toHaveLength(1);
  });
});

describe("parseScenario — errors", () => {
  it("fails with missing name", () => {
    const r = parseScenario({ ...validYaml, name: "" });
    expect(r.valid).toBe(false);
    expect(r.errors).toContain("missing or invalid 'name'");
  });

  it("fails with invalid start_date", () => {
    const r = parseScenario({ ...validYaml, start_date: "not-a-date" });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("start_date"))).toBe(true);
  });

  it("fails with empty events", () => {
    const r = parseScenario({ ...validYaml, events: [] });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("events"))).toBe(true);
  });

  it("fails with unknown event type", () => {
    const r = parseScenario({
      ...validYaml,
      events: [{ day: 1, type: "unknown_event" }],
    });
    expect(r.valid).toBe(false);
  });

  it("fails on joint_session without 2 personas", () => {
    const r = parseScenario({
      ...validYaml,
      events: [{ day: 1, type: "joint_session", personas: ["only-one"] }],
    });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("joint_session"))).toBe(true);
  });

  it("fails on inject_status without dimension+value", () => {
    const r = parseScenario({
      ...validYaml,
      events: [{ day: 1, type: "inject_status", persona: "ryo" }],
    });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("inject_status"))).toBe(true);
  });

  it("fails on solo_session without persona", () => {
    const r = parseScenario({
      ...validYaml,
      events: [{ day: 1, type: "solo_session", turns: 5 }],
    });
    expect(r.valid).toBe(false);
  });

  it("fails on non-object input", () => {
    expect(parseScenario(null).valid).toBe(false);
    expect(parseScenario("string").valid).toBe(false);
    expect(parseScenario([]).valid).toBe(false);
  });

  it("fails on invalid rubric_v2 subitem", () => {
    const r = parseScenario({
      ...validYaml,
      rubric_v2: {
        enabled: true,
        evaluator_mode: "external",
        subject_mode: "blind",
        subitems: [
          {
            id: "",
            title: "",
            role: "subject",
            visibility: "public",
            severity: "hard",
            trigger: { type: "outcome", when: "unknown" },
            window: { start: "later", end: "later" },
            evidence: [],
            pass_if: [],
          },
        ],
      },
    });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("rubric_v2.subitems[0].role"))).toBe(true);
  });
});

describe("dayToIso", () => {
  it("day 1 == start_date", () => {
    const iso = dayToIso("2026-05-01T00:00:00Z", 1);
    expect(iso.slice(0, 10)).toBe("2026-05-01");
  });

  it("day 2 = start + 1 dia", () => {
    const iso = dayToIso("2026-05-01T00:00:00Z", 2);
    expect(iso.slice(0, 10)).toBe("2026-05-02");
  });

  it("day 30 = start + 29 dias", () => {
    const iso = dayToIso("2026-05-01T00:00:00Z", 30);
    expect(iso.slice(0, 10)).toBe("2026-05-30");
  });

  it("determinism", () => {
    const a = dayToIso("2026-05-01T00:00:00Z", 15);
    const b = dayToIso("2026-05-01T00:00:00Z", 15);
    expect(a).toBe(b);
  });
});

describe("SCENARIO_EVENT_TYPES contract", () => {
  it("inclui os 5 tipos do handoff", () => {
    expect(SCENARIO_EVENT_TYPES).toEqual([
      "parent_onboarding",
      "solo_session",
      "joint_session",
      "gardner_advance",
      "inject_status",
    ]);
  });
});
