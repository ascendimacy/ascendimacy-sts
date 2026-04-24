import type { SessionTrace, STSTurnTrace } from "./types.js";
import { randomUUID } from "crypto";

export function createSessionTrace(personaId: string): SessionTrace {
  return {
    sessionId: randomUUID(),
    personaId,
    startedAt: new Date().toISOString(),
    completedAt: "",
    totalTurns: 0,
    turns: [],
  };
}

export function finalizeTrace(trace: SessionTrace): SessionTrace {
  return {
    ...trace,
    completedAt: new Date().toISOString(),
    totalTurns: trace.turns.length,
  };
}

export function addTurn(trace: SessionTrace, turn: STSTurnTrace): void {
  trace.turns.push(turn);
}
