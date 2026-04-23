#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadPersonas, getPersona } from "./persona-loader.js";
import { getPersonaNextMessage } from "./llm-client.js";
import type { PersonaState } from "./types.js";

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
    const result = await getPersonaNextMessage(persona, args.botMessage, args.history ?? state.history);
    state.history.push({ role: "assistant", content: args.botMessage });
    state.history.push({ role: "user", content: result.message });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
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
