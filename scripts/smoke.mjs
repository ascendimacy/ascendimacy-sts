#!/usr/bin/env node
// Smoke test: runs 3-turn mock scenario for paula-mendes
// Validates G1-G4 green. Uses USE_MOCK_LLM=true (no real LLM).

import { createSessionTrace, finalizeTrace, addTurn } from "../shared/dist/index.js";
import { runMotorTurn } from "../orchestrator/dist/motor-client.js";
import { evaluateRubric } from "../orchestrator/dist/rubric.js";

process.env["USE_MOCK_LLM"] = "true";
process.env["MOTOR_PATH"] = process.env["MOTOR_PATH"] ?? "/home/alexa/ascendimacy-motor";

const PERSONA_ID = "paula-mendes";
const TURNS = 3;

console.log(`[smoke] Running ${TURNS}-turn mock scenario for ${PERSONA_ID}`);

const trace = createSessionTrace(PERSONA_ID);
trace.sessionId = "smoke-test-session";

const MOCK_PERSONA_RESPONSES = [
  { message: "Estou bem, obrigada.", endConversation: false, mood: "neutral" },
  { message: "Entendo. Vou pensar nisso.", endConversation: false, mood: "reflective" },
  { message: "Até logo.", endConversation: true, mood: "closing" },
];

for (let i = 1; i <= TURNS; i++) {
  const motorResult = await runMotorTurn(trace.sessionId, `Persona message ${i}`, i);
  const personaResp = MOCK_PERSONA_RESPONSES[i - 1];

  addTurn(trace, {
    turn: i,
    botMessage: motorResult.botMessage,
    personaMessage: personaResp.message,
    trustLevel: motorResult.trustLevel,
    budgetRemaining: motorResult.budgetRemaining,
    playbookId: motorResult.playbookId,
    durationMs: 50,
    motorTrace: motorResult.motorTrace,
    personaEntry: {
      personaId: PERSONA_ID,
      mood: personaResp.mood,
      endConversation: personaResp.endConversation,
    },
  });

  console.log(`[smoke] Turn ${i}: ${motorResult.botMessage.slice(0, 60)}...`);
}

const finalized = finalizeTrace(trace);
const rubric = evaluateRubric(finalized, TURNS);

console.log(`\n[smoke] Result: ${rubric.summary}`);
for (const gate of rubric.gates) {
  const icon = gate.passed ? "✅" : gate.gate === "G5" ? "⚠️" : "❌";
  console.log(`  ${icon} ${gate.gate}: ${gate.detail}`);
}

if (!rubric.allMustPassGreen) {
  console.error("[smoke] FAILED — G1-G4 not all green");
  process.exit(1);
}

console.log("\n[smoke] PASS");
