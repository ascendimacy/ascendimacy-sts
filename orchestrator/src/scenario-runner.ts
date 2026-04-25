/**
 * Scenario runner — sts#6 orchestra eventos multi-dia de um cenário YAML.
 *
 * Fluxo:
 *   1. Lê + valida YAML
 *   2. Cria state_dir (isolado por scenario)
 *   3. Para cada evento: seta STS_VIRTUAL_NOW = dia ISO, MOTOR_STATE_DIR = state_dir,
 *      dispatcha pro handler apropriado
 *   4. Ao fim, gera reports/<scenario>/consolidated.md
 *
 * v1 simplificações:
 *   - mock_llm=true default (evita custo LLM)
 *   - NODE_ENV=test (permite emitCard com scaffolds)
 *   - parent_onboarding é stub (v1)
 *   - motor spawn é caller-controlled; runner seta env antes de qualquer spawn
 */

import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import yaml from "js-yaml";
import { parseScenario, dayToIso, initDebugRun, isDebugModeEnabled } from "@ascendimacy/sts-shared";
import type { Scenario, ScenarioEvent } from "@ascendimacy/sts-shared";
import { dispatchEvent } from "./scenario-events.js";
import type { EventOutcome, EventContext } from "./scenario-events.js";
import {
  generateConsolidatedReport,
  type ConsolidatedReport,
} from "./scenario-report.js";

export interface ScenarioRunOptions {
  /** Path absoluto ou relativo ao .yaml. */
  scenarioPath: string;
  /** Diretório pros reports — default: reports/<scenario_name>/ relativo ao cwd. */
  reportsDir?: string;
  /** Override mock_llm (default: valor do YAML). */
  forceMockLlm?: boolean;
  /** Callbacks de sessão — sts caller injeta runScenario + jointSession. */
  runSoloSession?: EventContext["runSoloSession"];
  runJointSession?: EventContext["runJointSession"];
  /** MCP clients pra gardner_advance. */
  clients?: EventContext["clients"];
  /** Factory pra reconectar clients lazily entre eventos. */
  clientsFactory?: EventContext["clientsFactory"];
  /** Motor path (exigido pra sistema detectar motor binário). */
  motorPath?: string;
  /** Verbose log. */
  verbose?: boolean;
}

export interface ScenarioRunResult {
  scenario: Scenario;
  outcomes: EventOutcome[];
  report: ConsolidatedReport;
  state_dir: string;
  reports_dir: string;
}

function loadScenarioFromFile(path: string): Scenario {
  const raw = yaml.load(readFileSync(path, "utf-8"));
  const result = parseScenario(raw);
  if (!result.valid || !result.scenario) {
    throw new Error(
      `Scenario invalid (${path}):\n  - ${result.errors.join("\n  - ")}`,
    );
  }
  return result.scenario;
}

function resolveStateDir(scenario: Scenario, scenarioPath: string): string {
  const dir = scenario.state_dir ?? `.sts/state/${scenario.name}`;
  const base = dirname(resolve(scenarioPath));
  const abs = resolve(base, "..", dir);
  if (!existsSync(abs)) mkdirSync(abs, { recursive: true });
  return abs;
}

function resolveReportsDir(scenario: Scenario, scenarioPath: string, override?: string): string {
  if (override) {
    const abs = resolve(override);
    if (!existsSync(abs)) mkdirSync(abs, { recursive: true });
    return abs;
  }
  const base = dirname(resolve(scenarioPath));
  const abs = resolve(base, "..", "reports", scenario.name);
  if (!existsSync(abs)) mkdirSync(abs, { recursive: true });
  return abs;
}

function setEventEnv(stateDir: string, isoNow: string, mockLlm: boolean): void {
  process.env["MOTOR_STATE_DIR"] = stateDir;
  process.env["STS_VIRTUAL_NOW"] = isoNow;
  // emitCard exige NODE_ENV=test pra permitir scaffold archetypes (Bloco 5a guard).
  process.env["NODE_ENV"] = "test";
  if (mockLlm) process.env["USE_MOCK_LLM"] = "true";
}

