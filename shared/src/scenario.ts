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

export const SUBITEM_ROLES = [
  "external_evaluator",
  "parent_monitor",
] as const;
export type SubitemRole = (typeof SUBITEM_ROLES)[number];

export const SUBITEM_VISIBILITIES = [
  "hidden_from_subject",
  "visible_to_parent_only",
  "visible_to_evaluator_only",
] as const;
export type SubitemVisibility = (typeof SUBITEM_VISIBILITIES)[number];

export const SUBITEM_SEVERITIES = ["blocker", "advisory"] as const;
export type SubitemSeverity = (typeof SUBITEM_SEVERITIES)[number];

export const SUBITEM_TRIGGER_TYPES = ["outcome"] as const;
export type SubitemTriggerType = (typeof SUBITEM_TRIGGER_TYPES)[number];

export const SUBITEM_TRIGGER_WHENS = [
  "subject_answer_partial_or_wrong",
  "subject_answer_correct",
  "turn_with_tutorial_contract",
  "session_end",
  "deflection_detected",
] as const;
export type SubitemTriggerWhen = (typeof SUBITEM_TRIGGER_WHENS)[number];

export const SUBITEM_WINDOW_POSITIONS = [
  "same_turn",
  "next_turn",
  "next_two_turns",
  "session_end",
] as const;
export type SubitemWindowPosition = (typeof SUBITEM_WINDOW_POSITIONS)[number];

export const SUBITEM_EVIDENCE_TYPES = [
  "transcript",
  "engine_trace",
  "context_hints",
  "event_log",
  "session_summary",
] as const;
export type SubitemEvidenceType = (typeof SUBITEM_EVIDENCE_TYPES)[number];

export interface ScenarioSubitem {
  id: string;
  title: string;
  role: SubitemRole;
  visibility: SubitemVisibility;
  severity: SubitemSeverity;
  applies_to?: {
    personas?: string[];
    labels?: string[];
  };
  trigger: {
    type: SubitemTriggerType;
    when: SubitemTriggerWhen;
  };
  window: {
    start: SubitemWindowPosition;
    end: SubitemWindowPosition;
  };
  evidence: SubitemEvidenceType[];
  pass_if: string[];
  fail_if?: string[];
}

export interface ScenarioRubricV2 {
  enabled: boolean;
  evaluator_mode: "external";
  subject_mode: "blind";
  parent_mode?: "optional";
  subitems: ScenarioSubitem[];
}

export interface Scenario {
  name: string;
  start_date: string;
  end_date: string;
  personas: string[];
  parents: string[];
  mock_llm?: boolean;
  state_dir?: string;
  rubric_v2?: ScenarioRubricV2;
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

