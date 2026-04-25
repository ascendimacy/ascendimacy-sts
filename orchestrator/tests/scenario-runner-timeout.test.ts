/**
 * Tests do per-event timeout no scenario-runner (sts#11).
 *
 * Critical: 30d real-llm scenario com evento travado deve pular após
 * ASC_EVENT_TIMEOUT_SECONDS, não pendurar indefinidamente (Kimi-like).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runScenarioFromFile } from "../src/scenario-runner.js";

let tmpDir: string;
let scenarioPath: string;
const ORIG_ENV = { ...process.env };

const SCENARIO_YAML = `
name: test-timeout-scenario
start_date: "2026-05-01T00:00:00Z"
end_date: "2026-05-02T23:59:59Z"
personas: [test-persona]
parents: []
mock_llm: true
state_dir: ".sts/state/test-timeout"
events:
  - day: 1
    type: solo_session
    persona: test-persona
    turns: 2
`;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "sts-timeout-test-"));
  const scenariosDir = join(tmpDir, "scenarios");
  mkdirSync(scenariosDir, { recursive: true });
  scenarioPath = join(scenariosDir, "test-timeout-scenario.yaml");
  writeFileSync(scenarioPath, SCENARIO_YAML, "utf-8");
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  for (const k of Object.keys(process.env)) {
    if (!(k in ORIG_ENV)) delete process.env[k];
  }
  for (const [k, v] of Object.entries(ORIG_ENV)) process.env[k] = v;
  delete process.env["ASC_EVENT_TIMEOUT_SECONDS"];
});

describe("scenario-runner per-event timeout (sts#11)", () => {
  it("evento que demora MAIS que ASC_EVENT_TIMEOUT_SECONDS é cortado com event_timeout", async () => {
    process.env["ASC_EVENT_TIMEOUT_SECONDS"] = "1"; // 1s pra teste rápido

    const result = await runScenarioFromFile({
      scenarioPath,
      reportsDir: join(tmpDir, "reports"),
      forceMockLlm: true,
      runSoloSession: async () => {
        // Simula evento travado (mais lento que 1s timeout)
        await new Promise((resolve) => setTimeout(resolve, 3000));
      },
    });

    expect(result.outcomes).toHaveLength(1);
    const outcome = result.outcomes[0]!;
    expect(outcome.success).toBe(false);
    expect(outcome.error).toContain("event_timeout");
    expect(outcome.error).toContain("1s");
    // Duration deve estar próximo de 1s (não 3s)
    expect(outcome.duration_ms).toBeLessThan(1500);
  });

  it("evento rápido completa normalmente sem afetado por timeout", async () => {
    process.env["ASC_EVENT_TIMEOUT_SECONDS"] = "10";

    const result = await runScenarioFromFile({
      scenarioPath,
      reportsDir: join(tmpDir, "reports"),
      forceMockLlm: true,
      runSoloSession: async () => {
        // Rápido, 50ms
        await new Promise((resolve) => setTimeout(resolve, 50));
      },
    });

    expect(result.outcomes).toHaveLength(1);
    const outcome = result.outcomes[0]!;
    expect(outcome.success).toBe(true);
    expect(outcome.duration_ms).toBeLessThan(500);
  });

  it("ASC_EVENT_TIMEOUT_SECONDS inválido → fallback 180s default (não trava)", async () => {
    process.env["ASC_EVENT_TIMEOUT_SECONDS"] = "abc"; // inválido

    const result = await runScenarioFromFile({
      scenarioPath,
      reportsDir: join(tmpDir, "reports"),
      forceMockLlm: true,
      runSoloSession: async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      },
    });

    expect(result.outcomes[0]!.success).toBe(true);
  });
});
