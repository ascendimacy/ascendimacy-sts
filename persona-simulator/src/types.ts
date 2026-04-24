export interface PersonaState {
  history: Array<{ role: "user" | "assistant"; content: string }>;
}
