/**
 * Consolidated report generator — sts#6.
 * Inline markdown, zero deps.
 */

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import type { Scenario } from "@ascendimacy/sts-shared";
import type { EventOutcome } from "./scenario-events.js";

export interface ConsolidatedReport {
  scenario_name: string;
  outcomes: EventOutcome[];
  weeks: WeeklySection[];
  findings: string[];
  markdown: string;
}

interface WeeklySection {
  week: number;
  day_range: [number, number];
  sessions_run: number;
  joint_sessions: number;
  cards_emitted_count: number;
  bullying_flags_count: number;
  gardner_advances: number;
  brejo_injects: number;
}

interface DbStats {
  tree_nodes_brejo: number;
  emitted_cards: number;
  parent_decisions: number;
  gardner_sessions: number;
}

function readDbStats(stateDir: string): DbStats {
  const path = join(stateDir, ".motor-state.db");
  if (!existsSync(path)) {
    return { tree_nodes_brejo: 0, emitted_cards: 0, parent_decisions: 0, gardner_sessions: 0 };
  }
  const db = new Database(path, { readonly: true });
  try {
    const brejoQ = safeCount(db, `SELECT COUNT(*) AS n FROM tree_nodes WHERE zone='status' AND value='brejo'`);
    const cardsQ = safeCount(db, `SELECT COUNT(*) AS n FROM kids_emitted_cards`);
    const decisionsQ = safeCount(db, `SELECT COUNT(*) AS n FROM kids_parent_decisions`);
    const gardnerQ = safeCount(db, `SELECT COUNT(*) AS n FROM kids_gardner_program`);
    return {
      tree_nodes_brejo: brejoQ,
      emitted_cards: cardsQ,
      parent_decisions: decisionsQ,
      gardner_sessions: gardnerQ,
    };
  } finally {
    db.close();
  }
}

function safeCount(db: Database.Database, sql: string): number {
  try {
    const row = db.prepare(sql).get() as { n: number } | undefined;
    return row?.n ?? 0;
  } catch {
    return 0;
  }
}

function groupIntoWeeks(outcomes: EventOutcome[]): WeeklySection[] {
  const weeks: WeeklySection[] = [];
  const maxDay = Math.max(1, ...outcomes.map((o) => o.day));
  const numWeeks = Math.ceil(maxDay / 7);
  for (let w = 1; w <= numWeeks; w++) {
    const from = (w - 1) * 7 + 1;
    const to = Math.min(w * 7, maxDay);
    const wkOutcomes = outcomes.filter((o) => o.day >= from && o.day <= to);
    weeks.push({
      week: w,
      day_range: [from, to],
      sessions_run: wkOutcomes.filter((o) => o.type === "solo_session" || o.type === "joint_session").length,
      joint_sessions: wkOutcomes.filter((o) => o.type === "joint_session").length,
      cards_emitted_count: 0, // populado pelo DbStats final; aqui é 0 por semana
      bullying_flags_count: 0, // idem
      gardner_advances: wkOutcomes.filter((o) => o.type === "gardner_advance").length,
      brejo_injects: wkOutcomes.filter((o) => o.type === "inject_status" && (o as EventOutcome).notes?.includes("brejo")).length,
    });
  }
  return weeks;
}

