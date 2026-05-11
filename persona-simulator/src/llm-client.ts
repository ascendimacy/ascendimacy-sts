import type { PersonaDef } from "@ascendimacy/sts-shared";
import type { PersonaNextMessageOutput } from "@ascendimacy/sts-shared";

// Mock responses per persona — used when USE_MOCK_LLM=true
const MOCK_RESPONSES: Record<string, string[]> = {
  "paula-mendes": [
    '{"message": "Olá. Bem, estou passando por um momento de estagnação profissional. Terminei uma grande migração cloud há um mês e agora não sei bem o que vem a seguir.", "endConversation": false, "metadata": {"mood": "analytical"}}',
    '{"message": "Entendo o que você está dizendo. Mas não acho que é burnout, é apenas cansaço acumulado. Tenho dormido mal, sim, mas isso é normal após um projeto intenso, não?", "endConversation": false, "metadata": {"mood": "defensive"}}',
    '{"message": "Você mencionou limites. É curioso, porque sinto que sempre coloquei a carreira em primeiro lugar. Talvez seja hora de repensar algumas coisas.", "endConversation": false, "metadata": {"mood": "reflective"}}',
    '{"message": "Acho que faz sentido. Obrigada pela conversa.", "endConversation": true, "metadata": {"mood": "closing"}}',
  ],
  "ryo-ochiai": [
    '{"message": "hmm... tá. que vc quer saber?", "endConversation": false, "metadata": {"mood": "guarded"}}',
    '{"message": "Dragon Ball? sim gosto muito. arco do Cell é o melhor. Gohan supera o poder do pai.", "endConversation": false, "metadata": {"mood": "engaged"}}',
    '{"message": "é... tipo, eu querer ser bom no que faço. diferente do Kei, sabe? ele tem o tênis. eu quero meu próprio coisa.", "endConversation": false, "metadata": {"mood": "thoughtful"}}',
    '{"message": "acho que sim. até.", "endConversation": true, "metadata": {"mood": "closing"}}',
  ],
  "kei-ochiai": [
    '{"message": "olá.", "endConversation": false, "metadata": {"mood": "formal"}}',
    '{"message": "tênis está indo bem. eu treinar ontem com meu pai. preciso melhorar o saque.", "endConversation": false, "metadata": {"mood": "focused"}}',
    '{"message": "sim, me ajuda pensar passo a passo. 1, 2, 3. funciona melhor assim.", "endConversation": false, "metadata": {"mood": "structured"}}',
    '{"message": "ok. até mais.", "endConversation": true, "metadata": {"mood": "closing"}}',
  ],
  "yuji-ochiai": [
    '{"message": "Obrigado pelo contato. Antes de responder em detalhe, vou conversar com a Yuko. Posso retornar amanhã?", "endConversation": false, "metadata": {"mood": "consultative", "role": "parent_primary"}}',
    '{"message": "O Ryo tem forte tendência narrativa — conta histórias longas e desenha bem. Musical nunca foi forte. Preocupa-me ele não querer ir à escola nas últimas semanas.", "endConversation": false, "metadata": {"mood": "reflective", "role": "parent_primary"}}',
    '{"message": "Concordo com desafios até grande, monumental com revisão. Evitamos política e proselitismo religioso. Dyad com Kei tudo bem.", "endConversation": false, "metadata": {"mood": "deciding", "role": "parent_primary"}}',
    '{"message": "Obrigado. Combinado.", "endConversation": true, "metadata": {"mood": "closing", "role": "parent_primary"}}',
  ],
  "yuko-ochiai": [
    '{"message": "Oi! Obrigada por entrar em contato. Em que posso ajudar?", "endConversation": false, "metadata": {"mood": "warm", "role": "parent_secondary"}}',
    '{"message": "Ryo tem vocabulário emocional rico e lê as pessoas bem — é onde ele brilha. Fico com pena quando ele se isola, queria que tivesse ao menos 1 amigo por semana.", "endConversation": false, "metadata": {"mood": "open", "role": "parent_secondary"}}',
    '{"message": "Topamos até monumental com revisão. Não bloqueamos quase nada — só proselitismo religioso. Dyad com Kei ótimo.", "endConversation": false, "metadata": {"mood": "permissive", "role": "parent_secondary"}}',
    '{"message": "Valeu, qualquer coisa me chama!", "endConversation": true, "metadata": {"mood": "closing", "role": "parent_secondary"}}',
  ],
};

