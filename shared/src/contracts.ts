// MCP tool contracts for persona-simulator

export interface PersonaListOutput {
  personas: Array<{ id: string; name: string; age: number }>;
}

export interface PersonaNextMessageInput {
  personaId: string;
  botMessage: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
}

export interface PersonaNextMessageOutput {
  message: string;
  endConversation: boolean;
  metadata: { mood?: string };
}

export interface PersonaResetInput {
  personaId: string;
}

export interface PersonaResetOutput {
  ok: boolean;
}
