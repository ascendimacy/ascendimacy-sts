import type {
  ScenarioRubricV2,
  SessionTrace,
} from "@ascendimacy/sts-shared";

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

export interface SubitemResult {
  id: string;
  title: string;
  severity: "blocker" | "advisory";
  status: "PASS" | "FAIL" | "NOT_TRIGGERED" | "INCONCLUSIVE";
  detail: string;
}

export interface RubricV2Result {
  enabled: boolean;
  subitems: SubitemResult[];
  blockerFailures: number;
  advisoryFailures: number;
  summary: string;
}

export function evaluateRubric(trace: SessionTrace, expectedTurns: number): RubricResult {
  const gates: GateResult[] = [];

  // G1: pipeline ran at least 1 full turn. Persona may end early (endConversation=true) — that's valid.
  const personaEndedEarly = trace.turns.some((t) => t.personaEntry?.endConversation === true);
  const g1 = trace.turns.length >= 1;
  const g1Detail = personaEndedEarly
    ? `${trace.turns.length}/${expectedTurns} turns (persona ended at turn ${trace.turns.length})`
    : `${trace.turns.length}/${expectedTurns} turns completed`;
  gates.push({ gate: "G1", passed: g1, detail: g1Detail });

  // G2: bot messages are non-empty in all turns
  const emptyBotMsgs = trace.turns.filter((t) => !t.botMessage?.trim()).length;
  gates.push({
    gate: "G2",
    passed: emptyBotMsgs === 0,
    detail: emptyBotMsgs === 0 ? "All bot messages non-empty" : `${emptyBotMsgs} empty bot messages found`,
  });

  // G3: persona messages are non-empty in all turns
  const emptyPersonaMsgs = trace.turns.filter((t) => !t.personaEntry?.personaId).length;
  gates.push({
    gate: "G3",
    passed: emptyPersonaMsgs === 0,
    detail: emptyPersonaMsgs === 0 ? "All turns have personaEntry" : `${emptyPersonaMsgs} turns missing personaEntry`,
  });

  // G4: trace has sessionId and completedAt
  const g4 = !!trace.sessionId && !!trace.completedAt;
  gates.push({
    gate: "G4",
    passed: g4,
    detail: g4 ? "Trace metadata complete" : "Missing sessionId or completedAt",
  });

  // G5 (soft): trustLevel monotonically non-decreasing
  const trustLevels = trace.turns.map((t) => t.trustLevel);
  let g5 = true;
  for (let i = 1; i < trustLevels.length; i++) {
    if (trustLevels[i]! < trustLevels[i - 1]! - 0.1) { g5 = false; break; }
  }
  gates.push({
    gate: "G5",
    passed: g5,
    detail: g5 ? "Trust level non-decreasing" : `Trust dipped: [${trustLevels.map((t) => t.toFixed(2)).join(", ")}]`,
  });

  const mustPass = gates.slice(0, 4); // G1-G4
  const allMustPassGreen = mustPass.every((g) => g.passed);
  const summary = allMustPassGreen
    ? `PASS (G1-G4 green${g5 ? ", G5 green" : ", G5 soft-fail"})`
    : `FAIL: ${mustPass.filter((g) => !g.passed).map((g) => g.gate).join(", ")} failed`;

  return { gates, allMustPassGreen, summary };
}

function getTutorialMoveType(turn: SessionTrace["turns"][number]): string | undefined {
  const engineTrace = turn.engineTrace as
    | { tutorial_contract?: { move_type?: unknown } }
    | undefined;
  const engineMove = engineTrace?.tutorial_contract?.move_type;
  if (typeof engineMove === "string") {
    return engineMove;
  }
  const trace = turn.motorTrace as Record<string, unknown> | undefined;
  const plan = trace?.["plan"] as Record<string, unknown> | undefined;
  const contextHints = plan?.["contextHints"] as Record<string, unknown> | undefined;
  const tutorial = contextHints?.["tutorial"] as Record<string, unknown> | undefined;
  return typeof tutorial?.["move_type"] === "string"
    ? (tutorial["move_type"] as string)
    : undefined;
}

