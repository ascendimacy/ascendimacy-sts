/**
 * LLM router — config helpers pra escolher provider + model por callsite (motor#21).
 *
 * Spec: docs/specs/2026-04-24-debug-mode.md (extension).
 *
 * Não chama LLM aqui — apenas decide CONFIG. Cada workspace implementa
 * sua própria chamada com Anthropic SDK ou OpenAI SDK + Infomaniak baseURL,
 * baseado no que getProviderForStep retorna.
 *
 * Defaults: TUDO Kimi K2.5 via Infomaniak (zero dependência de Anthropic credit).
 * Override per-callsite via env <STEP>_PROVIDER + <STEP>_MODEL.
 *
 * Ex:
 *   PLANEJADOR_PROVIDER=anthropic
 *   PLANEJADOR_MODEL=claude-sonnet-4-6
 *   PERSONA_SIM_PROVIDER=infomaniak
 *   PERSONA_SIM_MODEL=mistral3
 */

export type LlmProvider = "anthropic" | "infomaniak" | "local" | "mock";

/** Steps válidos com config defaults. */
export const LLM_STEPS = [
  "planejador",
  "drota",
  "persona-sim",
  "haiku-triage",
  "haiku-bullying",
] as const;
export type LlmStep = (typeof LLM_STEPS)[number];

/**
 * Default provider por step.
 * 2026-05-07: TUDO local por default (Qwen3-30B-A3B via llama.cpp SYCL).
 * Override per-step via env <STEP>_PROVIDER ou global LLM_PROVIDER.
 * motor#21 (legado): era infomaniak por default; mudou pra local após
 * stack llama.cpp validada com qualidade adequada e custo zero.
 */
export const DEFAULT_PROVIDERS: Record<LlmStep, LlmProvider> = {
  planejador: "local",
  drota: "local",
  "persona-sim": "local",
  "haiku-triage": "local",
  "haiku-bullying": "local",
};

/**
 * Default model por step (provider-agnóstico).
 * Para provider=local, llama.cpp aceita qualquer alias (single-model server),
 * então o nome aqui é informativo. Para infomaniak, usar modelo real.
 */
export const DEFAULT_MODELS: Record<LlmStep, string> = {
  planejador: "qwen3-30b",
  drota: "qwen3-30b",
  "persona-sim": "qwen3-30b",
  "haiku-triage": "qwen3-30b",
  "haiku-bullying": "qwen3-30b",
};

/**
 * Infomaniak fallback (usado se provider=infomaniak e <STEP>_MODEL ausente).
 */
export const INFOMANIAK_FALLBACK_MODELS: Record<LlmStep, string> = {
  planejador: "moonshotai/Kimi-K2.5",
  drota: "moonshotai/Kimi-K2.5",
  "persona-sim": "moonshotai/Kimi-K2.5",
  "haiku-triage": "mistral3",
  "haiku-bullying": "mistral3",
};

/**
 * Anthropic-specific defaults (usado só se provider=anthropic).
 * Mapeamento: step → modelo Claude equivalente.
 */
export const ANTHROPIC_FALLBACK_MODELS: Record<LlmStep, string> = {
  planejador: "claude-sonnet-4-6",
  drota: "claude-sonnet-4-6",
  "persona-sim": "claude-sonnet-4-6",
  "haiku-triage": "claude-haiku-4-5-20251001",
  "haiku-bullying": "claude-haiku-4-5-20251001",
};

function envKey(step: string, suffix: string): string {
  return `${step.toUpperCase().replace(/-/g, "_")}_${suffix}`;
}

/**
 * Resolve provider pra um step.
 *
 * Ordem:
 * 1. Env <STEP>_PROVIDER (ex: PLANEJADOR_PROVIDER)
 * 2. Env LLM_PROVIDER (global override)
 * 3. DEFAULT_PROVIDERS[step]
 * 4. "infomaniak" (Kimi-first fallback)
 */
