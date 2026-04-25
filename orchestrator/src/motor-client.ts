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
    // Bloco 7 sts#6 scenario runner — virtual clock + state isolation per scenario
    "STS_VIRTUAL_NOW",
    "MOTOR_STATE_DIR",
    "EBROTA_CARD_SECRET",
    "NODE_ENV",
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
/**
 * sts#8 — caches "motor unavailable" failure so we don't retry spawn every
 * turn. Lifted at process boundaries (test isolation via resetMotorClientsForTest).
 */
let _motorUnavailable = false;

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

/** sts#8 — non-throwing variant. Returns null if spawn impossible. */
async function tryGetMotorClients(): Promise<MotorClients | null> {
  if (_motorUnavailable) return null;
  try {
    return await getMotorClients();
  } catch (err) {
    _motorUnavailable = true;
    console.warn(`[sts] motor unavailable, degrading to fixed-string mock: ${String(err).slice(0, 200)}`);
    return null;
  }
}

/** Fallback usado SÓ se motor falhar ao spawn. Mantém compat com testes legados. */
function fixedMockResult(turnNumber: number): MotorTurnResult {
  return {
    botMessage: `[Mock Bot Turn ${turnNumber}] Entendo o que você está dizendo. Vamos explorar isso juntos.`,
    trustLevel: 0.5 + turnNumber * 0.02,
    budgetRemaining: 100 - turnNumber * 5,
    playbookId: "mock-playbook-01",
    motorTrace: { mock: true, turn: turnNumber, reason: "motor_spawn_failed" },
  };
}

/**
 * sts#8 — runMotorTurn passa a SEMPRE tentar motor MCP real. Mock_llm:true não
 * mais bypassa o motor; ele segue spawned mas planejador+drota usam
 * USE_MOCK_LLM internamente (sem chamar APIs Anthropic/Mistral). Isso garante
 * que o pipeline completo é exercitado: get_state→plan→drota→execute_playbook
 * + auto-hook detect_achievement→emit_card_for_signal (motor#17).
 *
 * Fallback fixed-string só se motor não conseguir spawnar (graceful degrade).
 *
 * Débito conhecido: este turn loop duplica motor.orchestrator.runTurn. Refactor
 * para delegação direta está documentado como follow-up sts v0.5+ (ver
 * docs/handoffs/INBOX.md débito sts#8 → b).
 */
