import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { SessionTrace } from "@ascendimacy/sts-shared";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");

export function writeTrace(trace: SessionTrace): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = join(repoRoot, "traces");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${trace.personaId}-${ts}.json`);
  writeFileSync(path, JSON.stringify(trace, null, 2), "utf-8");
  return path;
}
