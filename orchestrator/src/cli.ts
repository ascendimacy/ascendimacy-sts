#!/usr/bin/env node
import { runScenario } from "./orchestrator.js";

const args = process.argv.slice(2);

function parseArgs(argv: string[]): { persona?: string; turns?: number; dryRun?: boolean } {
  const result: { persona?: string; turns?: number; dryRun?: boolean } = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--persona" && argv[i + 1]) result.persona = argv[++i];
    else if (argv[i] === "--turns" && argv[i + 1]) result.turns = parseInt(argv[++i]!, 10);
    else if (argv[i] === "--dry-run") result.dryRun = true;
  }
  return result;
}

const command = args[0];
if (command !== "run") {
  console.error("Usage: npx sts run --persona <id> --turns <n> [--dry-run]");
  process.exit(1);
}

const { persona, turns = 10, dryRun = false } = parseArgs(args.slice(1));
if (!persona) {
  console.error("Error: --persona is required");
  process.exit(1);
}

runScenario({ personaId: persona, turns, dryRun }).catch((err) => {
  console.error("[STS] Fatal error:", err);
  process.exit(1);
});
