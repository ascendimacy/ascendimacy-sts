#!/usr/bin/env tsx
/**
 * baseline-retroativo — gera número-âncora pre-motor#25 sobre traces existentes.
 *
 * Spec: docs/handoffs/2026-04-26-cc-motor-pre-piloto-strategic-gaps.md (Script B paralelo)
 *
 * Calcula sobre traces smoke-3d existentes:
 *   1. Distância Levenshtein normalizada entre sequências archetype Ryo vs Kei
 *   2. Shannon entropy do candidate_set retroativo (onde houver log)
 *   3. Taxa de ignição estimada por archetype (mood_up + length_up no turn seguinte)
 *
 * Output: reports/baseline-retroativo-pre-motor25.md
 *
 * Run: npx tsx scripts/baseline-retroativo.ts
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";

// ─── Levenshtein inline (sem dep externa) ─────────────────────────────
function levenshtein<T>(a: T[], b: T[]): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1, // deleção
        dp[i][j - 1] + 1, // inserção
        dp[i - 1][j - 1] + cost, // substituição
      );
    }
  }
  return dp[m][n];
}

function normalizedLevenshtein<T>(a: T[], b: T[]): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 0;
  return levenshtein(a, b) / maxLen;
}

// ─── Shannon entropy ───────────────────────────────────────────────────
function shannonEntropy(values: string[]): number {
  if (values.length <= 1) return 0;
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  const total = values.length;
  let h = 0;
  for (const c of counts.values()) {
    const p = c / total;
    h -= p * Math.log2(p);
  }
  return h;
}

// ─── Carrega DB cards ─────────────────────────────────────────────────
function loadCardsFromDB(dbPath: string): Array<{
  child_id: string;
  archetype_id: string;
  session_id: string;
  emitted_at: string;
}> {
  if (!existsSync(dbPath)) return [];
  const db = new Database(dbPath, { readonly: true });
  try {
    return db
      .prepare(
        "SELECT child_id, archetype_id, session_id, emitted_at FROM kids_emitted_cards ORDER BY emitted_at, child_id",
      )
      .all() as Array<{
      child_id: string;
      archetype_id: string;
      session_id: string;
      emitted_at: string;
    }>;
  } finally {
    db.close();
  }
}

// ─── Carrega events.ndjson ────────────────────────────────────────────
function loadEvents(dbgRunDir: string): Array<Record<string, unknown>> {
  const path = join(dbgRunDir, "events.ndjson");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf-8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

// ─── Computa archetype sequence per persona ───────────────────────────
function archetypeSequenceByChild(
  cards: Array<{ child_id: string; archetype_id: string }>,
): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const c of cards) {
    if (!m.has(c.child_id)) m.set(c.child_id, []);
    m.get(c.child_id)!.push(c.archetype_id);
  }
  return m;
}

// ─── Heurística taxa de ignição ───────────────────────────────────────
/**
 * Para cada turn com card emitido, olha next turn:
 *   - trustLevel cresceu? (proxy mood_up)
 *   - length da bot message próxima > length atual? (proxy length_up)
 * Conta como "ignição" se ambas condições.
 */
function estimateIgnitionRate(events: Array<Record<string, unknown>>): {
  byArchetype: Map<string, { ignited: number; total: number; rate: number }>;
} {
  // Agrupa events por session+turn pra reconstruir flow
  const turnsBySession = new Map<
    string,
    Array<{
      turn: number;
      bot_length?: number;
      trust_after?: number;
      archetype?: string;
    }>
  >();

  for (const e of events) {
    if (e.step !== "auto-hook" && e.step !== "drota") continue;
    const session = String(e.session_id ?? "");
    const turn = Number(e.turn_number ?? 0);
    if (!session) continue;
    if (!turnsBySession.has(session)) turnsBySession.set(session, []);
    const arr = turnsBySession.get(session)!;
    let row = arr.find((r) => r.turn === turn);
    if (!row) {
      row = { turn };
      arr.push(row);
    }
    // drota event tem materialization length em snapshots_post.drota
    if (e.step === "drota") {
      const snap = (e.snapshots_post as { drota?: unknown } | null)?.drota;
      if (typeof snap === "string") {
        // Hash, blob não acessível aqui — estimativa via tokens out
        const tokens = (e.tokens as { out?: number } | null)?.out ?? 0;
        row.bot_length = tokens; // proxy
      }
    }
    // auto-hook event tem signal/archetype info
    if (e.step === "auto-hook") {
      const snapPost = (e.snapshots_post as { ebrota?: unknown } | null)
        ?.ebrota;
      if (typeof snapPost === "string") {
        // É hash — não dá pra ler aqui sem CAS resolver. Pula.
      }
    }
  }

  // Estimativa simplificada: se temos archetype + sequence, comparar adjacent turns
  const byArchetype = new Map<string, { ignited: number; total: number; rate: number }>();
  return { byArchetype };
}

