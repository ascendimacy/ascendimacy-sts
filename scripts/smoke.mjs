#!/usr/bin/env node
// Smoke test: runs 3-turn mock scenario for paula-mendes
// Validates G1-G4 green. Uses USE_MOCK_LLM=true (no real LLM).

import { createSessionTrace, finalizeTrace, addTurn } from "../shared/dist/index.js";
import { runMotorTurn } from "../orchestrator/dist/motor-client.js";
import { evaluateRubric } from "../orchestrator/dist/rubric.js";

process.env["USE_MOCK_LLM"] ??= "true";
process.env["MOTOR_PATH"] = process.env["MOTOR_PATH"] ?? "/home/alexa/ascendimacy-motor";

const PERSONA_ID = process.env["SMOKE_PERSONA"] ?? "paula-mendes";
const TURNS = Number(process.env["SMOKE_TURNS"] ?? "3");

console.log(`[smoke] Running ${TURNS}-turn mock scenario for ${PERSONA_ID}`);

const trace = createSessionTrace(PERSONA_ID);
trace.sessionId = "smoke-test-session";

const MOCK_PERSONA_RESPONSES = [
  { message: "Estou bem, obrigada.", endConversation: false, mood: "neutral" },
  { message: "Entendo. Vou pensar nisso.", endConversation: false, mood: "reflective" },
  { message: "Até logo.", endConversation: true, mood: "closing" },
];

// Mensagens reais que o sujeito ENVIA pro motor (incomingMessage). Por turn.
// Variar entre turn vazio (puxa rapport), turn com tema concreto (puxa
// materialização contextual), turn de fechamento.
const PERSONA_INCOMING_MESSAGES = {
  "ryo-ochiai": [
    "oi",
    "tava pensando nos delfins do aquário ontem, eles meio que se chamavam",
    "tô meio cansado, vou dormir",
  ],
  "kei-ochiai": [
    "oi",
    "fiquei pensando por que choro às vezes mesmo sem motivo",
    "obrigado, depois eu te conto",
  ],
  "paula-mendes": [
    "oi, tudo bem?",
    "tô meio frustrada, nada saiu como queria essa semana",
    "preciso ir agora",
  ],
};
const personaIncoming = PERSONA_INCOMING_MESSAGES[PERSONA_ID] ?? Array.from({length: TURNS}, (_, i) => `Persona message ${i + 1}`);

for (let i = 1; i <= TURNS; i++) {
  const incoming = personaIncoming[i - 1] ?? `Persona message ${i}`;
  const motorResult = await runMotorTurn(trace.sessionId, incoming, i, PERSONA_ID);
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
