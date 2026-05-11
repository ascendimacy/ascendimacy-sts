#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadPersonas, getPersona } from "./persona-loader.js";
import { getPersonaNextMessage } from "./llm-client.js";
import type { PersonaState } from "./types.js";
import { logDebugEvent, getProviderForStep, getModelForStep } from "@ascendimacy/sts-shared";

const server = new McpServer({
  name: "persona-simulator",
  version: "0.1.0",
});

const sessionStates = new Map<string, PersonaState>();

function getState(personaId: string): PersonaState {
  if (!sessionStates.has(personaId)) {
    sessionStates.set(personaId, { history: [] });
  }
  return sessionStates.get(personaId)!;
}

// Tool: list personas
(server as any).registerTool(
  "persona_list",
  {
    description: "List all available personas",
    inputSchema: {} as any,
  },
  async () => {
    const personas = loadPersonas();
    const result = {
      personas: personas.map((p) => ({ id: p.id, name: p.name, age: p.age })),
    };
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

// Tool: next message from persona
(server as any).registerTool(
  "persona_next_message",
  {
    description: "Get the persona's next message given the bot's message",
    inputSchema: {
      personaId: z.string(),
      botMessage: z.string(),
      history: z.array(
        z.object({ role: z.enum(["user", "assistant"]), content: z.string() })
      ),
    } as any,
  },
  async (args: { personaId: string; botMessage: string; history: Array<{ role: "user" | "assistant"; content: string }> }) => {
    const persona = getPersona(args.personaId);
    if (!persona) {
      return { content: [{ type: "text", text: JSON.stringify({ error: `Persona not found: ${args.personaId}` }) }] };
    }
    const state = getState(args.personaId);
    const effectiveHistory = args.history ?? state.history;
    const turnIndex = Math.floor(effectiveHistory.length / 2) + 1;

    // 2026-05-05: provider/model efetivos refletem dispatch real (mock/anthropic/local/infomaniak).
    // useMock cobre USE_MOCK_LLM=true; provider real vem do router.
    const useMockPersona = process.env["USE_MOCK_LLM"] === "true";
    const personaProvider = useMockPersona ? "mock" : getProviderForStep("persona-sim");
    const personaModel = useMockPersona ? "mock" : getModelForStep("persona-sim", personaProvider);
    const personaMockReason = useMockPersona ? "USE_MOCK_LLM=true" : null;

    try {
      const result = await getPersonaNextMessage(persona, args.botMessage, effectiveHistory);
      state.history.push({ role: "assistant", content: args.botMessage });
      state.history.push({ role: "user", content: result.message });

      // sts#10: debug log (no-op se ASC_DEBUG_MODE off)
      logDebugEvent({
        side: "sts",
        step: "persona-sim",
        user_id: args.personaId,
        user_kind: "child", // v1 assume child; futuro: lookup via persona.kind
        motor_target: "kids",
        turn_number: turnIndex,
        model: personaModel,
        provider: personaProvider,
        mock_reason: personaMockReason,
        tokens: result._debug
          ? { in: result._debug.tokens.in, out: result._debug.tokens.out, reasoning: 0 }
          : null,
        latency_ms: result._debug?.latency_ms ?? null,
        prompt: result._debug?.systemPrompt,
        response: result._debug?.rawResponse,
        reasoning: result._debug?.reasoning,
        snapshots_pre: {
          persona: {
            persona_id: persona.id,
            name: persona.name,
            age: persona.age,
            history_length: effectiveHistory.length,
            history_tail_3: effectiveHistory.slice(-3),
            mock_mode: false,
            turn_index: turnIndex,
            last_bot_message_preview: args.botMessage.slice(0, 160),
          },
        },
        snapshots_post: {
          persona: {
            persona_id: persona.id,
            history_length: state.history.length,
            end_conversation: result.endConversation,
            mood: result.metadata?.mood ?? null,
            response_preview: result.message.slice(0, 160),
          },
        },
        outcome: "ok",
      });

      // _debug nunca sai pra cliente MCP — strip antes de serializar
      const { _debug: _omit, ...publicResult } = result as typeof result & { _debug?: unknown };
      return { content: [{ type: "text", text: JSON.stringify(publicResult) }] };
    } catch (err) {
      logDebugEvent({
        side: "sts",
        step: "persona-sim",
        user_id: args.personaId,
        motor_target: "kids",
        turn_number: turnIndex,
        model: personaModel,
        provider: personaProvider,
        mock_reason: personaMockReason,
        outcome: "error",
        error_class: String((err as Error).name ?? "Error"),
        response: String((err as Error).message ?? String(err)),
      });
      throw err;
    }
  }
);

// Tool: reset persona state
(server as any).registerTool(
  "persona_reset",
  {
    description: "Reset persona conversation history",
    inputSchema: {
      personaId: z.string(),
    } as any,
  },
  async (args: { personaId: string }) => {
    sessionStates.delete(args.personaId);
    return { content: [{ type: "text", text: JSON.stringify({ ok: true }) }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