function deriveFindings(scenario: Scenario, outcomes: EventOutcome[], stats: DbStats): string[] {
  const findings: string[] = [];
  // programa Gardner completou?
  const gardnerAdvances = outcomes.filter((o) => o.type === "gardner_advance" && o.success).length;
  if (gardnerAdvances >= 5) {
    findings.push(`✅ Gardner program completou (${gardnerAdvances} advances ≥ 5 fases do programa)`);
  } else {
    findings.push(`⚠️ Gardner program parcial (${gardnerAdvances} advances; meta = 5+ fases)`);
  }

  // brejo pausou?
  const brejoInjects = outcomes.filter(
    (o) => o.type === "inject_status" && o.success && (o.notes ?? "").includes("brejo"),
  ).length;
  if (brejoInjects > 0) {
    findings.push(`🔴 ${brejoInjects} inject_status brejo disparados — motor pausou dyad (verificar logs planejador)`);
  }

  // bias_warning disparou? (stub pra v1)
  findings.push(`ℹ️ bias_warning: não inspecionado diretamente em v1 (exige scanner de traces)`);

  // cards emitidos
  if (stats.emitted_cards > 0) {
    findings.push(`🏆 ${stats.emitted_cards} cards emitidos durante o scenario`);
  } else {
    findings.push(`⚠️ 0 cards emitidos — detectAchievement pode não ter gatilhos nos mocks atuais`);
  }

  // joint sessions
  const jointCount = outcomes.filter((o) => o.type === "joint_session" && o.success).length;
  if (jointCount > 0) {
    findings.push(`👥 ${jointCount} joint sessions executadas (dyad ${scenario.personas.join("+")})`);
  }

  // falhas
  const failures = outcomes.filter((o) => !o.success);
  if (failures.length > 0) {
    findings.push(`❌ ${failures.length} eventos falharam — review necessário`);
    for (const f of failures.slice(0, 5)) {
      findings.push(`   · day ${f.day} ${f.type}: ${f.error ?? "unknown"}`);
    }
  } else {
    findings.push(`✅ Todos os ${outcomes.length} eventos passaram sem erro`);
  }

  return findings;
}

function renderWeek(w: WeeklySection): string {
  return [
    `### Semana ${w.week} (dias ${w.day_range[0]}–${w.day_range[1]})`,
    ``,
    `- Sessions: ${w.sessions_run}`,
    `- Joint (dyad): ${w.joint_sessions}`,
    `- Gardner advances: ${w.gardner_advances}`,
    `- Brejo injects: ${w.brejo_injects}`,
    ``,
  ].join("\n");
}

function renderTimeline(outcomes: EventOutcome[]): string {
  const lines = ["## Timeline", "", "| Dia | Evento | Target | Resultado | Notas |", "|---|---|---|---|---|"];
  for (const o of outcomes) {
    const target = o.persona ?? o.personas?.join("+") ?? "—";
    const status = o.success ? "✓" : "✗";
    const notes = (o.notes ?? o.error ?? "").slice(0, 60);
    lines.push(`| ${o.day} | ${o.type} | ${target} | ${status} | ${notes} |`);
  }
  lines.push("");
  return lines.join("\n");
}

export function generateConsolidatedReport(
  scenario: Scenario,
  outcomes: EventOutcome[],
  stateDir: string,
  outputDir: string,
): ConsolidatedReport {
  const stats = readDbStats(stateDir);
  const weeks = groupIntoWeeks(outcomes);
  const findings = deriveFindings(scenario, outcomes, stats);

  const sections: string[] = [];
  sections.push(`# Scenario consolidated: ${scenario.name}`);
  sections.push(``);
  sections.push(`**Período:** ${scenario.start_date.slice(0, 10)} → ${scenario.end_date.slice(0, 10)}`);
  sections.push(`**Personas:** ${scenario.personas.join(", ")}`);
  sections.push(`**Parents:** ${scenario.parents.join(", ") || "—"}`);
  sections.push(`**State dir:** \`${stateDir}\``);
  sections.push(`**Events executados:** ${outcomes.length}`);
  sections.push(``);
  sections.push(renderTimeline(outcomes));
  sections.push(`## Weekly sections`);
  sections.push(``);
  for (const w of weeks) sections.push(renderWeek(w));
  sections.push(`## DB final stats`);
  sections.push(``);
  sections.push(`- tree_nodes brejo: ${stats.tree_nodes_brejo}`);
  sections.push(`- emitted_cards: ${stats.emitted_cards}`);
  sections.push(`- parent_decisions: ${stats.parent_decisions}`);
  sections.push(`- gardner sessions: ${stats.gardner_sessions}`);
  sections.push(``);
  sections.push(`## Findings automáticos`);
  sections.push(``);
  for (const f of findings) sections.push(`- ${f}`);
  sections.push(``);
  sections.push(`---`);
  sections.push(`> 🌳 Crescer para colher.`);
  const markdown = sections.join("\n");

  // Write file
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
  const outPath = join(outputDir, "consolidated.md");
  writeFileSync(outPath, markdown, "utf-8");

  return {
    scenario_name: scenario.name,
    outcomes,
    weeks,
    findings,
    markdown,
  };
}
