import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { join } from "path";
import { existsSync } from "fs";
import type { MotorTurnResult } from "./types.js";

function buildEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  const keys = [
    "ANTHROPIC_API_KEY",
    "INFOMANIAK_API_KEY",
    "INFOMANIAK_BASE_URL",
    "PLANEJADOR_MODEL",
    "MOTOR_DROTA_MODEL",
    "USE_MOCK_LLM",
  ];
  for (const k of keys) {
    const v = process.env[k];
    if (v) env[k] = v;
  }
  return env;
}

function getMotorPath(): string {
  const motorPath = process.env["MOTOR_PATH"];
  if (!motorPath) throw new Error("MOTOR_PATH env var not set");

  const required = [
    join(motorPath, "planejador/dist/server.js"),
    join(motorPath, "motor-drota/dist/server.js"),
    join(motorPath, "motor-execucao/dist/server.js"),
  ];
  for (const p of required) {
    if (!existsSync(p)) {
      throw new Error(`Motor not built — missing: ${p}. Run: cd $MOTOR_PATH && npm run build`);
    }
  }
  return motorPath;
}

interface MotorClients {
  planejador: Client;
  motorDrota: Client;
  motorExecucao: Client;
}

let _clients: MotorClients | null = null;

export async function getMotorClients(): Promise<MotorClients> {
  if (_clients) return _clients;

  const motorPath = getMotorPath();
  const env = buildEnv();

  const planejador = new Client({ name: "sts-planejador-client", version: "0.1.0" });
  const motorDrota = new Client({ name: "sts-drota-client", version: "0.1.0" });
  const motorExecucao = new Client({ name: "sts-execucao-client", version: "0.1.0" });

  await planejador.connect(
    new StdioClientTransport({
      command: "node",
      args: [join(motorPath, "planejador/dist/server.js")],
      env,
    })
  );
  await motorDrota.connect(
    new StdioClientTransport({
      command: "node",
      args: [join(motorPath, "motor-drota/dist/server.js")],
      env,
    })
  );
  await motorExecucao.connect(
    new StdioClientTransport({
      command: "node",
      args: [join(motorPath, "motor-execucao/dist/server.js")],
      env,
    })
  );

  _clients = { planejador, motorDrota, motorExecucao };
  return _clients;
}

export async function runMotorTurn(
  sessionId: string,
  personaMessage: string,
  turnNumber: number
): Promise<MotorTurnResult> {
  if (process.env["USE_MOCK_LLM"] === "true") {
    return {
      botMessage: `[Mock Bot Turn ${turnNumber}] Entendo o que você está dizendo. Vamos explorar isso juntos.`,
      trustLevel: 0.5 + turnNumber * 0.02,
      budgetRemaining: 100 - turnNumber * 5,
      playbookId: "mock-playbook-01",
      motorTrace: { mock: true, turn: turnNumber },
    };
  }

  const { planejador, motorDrota, motorExecucao } = await getMotorClients();

  const planResult = await planejador.callTool({
    name: "plan_turn",
    arguments: { sessionId, personaMessage, turn: turnNumber },
  });
  const planText = (planResult.content as Array<{ type: string; text: string }>)[0]!.text;
  const planData = JSON.parse(planText);

  const drotaResult = await motorDrota.callTool({
    name: "evaluate_and_select",
    arguments: {
      sessionId,
      candidates: planData.candidates ?? [],
      trustLevel: planData.trustLevel ?? 0.5,
    },
  });
  const drotaText = (drotaResult.content as Array<{ type: string; text: string }>)[0]!.text;
  const drotaData = JSON.parse(drotaText);

  const execResult = await motorExecucao.callTool({
    name: "execute_playbook",
    arguments: {
      sessionId,
      playbookId: drotaData.selectedAction?.playbookId ?? "default",
      trustLevel: drotaData.trustLevel ?? 0.5,
      budgetRemaining: drotaData.budgetRemaining ?? 100,
      turn: turnNumber,
    },
  });
  const execText = (execResult.content as Array<{ type: string; text: string }>)[0]!.text;
  const execData = JSON.parse(execText);

  return {
    botMessage: execData.materialization ?? execData.botMessage ?? "...",
    trustLevel: execData.trustLevel ?? 0.5,
    budgetRemaining: execData.budgetRemaining ?? 100,
    playbookId: execData.playbookId ?? "unknown",
    motorTrace: { plan: planData, drota: drotaData, exec: execData },
  };
}

export async function closeMotorClients(): Promise<void> {
  if (_clients) {
    await _clients.planejador.close();
    await _clients.motorDrota.close();
    await _clients.motorExecucao.close();
    _clients = null;
  }
}
