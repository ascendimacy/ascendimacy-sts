/**
 * Tests do llm-config em sts-shared (sts#11) — robustness primitives.
 * Same contract do motor/shared/tests/llm-config.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getLlmTimeoutMs,
  getLlmMaxRetries,
  classifyLlmError,
  LLM_TIMEOUT_DEFAULTS,
} from "../src/llm-config.js";

const ORIG_ENV = { ...process.env };

beforeEach(() => {
  for (const k of Object.keys(process.env)) {
    if (k.startsWith("ASC_LLM_")) delete process.env[k];
  }
});

afterEach(() => {
  for (const k of Object.keys(process.env)) {
    if (k.startsWith("ASC_LLM_")) delete process.env[k];
  }
  for (const [k, v] of Object.entries(ORIG_ENV)) {
    if (k.startsWith("ASC_LLM_")) process.env[k] = v;
  }
});

describe("getLlmTimeoutMs (sts side)", () => {
  it("default persona-sim 30s", () => {
    expect(getLlmTimeoutMs("persona-sim")).toBe(LLM_TIMEOUT_DEFAULTS["persona-sim"]);
    expect(LLM_TIMEOUT_DEFAULTS["persona-sim"]).toBe(30_000);
  });

  it("override per-step", () => {
    process.env["ASC_LLM_TIMEOUT_PERSONA_SIM"] = "60";
    expect(getLlmTimeoutMs("persona-sim")).toBe(60_000);
  });

  it("global ASC_LLM_TIMEOUT_SECONDS aplica", () => {
    process.env["ASC_LLM_TIMEOUT_SECONDS"] = "45";
    expect(getLlmTimeoutMs("persona-sim")).toBe(45_000);
  });
});

describe("getLlmMaxRetries (sts side)", () => {
  it("persona-sim default 3", () => {
    expect(getLlmMaxRetries("persona-sim")).toBe(3);
  });

  it("override aplica", () => {
    process.env["ASC_LLM_MAX_RETRIES_PERSONA_SIM"] = "1";
    expect(getLlmMaxRetries("persona-sim")).toBe(1);
  });
});

describe("classifyLlmError (sts side)", () => {
  it("AuthError fail-fast", () => {
    expect(classifyLlmError({ status: 401 }).retriable).toBe(false);
  });
  it("RateLimit retriable", () => {
    expect(classifyLlmError({ status: 429 }).retriable).toBe(true);
  });
  it("LengthFinish fail-fast", () => {
    const e = { message: "Could not parse response content as the length limit was reached" };
    expect(classifyLlmError(e).retriable).toBe(false);
  });
});