  let rubricV2: ScenarioRubricV2 | undefined;
  const rubricRaw = s["rubric_v2"];
  if (rubricRaw !== undefined) {
    if (!rubricRaw || typeof rubricRaw !== "object") {
      errors.push("'rubric_v2' must be an object when present");
    } else {
      const r = rubricRaw as Record<string, unknown>;
      const enabled = r["enabled"] === true;
      const evaluator_mode = r["evaluator_mode"];
      const subject_mode = r["subject_mode"];
      const parent_mode = r["parent_mode"];
      const subitemsRaw = r["subitems"];

      if (enabled && evaluator_mode !== "external") {
        errors.push("'rubric_v2.evaluator_mode' must be 'external'");
      }
      if (enabled && subject_mode !== "blind") {
        errors.push("'rubric_v2.subject_mode' must be 'blind'");
      }
      if (
        parent_mode !== undefined &&
        parent_mode !== "optional"
      ) {
        errors.push("'rubric_v2.parent_mode' must be 'optional' when present");
      }
      if (!Array.isArray(subitemsRaw)) {
        errors.push("'rubric_v2.subitems' must be an array");
      } else {
        const subitems: ScenarioSubitem[] = [];
        for (let i = 0; i < subitemsRaw.length; i++) {
          const item = subitemsRaw[i] as Record<string, unknown>;
          if (!item || typeof item !== "object") {
            errors.push(`rubric_v2.subitems[${i}] must be an object`);
            continue;
          }

          const id = item["id"];
          const title = item["title"];
          const role = item["role"];
          const visibility = item["visibility"];
          const severity = item["severity"];
          const trigger = item["trigger"] as Record<string, unknown> | undefined;
          const window = item["window"] as Record<string, unknown> | undefined;
          const evidence = item["evidence"];
          const pass_if = item["pass_if"];
          const fail_if = item["fail_if"];
          const appliesTo = item["applies_to"] as Record<string, unknown> | undefined;

          if (typeof id !== "string" || id.length === 0) {
            errors.push(`rubric_v2.subitems[${i}].id must be non-empty string`);
          }
          if (typeof title !== "string" || title.length === 0) {
            errors.push(`rubric_v2.subitems[${i}].title must be non-empty string`);
          }
          if (!SUBITEM_ROLES.includes(role as SubitemRole)) {
            errors.push(`rubric_v2.subitems[${i}].role invalid`);
          }
          if (!SUBITEM_VISIBILITIES.includes(visibility as SubitemVisibility)) {
            errors.push(`rubric_v2.subitems[${i}].visibility invalid`);
          }
          if (!SUBITEM_SEVERITIES.includes(severity as SubitemSeverity)) {
            errors.push(`rubric_v2.subitems[${i}].severity invalid`);
          }
          if (!trigger || trigger["type"] !== "outcome" || !SUBITEM_TRIGGER_WHENS.includes(trigger["when"] as SubitemTriggerWhen)) {
            errors.push(`rubric_v2.subitems[${i}].trigger invalid`);
          }
          if (
            !window ||
            !SUBITEM_WINDOW_POSITIONS.includes(window["start"] as SubitemWindowPosition) ||
            !SUBITEM_WINDOW_POSITIONS.includes(window["end"] as SubitemWindowPosition)
          ) {
            errors.push(`rubric_v2.subitems[${i}].window invalid`);
          }
          if (!Array.isArray(evidence) || evidence.length === 0 || evidence.some((e) => !SUBITEM_EVIDENCE_TYPES.includes(e as SubitemEvidenceType))) {
            errors.push(`rubric_v2.subitems[${i}].evidence invalid`);
          }
          if (!Array.isArray(pass_if) || pass_if.length === 0 || pass_if.some((x) => typeof x !== "string")) {
            errors.push(`rubric_v2.subitems[${i}].pass_if must be non-empty string array`);
          }
          if (fail_if !== undefined && (!Array.isArray(fail_if) || fail_if.some((x) => typeof x !== "string"))) {
            errors.push(`rubric_v2.subitems[${i}].fail_if must be string array when present`);
          }

          const applies_to = appliesTo
            ? {
                personas: Array.isArray(appliesTo["personas"]) ? (appliesTo["personas"] as string[]) : undefined,
                labels: Array.isArray(appliesTo["labels"]) ? (appliesTo["labels"] as string[]) : undefined,
              }
            : undefined;

          subitems.push({
            id: String(id ?? ""),
            title: String(title ?? ""),
            role: role as SubitemRole,
            visibility: visibility as SubitemVisibility,
            severity: severity as SubitemSeverity,
            ...(applies_to ? { applies_to } : {}),
            trigger: {
              type: "outcome",
              when: (trigger?.["when"] ?? "turn_with_tutorial_contract") as SubitemTriggerWhen,
            },
            window: {
              start: (window?.["start"] ?? "same_turn") as SubitemWindowPosition,
              end: (window?.["end"] ?? "same_turn") as SubitemWindowPosition,
            },
            evidence: evidence as SubitemEvidenceType[],
            pass_if: pass_if as string[],
            ...(Array.isArray(fail_if) ? { fail_if: fail_if as string[] } : {}),
          });
        }

        rubricV2 = {
          enabled,
          evaluator_mode: "external",
          subject_mode: "blind",
          ...(parent_mode === "optional" ? { parent_mode: "optional" as const } : {}),
          subitems,
        };
      }
    }
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
    ...(rubricV2 ? { rubric_v2: rubricV2 } : {}),
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
