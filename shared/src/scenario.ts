/**
 * Scenario schema — sts#6 multi-session scenario runner.
 * Spec: ascendimacy-ops handoff #17 Bloco 7 prep.
 */

export const SCENARIO_EVENT_TYPES = [
  "parent_onboarding",
  "solo_session",
  "joint_session",
  "gardner_advance",
  "inject_status",
] as const;
export type ScenarioEventType = (typeof SCENARIO_EVENT_TYPES)[number];

export interface ScenarioEvent {
  day: number;
  type: ScenarioEventType;
  /** Used by parent_onboarding, solo_session, gardner_advance, inject_status. */
  persona?: string;
  /** Used by joint_session (pair of child personas). */
  personas?: string[];
  /** turns count for session events. Default 10. */
  turns?: number;
  // inject_status specifics
  dimension?: string;
  value?: "brejo" | "baia" | "pasto";
  // optional label pro trace
  label?: string;
}

export interface Scenario {
  name: string;
  start_date: string;
  end_date: string;
  personas: string[];
  parents: string[];
  mock_llm?: boolean;
  state_dir?: string;
  events: ScenarioEvent[];
}

export interface ScenarioValidationResult {
  valid: boolean;
  errors: string[];
  scenario?: Scenario;
}

/** Parser + validator puro; retorna {valid, errors, scenario}. */
export function parseScenario(raw: unknown): ScenarioValidationResult {
  const errors: string[] = [];
  if (!raw || typeof raw !== "object") {
    return { valid: false, errors: ["scenario must be an object"] };
  }
  const s = raw as Record<string, unknown>;

  if (typeof s["name"] !== "string" || (s["name"] as string).length === 0) {
    errors.push("missing or invalid 'name'");
  }
  if (typeof s["start_date"] !== "string" || isNaN(Date.parse(s["start_date"] as string))) {
    errors.push("missing or invalid 'start_date' (ISO)");
  }
  if (typeof s["end_date"] !== "string" || isNaN(Date.parse(s["end_date"] as string))) {
    errors.push("missing or invalid 'end_date' (ISO)");
  }
  if (!Array.isArray(s["personas"]) || (s["personas"] as unknown[]).length === 0) {
    errors.push("'personas' must be non-empty string array");
  }
  if (!Array.isArray(s["parents"])) {
    errors.push("'parents' must be string array (empty allowed)");
  }
  if (!Array.isArray(s["events"]) || (s["events"] as unknown[]).length === 0) {
    errors.push("'events' must be non-empty array");
  }

  if (errors.length > 0) return { valid: false, errors };

  const events: ScenarioEvent[] = [];
  const eventsRaw = s["events"] as unknown[];
  for (let i = 0; i < eventsRaw.length; i++) {
    const e = eventsRaw[i] as Record<string, unknown>;
    if (!e || typeof e !== "object") {
      errors.push(`event[${i}] must be an object`);
      continue;
    }
    if (typeof e["day"] !== "number" || e["day"] < 1) {
      errors.push(`event[${i}].day must be positive integer`);
      continue;
    }
    if (!SCENARIO_EVENT_TYPES.includes(e["type"] as ScenarioEventType)) {
      errors.push(`event[${i}].type must be one of ${SCENARIO_EVENT_TYPES.join("|")}`);
      continue;
    }
    const evt: ScenarioEvent = {
      day: e["day"] as number,
      type: e["type"] as ScenarioEventType,
      persona: typeof e["persona"] === "string" ? (e["persona"] as string) : undefined,
      personas: Array.isArray(e["personas"]) ? (e["personas"] as string[]) : undefined,
      turns: typeof e["turns"] === "number" ? (e["turns"] as number) : undefined,
      dimension: typeof e["dimension"] === "string" ? (e["dimension"] as string) : undefined,
      value: e["value"] as ScenarioEvent["value"],
      label: typeof e["label"] === "string" ? (e["label"] as string) : undefined,
    };
    // per-type validation
    if (evt.type === "joint_session" && (!evt.personas || evt.personas.length !== 2)) {
      errors.push(`event[${i}] joint_session requires 'personas' with exactly 2 ids`);
    }
    if (
      (evt.type === "parent_onboarding" ||
        evt.type === "solo_session" ||
        evt.type === "gardner_advance" ||
        evt.type === "inject_status") &&
      !evt.persona
    ) {
      errors.push(`event[${i}] ${evt.type} requires 'persona'`);
    }
    if (evt.type === "inject_status" && (!evt.dimension || !evt.value)) {
      errors.push(`event[${i}] inject_status requires 'dimension' and 'value'`);
    }
    events.push(evt);
  }

  if (errors.length > 0) return { valid: false, errors };

  const scenario: Scenario = {
    name: s["name"] as string,
    start_date: s["start_date"] as string,
    end_date: s["end_date"] as string,
    personas: s["personas"] as string[],
    parents: s["parents"] as string[],
    mock_llm: s["mock_llm"] !== false,
    state_dir: typeof s["state_dir"] === "string" ? (s["state_dir"] as string) : undefined,
    events,
  };
  return { valid: true, errors: [], scenario };
}

/** Day 1 = start_date; day N = start_date + (N-1) * 86400s. Retorna ISO. */
export function dayToIso(startDate: string, day: number): string {
  const base = new Date(startDate);
  const ms = base.getTime() + (day - 1) * 86_400_000;
  return new Date(ms).toISOString();
}
