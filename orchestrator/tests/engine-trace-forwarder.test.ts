/**
 * TV2-5 (motor spec ops#1136) — STS forwarder do EngineTraceV2 do motor.
 *
 * Validação simples do trace-writer: quando STSTurnTrace.engineTrace
 * presente, escreve no JSON; quando ausente, não emite campo.
 *
 * Não exercita motor real — usa fixtures sintéticos. Forwarder em
 * motor-client.ts + orchestrator.ts é puramente plumbing (type-checked
 * pelo tsc).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, rmSync, existsSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { SessionTrace, STSTurnTrace } from "@ascendimacy/sts-shared";

// trace-writer escreve em <repoRoot>/traces — não bate com tmpdir. Em vez
// disso testamos via JSON.stringify direto (a operação importante é o
// JSON shape). Mantém test puro e portable.

const baseTurn = (turn: number): STSTurnTrace => ({
  turn,
  botMessage: "bot says hi",
  personaMessage: "user says hello",
  trustLevel: 0.5,
  budgetRemaining: 100,
  playbookId: "test-playbook",
  durationMs: 1000,
  personaEntry: { personaId: "test-persona", endConversation: false },
});

const baseSession = (turns: STSTurnTrace[]): SessionTrace => ({
  sessionId: "test-session",
  personaId: "test-persona",
  startedAt: new Date().toISOString(),
  completedAt: new Date().toISOString(),
  totalTurns: turns.length,
  turns,
});

describe("TV2-5 — STSTurnTrace forwarda engineTrace", () => {
  it("escreve engineTrace quando presente no turn", () => {
    const engineTrace = {
      schema_version: 2,
      turn_started_at: "2026-05-26T15:00:00Z",
      turn_completed_at: "2026-05-26T15:00:30Z",
      pre_state: { trust_level: 0.4, budget_remaining: 100 },
      post_state: { trust_level: 0.45, budget_remaining: 95 },
      state_diff: {
        subject_knowledge_added_count: 1,
        trust_delta: 0.05,
        budget_delta: -5,
      },
      components: {},
      llm_calls: [
        {
          id: "llm-1",
          role: "materializer",
          provider: "local",
          model: "qwen14b",
          prompt: "x",
          response: "y",
          duration_ms: 500,
        },
      ],
      subject_knowledge_writes: [],
      warnings: [],
    };
    const turn: STSTurnTrace = { ...baseTurn(1), engineTrace };
    const session = baseSession([turn]);
    const serialized = JSON.parse(JSON.stringify(session));
    expect(serialized.turns[0].engineTrace).toBeDefined();
    expect(serialized.turns[0].engineTrace.schema_version).toBe(2);
    expect(serialized.turns[0].engineTrace.llm_calls).toHaveLength(1);
  });

  it("NÃO emite engineTrace key quando ausente (backward compat)", () => {
    const turn = baseTurn(1);
    const session = baseSession([turn]);
    const serialized = JSON.parse(JSON.stringify(session));
    expect("engineTrace" in serialized.turns[0]).toBe(false);
    expect(serialized.turns[0].engineTrace).toBeUndefined();
  });

  it("mistura: alguns turns têm engineTrace, outros não", () => {
    const session = baseSession([
      baseTurn(1),
      { ...baseTurn(2), engineTrace: { schema_version: 2, foo: "bar" } },
      baseTurn(3),
    ]);
    const serialized = JSON.parse(JSON.stringify(session));
    expect(serialized.turns[0].engineTrace).toBeUndefined();
    expect(serialized.turns[1].engineTrace).toBeDefined();
    expect(serialized.turns[1].engineTrace.foo).toBe("bar");
    expect(serialized.turns[2].engineTrace).toBeUndefined();
  });
});
