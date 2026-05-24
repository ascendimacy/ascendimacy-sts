import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

/**
 * MCP request timeout pra callTool — D-3-PROV motor#1055 follow-up.
 *
 * Default 300_000ms (5min) cobre cold-prefix LLM local (Qwen3-30B em
 * Arc B580: turns observados até 123s no smoke 2026-05-24). MCP SDK
 * default = 60s, insuficiente — gerava McpError -32001 Request timed
 * out em smokes com LLM real, mesmo quando llama-server respondia.
 * Override via env MCP_CALL_TIMEOUT_MS.
 */
function mcpRequestOptions(): { timeout: number } {
  const env = process.env["MCP_CALL_TIMEOUT_MS"];
  const n = env ? Number.parseInt(env, 10) : NaN;
  return { timeout: Number.isFinite(n) && n > 0 ? n : 300_000 };
}
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { PersonaNextMessageOutput } from "@ascendimacy/sts-shared";

const __dirname = dirname(fileURLToPath(import.meta.url));

let _client: Client | null = null;

function buildEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  const keys = [
    "ANTHROPIC_API_KEY",
    "USE_MOCK_LLM",
    // sts#10 debug mode — propaga pros persona-simulator child
    "ASC_DEBUG_MODE",
    "ASC_DEBUG_RUN_ID",
    "ASC_DEBUG_DIR",
    // sts#13: persona-simulator agora pode usar Infomaniak por default (motor#21).
    // Sem essas keys propagadas, child throws "INFOMANIAK_API_KEY não setado".
    "INFOMANIAK_API_KEY",
    "INFOMANIAK_BASE_URL",
    // sts#13: router env keys pra override per-callsite (motor#21)
    "LLM_PROVIDER",
    "PERSONA_SIM_PROVIDER",
    "PERSONA_SIM_MODEL",
    "PERSONA_SIM_MAX_TOKENS",
    "ASC_LLM_TIMEOUT_PERSONA_SIM",
    "ASC_LLM_MAX_RETRIES_PERSONA_SIM",
    "ASC_LLM_TIMEOUT_SECONDS",
    "ASC_LLM_MAX_RETRIES",
    "LLM_THINKING_BUDGET_TOKENS",
    // LLM local (openai-compat, D-3-PROV motor#1055) — endpoint
    // + model usados pelo bypass callOpenAiCompatPersona em
    // persona-simulator/llm-client.ts. Sem essas, persona-sim
    // subspawn cai no default localhost:8080/v1/chat/completions
    // (que no setup do desenvolvedor coincide com Open WebUI → 405).
    "LLM_LOCAL_ENDPOINT",
    "LLM_LOCAL_MODEL",
  ];
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
  const result = await client.callTool(
    {
      name: "persona_next_message",
      arguments: { personaId, botMessage, history },
    },
    undefined,
    mcpRequestOptions(),
  );
  const r = result as { content: Array<{ type: string; text: string }>; isError?: boolean };
  const text = r.content?.find((c) => c.type === "text")?.text ?? "";
  if (r.isError) {
    throw new Error(`persona-sim MCP error: ${text.slice(0, 300)}`);
  }
  return JSON.parse(text) as PersonaNextMessageOutput;
}

export async function personaReset(personaId: string): Promise<void> {
  if (process.env["USE_MOCK_LLM"] === "true") return;
  const client = await getPersonaClient();
  await client.callTool(
    { name: "persona_reset", arguments: { personaId } },
    undefined,
    mcpRequestOptions(),
  );
}

export async function closePersonaClient(): Promise<void> {
  if (_client) {
    await _client.close();
    _client = null;
  }
}
