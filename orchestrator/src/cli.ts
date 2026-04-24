#!/usr/bin/env node
import { runScenario } from "./orchestrator.js";
import { runScenarioFromFile } from "./scenario-runner.js";
import { getMotorClients, closeMotorClients } from "./motor-client.js";
import type { MotorClients } from "./types.js";

const args = process.argv.slice(2);
const command = args[0];

async function main(): Promise<void> {
  if (command === "run") {
    await handleRun(args.slice(1));
  } else if (command === "run-scenario") {
    await handleRunScenario(args.slice(1));
  } else {
    printUsageAndExit(1);
  }
}

function printUsageAndExit(code: number): never {
  console.error(
    [
      "Usage:",
      "  npx sts run --persona <id> --turns <n> [--dry-run]",
      "  npx sts run-scenario <path-to-scenario.yaml> [--verbose] [--real-llm] [--reports-dir <dir>]",
    ].join("\n"),
  );
  process.exit(code);
}

async function handleRun(argv: string[]): Promise<void> {
  const opts: { persona?: string; turns?: number; dryRun?: boolean } = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--persona" && argv[i + 1]) opts.persona = argv[++i];
    else if (argv[i] === "--turns" && argv[i + 1]) opts.turns = parseInt(argv[++i]!, 10);
    else if (argv[i] === "--dry-run") opts.dryRun = true;
  }
  if (!opts.persona) {
    console.error("Error: --persona is required");
    process.exit(1);
  }
  await runScenario({ personaId: opts.persona, turns: opts.turns ?? 10, dryRun: opts.dryRun ?? false });
}

async function handleRunScenario(argv: string[]): Promise<void> {
  let scenarioPath: string | undefined;
  const opts: { verbose?: boolean; reportsDir?: string; forceMockLlm?: boolean } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--verbose") opts.verbose = true;
    else if (a === "--real-llm") opts.forceMockLlm = false;
    else if (a === "--reports-dir" && argv[i + 1]) opts.reportsDir = argv[++i];
    else if (a && !a.startsWith("--")) scenarioPath = a;
  }
  if (!scenarioPath) {
    console.error("Error: scenario path is required");
    printUsageAndExit(1);
  }

  // Factory de clients — reconecta on-demand. Necessário porque runScenario
  // (sessões solo/joint) fecha clients ao fim; eventos posteriores precisam
  // de connect fresco.
  const clientsFactory = async (): Promise<MotorClients> => {
    const c = await getMotorClients();
    return c as unknown as MotorClients;
  };

  try {
    await runScenarioFromFile({
      scenarioPath: scenarioPath!,
      verbose: opts.verbose,
      reportsDir: opts.reportsDir,
      forceMockLlm: opts.forceMockLlm,
      clientsFactory,
      runSoloSession: async (personaId, turns, _sessionId) => {
        await runScenario({ personaId, turns, dryRun: false });
      },
      runJointSession: async (personaA, personaB, turns, sessionId) => {
        // v1 simplificação: roda solo de cada persona sequencialmente.
        // Joint mode real exige sts cross-persona orchestration (débito Bloco 7).
        if (opts.verbose) {
          console.log(`  [joint v1] running solo for ${personaA} then ${personaB} (sessionId=${sessionId})`);
        }
        await runScenario({ personaId: personaA, turns: Math.ceil(turns / 2), dryRun: false });
        await runScenario({ personaId: personaB, turns: Math.floor(turns / 2), dryRun: false });
      },
    });
  } finally {
    try {
      await closeMotorClients();
    } catch {
      /* ignore close errors */
    }
  }
}

main().catch((err) => {
  console.error("[STS] Fatal error:", err);
  process.exit(1);
});
