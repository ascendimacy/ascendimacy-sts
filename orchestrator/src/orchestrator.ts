import { randomUUID } from "crypto";
import { createSessionTrace, finalizeTrace, addTurn } from "@ascendimacy/sts-shared";
import { runMotorTurn, closeMotorClients } from "./motor-client.js";
import { personaNextMessage, personaReset, closePersonaClient } from "./persona-client.js";
import { writeTrace } from "./trace-writer.js";
import { evaluateRubric } from "./rubric.js";
import { writeReport } from "./report.js";
import type { RunOptions } from "./types.js";
import type { STSTurnTrace } from "@ascendimacy/sts-shared";

const DEFAULT_INITIAL_MESSAGE =
  "Olá! Seja bem-vindo. Estou aqui para conversar e ajudar. O que está na sua mente hoje?";

export async function runScenario(options: RunOptions): Promise<void> {
  const { personaId, turns, initialBotMessage = DEFAULT_INITIAL_MESSAGE, dryRun = false } = options;

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
    const motorResult = await runMotorTurn(sessionId, currentBotMessage, i, personaId);

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
  const reportPath = writeReport(finalized, rubric, totalDuration);

  console.log(`\n[STS] Completed in ${(totalDuration / 1000).toFixed(1)}s`);
  console.log(`[STS] Trace: ${tracePath}`);
  console.log(`[STS] Report: ${reportPath}`);
  console.log(`[STS] Rubric: ${rubric.summary}`);
  for (const gate of rubric.gates) {
    console.log(`  ${gate.passed ? "✅" : gate.gate === "G5" ? "⚠️" : "❌"} ${gate.gate}: ${gate.detail}`);
  }

  await closePersonaClient();
  await closeMotorClients();

  if (!rubric.allMustPassGreen) {
    process.exit(1);
  }
}
