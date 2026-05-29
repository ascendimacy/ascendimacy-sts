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
  engineTrace?: {
    tutorial_contract?: { move_type?: string };
    tutorial_outcome?: { status?: string; needs_revisit?: boolean };
    session_mission?: Record<string, unknown>;
    progress_marker?: Record<string, unknown>;
    session_closure?: Record<string, unknown>;
  };
  tutorialOutcome?: { status?: string; needs_revisit?: boolean };
  sessionMission?: Record<string, unknown>;
  progressMarker?: Record<string, unknown>;
  sessionClosure?: Record<string, unknown>;
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
