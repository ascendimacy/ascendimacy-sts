#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadPersonas, getPersona } from "./persona-loader.js";
import { getPersonaNextMessage, summarizeSession, type CrossSessionMemory } from "./llm-client.js";
import { loadPersonaState, savePersonaState, clearPersonaState } from "./persona-state-store.js";
import type { PersonaState } from "./types.js";
import { logDebugEvent, getProviderForStep, getModelForStep } from "@ascendimacy/sts-shared";

const server = new McpServer({
  name: "persona-simulator",
  version: "0.1.0",
});

const sessionStates = new Map<string, PersonaState>();

function getState(personaId: string): PersonaState {
  if (!sessionStates.has(personaId)) {
    // Subject Knowledge Fase 8: ao primeiro acesso na sessão, carrega
    // memória persistida de disk (cross-session). History sempre começa
    // vazio (estado de turn na sessão atual).
    const persisted = loadPersonaState(personaId);
    sessionStates.set(personaId, persisted);
  }
  return sessionStates.get(personaId)!;
}

function extractCrossSessionMemory(state: PersonaState): CrossSessionMemory | undefined {
  if (
    !state.summary_so_far &&
    (!state.sessions_count || state.sessions_count === 0)
  ) {
    return undefined;
  }
  return {
    summary_so_far: state.summary_so_far,
    sessions_count: state.sessions_count,
    last_session_ended_at: state.last_session_ended_at,
    last_session_trust_final: state.last_session_trust_final,
  };
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
    const crossMem = extractCrossSessionMemory(state);

    const useMockPersona = process.env["USE_MOCK_LLM"] === "true";
    const personaProvider = useMockPersona ? "mock" : getProviderForStep("persona-sim");
    const personaModel = useMockPersona ? "mock" : getModelForStep("persona-sim", personaProvider);
    const personaMockReason = useMockPersona ? "USE_MOCK_LLM=true" : null;

    try {
      const result = await getPersonaNextMessage(persona, args.botMessage, effectiveHistory, crossMem);
      state.history.push({ role: "assistant", content: args.botMessage });
      state.history.push({ role: "user", content: result.message });

      logDebugEvent({
        side: "sts",
        step: "persona-sim",
        user_id: args.personaId,
        user_kind: "child",
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
            cross_session_sessions_count: state.sessions_count ?? 0,
            has_summary_so_far: !!state.summary_so_far,
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

// Tool: reset persona state (CURRENT SESSION ONLY — preserva cross-session memory)
(server as any).registerTool(
  "persona_reset",
  {
    description: "Reset persona conversation history for current session (preserves cross-session memory; use persona_clear_memory to wipe everything)",
    inputSchema: {
      personaId: z.string(),
    } as any,
  },
  async (args: { personaId: string }) => {
    // Re-load persisted state (preserves summary_so_far, sessions_count, etc)
    // mas zera history in-memory.
    const persisted = loadPersonaState(args.personaId);
    sessionStates.set(args.personaId, persisted);
    return { content: [{ type: "text", text: JSON.stringify({ ok: true, sessions_count: persisted.sessions_count ?? 0 }) }] };
  }
);

// Tool: clear ALL persona state (cross-session memory included) — útil pra testes
(server as any).registerTool(
  "persona_clear_memory",
  {
    description: "Wipe ALL persona state including cross-session memory (summary, sessions count). Use with care — restart fresh.",
    inputSchema: {
      personaId: z.string(),
    } as any,
  },
  async (args: { personaId: string }) => {
    clearPersonaState(args.personaId);
    sessionStates.delete(args.personaId);
    return { content: [{ type: "text", text: JSON.stringify({ ok: true, cleared: true }) }] };
  }
);

// Tool: finalize session — LLM summarize + persist cross-session memory.
// Chamado pelo orchestrator no fim de cada sessão multi-sessão.
(server as any).registerTool(
  "persona_finalize_session",
  {
    description: "Finalize a session — LLM summarize the conversation from persona's POV and persist as cross-session memory. Call ONCE at end of each session in multi-session scenarios.",
    inputSchema: {
      personaId: z.string(),
      finalTrust: z.number().optional(),
    } as any,
  },
  async (args: { personaId: string; finalTrust?: number }) => {
    const persona = getPersona(args.personaId);
    if (!persona) {
      return { content: [{ type: "text", text: JSON.stringify({ error: `Persona not found: ${args.personaId}` }) }] };
    }
    const state = getState(args.personaId);
    if (state.history.length === 0) {
      return { content: [{ type: "text", text: JSON.stringify({ ok: false, reason: "no history to summarize" }) }] };
    }

    const prior: CrossSessionMemory = {
      summary_so_far: state.summary_so_far,
      sessions_count: state.sessions_count,
      last_session_ended_at: state.last_session_ended_at,
      last_session_trust_final: state.last_session_trust_final,
    };

    const newSummary = await summarizeSession({
      persona,
      sessionHistory: state.history,
      priorMemory: prior,
      finalTrust: args.finalTrust,
    });

    const updated: PersonaState = {
      history: [], // limpa pra próxima sessão
      summary_so_far: newSummary,
      sessions_count: (state.sessions_count ?? 0) + 1,
      last_session_ended_at: new Date().toISOString(),
      last_session_trust_final: args.finalTrust,
    };
    sessionStates.set(args.personaId, updated);
    savePersonaState(args.personaId, updated);

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          ok: true,
          sessions_count: updated.sessions_count,
          summary_preview: newSummary.slice(0, 120),
        }),
      }],
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
