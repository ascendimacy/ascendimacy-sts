// Trace schema v0.1 — formaliza docs/specs/2026-04-22-trace-schema.md

export interface Trace {
  schema_version: '0.1';
  session_id: string;
  session_context: SessionContext;
  composer_config: ComposerConfig;
  initial_weights: {
    persona: Record<string, number>;
    bot: Record<string, number>;
  };
  turns: TurnEntry[];
  totals: TurnTotals | null;
  ending: SessionEnding | null;
}

export interface SessionContext {
  persona_id: string;
  persona_version: string;
  process_id: string;
  process_version: string;
  ontology_ref: string;
  started_at: string;
  ended_at: string | null;
  mvp_context: {
    mvp: string;
    orchestrator: string;
  };
}

export interface ComposerConfig {
  model: string;
  max_tokens: number;
  temperature: number;
  seed: number | null;
  emergent_policy: 'allowed' | 'strict' | 'off';
  cache_enabled: boolean;
}

export interface TurnEntry {
  turn: number;
  timestamp: string;
  phase: string;
  persona: AgentTurn;
  bot: AgentTurn;
  meta: TurnMeta;
  events?: TurnEvent[];
}

export interface AgentTurn {
  agent_role: 'persona' | 'bot';
  agent_id: string;
  weights_before: Record<string, number>;
  weights_after: Record<string, number>;
  deltas: Record<string, number>;
  emergent_withs_introduced: EmergentWithDecl[];
  message: string;
  composer_justification: string;
  key_signals_extracted: string[];
  llm_call: LLMCallMeta;
  warnings?: string[];
}

export interface LLMCallMeta {
  correlation_call_index: number;
  model_used: string;
  input_tokens: number;
  output_tokens: number;
  cost_brl: number;
  elapsed_ms: number;
  cache_hit: boolean;
  seed: number | null;
  request_id: string | null;
}

export interface EmergentWithDecl {
  id: string;
  derived_from?: string;
  peso: { base: number; drift: string };
  rationale: string;
  introduced_at_turn: number;
}

export interface TurnMeta {
  elapsed_seconds: number;
  llm_calls: number;
  cache_hits: number;
  cost_brl: number;
}

export interface TurnEvent {
  type: 'emergent_with_promoted' | 'safety_trigger' | 'phase_transition' | 'warning';
  detail: object;
}

export interface TurnTotals {
  turns_completed: number;
  llm_calls_total: number;
  input_tokens_total: number;
  output_tokens_total: number;
  cost_brl_total: number;
  elapsed_ms_total: number;
  emergent_withs_introduced_total: number;
  warnings_total: number;
}

export interface SessionEnding {
  reason: 'completed' | 'safety_trigger' | 'user_exit' | 'error' | 'max_turns';
  detail: string | null;
}
