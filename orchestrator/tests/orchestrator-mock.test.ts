import { describe, it, expect, beforeAll } from "vitest";
import { runMotorTurn } from "../src/motor-client.js";

beforeAll(() => {
  process.env["USE_MOCK_LLM"] = "true";
  process.env["MOTOR_PATH"] = process.env["MOTOR_PATH"] ?? "/home/alexa/ascendimacy-motor";
});

describe("runMotorTurn mock", () => {
  it("returns a motor result with mock enabled", async () => {
    const result = await runMotorTurn("test-session-1", "Olá", 1);
    expect(result.botMessage).toBeTruthy();
    expect(typeof result.trustLevel).toBe("number");
    expect(typeof result.budgetRemaining).toBe("number");
    expect(result.playbookId).toBeTruthy();
  });

  it("trust increases across turns in mock mode", async () => {
    const r1 = await runMotorTurn("test-session-2", "msg", 1);
    const r2 = await runMotorTurn("test-session-2", "msg", 2);
    expect(r2.trustLevel).toBeGreaterThan(r1.trustLevel);
  });
});
