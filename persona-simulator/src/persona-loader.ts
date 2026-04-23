import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import yaml from "js-yaml";
import type { PersonaDef } from "@ascendimacy/sts-shared";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface RawPersona {
  id?: string;
  pessoal_id?: string;
  name?: string;
  age?: number;
  profile?: string;
  prior?: { demographic_markers?: { name?: string; age?: number } };
  description?: string;
}

function extractPersonaDef(raw: RawPersona, filename: string): PersonaDef {
  const id = raw.id ?? raw.pessoal_id ?? filename.replace(/\.ya?ml$/, "");
  const name =
    raw.name ??
    raw.prior?.demographic_markers?.name ??
    id;
  const age =
    raw.age ??
    raw.prior?.demographic_markers?.age ??
    0;
  const profile =
    raw.profile ??
    (typeof raw.description === "string" ? raw.description.split("\n")[0]!.trim() : id);

  return { id, name, age, profile };
}

let _personas: PersonaDef[] | null = null;

export function loadPersonas(): PersonaDef[] {
  if (_personas) return _personas;

  const fixturesDir = join(__dirname, "../../fixtures/personas");
  const files = readdirSync(fixturesDir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));

  _personas = files.map((file) => {
    const content = readFileSync(join(fixturesDir, file), "utf-8");
    const raw = yaml.load(content) as RawPersona;
    return extractPersonaDef(raw, file);
  });

  return _personas;
}

export function getPersona(id: string): PersonaDef | undefined {
  return loadPersonas().find((p) => p.id === id);
}