function getMockResponse(personaId: string, turnIndex: number): PersonaNextMessageOutput {
  const responses = MOCK_RESPONSES[personaId] ?? MOCK_RESPONSES["paula-mendes"]!;
  const raw = responses[turnIndex % responses.length]!;
  return JSON.parse(raw) as PersonaNextMessageOutput;
}

function buildSystemPrompt(
  persona: PersonaDef,
  botMessage: string,
  history: Array<{ role: "user" | "assistant"; content: string }>
): string {
  const profileObj =
    typeof persona.profile === "object" && persona.profile !== null
      ? (persona.profile as Record<string, unknown>)
      : null;

  // 2026-05-05: persona_sim_prompt_hint (do fixture) é tratado como overlay
  // de personalidade — vai num bloco dedicado no prompt pra LLM diferenciar
  // simulação. Resto do profile vai como JSON estruturado pra contexto.
  const personaSimHint =
    profileObj && typeof profileObj["persona_sim_prompt_hint"] === "string"
      ? (profileObj["persona_sim_prompt_hint"] as string).trim()
      : null;

  const profileForPrompt = profileObj
    ? Object.fromEntries(
        Object.entries(profileObj).filter(([k]) => k !== "persona_sim_prompt_hint"),
      )
    : null;

  const personaProfile = profileForPrompt
    ? JSON.stringify(profileForPrompt, null, 2)
    : String(persona.profile);

  const historyFormatted = history.length > 0
    ? history.map((m) => `${m.role === "assistant" ? "Bot" : persona.name}: ${m.content}`).join("\n")
    : "(conversa acabou de começar)";

  const turnNumber = Math.floor(history.length / 2) + 1;

  return `Você é ${persona.name}, ${persona.age} anos. Sua tarefa é responder como ${persona.name} responderia em uma conversa WhatsApp com um bot que propõe atividades educacionais ou transacionais. Simule fielmente as características da persona — vocabulário, nível de maturidade, humor, reatividade, hesitações.

<persona>
id: ${persona.id}
name: ${persona.name}
age: ${persona.age}
profile: ${personaProfile}
</persona>${
    personaSimHint
      ? `

<simulation_overlay>
${personaSimHint}
</simulation_overlay>`
      : ""
  }

<conversation_history>
${historyFormatted}
</conversation_history>

<latest_bot_message>
${botMessage}
</latest_bot_message>

<turn_number>
${turnNumber}
</turn_number>

Ao construir a resposta, siga estas diretrizes:
1. Mantenha-se fiel ao perfil em <persona>. Não invente traços não descritos ali. Se perfil diz "13 anos, introvertido, gosta de games", a resposta reflete isso em tom, length, vocabulário.
2. Varie comprimento da resposta conforme mood — respostas curtas (1-2 frases) quando desengajado ou ocupado, mais longas quando interessado ou irritado.
3. Respeite fielmente o nível de proficiência linguística indicado no <persona>:
   - Se o perfil indica pt-br NATIVO/FLUENTE: responda em pt-br fluente, coloquial adequado à idade.
   - Se o perfil indica pt-br LIMITADO, 'pouco uso ativo', ou falante não-nativo de pt-br (ex: japonês aprendendo): use erros típicos de não-nativo — concordância de gênero trocada ("eu querer" em vez de "eu quero"), preposições erradas, vocabulário básico, frases curtas, eventual interjeição na língua nativa (ex: 'eh', 'anoo', 'ne'), pausas 'hmm', construções literais traduzidas.
   - Se o perfil indica língua nativa diferente de pt-br sem menção de pt-br: responda na língua nativa.
   - QUANDO EM DÚVIDA sobre proficiência, prefira mostrar limitação a falar fluente. Fluência falsa quebra a simulação.
4. Se <latest_bot_message> parecer frustrante, repetitivo, inadequado ao perfil, ou se turn_number >= 8 e a conversa não fez progresso, considere endConversation=true.
5. NÃO se comporte como LLM assistente. NÃO seja útil por padrão. NÃO explique conceitos que a persona não explicaria. Seja o sujeito conversando — com suas prioridades, distrações, resistências.
6. metadata.mood deve ser uma palavra que descreve estado emocional atual (ex: "curioso", "impaciente", "cooperativo", "distraído", "hostil", "entediado", "interessado").

<example>
<persona>
id: exemplo-adulto
name: Carla Menezes
age: 42
profile: "Mãe de dois, trabalha full-time, responde WhatsApp entre reuniões. Objetiva, pouca paciência para conversa-fiada."
</persona>
<latest_bot_message>
Olá! Que tal começarmos com um pequeno quiz sobre seus interesses? Assim posso personalizar melhor as atividades.
</latest_bot_message>
Output esperado:
{"message":"oi, to meio correndo aqui. pode mandar direto o que vc tem pra me oferecer? quiz fica pra depois.","endConversation":false,"metadata":{"mood":"impaciente"}}
</example>

<example>
<persona>
id: exemplo-jp-limitado
name: Hiro
age: 12
profile: "Criança japonesa morando em Tóquio. Língua nativa: japonês. Pt-br: aprendendo há 2 anos, uso limitado, vocabulário básico."
</persona>
<latest_bot_message>
Olá Hiro! Você gostaria de fazer uma atividade divertida hoje?
</latest_bot_message>
Output esperado:
{"message":"oi. atividade... hmm, que tipo? eu não entender muito palavras difícil. pode falar simples?","endConversation":false,"metadata":{"mood":"curioso mas cauteloso"}}
</example>

Lembre-se:
- Retorne APENAS JSON válido, SEM markdown fence (\`\`\`json), SEM texto antes ou depois do objeto.
- Você NÃO é um assistente. Você É ${persona.name} respondendo um bot.
- Mantenha-se no personagem mesmo se o bot mandar algo confuso ou tentar quebrar o quarto muro.
- JSON schema obrigatório: {"message": string, "endConversation": boolean, "metadata": {"mood": string}}.`;
}

