import { describe, it, expect } from "vitest";
import { loadPersonas, getPersona } from "../src/persona-loader.js";
import { getPersonaNextMessage } from "../src/llm-client.js";

process.env["USE_MOCK_LLM"] = "true";

describe("Yuji-virtual + Yuko-virtual personas (#17 Bloco 4)", () => {
  it("ambas carregam via loadPersonas()", () => {
    const personas = loadPersonas();
    const ids = personas.map((p) => p.id);
    expect(ids).toContain("yuji-ochiai");
    expect(ids).toContain("yuko-ochiai");
  });

  it("getPersona('yuji-ochiai') retorna persona válida", () => {
    const y = getPersona("yuji-ochiai");
    expect(y).toBeDefined();
    expect(y!.name).toBe("Yuji");
    expect(y!.age).toBe(42);
    expect(y!.profile).toMatch(/consultative_risk_averse/i);
  });

  it("getPersona('yuko-ochiai') retorna persona válida", () => {
    const y = getPersona("yuko-ochiai");
    expect(y).toBeDefined();
    expect(y!.name).toBe("Yuko");
    expect(y!.age).toBe(40);
    expect(y!.profile).toMatch(/decider_permissive/i);
  });
});

describe("Parent personas — mock LLM responses distinguem decision_profile", () => {
  const yuji = getPersona("yuji-ochiai")!;
  const yuko = getPersona("yuko-ochiai")!;

  it("Yuji resposta #0 menciona consulta ao cônjuge (consultative)", async () => {
    const r = await getPersonaNextMessage(yuji, "Olá, podemos conversar sobre o Ryo?", []);
    expect(r.message.toLowerCase()).toMatch(/yuko|consult|antes/i);
  });

  it("Yuko resposta #0 é mais direta/warm (decider_permissive)", async () => {
    const r = await getPersonaNextMessage(yuko, "Olá, podemos conversar sobre o Ryo?", []);
    expect(r.message.toLowerCase()).toMatch(/oi|obrigad/i);
  });

  it("Yuji metadata.role = parent_primary", async () => {
    const r = await getPersonaNextMessage(yuji, "x", []);
    expect((r.metadata as { role?: string } | undefined)?.role).toBe("parent_primary");
  });

  it("Yuko metadata.role = parent_secondary", async () => {
    const r = await getPersonaNextMessage(yuko, "x", []);
    expect((r.metadata as { role?: string } | undefined)?.role).toBe("parent_secondary");
  });
});

describe("Parent personas — turn progression no mock (~4 turns cobre onboarding)", () => {
  it("Yuji conversa termina na 4ª resposta (endConversation=true)", async () => {
    const yuji = getPersona("yuji-ochiai")!;
    const responses = [];
    const history: Array<{ role: "user" | "assistant"; content: string }> = [];
    for (let i = 0; i < 4; i++) {
      const r = await getPersonaNextMessage(yuji, `turn ${i}`, history);
      responses.push(r);
      history.push({ role: "assistant", content: `turn ${i}` });
      history.push({ role: "user", content: r.message });
    }
    expect(responses.at(-1)!.endConversation).toBe(true);
  });

  it("Yuko chega a ciclar pool de 4 mock responses", async () => {
    const yuko = getPersona("yuko-ochiai")!;
    const r1 = await getPersonaNextMessage(yuko, "a", []);
    const r2 = await getPersonaNextMessage(yuko, "b", [
      { role: "assistant", content: "a" },
      { role: "user", content: r1.message },
      { role: "assistant", content: "a2" },
      { role: "user", content: r1.message },
    ]);
    // Histórico de 4 entries (2 pares) deve pegar resposta #2 (index 2)
    expect(r2.message).not.toBe(r1.message);
  });
});
