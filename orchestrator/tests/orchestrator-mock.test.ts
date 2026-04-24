import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { runMotorTurn, closeMotorClients, resetMotorClientsForTest } from "../src/motor-client.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

/**
 * sts#8 — runMotorTurn agora SEMPRE tenta motor MCP (mock_llm passa a usar
 * USE_MOCK_LLM internamente, sem bypass). Estes testes exercitam o pipeline
 * completo + auto-hook de cards.
 *
 * MOTOR_PATH default = /home/alexa/ascendimacy-motor (ajusta via env se preciso).
 * Esses testes spawnam motor real (~1-2s setup) e podem ser pulados em CI light
 * via VITEST_SKIP_HEAVY=true.
 */

const SKIP_HEAVY = process.env["VITEST_SKIP_HEAVY"] === "true";
const desc = SKIP_HEAVY ? describe.skip : describe;

let tmpStateDir: string;

beforeAll(() => {
  tmpStateDir = mkdtempSync(join(tmpdir(), "sts8-motor-"));
  process.env["USE_MOCK_LLM"] = "true";
  process.env["MOTOR_PATH"] = process.env["MOTOR_PATH"] ?? "/home/alexa/ascendimacy-motor";
  process.env["MOTOR_STATE_DIR"] = tmpStateDir;
  process.env["NODE_ENV"] = "test";
  process.env["EBROTA_CARD_SECRET"] = process.env["EBROTA_CARD_SECRET"] ?? "ebrota-default-test-secret-min-8";
});

afterAll(async () => {
  try {
    await closeMotorClients();
  } catch { /* ignore */ }
  rmSync(tmpStateDir, { recursive: true, force: true });
  resetMotorClientsForTest();
});

desc("runMotorTurn — sts#8 real motor (mock LLM internal)", () => {
  it("retorna resultado válido com motorTrace expandido (não fixed-string mock)", async () => {
    const result = await runMotorTurn("sts8-test-real-1", "Olá", 1, "ryo-ochiai");
    expect(result.botMessage).toBeTruthy();
    expect(typeof result.trustLevel).toBe("number");
    expect(typeof result.budgetRemaining).toBe("number");
    expect(result.playbookId).toBeTruthy();
    // motorTrace agora tem plan/drota/exec, não é o mock={mock:true,turn:N} antigo
    const mt = result.motorTrace as Record<string, unknown>;
    expect(mt).toHaveProperty("plan");
    expect(mt).toHaveProperty("drota");
    expect(mt).toHaveProperty("exec");
    expect(mt["mock"]).toBe(true); // refletindo USE_MOCK_LLM, mas pipeline rodou
  });

  it("MotorTurnResult tem campos auto-hook (emittedCardId | cardEmissionSkipReason)", async () => {
    const result = await runMotorTurn("sts8-test-hook-1", "Oi", 1, "ryo-ochiai");
    // ao menos um dos dois deve estar definido — hook sempre roda
    const hasHookOutcome =
      result.emittedCardId !== undefined || result.cardEmissionSkipReason !== undefined;
    expect(hasHookOutcome).toBe(true);
  });

  it("DB do motor sob MOTOR_STATE_DIR contém TODAS tabelas kids_* (DDL rodou)", async () => {
    await runMotorTurn("sts8-test-db-1", "Oi", 1, "ryo-ochiai");
    const dbPath = join(tmpStateDir, ".motor-state.db");
    const db = new Database(dbPath, { readonly: true });
    try {
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all()
        .map((r) => (r as { name: string }).name);
      expect(tables).toContain("sessions");
      expect(tables).toContain("event_log");
      expect(tables).toContain("tree_nodes");
      expect(tables).toContain("kids_emitted_cards");
      expect(tables).toContain("kids_gardner_program");
      expect(tables).toContain("kids_parent_decisions");
    } finally {
      db.close();
    }
  });
});

describe("runMotorTurn — graceful degrade", () => {
  beforeEach(() => {
    resetMotorClientsForTest();
  });

  it("retorna fixed-string mock se MOTOR_PATH inválido", async () => {
    const original = process.env["MOTOR_PATH"];
    process.env["MOTOR_PATH"] = "/nonexistent/path/that/cannot/spawn";
    try {
      const result = await runMotorTurn("sts8-degrade-1", "msg", 3);
      expect(result.botMessage).toContain("[Mock Bot Turn 3]");
      const mt = result.motorTrace as Record<string, unknown>;
      expect(mt["mock"]).toBe(true);
      expect(mt["reason"]).toBe("motor_spawn_failed");
      // Sem hook outcome porque motor não spawnou
      expect(result.emittedCardId).toBeUndefined();
      expect(result.cardEmissionSkipReason).toBeUndefined();
    } finally {
      if (original) process.env["MOTOR_PATH"] = original;
      else delete process.env["MOTOR_PATH"];
      resetMotorClientsForTest();
    }
  });
});
