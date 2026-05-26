/**
 * profile pode ser string (legado: prosa única) ou objeto com campos
 * estruturados (parental_profile, gardner_assessment, persona_sim_prompt_hint,
 * summary, etc.). Loaders + consumers tratam ambos.
 */
export interface PersonaDef {
  id: string;
  name: string;
  age: number;
  profile: string | Record<string, unknown>;
}

export interface Message {
  role: "user" | "assistant";
  content: string;
}

export interface TurnTrace {
  turn: number;
  botMessage: string;
  personaMessage: string;
  trustLevel: number;
  budgetRemaining: number;
  playbookId: string;
  durationMs: number;
  motorTrace?: unknown;
  /**
   * TV2-5 (motor spec ops#1136): EngineTraceV2 do motor — full engine
   * telemetry per turn (LLM calls com prompt/response, pre/post state
   * snapshots, component traces, SK writes anotados). Pass-through não
   * tipado — STS não depende de motor's @ascendimacy/shared.
   *
   * TODO TV2-5-strict-validate: opt-in Zod parse via parseEngineTraceV2
   * quando STS ganhar dep no motor shared (ou cópia do schema).
   */
  engineTrace?: unknown;
  /** sts#8 — card_id se auto-hook detect_achievement+emit_card disparou. */
  emittedCardId?: string;
  /** sts#8 — razão pra skip do auto-hook (no_signal, scaffold_in_non_test, triage_rejected, auto_hook_error). */
  cardEmissionSkipReason?: string;
}

export interface STSTurnTrace extends TurnTrace {
  personaEntry: {
    personaId: string;
    mood?: string;
    endConversation: boolean;
  };
}

export interface SessionTrace {
  sessionId: string;
  personaId: string;
  startedAt: string;
  completedAt: string;
  totalTurns: number;
  turns: STSTurnTrace[];
}