export async function runScenarioFromFile(opts: ScenarioRunOptions): Promise<ScenarioRunResult> {
  const scenario = loadScenarioFromFile(opts.scenarioPath);
  const stateDir = resolveStateDir(scenario, opts.scenarioPath);
  const reportsDir = resolveReportsDir(scenario, opts.scenarioPath, opts.reportsDir);
  const mockLlm = opts.forceMockLlm ?? scenario.mock_llm ?? true;

  // sts#10: inicializa debug run se flag ligado. Gera run_id auto + manifest +
  // exporta ASC_DEBUG_RUN_ID pros children (motor + persona-simulator)
  // propagarem via buildEnv().
  let debugRunId: string | null = null;
  if (isDebugModeEnabled()) {
    debugRunId = initDebugRun({
      scenarioName: scenario.name,
      personas: scenario.personas ?? [],
      parents: scenario.parents ?? [],
      versions: { sts_schema: "1.0" },
    });
  }

  if (opts.verbose) {
    console.log(`[scenario] ${scenario.name}`);
    console.log(`[scenario] ${scenario.events.length} events, ${scenario.start_date} → ${scenario.end_date}`);
    console.log(`[scenario] state_dir: ${stateDir}`);
    console.log(`[scenario] reports_dir: ${reportsDir}`);
    console.log(`[scenario] mock_llm: ${mockLlm}`);
    if (debugRunId) {
      console.log(`[scenario] debug_run_id: ${debugRunId}`);
      console.log(`[scenario] debug_dir: ${process.env["ASC_DEBUG_DIR"] ?? "./logs/debug"}/${debugRunId}`);
    }
  }

  // sts#11: per-event timeout. Default 180s — 30d scenario com evento travado
  // não pendura indefinidamente. Override via ASC_EVENT_TIMEOUT_SECONDS.
  const eventTimeoutMs = (() => {
    const v = process.env["ASC_EVENT_TIMEOUT_SECONDS"];
    if (v) {
      const n = Number.parseInt(v, 10);
      if (!Number.isNaN(n) && n > 0) return n * 1000;
    }
    return 180_000;
  })();

  const outcomes: EventOutcome[] = [];
  for (const event of scenario.events) {
    const isoNow = dayToIso(scenario.start_date, event.day);
    setEventEnv(stateDir, isoNow, mockLlm);
    const ctx: EventContext = {
      scenario_name: scenario.name,
      state_dir: stateDir,
      iso_now: isoNow,
      motorPath: opts.motorPath ?? process.env["MOTOR_PATH"] ?? "",
      clients: opts.clients,
      clientsFactory: opts.clientsFactory,
      runSoloSession: opts.runSoloSession,
      runJointSession: opts.runJointSession,
    };
    if (opts.verbose) {
      console.log(`[day ${event.day}] ${event.type} ${event.persona ?? event.personas?.join("+") ?? ""} (${isoNow.slice(0, 10)})`);
    }
    const startMs = Date.now();
    const outcome = await Promise.race([
      dispatchEvent(event, ctx),
      new Promise<EventOutcome>((resolve) =>
        setTimeout(
          () =>
            resolve({
              day: event.day,
              type: event.type,
              persona: event.persona,
              success: false,
              duration_ms: Date.now() - startMs,
              error: `event_timeout: exceeded ${eventTimeoutMs / 1000}s (ASC_EVENT_TIMEOUT_SECONDS)`,
            }),
          eventTimeoutMs,
        ),
      ),
    ]);
    outcomes.push(outcome);
    if (opts.verbose) {
      const status = outcome.success ? "✓" : outcome.error?.startsWith("event_timeout") ? "⏱" : "✗";
      console.log(`  → ${status} ${outcome.duration_ms}ms ${outcome.notes ?? outcome.error ?? ""}`);
    }
  }

  const report = generateConsolidatedReport(scenario, outcomes, stateDir, reportsDir);
  if (opts.verbose) {
    console.log(`\n[scenario] Report: ${join(reportsDir, "consolidated.md")}`);
  }
  return { scenario, outcomes, report, state_dir: stateDir, reports_dir: reportsDir };
}

export { loadScenarioFromFile };
export type { ScenarioEvent };
