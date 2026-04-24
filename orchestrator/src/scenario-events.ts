/**
 * Scenario event dispatcher + handlers — sts#6.
 * Cada handler é assíncrono + puro no shape (retorna EventOutcome).
 * State side-effects acontecem via:
 *   - sessão em sts runScenario() (solo/joint)
 *   - MCP tool call direto (gardner_advance)
 *   - SQLite direto (inject_status)
 *   - stub (parent_onboarding v1)
 */

import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ScenarioEvent } from "@ascendimacy/sts-shared";
import type { MotorClients } from "./types.js";

/* eslint-disable @typescript-eslint/no-unused-vars */

export interface EventOutcome {
  day: number;
  type: string;
  persona?: string;
  personas?: string[];
  success: boolean;
  duration_ms: number;
  notes?: string;
  error?: string;
}

/** Dispatch principal — recebe event + state e delega pro handler apropriado. */
export interface EventContext {
  scenario_name: string;
  state_dir: string;
  iso_now: string;
  motorPath: string;
  clients?: MotorClients | null;
  /**
   * Factory pra reconectar clients lazily — necessário porque runScenario
   * (sessões solo/joint) fecha motor clients ao fim. Eventos posteriores
   * (gardner_advance) precisam reconectar.
   */
  clientsFactory?: () => Promise<MotorClients>;
  /** Callbacks — sts re-usa runScenario existente injetando estes. */
  runSoloSession?: (personaId: string, turns: number, sessionId: string) => Promise<void>;
  runJointSession?: (
    personaA: string,
    personaB: string,
    turns: number,
    sessionId: string,
  ) => Promise<void>;
}

function ensureStateDir(stateDir: string): void {
  if (!existsSync(stateDir)) {
    mkdirSync(stateDir, { recursive: true });
  }
}

function openStateDb(stateDir: string): Database.Database {
  ensureStateDir(stateDir);
  const path = join(stateDir, ".motor-state.db");
  return new Database(path);
}

/** Escreve um tree_node zone='status' diretamente — usado por inject_status. */
export function injectStatusDirect(
  stateDir: string,
  sessionId: string,
  dimension: string,
  value: "brejo" | "baia" | "pasto",
  now: string,
): void {
  const db = openStateDb(stateDir);
  try {
    // Espelha DDL do motor/tree-nodes.ts pra que injeção funcione mesmo que
    // motor ainda não tenha sido spawned no scenario.
    db.exec(`
      CREATE TABLE IF NOT EXISTS tree_nodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        zone TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT,
        source TEXT NOT NULL DEFAULT 'engine',
        state TEXT NOT NULL DEFAULT 'seed',
        sensitivity TEXT NOT NULL DEFAULT 'free',
        urgency INTEGER NOT NULL DEFAULT 1,
        importance INTEGER NOT NULL DEFAULT 1,
        half_life_days INTEGER,
        last_active_at TEXT,
        cooldown_until TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(session_id, zone, key)
      );
    `);
    db.prepare(
      `INSERT INTO tree_nodes
        (session_id, zone, key, value, source, state, sensitivity, urgency, importance,
         half_life_days, last_active_at, created_at, updated_at)
       VALUES (?, 'status', ?, ?, 'scenario_inject', 'done', 'free', 10, 10, NULL, ?, ?, ?)
       ON CONFLICT(session_id, zone, key) DO UPDATE SET
         value = excluded.value,
         source = excluded.source,
         state = excluded.state,
         updated_at = excluded.updated_at`,
    ).run(sessionId, dimension, value, now, now, now);
  } finally {
    db.close();
  }
}

async function handleParentOnboarding(
  event: ScenarioEvent,
  _ctx: EventContext,
): Promise<EventOutcome> {
  const start = Date.now();
  // v1 stub — onboarding real exige LLM roundtrip com persona. Scenario runner
  // documenta o evento; orchestrator pode usar sts persona-simulator separado.
  return {
    day: event.day,
    type: event.type,
    persona: event.persona,
    success: true,
    duration_ms: Date.now() - start,
    notes: `stub v1 — parent ${event.persona} onboarding consumido, ${event.turns ?? 0} turns`,
  };
}

async function handleSoloSession(
  event: ScenarioEvent,
  ctx: EventContext,
): Promise<EventOutcome> {
  const start = Date.now();
  if (!ctx.runSoloSession) {
    return {
      day: event.day,
      type: event.type,
      persona: event.persona,
      success: false,
      duration_ms: Date.now() - start,
      error: "runSoloSession callback not provided",
    };
  }
  const sessionId = `${ctx.scenario_name}-${event.persona}-d${event.day}`;
  try {
    await ctx.runSoloSession(event.persona!, event.turns ?? 10, sessionId);
    return {
      day: event.day,
      type: event.type,
      persona: event.persona,
      success: true,
      duration_ms: Date.now() - start,
    };
  } catch (err) {
    return {
      day: event.day,
      type: event.type,
      persona: event.persona,
      success: false,
      duration_ms: Date.now() - start,
      error: String(err),
    };
  }
}

