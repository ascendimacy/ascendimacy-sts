export interface PersonaState {
  /** Turn-level history dentro da sessão atual. Resetado a cada nova sessão. */
  history: Array<{ role: "user" | "assistant"; content: string }>;

  /**
   * Memória cross-session (Subject Knowledge spec 2026-05-25 §1.2).
   * Persistida em disco entre sessões; injetada no system prompt pra
   * que a persona "lembre" o que aconteceu antes — viabiliza simulação
   * realista de crescimento ao longo da jornada (journey_stage progression).
   *
   * Atualizada via tool `persona_finalize_session` no fim de cada sessão.
   */
  summary_so_far?: string;
  /** Quantidade de sessões anteriores já concluídas pra esta persona. */
  sessions_count?: number;
  /** ISO timestamp do fim da última sessão. */
  last_session_ended_at?: string;
  /** Trust final da última sessão (sinal pro persona modular abertura). */
  last_session_trust_final?: number;
}
