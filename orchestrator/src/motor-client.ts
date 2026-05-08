import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync, readFileSync } from "fs";
import yaml from "js-yaml";
import type { MotorTurnResult } from "./types.js";
import { logDebugEvent } from "@ascendimacy/sts-shared";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Timeout pra cada chamada MCP em ms.
 *
 * Default MCP SDK é 60s — insuficiente pra pipeline real-llm que pode
 * encadear 2-4 chamadas LLM (Sonnet planejador + Kimi drota + Haiku
 * triage etc.). Default aqui é 180s; override via STS_MCP_TIMEOUT_MS.
 *
 * Pra debugar timeouts, subir pra 300000 (5 min). Pra forçar fail-fast
 * em smoke determinístico, descer pra 30000.
 */
const MCP_REQUEST_TIMEOUT = Number(
  process.env["STS_MCP_TIMEOUT_MS"] ?? "180000",
);

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
    // sts#10 debug mode — propaga pros motor children (observability cross-processo)
    "ASC_DEBUG_MODE",
    "ASC_DEBUG_RUN_ID",
    "ASC_DEBUG_DIR",
    "ASC_DEBUG_MATERIALIZER",
    // sts#13 router env keys (motor#21) — override per-callsite no motor side
    "LLM_PROVIDER",
    "PLANEJADOR_PROVIDER",
    "PLANEJADOR_MODEL",
    "PLANEJADOR_MAX_TOKENS",
    "DROTA_PROVIDER",
    "DROTA_MODEL",
    "DROTA_MAX_TOKENS",
    "HAIKU_TRIAGE_PROVIDER",
    "HAIKU_TRIAGE_MODEL",
    "HAIKU_BULLYING_PROVIDER",
    "HAIKU_BULLYING_MODEL",
    "HAIKU_MODEL", // legacy
    "ASC_LLM_TIMEOUT_PLANEJADOR",
    "ASC_LLM_TIMEOUT_DROTA",
    "ASC_LLM_TIMEOUT_HAIKU_TRIAGE",
    "ASC_LLM_TIMEOUT_SECONDS",
    "ASC_LLM_MAX_RETRIES_PLANEJADOR",
    "ASC_LLM_MAX_RETRIES_DROTA",
    "ASC_LLM_MAX_RETRIES",
    "LLM_THINKING_BUDGET_TOKENS",
    // Local provider (vLLM / llama-server) — motor-simplificacao-v1
    "LOCAL_LLM_BASE_URL",
    "LOCAL_LLM_MODEL",
    "LOCAL_LLM_API_KEY",
    "LOCAL_LLM_FREQUENCY_PENALTY",
    "LOCAL_LLM_PRESENCE_PENALTY",
    "LOCAL_LLM_MAX_RETRIES",
    "LOCAL_LLM_RETRY_BASE_MS",
    "LOCAL_LLM_THINKING",
    // Pipeline simplification flag (motor-simplificacao-v1 Step 5)
    "USE_SIMPLIFIED_PIPELINE",
    // Step-specific provider/model overrides — granular routing
    "PERSONA_SIM_PROVIDER",
    "PERSONA_SIM_MODEL",
    "MOOD_EXTRACTOR_PROVIDER",
    "MOOD_EXTRACTOR_MODEL",
    "UNIFIED_ASSESSOR_PROVIDER",
    "UNIFIED_ASSESSOR_MODEL",
    "SIGNAL_EXTRACTOR_PROVIDER",
    "SIGNAL_EXTRACTOR_MODEL",
    // 2026-05-07 Phase 2 memory (#476) — profile injection + in-session compression.
    "PROFILES_DIR",
    "DISABLE_PROFILE_INJECTION",
    "PROFILE_COMPRESS_EVERY",
    "EXTRACTOR_BASE_URL",
    "EXTRACTOR_MODEL",
    "EXTRACTOR_API_KEY",
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
  const r = result as { content: Array<{ type: string; text: string }>; isError?: boolean };
  const raw = r.content?.find((c) => c.type === "text")?.text ?? "";
  if (r.isError) {
    throw new Error(`MCP tool error: ${raw.slice(0, 300)}`);
  }
  return JSON.parse(stripFence(raw || "{}")) as T;
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
/**
 * Tamanho da janela de history que o motor recebe pra context awareness.
 * Default 6 = últimos 3 pares user/assistant (user msg + bot reply × 3).
 * Suficiente pra detectar loops + drift sem inflar prompt.
 * Override via STS_MOTOR_HISTORY_TAIL.
 */
const MOTOR_HISTORY_TAIL = (() => {
  const v = process.env["STS_MOTOR_HISTORY_TAIL"];
  if (v) {
    const n = Number.parseInt(v, 10);
    if (!Number.isNaN(n) && n > 0) return n;
  }
  return 6;
})();