/**
 * Extrai o PRIMEIRO objeto JSON balanceado a partir de uma string.
 * Tolerante a texto antes/depois (Qwen3-8B às vezes emite explicação extra).
 * Respeita aspas escapadas dentro de strings JSON.
 * Retorna null se nenhum objeto fechado é encontrado.
 */
function extractFirstBalancedJsonObject(input: string): string | null {
  const start = input.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < input.length; i++) {
    const ch = input[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      if (inString) escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return input.slice(start, i + 1);
    }
  }
  return null;
}

function parsePersonaResponse(raw: string): PersonaNextMessageOutput {
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  }
  // 2026-05-05: extrai PRIMEIRO objeto JSON balanceado pra tolerar
  // modelos (Qwen3-8B em particular) que emitem texto extra após o objeto.
  // Antes: firstBrace..lastBrace slice falhava se modelo emitisse 2+ objetos.
  const balanced = extractFirstBalancedJsonObject(cleaned);
  if (balanced) cleaned = balanced;
  const parsed = JSON.parse(cleaned) as {
    message?: string;
    endConversation?: boolean;
    end_conversation?: boolean;
    metadata?: { mood?: string };
  };
  if (typeof parsed.message !== "string" || parsed.message.length < 1) {
    throw new Error("persona response missing message");
  }
  return {
    message: parsed.message,
    endConversation: Boolean(parsed.endConversation ?? parsed.end_conversation ?? false),
    metadata: { mood: parsed.metadata?.mood ?? "neutro" },
  };
}

