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
}
