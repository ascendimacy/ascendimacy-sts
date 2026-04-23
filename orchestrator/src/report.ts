import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { SessionTrace } from "@ascendimacy/sts-shared";
import type { RubricResult } from "./rubric.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");

export function generateReport(
  trace: SessionTrace,
  rubric: RubricResult,
  durationMs: number
): string {
  const lines: string[] = [];

  lines.push(`# STS Report — ${trace.personaId}`);
  lines.push(``);
  lines.push(`| Field | Value |`);
  lines.push(`|---|---|`);
  lines.push(`| Persona | ${trace.personaId} |`);
  lines.push(`| Session | ${trace.sessionId} |`);
  lines.push(`| Started | ${trace.startedAt} |`);
  lines.push(`| Completed | ${trace.completedAt} |`);
  lines.push(`| Turns | ${trace.totalTurns} |`);
  lines.push(`| Duration | ${(durationMs / 1000).toFixed(1)}s |`);
  lines.push(`| Result | **${rubric.summary}** |`);
  lines.push(``);

  lines.push(`## Rubric Gates`);
  lines.push(``);
  for (const gate of rubric.gates) {
    const icon = gate.passed ? "✅" : gate.gate === "G5" ? "⚠️" : "❌";
    lines.push(`- ${icon} **${gate.gate}**: ${gate.detail}`);
  }
  lines.push(``);

  lines.push(`## Dialogue`);
  lines.push(``);
  for (const turn of trace.turns) {
    lines.push(`### Turn ${turn.turn}`);
    lines.push(``);
    lines.push(`**Bot**: ${turn.botMessage}`);
    lines.push(``);
    lines.push(`**${trace.personaId}**: ${turn.personaEntry?.personaId ? turn.personaEntry.personaId : "—"}`);
    lines.push(``);
    lines.push(`_trust: ${turn.trustLevel.toFixed(2)} | budget: ${turn.budgetRemaining.toFixed(0)} | playbook: ${turn.playbookId} | ${turn.durationMs}ms_`);
    lines.push(``);
  }

  lines.push(`## Persona Messages`);
  lines.push(``);
  for (const turn of trace.turns) {
    lines.push(`**[Turn ${turn.turn}] ${trace.personaId}**: ${turn.personaMessage}`);
    lines.push(``);
  }

  return lines.join("\n");
}

export function writeReport(
  trace: SessionTrace,
  rubric: RubricResult,
  durationMs: number
): string {
  const content = generateReport(trace, rubric, durationMs);
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = join(repoRoot, "reports");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${trace.personaId}-${ts}.md`);
  writeFileSync(path, content, "utf-8");
  return path;
}
