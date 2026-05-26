/**
 * Tests cross-session memory persistence (PR 0 STS — spec 2026-05-25).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadPersonaState,
  savePersonaState,
  clearPersonaState,
  getStateDir,
} from "../src/persona-state-store.js";
import type { PersonaState } from "../src/types.js";

let tmpDir: string;
let originalEnv: string | undefined;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "persona-state-"));
  originalEnv = process.env["STS_PERSONA_STATE_DIR"];
  process.env["STS_PERSONA_STATE_DIR"] = tmpDir;
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  if (originalEnv === undefined) delete process.env["STS_PERSONA_STATE_DIR"];
  else process.env["STS_PERSONA_STATE_DIR"] = originalEnv;
});

describe("loadPersonaState", () => {
  it("retorna state limpo quando arquivo não existe", () => {
    const state = loadPersonaState("ryo-ochiai");
    expect(state.history).toEqual([]);
    expect(state.summary_so_far).toBeUndefined();
    expect(state.sessions_count).toBeUndefined();
  });

  it("carrega summary_so_far + sessions_count quando arquivo existe", () => {
    savePersonaState("ryo-ochiai", {
      history: [],
      summary_so_far: "Já falamos sobre Dragon Ball.",
      sessions_count: 2,
      last_session_ended_at: "2026-05-25T18:00:00.000Z",
      last_session_trust_final: 0.42,
    });
    const loaded = loadPersonaState("ryo-ochiai");
    expect(loaded.summary_so_far).toBe("Já falamos sobre Dragon Ball.");
    expect(loaded.sessions_count).toBe(2);
    expect(loaded.last_session_trust_final).toBe(0.42);
    expect(loaded.history).toEqual([]); // sempre reseta history
  });

  it("history nunca persiste (sempre vazia ao carregar)", () => {
    // Tenta forçar history em disk
    savePersonaState("ryo", {
      history: [{ role: "user", content: "x" }, { role: "assistant", content: "y" }],
      summary_so_far: "previous",
      sessions_count: 1,
    });
    const loaded = loadPersonaState("ryo");
    expect(loaded.history).toEqual([]);
    expect(loaded.summary_so_far).toBe("previous");
  });

  it("retorna state limpo se arquivo corrupto", () => {
    const path = join(tmpDir, "broken.json");
    require("fs").writeFileSync(path, "{ not valid json");
    const loaded = loadPersonaState("broken");
    expect(loaded.history).toEqual([]);
  });
});

describe("savePersonaState", () => {
  it("cria diretório se não existe", () => {
    savePersonaState("kei-ochiai", { history: [], sessions_count: 1 });
    expect(existsSync(join(tmpDir, "kei-ochiai.json"))).toBe(true);
  });

  it("nunca escreve history no arquivo (cross-session = sem history)", () => {
    savePersonaState("ryo-ochiai", {
      history: [{ role: "user", content: "secret" }, { role: "assistant", content: "x" }],
      summary_so_far: "ok",
    });
    const path = join(tmpDir, "ryo-ochiai.json");
    const content = readFileSync(path, "utf8");
    expect(content).not.toContain("secret");
    expect(JSON.parse(content).history).toEqual([]);
  });

  it("preserva summary + sessions_count após save+load round-trip", () => {
    const state: PersonaState = {
      history: [],
      summary_so_far: "memória X",
      sessions_count: 5,
      last_session_ended_at: "2026-05-25T18:00:00.000Z",
      last_session_trust_final: 0.55,
    };
    savePersonaState("test", state);
    const loaded = loadPersonaState("test");
    expect(loaded.summary_so_far).toBe(state.summary_so_far);
    expect(loaded.sessions_count).toBe(state.sessions_count);
    expect(loaded.last_session_ended_at).toBe(state.last_session_ended_at);
    expect(loaded.last_session_trust_final).toBe(state.last_session_trust_final);
  });
});

describe("clearPersonaState", () => {
  it("zera summary + sessions_count mas não derruba arquivo", () => {
    savePersonaState("ryo", { history: [], summary_so_far: "a", sessions_count: 3 });
    clearPersonaState("ryo");
    const loaded = loadPersonaState("ryo");
    expect(loaded.summary_so_far).toBeUndefined();
    expect(loaded.sessions_count).toBeUndefined();
  });

  it("no-op se arquivo não existe", () => {
    expect(() => clearPersonaState("never-existed")).not.toThrow();
  });
});

describe("getStateDir", () => {
  it("respeita STS_PERSONA_STATE_DIR env", () => {
    expect(getStateDir()).toBe(tmpDir);
  });
});
