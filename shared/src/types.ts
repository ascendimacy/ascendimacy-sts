export interface PersonaDef {
  id: string;
  name: string;
  age: number;
  profile: string;
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
