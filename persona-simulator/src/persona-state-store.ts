/**
 * Persona State Store — persistência cross-session da memória da persona.
 *
 * Spec: ascendimacy-ops/docs/specs/2026-05-25-session-phases-journey-stages-strategist.md §1.2
 *
 * Cada persona tem um arquivo JSON em `.sts/persona-states/<personaId>.json`
 * que sobrevive entre sessões. Carregado no início da sessão (injetado no
 * system prompt) e atualizado no fim (tool persona_finalize_session).
 *
 * Sem isso, persona "esquece" tudo a cada sessão nova — impossível simular
 * jornada (discovery_only → mapping_ready → applied_double_helix).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { PersonaState } from "./types.js";

/** Diretório raiz dos state files. Override via env STS_PERSONA_STATE_DIR. */
export function getStateDir(): string {
  return process.env["STS_PERSONA_STATE_DIR"] ?? join(process.cwd(), ".sts", "persona-states");
}

function statePath(personaId: string): string {
  return join(getStateDir(), `${personaId}.json`);
}

/**
 * Carrega state persistido de disk. Retorna state limpo (history vazio +
 * sem summary) se arquivo não existe — comportamento backcompat.
 */
export function loadPersonaState(personaId: string): PersonaState {
  const path = statePath(personaId);
  if (!existsSync(path)) {
    return { history: [] };
  }
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as PersonaState;
    // Garante que history vem reset (cross-session memória != current turn history)
    return {
      ...parsed,
      history: [],
    };
  } catch {
    return { history: [] };
  }
}

/**
 * Persiste state. Cria dir se não existir. Escreve atomicamente.
 *
 * NOTE: history é deliberadamente excluído do save — é estado de sessão
 * em curso, não memória cross-session. O LLM summarize gera summary_so_far
 * que substitui history como memória persistida.
 */
export function savePersonaState(personaId: string, state: PersonaState): void {
  const path = statePath(personaId);
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const toSave: PersonaState = {
    history: [], // nunca persiste history
    summary_so_far: state.summary_so_far,
    sessions_count: state.sessions_count,
    last_session_ended_at: state.last_session_ended_at,
    last_session_trust_final: state.last_session_trust_final,
  };
  writeFileSync(path, JSON.stringify(toSave, null, 2) + "\n", "utf8");
}

/**
 * Reset state completo — remove summary, sessions count, etc.
 * Diferente do persona_reset clássico que só limpa history in-memory.
 */
export function clearPersonaState(personaId: string): void {
  const path = statePath(personaId);
  if (existsSync(path)) {
    writeFileSync(path, JSON.stringify({ history: [] }, null, 2) + "\n", "utf8");
  }
}
