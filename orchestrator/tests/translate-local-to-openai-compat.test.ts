/**
 * Boundary translation STS → motor children env.
 *
 * STS canonical: provider="local" + LOCAL_LLM_BASE_URL + LOCAL_LLM_MODEL
 * Motor canonical (D-3-PROV motor ops#1055): provider="openai-compat" +
 *   LLM_LOCAL_ENDPOINT + LLM_LOCAL_MODEL
 *
 * Cada repo mantém seu vocabulário; tradução acontece quando STS spawn
 * motor child via motor-client.ts buildEnv.
 */

import { describe, it, expect } from "vitest";
import { translateLocalToOpenaiCompat } from "../src/motor-client.js";

describe("translateLocalToOpenaiCompat", () => {
  it("LLM_PROVIDER=local → openai-compat", () => {
    const env = { LLM_PROVIDER: "local" };
    translateLocalToOpenaiCompat(env);
    expect(env["LLM_PROVIDER"]).toBe("openai-compat");
  });

  it("LLM_PROVIDER=anthropic → mantém", () => {
    const env = { LLM_PROVIDER: "anthropic" };
    translateLocalToOpenaiCompat(env);
    expect(env["LLM_PROVIDER"]).toBe("anthropic");
  });

  it("LLM_PROVIDER=infomaniak → mantém", () => {
    const env = { LLM_PROVIDER: "infomaniak" };
    translateLocalToOpenaiCompat(env);
    expect(env["LLM_PROVIDER"]).toBe("infomaniak");
  });

  it("LLM_PROVIDER ausente → no-op", () => {
    const env: Record<string, string> = {};
    translateLocalToOpenaiCompat(env);
    expect(env["LLM_PROVIDER"]).toBeUndefined();
  });

  it("per-step *_PROVIDER=local → openai-compat", () => {
    const env = {
      PLANEJADOR_PROVIDER: "local",
      DROTA_PROVIDER: "local",
      PERSONA_SIM_PROVIDER: "local",
      HAIKU_TRIAGE_PROVIDER: "local",
      HAIKU_BULLYING_PROVIDER: "local",
      MOOD_EXTRACTOR_PROVIDER: "local",
      UNIFIED_ASSESSOR_PROVIDER: "local",
      SIGNAL_EXTRACTOR_PROVIDER: "local",
    };
    translateLocalToOpenaiCompat(env);
    for (const k of Object.keys(env)) {
      expect(env[k]).toBe("openai-compat");
    }
  });

  it("per-step *_PROVIDER=anthropic → mantém", () => {
    const env = {
      PLANEJADOR_PROVIDER: "anthropic",
      DROTA_PROVIDER: "infomaniak",
    };
    translateLocalToOpenaiCompat(env);
    expect(env["PLANEJADOR_PROVIDER"]).toBe("anthropic");
    expect(env["DROTA_PROVIDER"]).toBe("infomaniak");
  });

  it("LOCAL_LLM_BASE_URL → LLM_LOCAL_ENDPOINT (anexa /chat/completions)", () => {
    const env = { LOCAL_LLM_BASE_URL: "http://172.28.160.1:9000/v1" };
    translateLocalToOpenaiCompat(env);
    expect(env["LLM_LOCAL_ENDPOINT"]).toBe(
      "http://172.28.160.1:9000/v1/chat/completions",
    );
  });

  it("LOCAL_LLM_BASE_URL com trailing slash → normaliza", () => {
    const env = { LOCAL_LLM_BASE_URL: "http://localhost:9000/v1/" };
    translateLocalToOpenaiCompat(env);
    expect(env["LLM_LOCAL_ENDPOINT"]).toBe(
      "http://localhost:9000/v1/chat/completions",
    );
  });

  it("LLM_LOCAL_ENDPOINT existente NÃO é sobrescrito", () => {
    const env = {
      LOCAL_LLM_BASE_URL: "http://172.28.160.1:9000/v1",
      LLM_LOCAL_ENDPOINT: "http://override:8080/v1/chat/completions",
    };
    translateLocalToOpenaiCompat(env);
    expect(env["LLM_LOCAL_ENDPOINT"]).toBe(
      "http://override:8080/v1/chat/completions",
    );
  });

  it("LOCAL_LLM_MODEL → LLM_LOCAL_MODEL", () => {
    const env = { LOCAL_LLM_MODEL: "qwen3-30b" };
    translateLocalToOpenaiCompat(env);
    expect(env["LLM_LOCAL_MODEL"]).toBe("qwen3-30b");
  });

  it("LLM_LOCAL_MODEL existente NÃO é sobrescrito", () => {
    const env = {
      LOCAL_LLM_MODEL: "qwen3-30b",
      LLM_LOCAL_MODEL: "override-model",
    };
    translateLocalToOpenaiCompat(env);
    expect(env["LLM_LOCAL_MODEL"]).toBe("override-model");
  });

  it("cenário completo realista: smoke STS com Qwen3-30B local", () => {
    const env: Record<string, string> = {
      LLM_PROVIDER: "local",
      PLANEJADOR_PROVIDER: "local",
      DROTA_PROVIDER: "local",
      LOCAL_LLM_BASE_URL: "http://172.28.160.1:9000/v1",
      LOCAL_LLM_MODEL: "qwen3-30b",
      LOCAL_LLM_API_KEY: "local",
      // outras envs não relacionadas a translation
      USE_SIMPLIFIED_PIPELINE: "true",
      ASC_LLM_TIMEOUT_SECONDS: "300",
    };
    translateLocalToOpenaiCompat(env);
    expect(env["LLM_PROVIDER"]).toBe("openai-compat");
    expect(env["PLANEJADOR_PROVIDER"]).toBe("openai-compat");
    expect(env["DROTA_PROVIDER"]).toBe("openai-compat");
    expect(env["LLM_LOCAL_ENDPOINT"]).toBe(
      "http://172.28.160.1:9000/v1/chat/completions",
    );
    expect(env["LLM_LOCAL_MODEL"]).toBe("qwen3-30b");
    // env STS originais ficam intactas (motor-side ignora as que não conhece)
    expect(env["LOCAL_LLM_BASE_URL"]).toBe("http://172.28.160.1:9000/v1");
    expect(env["LOCAL_LLM_MODEL"]).toBe("qwen3-30b");
    expect(env["USE_SIMPLIFIED_PIPELINE"]).toBe("true");
  });
});
