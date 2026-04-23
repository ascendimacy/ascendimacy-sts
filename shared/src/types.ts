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