function hasSessionMission(turn: SessionTrace["turns"][number]): boolean {
  if (turn.sessionMission && typeof turn.sessionMission === "object") return true;
  const engineTrace = turn.engineTrace as
    | { session_mission?: Record<string, unknown> }
    | undefined;
  if (engineTrace?.session_mission && typeof engineTrace.session_mission === "object") {
    return true;
  }
  const trace = turn.motorTrace as Record<string, unknown> | undefined;
  const plan = trace?.["plan"] as Record<string, unknown> | undefined;
  const contextHints = plan?.["contextHints"] as Record<string, unknown> | undefined;
  return typeof contextHints?.["session_mission"] === "object";
}

function hasSessionClosure(turn: SessionTrace["turns"][number]): boolean {
  if (turn.sessionClosure && typeof turn.sessionClosure === "object") return true;
  const engineTrace = turn.engineTrace as
    | { session_closure?: Record<string, unknown> }
    | undefined;
  if (engineTrace?.session_closure && typeof engineTrace.session_closure === "object") {
    return true;
  }
  return getTutorialMoveType(turn) === "close";
}

function getTurnSignals(turn: SessionTrace["turns"][number]): string[] {
  const trace = turn.motorTrace as Record<string, unknown> | undefined;
  const assessment = trace?.["assessment"] as Record<string, unknown> | undefined;
  const signals = assessment?.["signals"];
  return Array.isArray(signals)
    ? signals.filter((s): s is string => typeof s === "string")
    : [];
}

function getSubjectReplyKind(turn: SessionTrace["turns"][number]): "correct" | "partial_or_wrong" | "unknown" {
  const msg = turn.personaMessage.trim().toLowerCase();
  if (!msg) return "unknown";
  if (/(não|nao|sei lá|sei la|talvez|acho|não lembro|nao lembro|hm|hmm)/.test(msg)) {
    return "partial_or_wrong";
  }
  return "correct";
}

function turnHasTutorialContract(turn: SessionTrace["turns"][number]): boolean {
  return getTutorialMoveType(turn) !== undefined;
}

function evaluatePredicate(
  predicate: string,
  triggeredTurn: SessionTrace["turns"][number] | undefined,
  windowTurns: SessionTrace["turns"],
): boolean | null {
  const normalized = predicate.trim();
  if (normalized === "tutorial.move_type exists") {
    return windowTurns.some((t) => turnHasTutorialContract(t));
  }
  if (normalized === "tutorial.move_type in [check, correct]") {
    return windowTurns.some((t) => {
      const move = getTutorialMoveType(t);
      return move === "check" || move === "correct";
    });
  }
  if (normalized === "no_new_concept_opened") {
    return windowTurns.every((t) => {
      const move = getTutorialMoveType(t);
      return move !== "explain";
    });
  }
  if (normalized === "bot_does_not_open_unrelated_topic") {
    return windowTurns.every((t) => {
      const move = getTutorialMoveType(t);
      return move !== "explain";
    });
  }
  if (normalized === "opened_unrelated_new_concept") {
    return windowTurns.some((t) => getTutorialMoveType(t) === "explain");
  }
  if (normalized === "tutorial.move_type == explain") {
    return windowTurns.some((t) => getTutorialMoveType(t) === "explain");
  }
  if (normalized === "session_closure_present") {
    return windowTurns.some((t) => hasSessionClosure(t));
  }
  if (normalized === "mission_identifiable") {
    return windowTurns.some((t) => hasSessionMission(t));
  }
  if (normalized === "deflection_detected") {
    return windowTurns.some((t) => getTurnSignals(t).includes("deflection_thematic"));
  }
  if (triggeredTurn && normalized === "same_persona_turn_present") {
    return windowTurns.length > 0;
  }
  return null;
}

function selectWindowTurns(
  trace: SessionTrace,
  triggeredIndex: number,
  start: ScenarioRubricV2["subitems"][number]["window"]["start"],
  end: ScenarioRubricV2["subitems"][number]["window"]["end"],
): SessionTrace["turns"] {
  if (start === "session_end" || end === "session_end") {
    return trace.turns.length > 0 ? [trace.turns[trace.turns.length - 1]!] : [];
  }
  if (start === "same_turn" && end === "same_turn") {
    return trace.turns[triggeredIndex] ? [trace.turns[triggeredIndex]!] : [];
  }
  if (start === "next_turn" && end === "next_turn") {
    return trace.turns[triggeredIndex + 1] ? [trace.turns[triggeredIndex + 1]!] : [];
  }
  if (start === "next_two_turns" || end === "next_two_turns") {
    return trace.turns.slice(triggeredIndex + 1, triggeredIndex + 3);
  }
  return trace.turns[triggeredIndex] ? [trace.turns[triggeredIndex]!] : [];
}

