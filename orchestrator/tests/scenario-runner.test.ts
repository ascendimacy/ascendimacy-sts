import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { runScenarioFromFile } from "../src/scenario-runner.js";
import { injectStatusDirect } from "../src/scenario-events.js";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "sts-scenario-test-"));
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function writeScenarioFile(content: string): string {
  const dir = join(tmpRoot, "scenarios");
  require("fs").mkdirSync(dir, { recursive: true });
  const p = join(dir, "test.yaml");
  writeFileSync(p, content, "utf-8");
  return p;
}

describe("scenario-runner — happy path", () => {
  it("runs inject_status and writes consolidated.md", async () => {
    const yaml = `
name: test-runner
start_date: "2026-05-01T00:00:00Z"
end_date: "2026-05-03T00:00:00Z"
personas: [ryo-ochiai]
parents: []
mock_llm: true
state_dir: "state/test-runner"
events:
  - day: 1
    type: inject_status
    persona: ryo-ochiai
    dimension: emotional
    value: brejo
  - day: 2
    type: inject_status
    persona: ryo-ochiai
    dimension: emotional
    value: baia
`;
    const path = writeScenarioFile(yaml);
    const reportsDir = join(tmpRoot, "reports");
    const result = await runScenarioFromFile({
      scenarioPath: path,
      reportsDir,
      forceMockLlm: true,
    });

    expect(result.outcomes).toHaveLength(2);
    expect(result.outcomes.every((o) => o.success)).toBe(true);
    expect(result.outcomes[0]!.notes).toContain("emotional=brejo");

    const consolidated = join(reportsDir, "consolidated.md");
    expect(existsSync(consolidated)).toBe(true);
    const md = readFileSync(consolidated, "utf-8");
    expect(md).toContain("test-runner");
    expect(md).toContain("## Timeline");
    expect(md).toContain("## Findings automáticos");
  });

  it("env vars são setadas por evento (STS_VIRTUAL_NOW + MOTOR_STATE_DIR)", async () => {
    const yaml = `
name: env-check
start_date: "2026-05-10T00:00:00Z"
end_date: "2026-05-12T00:00:00Z"
personas: [ryo]
parents: []
events:
  - day: 1
    type: inject_status
    persona: ryo
    dimension: emotional
    value: brejo
`;
    const path = writeScenarioFile(yaml);
    const reportsDir = join(tmpRoot, "reports");
    await runScenarioFromFile({ scenarioPath: path, reportsDir });

    expect(process.env["STS_VIRTUAL_NOW"]).toBe("2026-05-10T00:00:00.000Z");
    expect(process.env["MOTOR_STATE_DIR"]).toContain("env-check");
    expect(process.env["NODE_ENV"]).toBe("test");
  });

  it("invalid yaml throws informative error", async () => {
    const yaml = `
name: ""
start_date: "bad-date"
personas: []
events: []
`;
    const path = writeScenarioFile(yaml);
    await expect(
      runScenarioFromFile({ scenarioPath: path, reportsDir: join(tmpRoot, "reports") }),
    ).rejects.toThrow(/Scenario invalid/);
  });
});

describe("injectStatusDirect — DB effect", () => {
  it("upserts status into tree_nodes table", () => {
    const stateDir = join(tmpRoot, "direct-state");
    require("fs").mkdirSync(stateDir, { recursive: true });
    injectStatusDirect(stateDir, "sess-1", "emotional", "brejo", "2026-05-15T00:00:00Z");

    const db = new Database(join(stateDir, ".motor-state.db"), { readonly: true });
    const row = db
      .prepare("SELECT value FROM tree_nodes WHERE session_id='sess-1' AND zone='status' AND key='emotional'")
      .get() as { value: string } | undefined;
    db.close();
    expect(row?.value).toBe("brejo");
  });

  it("subsequent upsert overwrites (idempotent)", () => {
    const stateDir = join(tmpRoot, "overwrite-state");
    require("fs").mkdirSync(stateDir, { recursive: true });
    injectStatusDirect(stateDir, "s1", "emotional", "brejo", "2026-05-15T00:00:00Z");
    injectStatusDirect(stateDir, "s1", "emotional", "baia", "2026-05-16T00:00:00Z");

    const db = new Database(join(stateDir, ".motor-state.db"), { readonly: true });
    const rows = db
      .prepare("SELECT value FROM tree_nodes WHERE session_id='s1' AND zone='status' AND key='emotional'")
      .all() as Array<{ value: string }>;
    db.close();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.value).toBe("baia");
  });

  it("state persiste entre runs (state_dir compartilhado)", () => {
    const stateDir = join(tmpRoot, "persist-state");
    require("fs").mkdirSync(stateDir, { recursive: true });
    injectStatusDirect(stateDir, "s1", "emotional", "brejo", "2026-05-15T00:00:00Z");

    // Simular segundo "run" (nova invocação):
    const db = new Database(join(stateDir, ".motor-state.db"), { readonly: true });
    const row = db
      .prepare("SELECT value FROM tree_nodes WHERE session_id='s1'")
      .get() as { value: string } | undefined;
    db.close();
    expect(row?.value).toBe("brejo");
  });
});
