// Compositor contract v0.1 — formaliza docs/specs/2026-04-22-compositor-spec.md

export interface WithDecl {
  id: string;
  peso: {
    base: number;
    max?: number;
    drift: string;
  };
  modulation?: {
    raises?: Array<{ signal: string; delta: number }>;
    lowers?: Array<{ signal: string; delta: number }>;
  };
  interaction?: {
    synergistic_with?: string[];
    antagonistic_with?: string[];
    requires?: string[];
  };
  representation?: {
    active?: string;
    dormant?: string;
  };
}

export interface PhaseDecl {
  id: string;
  label: string;
  active_withs_tendency?: string[];
}

export interface Tendency {
  context: string;
  favor: string[];
  avoid: string[];
}

export interface Safety {
  id: string;
  trigger: string;
  action: string;
}

export interface HistoryEntry {
  turn: number;
  role: 'persona' | 'bot';
  message: string;
  key_signals: string[];
}

export interface ComposerInput {
  agent_role: 'persona' | 'bot';
  agent_id: string;

  prior: {
    description: string;
    commonly_active: WithDecl[];
    latent: WithDecl[];
    rare?: WithDecl[];
    blocked?: Array<{ id: string; reason: string }>;
    cautions?: string[];
    emergent_allowed?: object;
  };

  process: {
    book_id: string;
    version?: string;
    phases: PhaseDecl[];
    foundational_withs: string[];
    withs: WithDecl[];
    composition_tendencies: Tendency[];
    safety_boundaries: Safety[];
  };

  state: {
    weights_before: Record<string, number>;
    phase_current: string;
    turn: number;
    history_compact: HistoryEntry[];
    incoming_message?: string;
    incoming_signals?: string[];
  };

  config: {
    model: string;
    max_tokens: number;
    temperature: number;
    seed?: number;
    emergent_policy: 'allowed' | 'strict' | 'off';
  };
}

export interface ComposerOutput {
  weights_after: Record<string, number>;
  deltas: Record<string, number>;
  emergent_withs_introduced: Array<{
    id: string;
    derived_from?: string;
    peso: { base: number; drift: string };
    rationale: string;
  }>;
  message: string;
  composer_justification: string;
  meta: {
    model_used: string;
    input_tokens: number;
    output_tokens: number;
    cost_brl: number;
    cache_hit: boolean;
    elapsed_ms: number;
  };
  warnings?: string[];
}