export async function runMotorTurn(
  sessionId: string,
  personaMessage: string,
  turnNumber: number,
  personaId: string = "paula-mendes",
  history: Array<{ role: "user" | "assistant"; content: string }> = [],
): Promise<MotorTurnResult> {
  const clients = await tryGetMotorClients();
  if (!clients) return fixedMockResult(turnNumber);

  const motorPath = getMotorPath();
  const { persona, adquirente, inventory } = loadMotorFixtures(motorPath, personaId);
  const { planejador, motorDrota, motorExecucao } = clients;

  const stateResult = await motorExecucao.callTool(
    { name: "get_state", arguments: { sessionId } },
    undefined,
    { timeout: MCP_REQUEST_TIMEOUT },
  );
  const state = parseToolText<Record<string, unknown>>(stateResult);

  // motor#H5: load + lazy bootstrap Helix via MCP tool init_helix (idempotente).
  let helixState: Record<string, unknown> | null = null;
  try {
    const initResult = await motorExecucao.callTool(
      { name: "init_helix", arguments: { childId: persona.id } },
      undefined,
      { timeout: MCP_REQUEST_TIMEOUT },
    );
    const parsedInit = parseToolText<{ state: Record<string, unknown>; bootstrapped: boolean }>(initResult);
    helixState = parsedInit.state;
  } catch {
    // Fail-soft: helix indisponível → planejador faz fallback statusMatrix
  }

  // 2026-05-05 (sts-realista §2.4): bootstrap Gardner Program idempotente.
  // gardner_program_start tem early-return se current_week !== null. Sem isso,
  // state.gardnerProgram fica com current_week=null e plan.ts retorna
  // active=false — Program nunca dispara nem com sessions_observed=3 na fixture.
  try {
    await motorExecucao.callTool(
      { name: "gardner_program_start", arguments: { sessionId } },
      undefined,
      { timeout: MCP_REQUEST_TIMEOUT },
    );
  } catch {
    // Fail-soft: ausência de Gardner Program apenas desativa o programa, turn segue.
  }

  // 2026-05-05 (sts-realista §2.1): chamar extract_signals ANTES do planejador,
  // pra signals semânticos chegarem ao pool ranker via contextHints. Sem isso,
  // signals só são extraídos dentro do drota (pelo Unified Assessor) — tarde
  // demais pra influenciar o pool. Fail-soft: signals=[] se extractor falhar.
  //
  // recentTurns: usa history vindo do orchestrator (último N pares user/bot).
  // Motor é semi-stateless: estado estratégico (helix, status, gardner) vem do
  // sqlite; janela curta de texto vem aqui pra evitar loop sem inflar prompt.
  const stateWithRecent = state as { trustLevel?: number };
  const recentTurns = history.slice(-MOTOR_HISTORY_TAIL);
  let extractedSignals: string[] = [];
  try {
    const signalsResult = await motorDrota.callTool(
      {
        name: "extract_signals",
        arguments: {
          userMessage: personaMessage,
          personaName: persona.name,
          personaAge: persona.age,
          trustLevel: stateWithRecent.trustLevel ?? 0.3,
          conversationHistoryTail: recentTurns,
        },
      },
      undefined,
      { timeout: MCP_REQUEST_TIMEOUT },
    );
    const parsed = parseToolText<{ signals?: string[] }>(signalsResult);
    extractedSignals = Array.isArray(parsed.signals) ? parsed.signals : [];
  } catch {
    // Fail-soft: planejador segue com signals vazios.
  }

  const planResult = await planejador.callTool(
    {
      name: "plan_turn",
      arguments: {
        sessionId,
        persona,
        adquirente,
        inventory,
        state,
        incomingMessage: personaMessage,
        helixState,
        contextHints: {
          extracted_signals: extractedSignals,
          last_user_message: personaMessage,
          recent_turns: recentTurns,
        },
      },
    },
    undefined,
    { timeout: MCP_REQUEST_TIMEOUT },
  );
  const plan = parseToolText<{
    contentPool?: unknown[];
    strategicRationale?: string;
    contextHints?: Record<string, unknown>;
    instruction_addition?: string;
  }>(planResult);

  const drotaResult = await motorDrota.callTool(
    {
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
    },
    undefined,
    { timeout: MCP_REQUEST_TIMEOUT },
  );
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
    // 2026-05-05 (sts-realista §2.2): assessment exposto pelo simplified pipeline.
    assessment?: {
      mood: number;
      mood_confidence: "high" | "medium" | "low";
      mood_method: "rule" | "llm" | "fallback";
      signals: string[];
      engagement: "low" | "medium" | "high";
      rationale: string;
    };
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

  const execResult = await motorExecucao.callTool(
    {
      name: "execute_playbook",
      arguments: {
        sessionId,
        playbookId: deployProfileId,
        selectedContentId,
        output: drota.linguisticMaterialization,
        metadata: {},
      },
    },
    undefined,
    { timeout: MCP_REQUEST_TIMEOUT },
  );
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
    const newStateResult = await motorExecucao.callTool(
      {
        name: "get_state",
        arguments: { sessionId },
      },
      undefined,
      { timeout: MCP_REQUEST_TIMEOUT },
    );
    const newState = parseToolText<{ statusMatrix?: Record<string, string> }>(newStateResult);
    currentStatusMatrix = newState.statusMatrix ?? currentStatusMatrix;
  } catch {
    // Fallback: prev=curr (degrade gracioso, comportamento pré-#9).
  }

  // ─── sts#8 auto-hook (espelha motor.orchestrator.runTurn pós-#17/#18) ──
  // Falha aqui não pode quebrar o turn — mesma garantia que motor#17.
  // sts#14: agora também loga via debug-logger (faltava — débito de motor#19
  // que só wired no motor.runTurn canônico, não no espelho sts.runMotorTurn).
  let emittedCardId: string | undefined;
  let cardEmissionSkipReason: string | undefined;
  let signalKind: string | undefined;
  const autoHookT0 = Date.now();
  try {
    const selectedItem = drota.selectedContent?.item;
    const gardnerObserved = selectedItem?.gardner_channels ?? [];
    const caselTouched = selectedItem?.casel_target ?? [];
    // sts#9 — sacrifice_amount vem do item (motor#18 enriqueceu seed.json)
    const sacrificeSpent = Number(selectedItem?.sacrifice_amount ?? 0);
    const detectResult = await motorExecucao.callTool(
      {
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
      },
      undefined,
      { timeout: MCP_REQUEST_TIMEOUT },
    );
    const signal = parseToolText<unknown>(detectResult);
    if (signal && typeof signal === "object" && (signal as { kind?: unknown }).kind) {
      signalKind = String((signal as { kind?: unknown }).kind);
      const personaProfile = (persona.profile ?? {}) as Record<string, unknown>;
      const parentalProfile = personaProfile["parental_profile"];
      const emitResult = await motorExecucao.callTool(
        {
          name: "emit_card_for_signal",
          arguments: {
            signal,
            childName: persona.name,
            parentalProfile: parentalProfile && typeof parentalProfile === "object" ? parentalProfile : undefined,
          },
        },
        undefined,
        { timeout: MCP_REQUEST_TIMEOUT },
      );
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
  const autoHookMs = Date.now() - autoHookT0;

  // sts#14: debug log do auto-hook (no-op se ASC_DEBUG_MODE off).
  // Espelha o que motor#19 já fazia em motor.orchestrator.runTurn.
  logDebugEvent({
    side: "sts",
    step: "auto-hook",
    user_id: String((persona as { id: unknown }).id),
    user_kind: "child",
    motor_target: "kids",
    session_id: sessionId,
    turn_number: ((state as { turn?: number }).turn ?? null) as number | null,
    provider: null,
    model: null,
    latency_ms: autoHookMs,
    snapshots_pre: {
      ebrota: {
        prev_status_matrix: prevStatusMatrix ?? {},
        current_status_matrix: currentStatusMatrix ?? {},
        selected_content_id: drota.selectedContent?.item?.id ?? null,
        gardner_channels: drota.selectedContent?.item?.gardner_channels ?? [],
        casel_target: drota.selectedContent?.item?.casel_target ?? [],
        sacrifice_amount: drota.selectedContent?.item?.sacrifice_amount ?? 0,
      },
    },
    snapshots_post: {
      ebrota: {
        signal_kind: signalKind ?? null,
        emitted_card_id: emittedCardId ?? null,
        skip_reason: cardEmissionSkipReason ?? null,
      },
    },
    outcome: emittedCardId
      ? "ok"
      : cardEmissionSkipReason?.startsWith("auto_hook_error")
        ? "error"
        : "skip",
    error_class: cardEmissionSkipReason?.startsWith("auto_hook_error")
      ? cardEmissionSkipReason
      : null,
  });

  // motor#H5: Helix advance no fim do turn (via MCP tool advance_helix).
  // 2026-05-05 (sts-realista §2.2): mood real do Unified Assessor quando
  // disponível (simplified pipeline). Fallback proxy trustLevel quando
  // assessment ausente (pipeline antigo ou erro).
  if (helixState && !(helixState as { vacationModeActive?: boolean }).vacationModeActive) {
    const prevTrust = (state.trustLevel as number | undefined) ?? 0.3;
    const trustDelta = trustLevel - prevTrust;
    const delta = trustDelta > 0.02 ? 0.10 : trustDelta > 0 ? 0.05 : 0;
    const moodReal = drota.assessment?.mood;
    const moodFinal =
      typeof moodReal === "number" ? moodReal : trustLevel >= 0.4 ? 8 : 2;
    try {
      await motorExecucao.callTool(
        { name: "advance_helix", arguments: { childId: persona.id, delta, mood: moodFinal } },
        undefined,
        { timeout: MCP_REQUEST_TIMEOUT },
      );
    } catch {
      // Fail-soft
    }
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