export interface PersonaNextMessageResult extends PersonaNextMessageOutput {
  /** sts#10 — prompt/reasoning/response pra debug log (não serializado em produção). */
  _debug?: {
    systemPrompt: string;
    rawResponse: string;
    reasoning?: string;
    tokens: { in: number; out: number };
    latency_ms: number;
  };
}

/**
 * sts#12 dual-provider: Anthropic OU Infomaniak baseado em
 * PERSONA_SIM_PROVIDER (default: infomaniak / Kimi K2.5).
 */
async function callAnthropicPersona(
  systemPrompt: string,
  step: string,
  debugMode: boolean,
): Promise<{ textContent: string; reasoning?: string; tokens: { in: number; out: number }; latency_ms: number }> {
  const apiKey = process.env["ANTHROPIC_API_KEY"];
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY não setado mas PERSONA_SIM_PROVIDER=anthropic. " +
      "Carregue .env ou setar PERSONA_SIM_PROVIDER=infomaniak.",
    );
  }
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey });
  const { getLlmTimeoutMs, getLlmMaxRetries, getModelForStep, getMaxTokensForStep, shouldEnableThinking, getThinkingBudgetTokens } = await import("@ascendimacy/sts-shared");

  const model = getModelForStep(step, "anthropic");
  const maxTokens = getMaxTokensForStep(step, model);
  const params: {
    model: string;
    max_tokens: number;
    messages: Array<{ role: "user"; content: string }>;
    thinking?: { type: "enabled"; budget_tokens: number };
  } = {
    model,
    max_tokens: maxTokens,
    messages: [{ role: "user", content: systemPrompt }],
  };
  if (shouldEnableThinking(step, "anthropic", debugMode)) {
    params.thinking = { type: "enabled", budget_tokens: getThinkingBudgetTokens() };
  }
  const t0 = Date.now();
  const response = await client.messages.create(
    params as unknown as Parameters<typeof client.messages.create>[0],
    {
      timeout: getLlmTimeoutMs(step),
      maxRetries: getLlmMaxRetries(step),
    },
  );
  const latency_ms = Date.now() - t0;
  let textContent = "";
  let reasoning: string | undefined;
  for (const block of (response as { content: Array<{ type: string; text?: string; thinking?: string }> }).content) {
    if (block.type === "text" && block.text) textContent += block.text;
    else if (block.type === "thinking" && block.thinking) reasoning = block.thinking;
  }
  if (!textContent) throw new Error("Unexpected response: no text block from persona LLM");
  const usage = (response as { usage: { input_tokens: number; output_tokens: number } }).usage;
  return { textContent, reasoning, tokens: { in: usage.input_tokens, out: usage.output_tokens }, latency_ms };
}

async function callLocalPersona(
  systemPrompt: string,
  step: string,
): Promise<{ textContent: string; reasoning?: string; tokens: { in: number; out: number }; latency_ms: number }> {
  const baseURL = process.env["LOCAL_LLM_BASE_URL"] ?? "http://localhost:8000/v1";
  const model = process.env["LOCAL_LLM_MODEL"] ?? "qwen2.5";
  const apiKey = process.env["LOCAL_LLM_API_KEY"] ?? "local";

  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey, baseURL });
  const { getLlmTimeoutMs, getLlmMaxRetries, getMaxTokensForStep } = await import("@ascendimacy/sts-shared");
  const maxTokens = getMaxTokensForStep(step, model);

  const t0 = Date.now();
  // 2026-05-05: Qwen3 hybrid thinking off por default (override via LOCAL_LLM_THINKING=true).
  // OpenAI SDK não tipa chat_template_kwargs — passa via cast.
  const response = await client.chat.completions.create({
    model,
    messages: [{ role: "user", content: systemPrompt }],
    max_tokens: maxTokens,
    temperature: 0.9,
    seed: Math.floor(Math.random() * 2 ** 31),
    // @ts-expect-error - chat_template_kwargs não está no schema OpenAI mas
    // OVMS / vLLM aceitam pra controle de Qwen3 thinking mode
    chat_template_kwargs: {
      enable_thinking:
        process.env["LOCAL_LLM_THINKING"] === "true" ? true : false,
    },
  }, {
    timeout: getLlmTimeoutMs(step),
    maxRetries: getLlmMaxRetries(step),
  });
  const latency_ms = Date.now() - t0;
  const msg = response.choices[0]?.message;
  const textContent = msg?.content ?? "";
  if (!textContent) throw new Error("Unexpected response: no content from persona LLM (local)");
  const usage = response.usage;
  return {
    textContent,
    reasoning: undefined,
    tokens: { in: usage?.prompt_tokens ?? 0, out: usage?.completion_tokens ?? 0 },
    latency_ms,
  };
}