// ─── Main ──────────────────────────────────────────────────────────────

const TARGET_RUNS = [
  "smoke-3d-fixes-04-54-36", // 64 events, mais coverage
  "smoke-3d-bumped-04-21-33", // 48 events
];

const DB_PATH = "/home/alexa/ascendimacy-sts/.sts/state/smoke-3d/.motor-state.db";
const DEBUG_DIR = "/home/alexa/ascendimacy-sts/logs/debug";
const OUT_DIR = "/home/alexa/ascendimacy-sts/reports";
const OUT_PATH = join(OUT_DIR, "baseline-retroativo-pre-motor25.md");

console.log("═══ baseline-retroativo — calculando ═══");

const cards = loadCardsFromDB(DB_PATH);
console.log(`Cards loaded: ${cards.length}`);
if (cards.length === 0) {
  console.error("No cards in DB — abort");
  process.exit(1);
}

const archetypesByChild = archetypeSequenceByChild(cards);
console.log("Children:", Array.from(archetypesByChild.keys()));
for (const [child, seq] of archetypesByChild) {
  console.log(`  ${child}: [${seq.join(", ")}]`);
}

// Calc 1 — Levenshtein normalizada Ryo vs Kei
const ryo = archetypesByChild.get("ryo-ochiai") ?? [];
const kei = archetypesByChild.get("kei-ochiai") ?? [];
const dist = levenshtein(ryo, kei);
const normDist = normalizedLevenshtein(ryo, kei);
const identicalPct = (1 - normDist) * 100;

console.log("\n═══ Calc 1 — Levenshtein archetype sequences ═══");
console.log(`Ryo: [${ryo.join(", ")}] (len ${ryo.length})`);
console.log(`Kei: [${kei.join(", ")}] (len ${kei.length})`);
console.log(`Levenshtein distance: ${dist}`);
console.log(`Normalized: ${normDist.toFixed(3)} (${identicalPct.toFixed(1)}% identical)`);

// Calc 2 — Shannon entropy candidate_set retroativo
console.log("\n═══ Calc 2 — Shannon entropy candidate_set retroativo ═══");
let entropyResults: Array<{ run: string; events_with_candidate_set: number; entropy?: number }> = [];
for (const run of TARGET_RUNS) {
  const events = loadEvents(join(DEBUG_DIR, run));
  const candEvents = events.filter((e) => e.step === "drota" || e.step === "planejador");
  // pre-motor#25: sem candidate_set_emitted events. Verificar.
  const cs = events.filter((e) => e.step === "candidate_set_emitted" || (e.snapshots_pre as Record<string, unknown> | null)?.["candidate_set"]);
  console.log(`  ${run}: ${events.length} events, candidate_set events: ${cs.length}`);
  entropyResults.push({ run, events_with_candidate_set: cs.length });
}

// Calc 3 — Taxa de ignição estimada
console.log("\n═══ Calc 3 — Taxa de ignição estimada por archetype ═══");
console.log("(heurística: turn seguinte com tokens_out maior + trust progression)");
// Smoke-3d state DB tem session-level info, não turn-by-turn deltas no formato esperado
// Fallback: contagem absoluta de archetype emissões / total turns LLM-driving
const archetypeCounts = new Map<string, number>();
for (const c of cards) {
  archetypeCounts.set(c.archetype_id, (archetypeCounts.get(c.archetype_id) ?? 0) + 1);
}
console.log("Archetype emission counts:");
for (const [a, c] of archetypeCounts) console.log(`  ${a}: ${c}`);

// Total turns LLM-driving (drota events)
let totalDrotaTurns = 0;
for (const run of TARGET_RUNS) {
  const events = loadEvents(join(DEBUG_DIR, run));
  totalDrotaTurns += events.filter((e) => e.step === "drota").length;
}
const totalCardEmissions = cards.length;
const overallIgnitionRate = totalDrotaTurns > 0 ? totalCardEmissions / totalDrotaTurns : 0;
console.log(
  `Overall ignition rate: ${totalCardEmissions} cards / ${totalDrotaTurns} drota turns = ${(overallIgnitionRate * 100).toFixed(1)}%`,
);

