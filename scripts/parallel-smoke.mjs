#!/usr/bin/env node
/**
 * parallel-smoke.mjs — pool de workers com fila prioritária + arrivals staggered.
 *
 * Simula uso real do produto:
 *   - Wave 0 (T=0, priority=0): kids interactive — 4 jobs satura 4 slots imediato
 *   - Wave 1 (T=60s, priority=1): parents — entra na queue mid-flight
 *   - Wave 2 (T=120s, priority=2): batch — entra por último
 *
 * Workers (default 4 = nº de slots do llama-server) puxam da queue em ordem de
 * prioridade (FIFO em empate). Cada job spawna `node cli.js run --persona X` em
 * subprocess isolado com MOTOR_STATE_DIR único.
 *
 * Output:
 *   - Tabela markdown no stdout
 *   - traces/parallel-summary-<ts>.json com per-job timing + global stats
 *
 * Usage:
 *   cd /home/alexa/ascendimacy-sts
 *   node scripts/parallel-smoke.mjs
 *
 *   # ajustar concorrência:
 *   N_WORKERS=4 node scripts/parallel-smoke.mjs
 *
 * Pré-req: STS + motor já buildados, llama-server up em LOCAL_LLM_BASE_URL,
 * .env loadeado (script propaga via --env-file no subprocess).
 */

import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ROOT = process.cwd();
const N_WORKERS = Number(process.env.N_WORKERS ?? "4");

// Job specs. priority: lower = higher priority (FIFO em empate).
// arrivalDelayMs: quando o job entra na queue (staggered = mais realista).
const JOBS = [
  // Wave 0 — kids (saturação imediata dos 4 slots)
  { persona: "ryo-ochiai", turns: 4, priority: 0, arrivalDelayMs:     0, label: "kid-ryo-A" },
  { persona: "kei-ochiai", turns: 4, priority: 0, arrivalDelayMs:     0, label: "kid-kei-A" },
  { persona: "ryo-ochiai", turns: 4, priority: 0, arrivalDelayMs:     0, label: "kid-ryo-B" },
  { persona: "kei-ochiai", turns: 4, priority: 0, arrivalDelayMs:     0, label: "kid-kei-B" },
  // Wave 1 — parents (chegam meio do caminho)
  { persona: "yuji-ochiai", turns: 4, priority: 1, arrivalDelayMs: 60000, label: "parent-yuji" },
  { persona: "yuko-ochiai", turns: 4, priority: 1, arrivalDelayMs: 60000, label: "parent-yuko" },
  // Wave 2 — batch low-priority
  { persona: "paula-mendes", turns: 4, priority: 2, arrivalDelayMs: 120000, label: "batch-paula" },
  { persona: "ryo-ochiai",   turns: 4, priority: 2, arrivalDelayMs: 120000, label: "batch-ryo-C" },
];

class PriorityQueue {
  constructor() { this.items = []; }
  push(job, seq) {
    this.items.push({ job, seq });
    // priority asc, seq asc (FIFO em empate)
    this.items.sort((a, b) => a.job.priority - b.job.priority || a.seq - b.seq);
  }
  pop() { return this.items.shift()?.job; }
  size() { return this.items.length; }
}

const queue = new PriorityQueue();
const results = [];
let seq = 0;
const T0 = Date.now();
const elapsed = () => ((Date.now() - T0) / 1000) | 0;

function dispatchAll() {
  for (const job of JOBS) {
    setTimeout(() => {
      queue.push(job, seq++);
      console.log(`[gen T+${elapsed()}s] enq ${job.label} p${job.priority} qsize=${queue.size()}`);
    }, job.arrivalDelayMs);
  }
}

