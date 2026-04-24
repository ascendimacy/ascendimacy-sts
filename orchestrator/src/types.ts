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

/** Motor clients interface — used by scenario-events. */
export interface MotorClientTool {
  callTool: (args: { name: string; arguments: Record<string, unknown> }) => Promise<unknown>;
}

export interface MotorClients {
  motorExecucao: MotorClientTool;
  planejador?: MotorClientTool;
  motorDrota?: MotorClientTool;
}
