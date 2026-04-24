import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync, readFileSync } from "fs";
import yaml from "js-yaml";
import type { MotorTurnResult } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function buildEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  const keys = [
    "ANTHROPIC_API_KEY",
    "INFOMANIAK_API_KEY",
    "INFOMANIAK_BASE_URL",
    "PLANEJADOR_MODEL",
    "MOTOR_DROTA_MODEL",
    "USE_MOCK_LLM",
  ];
  for (const k of keys) {
    const v = process.env[k];
    if (v) env[k] = v;
  }
  return env;
}

function getMotorPath(): string {
  const motorPath = process.env["MOTOR_PATH"];
  if (!motorPath) throw new Error("MOTOR_PATH env var not set");
  const required = [
    join(motorPath, "planejador/dist/server.js"),
    join(motorPath, "motor-drota/dist/server.js"),
    join(motorPath, "motor-execucao/dist/server.js"),
  ];
  for (const p of required) {
    if (!existsSync(p)) {
      throw new Error(`Motor not built — missing: ${p}. Run: cd $MOTOR_PATH && npm run build`);
    }
  }
  return motorPath;
}

function loadMotorFixtures(motorPath: string, personaId: string): {
  persona: Record<string, unknown>;
  adquirente: Record<string, unknown>;
  inventory: unknown[];
} {
  const motorPersonaPath = join(motorPath, `fixtures/${personaId}.yaml`);
  const stsPersonaPath = join(__dirname, `../../fixtures/personas/${personaId}.yaml`);
  const personaPath = existsSync(motorPersonaPath) ? motorPersonaPath : stsPersonaPath;
  const personaRaw = yaml.load(readFileSync(personaPath, "utf-8")) as Record<string, unknown>;

  const priorMarkers = (personaRaw["prior"] as Record<string, unknown> | undefined)?.demographic_markers as Record<string, unknown> | undefined;
  const persona = {
    id: String(personaRaw["id"] ?? personaRaw["pessoal_id"] ?? personaId),
    name: String(personaRaw["name"] ?? priorMarkers?.["name"] ?? personaId),
    age: Number(personaRaw["age"] ?? priorMarkers?.["age"] ?? 30),
    profile: typeof personaRaw["profile"] === "string"
      ? { summary: personaRaw["profile"] }
      : (personaRaw["profile"] as Record<string, unknown>) ?? { summary: String(personaRaw["description"] ?? "").slice(0, 300) },
  };

  const adquirentePath = join(motorPath, "fixtures/adquirente-jun.md");
  const adquirenteRaw = existsSync(adquirentePath) ? readFileSync(adquirentePath, "utf-8") : "";
  const adquirente = {
    id: "jun",
    name: "Jun Ochiai",
    defaults: { style: "direto", language: "pt-br", rawRef: adquirenteRaw.slice(0, 200) },
  };

  const inventoryPath = join(motorPath, "fixtures/ebrota-inventario-v1.yaml");
  let inventory: unknown[] = [];
  if (existsSync(inventoryPath)) {
    const invRaw = yaml.load(readFileSync(inventoryPath, "utf-8")) as Record<string, unknown>;
    const entries = Array.isArray(invRaw["playbooks"]) ? invRaw["playbooks"] : [];
    inventory = entries.slice(0, 10).map((p: Record<string, unknown>, i: number) => ({
      id: String(p["id"] ?? p["name"] ?? `playbook-${i}`),
      title: String(p["title"] ?? p["name"] ?? "untitled"),
      category: String(p["category"] ?? "general"),
      estimatedSacrifice: Number(p["estimated_sacrifice"] ?? 2),
      estimatedConfidenceGain: Number(p["estimated_confidence_gain"] ?? 3),
    }));
  }

  return { persona, adquirente, inventory };
}

function stripFence(raw: string): string {
  return raw.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
}

function parseToolText<T>(result: unknown): T {
  const content = (result as { content: Array<{ type: string; text: string }> }).content;
  const raw = content.find((c) => c.type === "text")?.text ?? "{}";
  return JSON.parse(stripFence(raw)) as T;
}

interface MotorClients {
  planejador: Client;
  motorDrota: Client;
  motorExecucao: Client;
}

let _clients: MotorClients | null = null;

