import type { PersonaDef } from "@ascendimacy/sts-shared";
import type { PersonaNextMessageOutput } from "@ascendimacy/sts-shared";

const MOCK_RESPONSES: Record<string, string[]> = {
  "paula-mendes": [
    '{"message": "Olá. Bem, estou passando por um momento de estagnação profissional. Terminei uma grande migração cloud há um mês e agora não sei bem o que vem a seguir.", "endConversation": false, "metadata": {"mood": "analytical"}}',
    '{"message": "Entendo o que você está dizendo. Mas não acho que é burnout, é apenas cansaço acumulado. Tenho dormido mal, sim, mas isso é normal após um projeto intenso, não?", "endConversation": false, "metadata": {"mood": "defensive"}}',
    '{"message": "Você mencionou limites. É curioso, porque sinto que sempre coloquei a carreira em primeiro lugar. Talvez seja hora de repensar algumas coisas.", "endConversation": false, "metadata": {"mood": "reflective"}}',
    '{"message": "Acho que faz sentido. Obrigada pela conversa.", "endConversation": true, "metadata": {"mood": "closing"}}',
  ],
  "ryo-ochiai": [
    '{"message": "Hmm... tá. O que você quer saber?", "endConversation": false, "metadata": {"mood": "guarded"}}',
    '{"message": "Dragon Ball? Sim, gosto muito. O arco do Cell é o melhor. O Gohan supera o poder do pai.", "endConversation": false, "metadata": {"mood": "engaged"}}',
    '{"message": "É... tipo, quero ser bom no que faço. Diferente do Kei, sabe? Ele tem o tênis. Eu quero meu próprio negócio.", "endConversation": false, "metadata": {"mood": "thoughtful"}}',
    '{"message": "Acho que sim. Até.", "endConversation": true, "metadata": {"mood": "closing"}}',
  ],
  "kei-ochiai": [
    '{"message": "Olá.", "endConversation": false, "metadata": {"mood": "formal"}}',
    '{"message": "Tênis está indo bem. Treinei ontem com meu pai. Preciso melhorar o saque.", "endConversation": false, "metadata": {"mood": "focused"}}',
    '{"message": "Sim, me ajuda pensar passo a passo. 1, 2, 3. Funciona melhor assim.", "endConversation": false, "metadata": {"mood": "structured"}}',
    '{"message": "Ok. Até mais.", "endConversation": true, "metadata": {"mood": "closing"}}',
  ],
};

function getMockResponse(personaId: string, turnIndex: number): PersonaNextMessageOutput {
  const responses = MOCK_RESPONSES[personaId] ?? MOCK_RESPONSES["paula-mendes"]!;
  const raw = responses[turnIndex % responses.length]!;
  return JSON.parse(raw) as PersonaNextMessageOutput;
}

export async function getPersonaNextMessage(
  persona: PersonaDef,
  botMessage: string,
  history: Array<{ role: "user" | "assistant"; content: string }>
): Promise<PersonaNextMessageOutput> {
  if (process.env["USE_MOCK_LLM"] === "true") {
    return getMockResponse(persona.id, Math.floor(history.length / 2));
  }

  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: process.env["ANTHROPIC_API_KEY"] });

  const profileSummary = persona.profile.slice(0, 300);
  const historyFormatted = history
    .map((m) => `${m.role === "assistant" ? "Bot" : persona.name}: ${m.content}`)
    .join("\n");

  const systemPrompt = `Você é ${persona.name}, ${persona.age} anos. Perfil: ${profileSummary}.
Contexto: você está conversando com um bot que te propõe atividades.
Histórico: ${historyFormatted || "(início da conversa)"}
Última mensagem do bot: "${botMessage}"
Responda de forma natural, em pt-br, como ${persona.name} responderia.
Retorne JSON: {"message": "...", "endConversation": false, "metadata": {"mood": "..."}}.
Máximo 150 palavras na mensagem. Sem markdown fence.`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 400,
    messages: [{ role: "user", content: systemPrompt }],
  });

  const text = (response.content[0] as { type: string; text: string }).text.trim();
  const cleaned = text.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();

  return JSON.parse(cleaned) as PersonaNextMessageOutput;
}