async function runJob(job, workerId) {
  const stateDir = mkdtempSync(join(tmpdir(), `sts-${job.label}-`));
  const env = {
    ...process.env,
    MOTOR_STATE_DIR: stateDir,
    USE_SIMPLIFIED_PIPELINE: "true",
    STS_MCP_TIMEOUT_MS: "2400000",
  };
  const tStart = Date.now();
  const wallStart = (tStart - T0) / 1000;
  console.log(`[worker ${workerId} T+${elapsed()}s] START ${job.label}`);
  return new Promise((resolve) => {
    const proc = spawn(
      "node",
      ["--env-file=.env", "orchestrator/dist/cli.js", "run",
       "--persona", job.persona, "--turns", String(job.turns)],
      { stdio: ["ignore", "pipe", "pipe"], env, cwd: ROOT },
    );
    let stderrTail = "";
    let rubric = null;
    proc.stdout.on("data", (d) => {
      const s = d.toString();
      // Capture rubric line if present
      const m = s.match(/Rubric:\s*(\w+)/);
      if (m) rubric = m[1];
    });
    proc.stderr.on("data", (d) => {
      stderrTail = (stderrTail + d.toString()).slice(-1000);
    });
    proc.on("exit", (code) => {
      const dtMs = Date.now() - tStart;
      const wallEnd = (Date.now() - T0) / 1000;
      console.log(
        `[worker ${workerId} T+${elapsed()}s] DONE  ${job.label} exit=${code} dt=${(dtMs/1000)|0}s rubric=${rubric}`,
      );
      resolve({
        ...job,
        workerId,
        wallStart,
        wallEnd,
        dt_s: dtMs / 1000,
        exit_code: code,
        rubric,
        stateDir,
        stderrTail,
      });
    });
  });
}

async function worker(id) {
  while (true) {
    if (queue.size() === 0) {
      if (results.length >= JOBS.length) return;
      // ainda há jobs por chegar — espera
      await new Promise((r) => setTimeout(r, 500));
      continue;
    }
    const job = queue.pop();
    const r = await runJob(job, id);
    results.push(r);
  }
}

console.log(`[parallel-smoke] ${JOBS.length} jobs, ${N_WORKERS} workers, T0=${new Date(T0).toISOString()}`);
dispatchAll();
await Promise.all(Array.from({ length: N_WORKERS }, (_, i) => worker(i)));

const totalWall = (Date.now() - T0) / 1000;
console.log(`\n[parallel-smoke] All done in ${totalWall.toFixed(0)}s`);

// Tabela
console.log("\n| label | persona | p | worker | start_s | end_s | dt_s | exit | rubric |");
console.log("|---|---|---|---|---|---|---|---|---|");
for (const r of [...results].sort((a, b) => a.wallStart - b.wallStart)) {
  console.log(
    `| ${r.label} | ${r.persona} | ${r.priority} | ${r.workerId} | ${r.wallStart.toFixed(0)} | ${r.wallEnd.toFixed(0)} | ${r.dt_s.toFixed(0)} | ${r.exit_code} | ${r.rubric ?? "-"} |`,
  );
}

// Aggregator JSON
const tracesDir = join(ROOT, "traces");
mkdirSync(tracesDir, { recursive: true });
const summary = {
  schema: "parallel-smoke-v1",
  generated_at: new Date().toISOString(),
  n_workers: N_WORKERS,
  total_wall_s: totalWall,
  jobs: results,
  stats: {
    n_jobs: results.length,
    n_succeeded: results.filter((r) => r.exit_code === 0).length,
    n_failed: results.filter((r) => r.exit_code !== 0).length,
    n_pass_rubric: results.filter((r) => r.rubric === "PASS").length,
    avg_dt_s: results.reduce((a, r) => a + r.dt_s, 0) / results.length,
    max_dt_s: Math.max(...results.map((r) => r.dt_s)),
    min_dt_s: Math.min(...results.map((r) => r.dt_s)),
    by_priority: Object.fromEntries(
      [0, 1, 2].map((p) => [p, results.filter((r) => r.priority === p).length]),
    ),
  },
};
const summaryPath = join(tracesDir, `parallel-summary-${Date.now()}.json`);
writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
console.log(`\nSummary JSON: ${summaryPath}`);

process.exit(results.every((r) => r.exit_code === 0) ? 0 : 1);