async function handleJointSession(
  event: ScenarioEvent,
  ctx: EventContext,
): Promise<EventOutcome> {
  const start = Date.now();
  if (!ctx.runJointSession) {
    return {
      day: event.day,
      type: event.type,
      personas: event.personas,
      success: false,
      duration_ms: Date.now() - start,
      error: "runJointSession callback not provided",
    };
  }
  const [a, b] = event.personas!;
  const sessionId = `${ctx.scenario_name}-joint-${a}-${b}-d${event.day}`;
  try {
    await ctx.runJointSession(a!, b!, event.turns ?? 10, sessionId);
    return {
      day: event.day,
      type: event.type,
      personas: event.personas,
      success: true,
      duration_ms: Date.now() - start,
    };
  } catch (err) {
    return {
      day: event.day,
      type: event.type,
      personas: event.personas,
      success: false,
      duration_ms: Date.now() - start,
      error: String(err),
    };
  }
}

async function handleGardnerAdvance(
  event: ScenarioEvent,
  ctx: EventContext,
): Promise<EventOutcome> {
  const start = Date.now();
  // Reconecta lazy — clients podem ter sido fechados por runScenario anterior.
  let clients = ctx.clients;
  if (!clients?.motorExecucao && ctx.clientsFactory) {
    try {
      clients = await ctx.clientsFactory();
    } catch (err) {
      return {
        day: event.day,
        type: event.type,
        persona: event.persona,
        success: false,
        duration_ms: Date.now() - start,
        error: `failed to reconnect clients: ${err}`,
      };
    }
  }
  if (!clients?.motorExecucao) {
    return {
      day: event.day,
      type: event.type,
      persona: event.persona,
      success: false,
      duration_ms: Date.now() - start,
      error: "motorExecucao client not available",
    };
  }
  const sessionId = `${ctx.scenario_name}-${event.persona}-gardner`;
  try {
    // Garante programa existe; depois avança.
    await clients.motorExecucao.callTool({
      name: "gardner_program_start",
      arguments: { sessionId },
    });
    const result = await clients.motorExecucao.callTool({
      name: "gardner_program_advance",
      arguments: { sessionId },
    });
    return {
      day: event.day,
      type: event.type,
      persona: event.persona,
      success: true,
      duration_ms: Date.now() - start,
      notes: extractText(result),
    };
  } catch (err) {
    return {
      day: event.day,
      type: event.type,
      persona: event.persona,
      success: false,
      duration_ms: Date.now() - start,
      error: String(err),
    };
  }
}

async function handleInjectStatus(
  event: ScenarioEvent,
  ctx: EventContext,
): Promise<EventOutcome> {
  const start = Date.now();
  try {
    const sessionId = `${ctx.scenario_name}-${event.persona}-d${event.day}`;
    injectStatusDirect(
      ctx.state_dir,
      sessionId,
      event.dimension!,
      event.value!,
      ctx.iso_now,
    );
    return {
      day: event.day,
      type: event.type,
      persona: event.persona,
      success: true,
      duration_ms: Date.now() - start,
      notes: `${event.dimension}=${event.value} injetado em session ${sessionId}`,
    };
  } catch (err) {
    return {
      day: event.day,
      type: event.type,
      persona: event.persona,
      success: false,
      duration_ms: Date.now() - start,
      error: String(err),
    };
  }
}

function extractText(result: unknown): string {
  try {
    const content = (result as { content: Array<{ type: string; text: string }> }).content;
    const text = content.find((c) => c.type === "text")?.text ?? "";
    return text.slice(0, 200);
  } catch {
    return "";
  }
}

/** Main dispatch. */
export async function dispatchEvent(
  event: ScenarioEvent,
  ctx: EventContext,
): Promise<EventOutcome> {
  switch (event.type) {
    case "parent_onboarding":
      return handleParentOnboarding(event, ctx);
    case "solo_session":
      return handleSoloSession(event, ctx);
    case "joint_session":
      return handleJointSession(event, ctx);
    case "gardner_advance":
      return handleGardnerAdvance(event, ctx);
    case "inject_status":
      return handleInjectStatus(event, ctx);
    default:
      return {
        day: event.day,
        type: String(event.type),
        success: false,
        duration_ms: 0,
        error: "unknown event type",
      };
  }
}
