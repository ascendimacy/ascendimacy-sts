export interface RunOptions {
  personaId: string;
  turns: number;
  initialBotMessage?: string;
  dryRun?: boolean;
}

export interface MotorTurnResult {
  botMessage: string;
  trustLevel: number;
  budgetRemaining: number;
  playbookId: string;
  motorTrace?: unknown;
  /** sts#8 auto-hook — card_id quando detect+emit pipeline persistiu. */
  emittedCardId?: string;
  /** sts#8 auto-hook — skip_reason (no_signal, scaffold_in_non_test, triage_rejected, etc). */
  cardEmissionSkipReason?: string;
}

/** Motor clients interface — used by scenario-events. */
export interface MotorClientTool {
  callTool: (args: { name: string; arguments: Record<string, unknown> }) => Promise<unknown>;
}

export interface MotorClients {
  motorExecucao: MotorClientTool;
  planejador?: MotorClientTool;
  motorDrota?: MotorClientTool;
}