function findTriggeredTurnIndex(
  trace: SessionTrace,
  when: ScenarioRubricV2["subitems"][number]["trigger"]["when"],
): number {
  if (when === "session_end") {
    return trace.turns.length - 1;
  }
  if (when === "turn_with_tutorial_contract") {
    return trace.turns.findIndex((t) => turnHasTutorialContract(t));
  }
  if (when === "deflection_detected") {
    return trace.turns.findIndex((t) => getTurnSignals(t).includes("deflection_thematic"));
  }
  if (when === "subject_answer_partial_or_wrong") {
    return trace.turns.findIndex((t) => getSubjectReplyKind(t) === "partial_or_wrong");
  }
  if (when === "subject_answer_correct") {
    return trace.turns.findIndex((t) => getSubjectReplyKind(t) === "correct");
  }
  return -1;
}

export function evaluateRubricV2(
  trace: SessionTrace,
  rubricV2?: ScenarioRubricV2,
): RubricV2Result {
  if (!rubricV2?.enabled) {
    return {
      enabled: false,
      subitems: [],
      blockerFailures: 0,
      advisoryFailures: 0,
      summary: "rubric_v2 disabled",
    };
  }

  const subitems: SubitemResult[] = rubricV2.subitems.map((item: any) => {
    const personaScoped =
      !item.applies_to?.personas || item.applies_to.personas.includes(trace.personaId);
    if (!personaScoped) {
      return {
        id: item.id,
        title: item.title,
        severity: item.severity,
        status: "NOT_TRIGGERED",
        detail: `persona ${trace.personaId} outside applies_to.personas`,
      };
    }

    const triggeredIndex = findTriggeredTurnIndex(trace, item.trigger.when);
    if (triggeredIndex < 0) {
      return {
        id: item.id,
        title: item.title,
        severity: item.severity,
        status: "NOT_TRIGGERED",
        detail: `trigger not observed: ${item.trigger.when}`,
      };
    }

    const triggeredTurn = trace.turns[triggeredIndex];
    const windowTurns = selectWindowTurns(trace, triggeredIndex, item.window.start, item.window.end);
    if (windowTurns.length === 0) {
      return {
        id: item.id,
        title: item.title,
        severity: item.severity,
        status: "INCONCLUSIVE",
        detail: `no turns available in evaluation window ${item.window.start}..${item.window.end}`,
      };
    }

    const failHit = (item.fail_if ?? [])
      .map((p: unknown) => evaluatePredicate(p as never, triggeredTurn, windowTurns))
      .some((r: unknown) => r === true);
    if (failHit) {
      return {
        id: item.id,
        title: item.title,
        severity: item.severity,
        status: "FAIL",
        detail: `fail_if predicate matched`,
      };
    }

    const passResults = item.pass_if.map((p: unknown) => evaluatePredicate(p as never, triggeredTurn, windowTurns));
    if (passResults.some((r: unknown) => r === null)) {
      return {
        id: item.id,
        title: item.title,
        severity: item.severity,
        status: "INCONCLUSIVE",
        detail: `unsupported predicate present in pass_if/fail_if`,
      };
    }
    const allPass = passResults.every((r: unknown) => r === true);
    return {
      id: item.id,
      title: item.title,
      severity: item.severity,
      status: allPass ? "PASS" : "FAIL",
      detail: allPass
        ? `triggered at turn ${triggeredIndex + 1}, predicates satisfied`
        : `triggered at turn ${triggeredIndex + 1}, one or more pass_if predicates failed`,
    };
  });

  const blockerFailures = subitems.filter(
    (s) => s.severity === "blocker" && s.status === "FAIL",
  ).length;
  const advisoryFailures = subitems.filter(
    (s) => s.severity === "advisory" && s.status === "FAIL",
  ).length;

  return {
    enabled: true,
    subitems,
    blockerFailures,
    advisoryFailures,
    summary:
      blockerFailures === 0
        ? `PASS (${subitems.filter((s) => s.status === "PASS").length}/${subitems.length} subitems green${advisoryFailures > 0 ? `, ${advisoryFailures} advisory fail` : ""})`
        : `FAIL (${blockerFailures} blocker subitems failed)`,
  };
}
