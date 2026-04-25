/**
 * Tests do debug-logger em sts-shared (sts#10).
 *
 * Same contract do motor/shared/tests/debug-logger.test.ts — duplicação
 * proposital porque são workspaces separados. Alinhamento via spec
 * (docs/specs/2026-04-24-debug-mode.md).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  logDebugEvent,
  initDebugRun,
  isDebugModeEnabled,
  setDebugRunId,
} from "../src/debug-logger.js";

let tmpDir: string;
const ORIG_ENV = { ...process.env };

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "sts-debug-logger-"));
  delete process.env["ASC_DEBUG_MODE"];
  delete process.env["ASC_DEBUG_RUN_ID"];
  process.env["ASC_DEBUG_DIR"] = tmpDir;
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  for (const k of Object.keys(process.env)) {
    if (!(k in ORIG_ENV)) delete process.env[k];
  }
  for (const [k, v] of Object.entries(ORIG_ENV)) process.env[k] = v;
});

describe("isDebugModeEnabled", () => {
  it("false sem flag", () => {
    expect(isDebugModeEnabled()).toBe(false);
  });
  it("true com 'true'", () => {
    process.env["ASC_DEBUG_MODE"] = "true";
    expect(isDebugModeEnabled()).toBe(true);
  });
});

describe("logDebugEvent (sts side)", () => {
  it("no-op flag off", () => {
    logDebugEvent({ side: "sts", step: "persona-sim", user_id: "ryo", outcome: "ok" });
    expect(existsSync(tmpDir) ? readdirSync(tmpDir) : []).toEqual([]);
  });

  it("escreve NDJSON quando flag on + run_id", () => {
    process.env["ASC_DEBUG_MODE"] = "true";
    setDebugRunId("sts-test-run");
    logDebugEvent({
      side: "sts",
      step: "persona-sim",
      user_id: "ryo-ochiai",
      user_kind: "child",
      motor_target: "kids",
      turn_number: 1,
      prompt: "test prompt",
      response: "test response",
      outcome: "ok",
    });
    const ndjsonPath = join(tmpDir, "sts-test-run", "events.ndjson");
    const event = JSON.parse(readFileSync(ndjsonPath, "utf-8").trim());
    expect(event.side).toBe("sts");
    expect(event.step).toBe("persona-sim");
    expect(event.user_id).toBe("ryo-ochiai");
    expect(event.user_kind).toBe("child");
    expect(event.motor_target).toBe("kids");
    expect(event.prompt_hash).toMatch(/^sha256:/);
  });
});

describe("initDebugRun", () => {
  it("gera runId + manifest com personas", () => {
    process.env["ASC_DEBUG_MODE"] = "true";
    const runId = initDebugRun({
      scenarioName: "smoke-3d",
      personas: ["ryo-ochiai", "kei-ochiai"],
      parents: ["yuji", "yuko"],
    });
    expect(runId).toBeTruthy();
    expect(runId!.startsWith("smoke-3d_")).toBe(true);
    const manifest = JSON.parse(
      readFileSync(join(tmpDir, runId!, "manifest.json"), "utf-8"),
    );
    expect(manifest.personas).toEqual(["ryo-ochiai", "kei-ochiai"]);
    expect(manifest.parents).toEqual(["yuji", "yuko"]);
  });
});
