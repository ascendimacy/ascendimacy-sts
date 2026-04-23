import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { PersonaNextMessageOutput } from "@ascendimacy/sts-shared";

const __dirname = dirname(fileURLToPath(import.meta.url));

let _client: Client | null = null;

function buildEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  const keys = ["ANTHROPIC_API_KEY", "USE_MOCK_LLM"];
  for (const k of keys) {
    const v = process.env[k];
    if (v) env[k] = v;
  }
  return env;
}

const MOCK_RESPONSES: Record<string, string[]> = {
  "paula-mendes": [
    "Olá. Estou passando por um momento de estagnação profissional.",
    "Entendo. Mas não acho que é burnout, é apenas cansaço acumulado.",
    "Você mencionou limites. É curioso, porque sempre coloquei a carreira em primeiro lugar.",
    "Acho que faz sentido. Obrigada pela conversa.",
  ],
  "ryo-ochiai": [
    "Hmm... tá. O que você quer saber?",
    "Dragon Ball? Sim, gosto muito. O arco do Cell é o melhor.",
    "Quero ser bom no que faço. Diferente do Kei, sabe? Ele tem o tênis.",
    "Acho que sim. Até.",
  ],
  "kei-ochiai": [
    "Olá.",
    "Tênis está indo bem. Treinei ontem com meu pai.",
    "Sim, me ajuda pensar passo a passo. 1, 2, 3.",
    "Ok. Até mais.",
  ],
};

function mockPersonaResponse(personaId: string, turnIndex: number): PersonaNextMessageOutput {
  const responses = MOCK_RESPONSES[personaId] ?? MOCK_RESPONSES["paula-mendes"]!;
  const msg = responses[turnIndex % responses.length]!;
  const isLast = turnIndex >= responses.length - 1;
  return {
    message: msg,
    endConversation: isLast,
    metadata: { mood: isLast ? "closing" : "engaged" },
  };
}

export async function getPersonaClient(): Promise<Client> {
  if (_client) return _client;

  _client = new Client({ name: "sts-persona-client", version: "0.1.0" });
  const serverPath = join(__dirname, "../../persona-simulator/dist/server.js");

  await _client.connect(
    new StdioClientTransport({
      command: "node",
      args: [serverPath],
      env: buildEnv(),
    })
  );
  return _client;
}

export async function personaNextMessage(
  personaId: string,
  botMessage: string,
  history: Array<{ role: "user" | "assistant"; content: string }>
): Promise<PersonaNextMessageOutput> {
  if (process.env["USE_MOCK_LLM"] === "true") {
    const turnIndex = Math.floor(history.length / 2);
    return mockPersonaResponse(personaId, turnIndex);
  }

  const client = await getPersonaClient();
  const result = await client.callTool({
    name: "persona_next_message",
    arguments: { personaId, botMessage, history },
  });
  const text = (result.content as Array<{ type: string; text: string }>)[0]!.text;
  return JSON.parse(text) as PersonaNextMessageOutput;
}

export async function personaReset(personaId: string): Promise<void> {
  if (process.env["USE_MOCK_LLM"] === "true") return;
  const client = await getPersonaClient();
  await client.callTool({ name: "persona_reset", arguments: { personaId } });
}

export async function closePersonaClient(): Promise<void> {
  if (_client) {
    await _client.close();
    _client = null;
  }
}
