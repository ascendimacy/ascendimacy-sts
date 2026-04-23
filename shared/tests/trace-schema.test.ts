import { describe, it, expect } from "vitest";
import { createSessionTrace, finalizeTrace, addTurn } from "../src/trace-schema.js";
import type { STSTurnTrace } from "../src/types.js";

describe("createSessionTrace", () => {
  it("creates trace with correct personaId", () => {
    const trace = createSessionTrace("paula-mendes");
    expect(trace.personaId).toBe("paula-mendes");
    expect(trace.turns).toHaveLength(0);
    expect(trace.sessionId).toBeTruthy();
  });
});

describe("finalizeTrace", () => {
  it("sets completedAt and totalTurns", () => {
    const trace = createSessionTrace("ryo");
    const turn: STSTurnTrace = {
      turn: 1,
      botMessage: "Olá",
      personaMessage: "Oi",
      trustLevel: 0.5,
      budgetRemaining: 100,
      playbookId: "p1",
      durationMs: 100,
      personaEntry: { personaId: "ryo", mood: "curious", endConversation: false },
    };
    addTurn(trace, turn);
    const finalized = finalizeTrace(trace);
    expect(finalized.totalTurns).toBe(1);
    expect(finalized.completedAt).toBeTruthy();
  });
});