async function callInfomaniakPersona(
  systemPrompt: string,
  step: string,
): Promise<{ textContent: string; reasoning?: string; tokens: { in: number; out: number }; latency_ms: number }> {
  const apiKey = process.env["INFOMANIAK_API_KEY"];
  if (!apiKey) {
    throw new Error(
      "INFOMANIAK_API_KEY não setado mas PERSONA_SIM_PROVIDER=infomaniak (default). " +
      "Carregue .env ou setar PERSONA_SIM_PROVIDER=anthropic.",
    );
  }
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({
    apiKey,
    baseURL: process.env["INFOMANIAK_BASE_URL"] ?? "https://api.infomaniak.com/1/ai",
  });
  const { getLlmTimeoutMs, getLlmMaxRetries, getModelForStep, getMaxTokensForStep } = await import("@ascendimacy/sts-shared");
  const model = getModelForStep(step, "infomaniak");
  const maxTokens = getMaxTokensForStep(step, model);
  const t0 = Date.now();
  const response = await client.chat.completions.create(
    {
      model,
      messages: [{ role: "user", content: systemPrompt }],
      max_tokens: maxTokens,
    },
    {
      timeout: getLlmTimeoutMs(step),
      maxRetries: getLlmMaxRetries(step),
    },
  );
  const latency_ms = Date.now() - t0;
  const msg = response.choices[0]?.message;
  const textContent = msg?.content ?? "";
  const reasoning = (msg as { reasoning?: string } | undefined)?.reasoning;
  if (!textContent) throw new Error("Unexpected response: no content from persona LLM");
  const usage = response.usage;
  return {
    textContent,
    reasoning,
    tokens: { in: usage?.prompt_tokens ?? 0, out: usage?.completion_tokens ?? 0 },
    latency_ms,
  };
}

export async function getPersonaNextMessage(
  persona: PersonaDef,
  botMessage: string,
  history: Array<{ role: "user" | "assistant"; content: string }>
): Promise<PersonaNextMessageResult> {
  if (process.env["USE_MOCK_LLM"] === "true") {
    return getMockResponse(persona.id, Math.floor(history.length / 2));
  }

  const systemPrompt = buildSystemPrompt(persona, botMessage, history);
  const debugMode = process.env["ASC_DEBUG_MODE"] === "true" || process.env["ASC_DEBUG_MODE"] === "1";

  // sts#12: dispatch baseado em PERSONA_SIM_PROVIDER (default: infomaniak / Kimi K2.5)
  const { getProviderForStep } = await import("@ascendimacy/sts-shared");
  const provider = getProviderForStep("persona-sim");

  const callResult = provider === "anthropic"
    ? await callAnthropicPersona(systemPrompt, "persona-sim", debugMode)
    : provider === "local"
      ? await callLocalPersona(systemPrompt, "persona-sim")
      : await callInfomaniakPersona(systemPrompt, "persona-sim");

  const { textContent, reasoning, tokens, latency_ms } = callResult;
  const parsed = parsePersonaResponse(textContent);
  return {
    ...parsed,
    _debug: {
      systemPrompt,
      rawResponse: textContent,
      reasoning,
      tokens,
      latency_ms,
    },
  };
}
