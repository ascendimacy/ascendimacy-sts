import { z } from 'zod';

// Zod schemas para validação do Trace JSON (gate G2)
// Espelha src/types/trace.ts — fonte de verdade é o spec trace-schema.md v0.1

const EmergentWithDeclSchema = z.object({
  id: z.string(),
  derived_from: z.string().optional(),
  peso: z.object({
    base: z.number().min(0).max(1),
    drift: z.string(),
  }),
  rationale: z.string(),
  introduced_at_turn: z.number().int().positive(),
});

const LLMCallMetaSchema = z.object({
  correlation_call_index: z.number().int().positive(),
  model_used: z.string(),
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  cost_brl: z.number().nonnegative(),
  elapsed_ms: z.number().nonnegative(),
  cache_hit: z.boolean(),
  seed: z.number().nullable(),
  request_id: z.string().nullable(),
});

const AgentTurnSchema = z.object({
  agent_role: z.enum(['persona', 'bot']),
  agent_id: z.string(),
  weights_before: z.record(z.string(), z.number()),
  weights_after: z.record(z.string(), z.number()),
  deltas: z.record(z.string(), z.number()),
  emergent_withs_introduced: z.array(EmergentWithDeclSchema),
  message: z.string(),
  composer_justification: z.string(),
  key_signals_extracted: z.array(z.string()),
  llm_call: LLMCallMetaSchema,
  warnings: z.array(z.string()).optional(),
});

const TurnEventSchema = z.object({
  type: z.enum(['emergent_with_promoted', 'safety_trigger', 'phase_transition', 'warning']),
  detail: z.record(z.string(), z.unknown()),
});

const TurnMetaSchema = z.object({
  elapsed_seconds: z.number().nonnegative(),
  llm_calls: z.number().int().nonnegative(),
  cache_hits: z.number().int().nonnegative(),
  cost_brl: z.number().nonnegative(),
});

const TurnEntrySchema = z.object({
  turn: z.number().int().positive(),
  timestamp: z.string().datetime({ offset: true }),
  phase: z.string(),
  persona: AgentTurnSchema,
  bot: AgentTurnSchema,
  meta: TurnMetaSchema,
  events: z.array(TurnEventSchema).optional(),
});

const SessionContextSchema = z.object({
  persona_id: z.string(),
  persona_version: z.string(),
  process_id: z.string(),
  process_version: z.string(),
  ontology_ref: z.string(),
  started_at: z.string().datetime({ offset: true }),
  ended_at: z.string().datetime({ offset: true }).nullable(),
  mvp_context: z.object({
    mvp: z.string(),
    orchestrator: z.string(),
  }),
});

const ComposerConfigSchema = z.object({
  model: z.string(),
  max_tokens: z.number().int().positive(),
  temperature: z.number().min(0).max(2),
  seed: z.number().nullable(),
  emergent_policy: z.enum(['allowed', 'strict', 'off']),
  cache_enabled: z.boolean(),
});

const TurnTotalsSchema = z.object({
  turns_completed: z.number().int().nonnegative(),
  llm_calls_total: z.number().int().nonnegative(),
  input_tokens_total: z.number().int().nonnegative(),
  output_tokens_total: z.number().int().nonnegative(),
  cost_brl_total: z.number().nonnegative(),
  elapsed_ms_total: z.number().nonnegative(),
  emergent_withs_introduced_total: z.number().int().nonnegative(),
  warnings_total: z.number().int().nonnegative(),
});

const SessionEndingSchema = z.object({
  reason: z.enum(['completed', 'safety_trigger', 'user_exit', 'error', 'max_turns']),
  detail: z.string().nullable(),
});

export const TraceSchema = z.object({
  schema_version: z.literal('0.1'),
  session_id: z.string(),
  session_context: SessionContextSchema,
  composer_config: ComposerConfigSchema,
  initial_weights: z.object({
    persona: z.record(z.string(), z.number()),
    bot: z.record(z.string(), z.number()),
  }),
  turns: z.array(TurnEntrySchema),
  totals: TurnTotalsSchema.nullable(),
  ending: SessionEndingSchema.nullable(),
});

/**
 * Valida um objeto contra o schema do Trace.
 * @param {unknown} data
 * @returns {{ success: true, data: import('./trace.js').Trace } | { success: false, error: import('zod').ZodError }}
 */
export function validateTrace(data) {
  return TraceSchema.safeParse(data);
}
