import { describe, it, expect } from "vitest";
import { loadPersonas, getPersona } from "../src/persona-loader.js";

describe("loadPersonas", () => {
  it("loads at least 5 personas (3 child + 2 parent após Bloco 4)", () => {
    const personas = loadPersonas();
    expect(personas.length).toBeGreaterThanOrEqual(5);
  });

  it("each persona has id, name, age, profile", () => {
    const personas = loadPersonas();
    for (const p of personas) {
      expect(p.id).toBeTruthy();
      expect(p.name).toBeTruthy();
      expect(typeof p.age).toBe("number");
      expect(p.profile).toBeTruthy();
    }
  });
});

describe("getPersona", () => {
  it("returns paula-mendes", () => {
    const p = getPersona("paula-mendes");
    expect(p).toBeDefined();
    expect(p!.name).toContain("Paula");
  });

  it("returns undefined for unknown persona", () => {
    expect(getPersona("unknown-xyz")).toBeUndefined();
  });
});
