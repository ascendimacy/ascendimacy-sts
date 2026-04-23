import { describe, it, expect } from "vitest";

// Unit tests for mock response logic — no env var dependency
const MOCK_RESPONSES: Record<string, string[]> = {
  "paula-mendes": [
    '{"message": "Estou passando por estagnação profissional.", "endConversation": false, "metadata": {"mood": "analytical"}}',
    '{"message": "Não acho que é burnout, é cansaço.", "endConversation": false, "metadata": {"mood": "defensive"}}',
    '{"message": "É curioso, coloquei carreira em primeiro lugar.", "endConversation": false, "metadata": {"mood": "reflective"}}',
    '{"message": "Obrigada pela conversa.", "endConversation": true, "metadata": {"mood": "closing"}}',
  ],
};

function getMockResponse(personaId: string, turnIndex: number) {
  const responses = MOCK_RESPONSES[personaId] ?? MOCK_RESPONSES["paula-mendes"]!;
  const raw = responses[turnIndex % responses.length]!;
  return JSON.parse(raw);
}

describe("mock response parsing", () => {
  it("parses endConversation as boolean", () => {
    const result = getMockResponse("paula-mendes", 0);
    expect(result.message).toBeTruthy();
    expect(typeof result.endConversation).toBe("boolean");
    expect(result.endConversation).toBe(false);
  });

  it("returns endConversation=true at last turn", () => {
    const result = getMockResponse("paula-mendes", 3);
    expect(result.endConversation).toBe(true);
  });

  it("loops responses correctly", () => {
    const r0 = getMockResponse("paula-mendes", 0);
    const r4 = getMockResponse("paula-mendes", 4);
    expect(r0.message).toBe(r4.message);
  });
});
