import { randomUUID } from "crypto";
import { createSessionTrace, finalizeTrace, addTurn } from "@ascendimacy/sts-shared";
import { runMotorTurn, closeMotorClients } from "./motor-client.js";
import { personaNextMessage, personaReset, personaFinalizeSession, closePersonaClient } from "./persona-client.js";
import { writeTrace } from "./trace-writer.js";
import { evaluateRubric, evaluateRubricV2 } from "./rubric.js";
import { writeReport } from "./report.js";
import type { RunOptions } from "./types.js";
import type { STSTurnTrace } from "@ascendimacy/sts-shared";

const DEFAULT_INITIAL_MESSAGE =
  "Olá! Seja bem-vindo. Estou aqui para conversar e ajudar. O que está na sua mente hoje?";

export async function runScenario(options: RunOptions): Promise<void> {
  const {
    personaId,
    turns,
    initialBotMessage = DEFAULT_INITIAL_MESSAGE,
    dryRun = false,
    scenario,
    scenarioEventLabel,
  } = options;

  if (dryRun) {
    console.log(`[dry-run] Would run scenario:`);
    console.log(`  persona: ${personaId}`);
    console.log(`  turns: ${turns}`);
    console.log(`  initialBotMessage: ${initialBotMessage}`);
    return;
  }

  const sessionId = randomUUID();
  const trace = createSessionTrace(personaId);
  trace.sessionId = sessionId;

  await personaReset(personaId);

  const history: Array<{ role: "user" | "assistant"; content: string }> = [];
  let currentBotMessage = initialBotMessage;
  const startMs = Date.now();

  console.log(`\n[STS] Starting scenario: ${personaId} × ${turns} turns (session ${sessionId})`);
  console.log(`[STS] Initial bot: ${currentBotMessage}\n`);

  for (let i = 1; i <= turns; i++) {
    const turnStart = Date.now();

    // Get motor response
    // history aqui é o array (assistant=bot, user=persona) acumulado até agora.
    // 2026-05-05 (sts-realista): motor passa a receber recentHistory pra
    // alimentar context awareness do unified-assessor + materializer.
    const motorResult = await runMotorTurn(sessionId, currentBotMessage, i, personaId, history);

    // Get persona response to bot's message
    const personaResult = await personaNextMessage(personaId, motorResult.botMessage, history);

    history.push({ role: "assistant", content: motorResult.botMessage });
    history.push({ role: "user", content: personaResult.message });

    const turnDuration = Date.now() - turnStart;

    const turnTrace: STSTurnTrace = {
      turn: i,
      botMessage: motorResult.botMessage,
      personaMessage: personaResult.message,
      trustLevel: motorResult.trustLevel,
      budgetRemaining: motorResult.budgetRemaining,
      playbookId: motorResult.playbookId,
      durationMs: turnDuration,
      motorTrace: motorResult.motorTrace,
      emittedCardId: motorResult.emittedCardId,
      cardEmissionSkipReason: motorResult.cardEmissionSkipReason,
      personaEntry: {
        personaId,
        mood: personaResult.metadata?.mood,
        endConversation: personaResult.endConversation,
      },
    };

    addTurn(trace, turnTrace);

    console.log(`[Turn ${i}] Bot: ${motorResult.botMessage.slice(0, 80)}...`);
    console.log(`[Turn ${i}] ${personaId}: ${personaResult.message.slice(0, 80)}...`);
    console.log(`[Turn ${i}] trust=${motorResult.trustLevel.toFixed(2)} budget=${motorResult.budgetRemaining} ${turnDuration}ms\n`);

    currentBotMessage = personaResult.message;

    if (personaResult.endConversation) {
      console.log(`[STS] Persona ended conversation at turn ${i}`);
      break;
    }
  }

  const finalized = finalizeTrace(trace);
  const totalDuration = Date.now() - startMs;

  const tracePath = writeTrace(finalized);
  const rubric = evaluateRubric(finalized, turns);
  const rubricV2 = evaluateRubricV2(finalized, scenario?.rubric_v2);
  const reportPath = writeReport(finalized, rubric, rubricV2, totalDuration);

  console.log(`\n[STS] Completed in ${(totalDuration / 1000).toFixed(1)}s`);
  console.log(`[STS] Trace: ${tracePath}`);
  console.log(`[STS] Report: ${reportPath}`);
  console.log(`[STS] Rubric: ${rubric.summary}`);
  for (const gate of rubric.gates) {
    console.log(`  ${gate.passed ? "✅" : gate.gate === "G5" ? "⚠️" : "❌"} ${gate.gate}: ${gate.detail}`);
  }
  if (scenarioEventLabel) {
    console.log(`[STS] Scenario label: ${scenarioEventLabel}`);
  }
  if (rubricV2.enabled) {
    console.log(`[STS] Rubric V2: ${rubricV2.summary}`);
    for (const item of rubricV2.subitems) {
      const icon = item.status === "PASS" ? "✅" : item.status === "FAIL" ? "❌" : item.status === "NOT_TRIGGERED" ? "⏭️" : "⚠️";
      console.log(`  ${icon} ${item.id}: ${item.detail}`);
    }
  }

  // Subject Knowledge Fase 8: finaliza sessão (LLM summarize + persist cross-session memory).
  // Multi-session scenarios precisam disso pra próxima sessão herdar contexto da persona.
  // Single-session legacy scenarios não atrapalham — só geram summary descartado depois.
  try {
    const finalTrustVal = finalized.turns.length > 0
      ? finalized.turns[finalized.turns.length - 1]?.trustLevel
      : undefined;
    const finalizeResult = await personaFinalizeSession(personaId, finalTrustVal);
    if (finalizeResult.ok && finalizeResult.summary_preview) {
      console.log(`[STS] Persona memory updated (sessions=${finalizeResult.sessions_count}): ${finalizeResult.summary_preview}`);
    }
  } catch (err) {
    console.log(`[STS] (persona_finalize_session failed: ${(err as Error).message} — continuing)`);
  }

  await closePersonaClient();
  await closeMotorClients();

  if (!rubric.allMustPassGreen || rubricV2.blockerFailures > 0) {
    process.exit(1);
  }
}
