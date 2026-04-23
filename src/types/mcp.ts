// MCP contracts v0.1 — formaliza docs/specs/2026-04-22-mcp-contracts.md

// ── MCP-LLM ────────────────────────────────────────────────────────────────

export interface LLMCorrelation {
  session_id: string;
  turn: number;
  agent_role: 'persona' | 'bot' | 'evaluator';
  call_index: number;
}

export interface LLMCompleteRequest {
  model: string;
  system: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  max_tokens: number;
  temperature?: number;
  seed?: number;
  response_format?: 'text' | 'json';
  correlation: LLMCorrelation;
}

export interface LLMCompleteResponse {
  content: string;
  meta: {
    model_used: string;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens?: number;
    cost_brl: number;
    elapsed_ms: number;
    provider: string;
    request_id: string;
  };
  correlation: LLMCorrelation;
  warnings?: string[];
}

// ── MCP-ebrota ─────────────────────────────────────────────────────────────

export interface EbrotaCorrelation {
  session_id: string;
  turn: number;
}

export interface EbrotaSessionStartRequest {
  phone: string;
  product: 'personal' | 'kids';
  mvp01a_context?: {
    process_id: string;
    bot_prior_ref: string;
    compositor_config: object;
  };
  correlation: EbrotaCorrelation;
}

export interface EbrotaSessionStartResponse {
  session_id_ebrota: string;
  message: string;
  phase: string;
  bot_weights?: Record<string, number>;
  bot_composer_justification?: string;
  meta: {
    elapsed_ms: number;
    from_stub: boolean;
  };
  correlation: EbrotaCorrelation;
}

export interface EbrotaSessionMessageRequest {
  phone: string;
  message: string;
  session_id_ebrota: string;
  correlation: EbrotaCorrelation;
}

export interface EbrotaSessionMessageResponse {
  message: string;
  phase: string;
  cohort?: string;
  qm_scores?: Record<string, number>;
  bot_weights?: Record<string, number>;
  bot_composer_justification?: string;
  meta: {
    elapsed_ms: number;
    from_stub: boolean;
  };
  correlation: EbrotaCorrelation;
}

export interface EbrotaHealthResponse {
  ok: boolean;
  mode: 'stub' | 'real';
  version: string;
  backend_version?: string;
}