export async function getMotorClients(): Promise<MotorClients> {
  if (_clients) return _clients;

  const motorPath = getMotorPath();
  const env = buildEnv();
  const nodeCmd = process.execPath;

  const [planejador, motorDrota, motorExecucao] = await Promise.all([
    (async () => {
      const c = new Client({ name: "sts-planejador-client", version: "0.1.0" });
      await c.connect(new StdioClientTransport({ command: nodeCmd, args: [join(motorPath, "planejador/dist/server.js")], env }));
      return c;
    })(),
    (async () => {
      const c = new Client({ name: "sts-drota-client", version: "0.1.0" });
      await c.connect(new StdioClientTransport({ command: nodeCmd, args: [join(motorPath, "motor-drota/dist/server.js")], env }));
      return c;
    })(),
    (async () => {
      const c = new Client({ name: "sts-execucao-client", version: "0.1.0" });
      await c.connect(new StdioClientTransport({ command: nodeCmd, args: [join(motorPath, "motor-execucao/dist/server.js")], env }));
      return c;
    })(),
  ]);

  _clients = { planejador, motorDrota, motorExecucao };
  return _clients;
}

export async function runMotorTurn(
  sessionId: string,
  personaMessage: string,
  turnNumber: number,
  personaId: string = "paula-mendes"
): Promise<MotorTurnResult> {
  if (process.env["USE_MOCK_LLM"] === "true") {
    return {
      botMessage: `[Mock Bot Turn ${turnNumber}] Entendo o que você está dizendo. Vamos explorar isso juntos.`,
      trustLevel: 0.5 + turnNumber * 0.02,
      budgetRemaining: 100 - turnNumber * 5,
      playbookId: "mock-playbook-01",
      motorTrace: { mock: true, turn: turnNumber },
    };
  }

  const motorPath = getMotorPath();
  const { persona, adquirente, inventory } = loadMotorFixtures(motorPath, personaId);
  const { planejador, motorDrota, motorExecucao } = await getMotorClients();

  const stateResult = await motorExecucao.callTool({ name: "get_state", arguments: { sessionId } });
  const state = parseToolText<Record<string, unknown>>(stateResult);

  const planResult = await planejador.callTool({
    name: "plan_turn",
    arguments: { sessionId, persona, adquirente, inventory, state, incomingMessage: personaMessage },
  });
  const plan = parseToolText<{
    candidateActions: unknown[];
    strategicRationale: string;
    contextHints: Record<string, unknown>;
  }>(planResult);

  const drotaResult = await motorDrota.callTool({
    name: "evaluate_and_select",
    arguments: {
      sessionId,
      candidateActions: plan.candidateActions,
      state,
      persona,
      strategicRationale: plan.strategicRationale,
      contextHints: plan.contextHints ?? {},
    },
  });
  let drota = parseToolText<{
    selectedAction: { playbookId: string };
    linguisticMaterialization: string;
    actualSacrifice: number;
    actualConfidenceGain: number;
  }>(drotaResult);
  // drota may return linguisticMaterialization wrapping the full JSON again (fence or not); unwrap
  const lm = drota.linguisticMaterialization;
  if (typeof lm === "string") {
    const stripped = stripFence(lm);
    if (stripped.startsWith("{")) {
      try {
        const inner = JSON.parse(stripped) as typeof drota;
        if (inner.linguisticMaterialization) drota = { ...drota, ...inner };
      } catch { /* leave as-is */ }
    }
  }

  const execResult = await motorExecucao.callTool({
    name: "execute_playbook",
    arguments: {
      sessionId,
      playbookId: drota.selectedAction.playbookId,
      output: drota.linguisticMaterialization,
      metadata: {},
    },
  });
  const exec = parseToolText<{ newState: { trustLevel: number; budgetRemaining: number } }>(execResult);

  return {
    botMessage: drota.linguisticMaterialization,
    trustLevel: exec.newState?.trustLevel ?? 0.5,
    budgetRemaining: exec.newState?.budgetRemaining ?? 100,
    playbookId: drota.selectedAction.playbookId,
    motorTrace: { plan, drota, exec },
  };
}

export async function closeMotorClients(): Promise<void> {
  if (_clients) {
    await Promise.all([
      _clients.planejador.close(),
      _clients.motorDrota.close(),
      _clients.motorExecucao.close(),
    ]);
    _clients = null;
  }
}
