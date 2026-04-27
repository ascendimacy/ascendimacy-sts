#!/usr/bin/env node
/**
 * sts-progress — reporta progresso de scenario STS rodando em background.
 *
 * Usage:
 *   node scripts/sts-progress.mjs --pid <pid> --run <run_id> [--scenario <name>]
 *
 * Lê:
 *   - PID alive?
 *   - logs/debug/<run_id>/events.ndjson — count + última timestamp
 *   - .sts/state/<scenario>/.motor-state.db — cards count + sessions
 *   - reports/<scenario>/consolidated.md — existe?
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";

const args = process.argv.slice(2);
function flag(name) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : null;
}

const pidStr = flag("pid");
const runId = flag("run");
const scenarioName = flag("scenario") ?? "nagareyama-14d-v1";

if (!runId) {
  console.error("Usage: sts-progress.mjs --pid <pid> --run <run_id> [--scenario <name>]");
  process.exit(1);
}

const pid = pidStr ? Number(pidStr) : null;

// PID alive?
let pidStatus = "(no PID provided)";
if (pid) {
  try {
    process.kill(pid, 0);
    pidStatus = `PID ${pid} ALIVE`;
  } catch {
    pidStatus = `PID ${pid} dead/exited`;
  }
}

const stsRoot = "/home/alexa/ascendimacy-sts";
const debugDir = join(stsRoot, "logs/debug", runId);
const eventsPath = join(debugDir, "events.ndjson");
const dbPath = join(stsRoot, ".sts/state", scenarioName, ".motor-state.db");
const consolidatedPath = join(stsRoot, "reports", scenarioName, "consolidated.md");

// Events
let eventsCount = 0;
let firstTs = "n/a";
let lastTs = "n/a";
let stepsCount = {};
let usersCount = {};
if (existsSync(eventsPath)) {
  const lines = readFileSync(eventsPath, "utf-8").trim().split("\n").filter(Boolean);
  eventsCount = lines.length;
  if (lines.length > 0) {
    try {
      firstTs = JSON.parse(lines[0]).ts ?? "?";
      lastTs = JSON.parse(lines[lines.length - 1]).ts ?? "?";
    } catch {}
    for (const l of lines) {
      try {
        const e = JSON.parse(l);
        stepsCount[e.step] = (stepsCount[e.step] ?? 0) + 1;
        if (e.user_id) usersCount[e.user_id] = (usersCount[e.user_id] ?? 0) + 1;
      } catch {}
    }
  }
}

// Cards
let cardsCount = 0;
let parentDecisionsCount = 0;
let signalsExtractedCount = 0;
let transitionEvaluatedCount = 0;
let candidateSetEmittedCount = 0;
let sessionsCount = 0;
if (existsSync(dbPath)) {
  try {
    const db = new Database(dbPath, { readonly: true });
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r) => r.name);
    if (tables.includes("kids_emitted_cards")) {
      cardsCount = db.prepare("SELECT COUNT(*) AS n FROM kids_emitted_cards").get().n;
    }
    if (tables.includes("kids_parent_decisions")) {
      parentDecisionsCount = db.prepare("SELECT COUNT(*) AS n FROM kids_parent_decisions").get().n;
    }
    if (tables.includes("event_log")) {
      signalsExtractedCount = db
        .prepare("SELECT COUNT(*) AS n FROM event_log WHERE type = 'signals_extracted'")
        .get().n;
      transitionEvaluatedCount = db
        .prepare("SELECT COUNT(*) AS n FROM event_log WHERE type = 'transition_evaluated'")
        .get().n;
      candidateSetEmittedCount = db
        .prepare("SELECT COUNT(*) AS n FROM event_log WHERE type = 'candidate_set_emitted'")
        .get().n;
    }
    if (tables.includes("sessions")) {
      sessionsCount = db.prepare("SELECT COUNT(*) AS n FROM sessions").get().n;
    }
    db.close();
  } catch (e) {
    console.error(`(DB read error: ${String(e).slice(0, 80)})`);
  }
}

const consolidated = existsSync(consolidatedPath) ? "✅ generated" : "(pending)";

console.log(`═══ STS Progress: ${scenarioName} ═══`);
console.log(`Run ID: ${runId}`);
console.log(`Daemon: ${pidStatus}`);
console.log(`Time now: ${new Date().toISOString()}`);
console.log();
console.log(`── Events log ──`);
console.log(`Path: ${eventsPath}`);
console.log(`Lines: ${eventsCount}`);
console.log(`First: ${firstTs}`);
console.log(`Last:  ${lastTs}`);
if (Object.keys(stepsCount).length > 0) {
  console.log(`Steps:`);
  for (const [s, n] of Object.entries(stepsCount).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${s}: ${n}`);
  }
}
if (Object.keys(usersCount).length > 0) {
  console.log(`Users:`);
  for (const [u, n] of Object.entries(usersCount).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${u}: ${n}`);
  }
}
console.log();
console.log(`── DB stats ──`);
console.log(`Path: ${dbPath}`);
console.log(`Sessions: ${sessionsCount}`);
console.log(`Cards emitted: ${cardsCount}`);
console.log(`Parent decisions: ${parentDecisionsCount}`);
console.log(`signals_extracted events: ${signalsExtractedCount}`);
console.log(`transition_evaluated events: ${transitionEvaluatedCount}`);
console.log(`candidate_set_emitted events: ${candidateSetEmittedCount}`);
console.log();
console.log(`── Consolidated report ──`);
console.log(`Path: ${consolidatedPath}`);
console.log(`Status: ${consolidated}`);
