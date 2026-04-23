import { describe, it, expect } from 'vitest';
import { validateTrace } from '../src/types/trace.schema.js';

describe('H0 smoke test', () => {
  it('TraceSchema rejeita objeto vazio', () => {
    const result = validateTrace({});
    expect(result.success).toBe(false);
  });

  it('TraceSchema valida trace mínimo bem-formado', () => {
    const now = new Date().toISOString();

    const minimalTurn = {
      turn: 1,
      timestamp: now,
      phase: 'opening',
      persona: makeAgentTurn('persona', 'paula-mendes', 1),
      bot: makeAgentTurn('bot', 'drota-coach', 2),
      meta: { elapsed_seconds: 4.6, llm_calls: 2, cache_hits: 0, cost_brl: 0.09 },
    };

    const trace = {
      schema_version: '0.1',
      session_id: 'paula-mendes-drota-20260423T0000Z',
      session_context: {
        persona_id: 'paula-mendes',
        persona_version: '0.1',
        process_id: 'drota',
        process_version: '0.1',
        ontology_ref: 'last-co-v1.0',
        started_at: now,
        ended_at: null,
        mvp_context: { mvp: 'mvp-01a', orchestrator: 'ascendimacy-sts-cli v0.1.0' },
      },
      composer_config: {
        model: 'claude-sonnet-4-6',
        max_tokens: 400,
        temperature: 0.7,
        seed: null,
        emergent_policy: 'allowed',
        cache_enabled: false,
      },
      initial_weights: {
        persona: { withAnalyticalDistance: 0.75 },
        bot: { withCoachingStance: 0.80 },
      },
      turns: [minimalTurn],
      totals: null,
      ending: null,
    };

    const result = validateTrace(trace);
    expect(result.success).toBe(true);
  });

  it('TraceSchema rejeita schema_version errada', () => {
    const result = validateTrace({ schema_version: '1.0' });
    expect(result.success).toBe(false);
  });

  it('TraceSchema rejeita cost_brl negativo', () => {
    const now = new Date().toISOString();
    const trace = buildMinimalTrace(now);
    trace.turns[0].meta.cost_brl = -1;
    const result = validateTrace(trace);
    expect(result.success).toBe(false);
  });

  it('TraceSchema rejeita emergent_policy inválida', () => {
    const now = new Date().toISOString();
    const trace = buildMinimalTrace(now);
    trace.composer_config.emergent_policy = 'maybe';
    const result = validateTrace(trace);
    expect(result.success).toBe(false);
  });
});

// ── helpers ─────────────────────────────────────────────────────────────────

function makeAgentTurn(role, agentId, callIndex) {
  const now = new Date().toISOString();
  return {
    agent_role: role,
    agent_id: agentId,
    weights_before: {},
    weights_after: { withSomething: 0.5 },
    deltas: { withSomething: 0.5 },
    emergent_withs_introduced: [],
    message: 'Olá.',
    composer_justification: 'Turn 1. Fase opening. Abre neutro.',
    key_signals_extracted: ['abertura_neutra'],
    llm_call: {
      correlation_call_index: callIndex,
      model_used: 'claude-sonnet-4-6',
      input_tokens: 2000,
      output_tokens: 150,
      cost_brl: 0.045,
      elapsed_ms: 2100,
      cache_hit: false,
      seed: null,
      request_id: null,
    },
  };
}

function buildMinimalTrace(now) {
  return {
    schema_version: '0.1',
    session_id: 'smoke-test-session',
    session_context: {
      persona_id: 'paula-mendes',
      persona_version: '0.1',
      process_id: 'drota',
      process_version: '0.1',
      ontology_ref: 'last-co-v1.0',
      started_at: now,
      ended_at: null,
      mvp_context: { mvp: 'mvp-01a', orchestrator: 'ascendimacy-sts-cli v0.1.0' },
    },
    composer_config: {
      model: 'claude-sonnet-4-6',
      max_tokens: 400,
      temperature: 0.7,
      seed: null,
      emergent_policy: 'allowed',
      cache_enabled: false,
    },
    initial_weights: { persona: {}, bot: {} },
    turns: [
      {
        turn: 1,
        timestamp: now,
        phase: 'opening',
        persona: makeAgentTurn('persona', 'paula-mendes', 1),
        bot: makeAgentTurn('bot', 'drota-coach', 2),
        meta: { elapsed_seconds: 4.0, llm_calls: 2, cache_hits: 0, cost_brl: 0.09 },
      },
    ],
    totals: null,
    ending: null,
  };
}