export function getProviderForStep(step: string): LlmProvider {
  const perStep = process.env[envKey(step, "PROVIDER")];
  if (perStep === "anthropic" || perStep === "infomaniak" || perStep === "local") return perStep;
  const global = process.env["LLM_PROVIDER"];
  if (global === "anthropic" || global === "infomaniak" || global === "local") return global;
  return DEFAULT_PROVIDERS[step as LlmStep] ?? "infomaniak";
}

/**
 * Resolve model pra um step. Provider-aware:
 * - Se provider=anthropic e env <STEP>_MODEL é Anthropic-style ou ausente → Claude default
 * - Se provider=infomaniak → Infomaniak model name
 *
 * Ordem:
 * 1. Env <STEP>_MODEL (ex: PLANEJADOR_MODEL=moonshotai/Kimi-K2.5)
 * 2. Default por step + provider
 */
export function getModelForStep(step: string, provider?: LlmProvider): string {
  const explicit = process.env[envKey(step, "MODEL")];
  if (explicit && explicit.length > 0) return explicit;
  // Legacy compat: aceita nomes antigos (PLANEJADOR_MODEL, MOTOR_DROTA_MODEL)
  // que existiam antes da padronização do router.
  const legacyKeys: Record<string, string> = {
    drota: "MOTOR_DROTA_MODEL",
    planejador: "PLANEJADOR_MODEL",
  };
  const legacy = legacyKeys[step];
  if (legacy && process.env[legacy]) return process.env[legacy]!;
  // Fallback aware do provider escolhido
  const p = provider ?? getProviderForStep(step);
  if (p === "anthropic") {
    return ANTHROPIC_FALLBACK_MODELS[step as LlmStep] ?? "claude-sonnet-4-6";
  }
  if (p === "infomaniak") {
    return INFOMANIAK_FALLBACK_MODELS[step as LlmStep] ?? "moonshotai/Kimi-K2.5";
  }
  // local (default) ou outros — modelo informativo (llama-server aceita qualquer alias)
  return DEFAULT_MODELS[step as LlmStep] ?? "qwen3-30b";
}

/**
 * Heurística: modelo é reasoning-capable?
 * Reasoning models drenam tokens em CoT antes de emitir content,
 * então max_tokens precisa ser maior.
 */
export function isReasoningModel(model: string): boolean {
  return /kimi|deepseek-r|o1|o3|reason|qwq|thinking/i.test(model);
}

/**
 * max_tokens default por step + reasoning awareness.
 * Override via env <STEP>_MAX_TOKENS.
 */
export function getMaxTokensForStep(step: string, model: string): number {
  const explicit = process.env[envKey(step, "MAX_TOKENS")];
  if (explicit) {
    const n = Number.parseInt(explicit, 10);
    if (!Number.isNaN(n) && n > 0) return n;
  }
  const reasoning = isReasoningModel(model);
  switch (step) {
    case "planejador":
      return reasoning ? 4096 : 2048;
    case "drota":
      return reasoning ? 4096 : 2048;
    case "persona-sim":
      return reasoning ? 4096 : 2048;
    case "haiku-triage":
      return reasoning ? 2048 : 512;
    case "haiku-bullying":
      return reasoning ? 2048 : 512;
    default:
      return reasoning ? 4096 : 2048;
  }
}

/**
 * Anthropic extended thinking habilitado pra esse step?
 *
 * Só relevante se provider=anthropic. Para Infomaniak, reasoning vem
 * automático em modelos reasoning (Kimi, DeepSeek-R1).
 *
 * Default: ON em planejador + persona-sim (debug útil), OFF em
 * haiku-* (rerank simples, thinking custa latência).
 */
export function shouldEnableThinking(step: string, provider: LlmProvider, debugMode: boolean): boolean {
  if (provider !== "anthropic") return false;
  if (!debugMode) return false;
  const noThinkSteps = new Set(["haiku-triage", "haiku-bullying"]);
  return !noThinkSteps.has(step);
}

export function getThinkingBudgetTokens(): number {
  const v = process.env["LLM_THINKING_BUDGET_TOKENS"];
  if (v) {
    const n = Number.parseInt(v, 10);
    if (!Number.isNaN(n) && n > 0) return n;
  }
  return 1024;
}