export async function runMotorTurn(
  sessionId: string,
  personaMessage: string,
  turnNumber: number,
  personaId: string = "paula-mendes"
): Promise<MotorTurnResult> {
  const clients = await tryGetMotorClients();
  if (!clients) return fixedMockResult(turnNumber);

  const motorPath = getMotorPath();
  const { persona, adquirente, inventory } = loadMotorFixtures(motorPath, personaId);
  const { planejador, motorDrota, motorExecucao } = clients;

  const stateResult = await motorExecucao.callTool({ name: "get_state", arguments: { sessionId } });
  const state = parseToolText<Record<string, unknown>>(stateResult);

  const planResult = await planejador.callTool({
    name: "plan_turn",
    arguments: { sessionId, persona, adquirente, inventory, state, incomingMessage: personaMessage },
  });
  const plan = parseToolText<{
    contentPool?: unknown[];
    strategicRationale?: string;
    contextHints?: Record<string, unknown>;
    instruction_addition?: string;
  }>(planResult);

  const drotaResult = await motorDrota.callTool({
    name: "evaluate_and_select",
    arguments: {
      sessionId,
      contentPool: plan.contentPool ?? [],
      state,
      persona,
      strategicRationale: plan.strategicRationale ?? "",
      contextHints: plan.contextHints ?? {},
      instruction_addition: plan.instruction_addition ?? "",
    },
  });
  let drota = parseToolText<{
    selectedContent?: {
      item?: {
        id?: string;
        type?: string;
        gardner_channels?: string[];
        casel_target?: string[];
        sacrifice_type?: string;
        sacrifice_amount?: number;
      };
      score?: number;
    };
    linguisticMaterialization: string;
    selectionRationale?: string;
  }>(drotaResult);
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

  // playbookId default = inventory[0] (deploy profile pattern do motor.orchestrator).
  const deployProfileId = (inventory[0] as { id?: string } | undefined)?.id ?? "default";
  const selectedContentId = drota.selectedContent?.item?.id ?? "";

  const execResult = await motorExecucao.callTool({
    name: "execute_playbook",
    arguments: {
      sessionId,
      playbookId: deployProfileId,
      selectedContentId,
      output: drota.linguisticMaterialization,
      metadata: {},
    },
  });
  const exec = parseToolText<{
    newState?: { trustLevel?: number; budgetRemaining?: number };
    trustLevel?: number;
    budgetRemaining?: number;
  }>(execResult);
  const trustLevel = exec.newState?.trustLevel ?? exec.trustLevel ?? 0.5;
  const budgetRemaining = exec.newState?.budgetRemaining ?? exec.budgetRemaining ?? 100;

  // ─── sts#9 (mirror motor#18) — prev_matrix snapshot + re-fetch ───────
  // Snapshot pré-turno tirado lá em cima (state.statusMatrix), agora re-fetch
  // pra capturar matrix atualizada pelo execute_playbook. Habilita detecção
  // de status_to_pasto + crossing (brejo→baia).
  const prevStatusMatrix =
    (state as { statusMatrix?: Record<string, string> }).statusMatrix
      ? { ...(state as { statusMatrix: Record<string, string> }).statusMatrix }
      : undefined;
  let currentStatusMatrix = (state as { statusMatrix?: Record<string, string> }).statusMatrix;
  try {
    const newStateResult = await motorExecucao.callTool({
      name: "get_state",
      arguments: { sessionId },
    });
    const newState = parseToolText<{ statusMatrix?: Record<string, string> }>(newStateResult);
    currentStatusMatrix = newState.statusMatrix ?? currentStatusMatrix;
  } catch {
    // Fallback: prev=curr (degrade gracioso, comportamento pré-#9).
  }

  // ─── sts#8 auto-hook (espelha motor.orchestrator.runTurn pós-#17/#18) ──
  // Falha aqui não pode quebrar o turn — mesma garantia que motor#17.
  let emittedCardId: string | undefined;
  let cardEmissionSkipReason: string | undefined;
  try {
    const selectedItem = drota.selectedContent?.item;
    const gardnerObserved = selectedItem?.gardner_channels ?? [];
    const caselTouched = selectedItem?.casel_target ?? [];
    // sts#9 — sacrifice_amount vem do item (motor#18 enriqueceu seed.json)
    const sacrificeSpent = Number(selectedItem?.sacrifice_amount ?? 0);
    const detectResult = await motorExecucao.callTool({
      name: "detect_achievement",
      arguments: {
        childId: persona.id,
        sessionId,
        currentMatrix: currentStatusMatrix ?? {},
        previousMatrix: prevStatusMatrix ?? {},
        gardnerObserved,
        caselTouched,
        sacrificeSpent,
        selectedContent: drota.selectedContent ?? {},
      },
    });
    const signal = parseToolText<unknown>(detectResult);
    if (signal && typeof signal === "object" && (signal as { kind?: unknown }).kind) {
      const personaProfile = (persona.profile ?? {}) as Record<string, unknown>;
      const parentalProfile = personaProfile["parental_profile"];
      const emitResult = await motorExecucao.callTool({
        name: "emit_card_for_signal",
        arguments: {
          signal,
          childName: persona.name,
          parentalProfile: parentalProfile && typeof parentalProfile === "object" ? parentalProfile : undefined,
        },
      });
      const emitOutput = parseToolText<{
        ok?: boolean;
        card_id?: string;
        skipped?: boolean;
        skip_reason?: string;
      }>(emitResult);
      if (emitOutput.ok && emitOutput.card_id) {
        emittedCardId = emitOutput.card_id;
      } else if (emitOutput.skipped) {
        cardEmissionSkipReason = emitOutput.skip_reason ?? "skipped_unknown";
      }
    } else {
      cardEmissionSkipReason = "no_signal";
    }
  } catch (err) {
    cardEmissionSkipReason = `auto_hook_error:${String(err).slice(0, 120)}`;
  }

  return {
    botMessage: drota.linguisticMaterialization,
    trustLevel,
    budgetRemaining,
    playbookId: deployProfileId,
    motorTrace: { plan, drota, exec, mock: process.env["USE_MOCK_LLM"] === "true" },
    emittedCardId,
    cardEmissionSkipReason,
  };
}

/** sts#8 — usado por testes para resetar caches entre cenários. */
export function resetMotorClientsForTest(): void {
  _clients = null;
  _motorUnavailable = false;
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
