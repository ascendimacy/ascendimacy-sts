import type { SessionTrace } from "@ascendimacy/sts-shared";

export interface GateResult {
  gate: string;
  passed: boolean;
  detail: string;
}

export interface RubricResult {
  gates: GateResult[];
  allMustPassGreen: boolean;
  summary: string;
}

export function evaluateRubric(trace: SessionTrace, expectedTurns: number): RubricResult {
  const gates: GateResult[] = [];

  // G1: completed expected turns (allow ±1 if persona ended early)
  const g1 = trace.turns.length >= Math.min(expectedTurns, expectedTurns - 1);
  gates.push({
    gate: "G1",
    passed: g1,
    detail: `${trace.turns.length}/${expectedTurns} turns completed`,
  });

  // G2: bot messages are non-empty in all turns
  const emptyBotMsgs = trace.turns.filter((t) => !t.botMessage?.trim()).length;
  gates.push({
    gate: "G2",
    passed: emptyBotMsgs === 0,
    detail:
      emptyBotMsgs === 0
        ? "All bot messages non-empty"
        : `${emptyBotMsgs} empty bot messages found`,
  });

  // G3: persona messages are non-empty in all turns
  const emptyPersonaMsgs = trace.turns.filter((t) => !t.personaEntry?.personaId).length;
  gates.push({
    gate: "G3",
    passed: emptyPersonaMsgs === 0,
    detail:
      emptyPersonaMsgs === 0
        ? "All turns have personaEntry"
        : `${emptyPersonaMsgs} turns missing personaEntry`,
  });

  // G4: trace has sessionId and completedAt
  const g4 = !!trace.sessionId && !!trace.completedAt;
  gates.push({
    gate: "G4",
    passed: g4,
    detail: g4 ? "Trace metadata complete" : "Missing sessionId or completedAt",
  });

  // G5 (soft): trustLevel monotonically non-decreasing (allowed to fail)
  const trustLevels = trace.turns.map((t) => t.trustLevel);
  let g5 = true;
  for (let i = 1; i < trustLevels.length; i++) {
    if (trustLevels[i]! < trustLevels[i - 1]! - 0.1) {
      g5 = false;
      break;
    }
  }
  gates.push({
    gate: "G5",
    passed: g5,
    detail: g5
      ? "Trust level non-decreasing"
      : `Trust dipped: [${trustLevels.map((t) => t.toFixed(2)).join(", ")}]`,
  });

  const mustPass = gates.slice(0, 4); // G1-G4
  const allMustPassGreen = mustPass.every((g) => g.passed);
  const summary = allMustPassGreen
    ? `PASS (G1-G4 green${g5 ? ", G5 green" : ", G5 soft-fail"})`
    : `FAIL: ${mustPass.filter((g) => !g.passed).map((g) => g.gate).join(", ")} failed`;

  return { gates, allMustPassGreen, summary };
}
