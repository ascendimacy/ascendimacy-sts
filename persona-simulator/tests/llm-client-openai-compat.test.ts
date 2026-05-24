/**
 * Persona-simulator LLM client — openai-compat bypass tests.
 *
 * D-3-PROV motor#1055 mirror em STS. Mockamos globalThis.fetch pra
 * verificar request shape + parsing do response sem precisar de
 * llama-server real.
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from "vitest";
import { getPersonaNextMessage } from "../src/llm-client.js";
import type { PersonaDef } from "../src/types.js";

const samplePersona = (): PersonaDef =>
  ({
    id: "test-persona",
    role: "user",
    age: 8,
    voiceProfile: {},
    background: {},
    triggers: {},
  }) as unknown as PersonaDef;

const KEYS = [
  "USE_MOCK_LLM",
  "ANTHROPIC_API_KEY",
  "INFOMANIAK_API_KEY",
  "LLM_PROVIDER",
  "LLM_LOCAL_ENDPOINT",
  "LLM_LOCAL_MODEL",
  "PERSONA_SIM_PROVIDER",
  "PERSONA_SIM_MODEL",
];

let fetchMock: Mock;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const mockResponse = (personaMessage = "olha aqui meu freio") => ({
  ok: true,
  status: 200,
  json: async () => ({
    // persona-sim espera JSON parseável no content: {message, mood, endConversation}
    choices: [
      {
        message: {
          content: JSON.stringify({
            message: personaMessage,
            endConversation: false,
            metadata: { mood: "curioso" },
          }),
        },
      },
    ],
    usage: { prompt_tokens: 50, completion_tokens: 10 },
    model: "qwen3-30b",
  }),
});

describe("callOpenAiCompatPersona bypass", () => {
  it("provider=openai-compat → fetch direto pro LLM_LOCAL_ENDPOINT", async () => {
    process.env["LLM_PROVIDER"] = "openai-compat";
    process.env["LLM_LOCAL_ENDPOINT"] = "http://172.28.160.1:9000/v1/chat/completions";
    process.env["LLM_LOCAL_MODEL"] = "qwen3-30b";
    fetchMock.mockResolvedValueOnce(
      mockResponse("hmm... tô pensando em montar o freio da bicicleta"),
    );

    const out = await getPersonaNextMessage(samplePersona(), "Olá", []);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://172.28.160.1:9000/v1/chat/completions");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("qwen3-30b");
    expect(body.messages).toHaveLength(1);
    expect(out.message).toContain("freio");
  });

  it("default endpoint localhost:8080 quando LLM_LOCAL_ENDPOINT ausente", async () => {
    process.env["LLM_PROVIDER"] = "openai-compat";
    process.env["LLM_LOCAL_MODEL"] = "qwen3-30b";
    fetchMock.mockResolvedValueOnce(mockResponse());

    await getPersonaNextMessage(samplePersona(), "oi", []);

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("http://localhost:8080/v1/chat/completions");
  });

  it("HTTP non-2xx → throws com shape openai-compat persona error: HTTP_N", async () => {
    process.env["LLM_PROVIDER"] = "openai-compat";
    process.env["LLM_LOCAL_ENDPOINT"] = "http://localhost:9000/v1/chat/completions";
    process.env["LLM_LOCAL_MODEL"] = "qwen3-30b";
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 405,
      text: async () => '{"detail":"Method Not Allowed"}',
    });

    await expect(
      getPersonaNextMessage(samplePersona(), "oi", []),
    ).rejects.toThrow(/openai-compat persona error: HTTP_405/);
  });

  it("response sem choices → throws EMPTY_RESPONSE", async () => {
    process.env["LLM_PROVIDER"] = "openai-compat";
    process.env["LLM_LOCAL_ENDPOINT"] = "http://localhost:9000/v1/chat/completions";
    process.env["LLM_LOCAL_MODEL"] = "qwen3-30b";
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ choices: [] }),
    });

    await expect(
      getPersonaNextMessage(samplePersona(), "oi", []),
    ).rejects.toThrow(/EMPTY_RESPONSE/);
  });

  it("provider=openai-compat NÃO invoca callInfomaniakPersona (não exige INFOMANIAK_API_KEY)", async () => {
    // Reproduz o bug que motivou esse PR: antes, openai-compat caía
    // no else binário e tentava chamar Infomaniak SDK → timeout/error
    // por falta de key. Agora o switch trifurcado garante que o
    // openai-compat path é tomado mesmo sem nenhuma API key setada.
    process.env["LLM_PROVIDER"] = "openai-compat";
    process.env["LLM_LOCAL_ENDPOINT"] = "http://localhost:9000/v1/chat/completions";
    process.env["LLM_LOCAL_MODEL"] = "qwen3-30b";
    // Note: INFOMANIAK_API_KEY ausente
    fetchMock.mockResolvedValueOnce(mockResponse());

    await getPersonaNextMessage(samplePersona(), "oi", []);

    expect(fetchMock).toHaveBeenCalledOnce();
    // Se o switch antigo (binário) estivesse ativo, callInfomaniakPersona
    // teria sido chamado e jogado com mensagem "INFOMANIAK_API_KEY não
    // setado..." antes do fetch acontecer. O fetch ter sido invocado
    // confirma que o switch novo (trifurcado) está ativo.
  });
});