// ─── Gera report ──────────────────────────────────────────────────────
mkdirSync(OUT_DIR, { recursive: true });
const md = `# Baseline retroativo — pre-motor#25

> **Frase âncora**:
> v0 emite sequências **${identicalPct.toFixed(0)}% idênticas** para personas opostas
> (Ryo deflexivo + Kei filosófico, fase brejo, smoke-3d post-motor#23).

---

## Setup

- **DB**: \`.sts/state/smoke-3d/.motor-state.db\` (motor#23 — USED_IN_SESSION_PENALTY ativo)
- **Traces analisadas**: ${TARGET_RUNS.length} runs
- **Personas comparadas**: ryo-ochiai (deflexivo, Dragon Ball anchor) vs kei-ochiai (filosófico/técnico, tênis anchor)
- **Cards no DB**: ${cards.length}

---

## Calc 1 — Distância Levenshtein normalizada (Ryo vs Kei)

| Métrica | Valor |
|---|---|
| Sequência Ryo | \`[${ryo.join(", ")}]\` (len ${ryo.length}) |
| Sequência Kei | \`[${kei.join(", ")}]\` (len ${kei.length}) |
| Levenshtein distance | **${dist}** |
| Distância normalizada | **${normDist.toFixed(3)}** |
| **Sequências idênticas** | **${identicalPct.toFixed(1)}%** |

### Leitura

${
  identicalPct >= 90
    ? `Personas com perfis radicalmente opostos (Ryo: deflexivo/anime; Kei: filosófico/técnico) emitem **sequências archetype virtualmente idênticas**. Confirma o diagnóstico do handoff strategic-gaps: motor v0 está em "carrossel" — re-emite mesmo archetype turn após turn, independente de signal pedagógico ou perfil.`
    : `Sequências divergem em ${(100 - identicalPct).toFixed(0)}% — base ainda problemática mas não 100% carrossel.`
}

---

## Calc 2 — Shannon entropy candidate_set (retroativo)

${entropyResults.map((r) => `| ${r.run} | ${r.events_with_candidate_set} candidate_set events |`).join("\n")}

**Resultado**: pre-motor#25 NÃO emite events \`candidate_set_emitted\` (capability adicionada em motor#25 §B5). **Não computável retroativamente** — qualquer estimativa seria reconstrução de candidate_set a partir de logs do drota, que mostra apenas top-N final, não pool completo pré-rerank.

**Pós motor#25**: rodar mesmo cálculo sobre traces post-merge servirá de comparativo direto.

---

## Calc 3 — Taxa de ignição estimada

| Métrica | Valor |
|---|---|
| Total cards emitidos | ${totalCardEmissions} |
| Total drota turns LLM-driving | ${totalDrotaTurns} |
| **Taxa de ignição overall** | **${(overallIgnitionRate * 100).toFixed(1)}%** |

### Por archetype

| Archetype | Emissões |
|---|---|
${Array.from(archetypeCounts.entries())
  .map(([a, c]) => `| \`${a}\` | ${c} |`)
  .join("\n")}

### Caveat

Heurística simplificada (turn-seguinte mood_up + length_up) requer reconstrução de mood/length per-turn que não estava em formato direto nas traces existentes. Estimativa **conservadora**: total_cards / total_drota_turns. Pós-motor#25 com transition_evaluated events vai dar precisão maior.

---

## N e limites

- **N=2 personas** (Ryo + Kei) em **N=3 sessions** (smoke-3d). Estatisticamente fraco, mas suficiente como número-âncora.
- Comparação Ryo vs Kei é **diretamente análoga** ao caso central do strategic-gaps (perfis opostos → mesma resposta motor) — válida.
- Calc 2 (candidate_set entropy) só ganha sentido pós motor#25 — fica como métrica nova a ser comparada.
- Pós-piloto Nagareyama com N≥10 sessions, métricas se firmam.

---

## Métricas-alvo pós motor#25

| Métrica | Pre-motor#25 (atual) | Alvo pós-motor#25 |
|---|---|---|
| Distância Ryo vs Kei | ${identicalPct.toFixed(0)}% idêntica | **<70% idêntica** (signal differentiation funcionando) |
| candidate_set entropy avg | n/a | **>1.5 bits** (pool diverso) |
| Taxa ignição overall | ${(overallIgnitionRate * 100).toFixed(0)}% | **30-60%** (signals filtrando emissões irrelevantes) |
| transition_evaluated.fired count | 0 (event inexistente) | **≥3 em smoke-3d** (capturas reais) |

---

> 🌳 _Sem baseline mensurado, qualquer melhora vai ser discutida no feeling._
`;

writeFileSync(OUT_PATH, md);
console.log(`\n═══ Report written: ${OUT_PATH} ═══`);
console.log(`Total chars: ${md.length}`);
