import { describe, it, expect } from "vitest";

// Tests for persona-simulator language proficiency behavior.
// Real LLM validation is covered by STS H7 re-run (v0.2 traces).
// These tests verify mock outputs reflect limited-pt-br characteristics.

const MOCK_RYO = [
  '{"message": "hmm... tá. que vc quer saber?", "endConversation": false, "metadata": {"mood": "guarded"}}',
  '{"message": "Dragon Ball? sim gosto muito. arco do Cell é o melhor. Gohan supera o poder do pai.", "endConversation": false, "metadata": {"mood": "engaged"}}',
  '{"message": "é... tipo, eu querer ser bom no que faço. diferente do Kei, sabe? ele tem o tênis. eu quero meu próprio coisa.", "endConversation": false, "metadata": {"mood": "thoughtful"}}',
  '{"message": "acho que sim. até.", "endConversation": true, "metadata": {"mood": "closing"}}',
];

const MOCK_KEI = [
  '{"message": "olá.", "endConversation": false, "metadata": {"mood": "formal"}}',
  '{"message": "tênis está indo bem. eu treinar ontem com meu pai. preciso melhorar o saque.", "endConversation": false, "metadata": {"mood": "focused"}}',
  '{"message": "sim, me ajuda pensar passo a passo. 1, 2, 3. funciona melhor assim.", "endConversation": false, "metadata": {"mood": "structured"}}',
  '{"message": "ok. até mais.", "endConversation": true, "metadata": {"mood": "closing"}}',
];

describe("mock pt-br limitado — Ryo persona", () => {
  it("returns valid JSON with endConversation boolean", () => {
    for (const raw of MOCK_RYO) {
      const parsed = JSON.parse(raw) as { message: string; endConversation: boolean; metadata: { mood: string } };
      expect(typeof parsed.message).toBe("string");
      expect(typeof parsed.endConversation).toBe("boolean");
      expect(typeof parsed.metadata.mood).toBe("string");
    }
  });

  it("ryo mock contains limited-proficiency signals in early turns", () => {
    // 'eu querer' (verb concordance error) is a pt-br limitado signal
    const turn3 = JSON.parse(MOCK_RYO[2]!) as { message: string };
    expect(turn3.message).toContain("eu querer");
  });

  it("ryo last mock turn has endConversation=true", () => {
    const last = JSON.parse(MOCK_RYO[MOCK_RYO.length - 1]!) as { endConversation: boolean };
    expect(last.endConversation).toBe(true);
  });

  it("cycles through mock responses by turn index", () => {
    for (let i = 0; i < MOCK_RYO.length * 2; i++) {
      const raw = MOCK_RYO[i % MOCK_RYO.length]!;
      const parsed = JSON.parse(raw);
      expect(parsed.message.length).toBeGreaterThan(0);
    }
  });
});

describe("mock pt-br limitado — Kei persona", () => {
  it("returns valid JSON with endConversation boolean", () => {
    for (const raw of MOCK_KEI) {
      const parsed = JSON.parse(raw) as { message: string; endConversation: boolean; metadata: { mood: string } };
      expect(typeof parsed.message).toBe("string");
      expect(typeof parsed.endConversation).toBe("boolean");
    }
  });

  it("kei mock contains verb conjugation error in turn 2", () => {
    // 'eu treinar' instead of 'eu treinei' — limited proficiency signal
    const turn2 = JSON.parse(MOCK_KEI[1]!) as { message: string };
    expect(turn2.message).toContain("eu treinar");
  });
});

describe("persona response parser — defensive JSON extraction", () => {
  it("strips markdown fence from response", () => {
    function parsePersonaResponse(raw: string) {
      let cleaned = raw.trim();
      if (cleaned.startsWith("```")) {
        cleaned = cleaned.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
      }
      const firstBrace = cleaned.indexOf("{");
      const lastBrace = cleaned.lastIndexOf("}");
      if (firstBrace >= 0 && lastBrace > firstBrace) {
        cleaned = cleaned.slice(firstBrace, lastBrace + 1);
      }
      return JSON.parse(cleaned) as { message: string; endConversation: boolean };
    }

    const fenced = '```json\n{"message":"oi","endConversation":false,"metadata":{"mood":"neutro"}}\n```';
    const result = parsePersonaResponse(fenced);
    expect(result.message).toBe("oi");
    expect(result.endConversation).toBe(false);
  });

  it("extracts JSON from text with preamble", () => {
    function parsePersonaResponse(raw: string) {
      let cleaned = raw.trim();
      const firstBrace = cleaned.indexOf("{");
      const lastBrace = cleaned.lastIndexOf("}");
      if (firstBrace >= 0 && lastBrace > firstBrace) {
        cleaned = cleaned.slice(firstBrace, lastBrace + 1);
      }
      return JSON.parse(cleaned) as { message: string };
    }

    const withPreamble = 'Here is the response:\n{"message":"olá","endConversation":false,"metadata":{"mood":"formal"}}';
    const result = parsePersonaResponse(withPreamble);
    expect(result.message).toBe("olá");
  });
});
