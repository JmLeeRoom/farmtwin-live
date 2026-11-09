import { GATE_TITLE, ROLE_LABEL } from "./constants";
import type { EventRow, GateKind, ParticipantRow, Role } from "./types";

export function timeHMS(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Asia/Seoul",
  });
}

export const fmtM = (v: unknown, digits = 3) => (typeof v === "number" && Number.isFinite(v) ? `${v.toFixed(digits)} m` : "—");

export function fmtValue(v: unknown): string {
  if (v === null || v === undefined) return "none";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(4)));
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "object") {
    const z = v as Record<string, unknown>;
    if ("x_min_m" in z) return `x ${z.x_min_m}–${z.x_max_m} m · y ${z.y_min_m}–${z.y_max_m} m`;
    return JSON.stringify(v);
  }
  return String(v);
}

export function whoOf(e: EventRow, byId: Map<string, ParticipantRow>): string {
  if (e.actor_kind === "human" && e.actor_id) {
    const p = byId.get(e.actor_id);
    if (p) return p.name === ROLE_LABEL[p.role] ? p.name : `${p.name}(${ROLE_LABEL[p.role]})`;
    const name = e.payload?.name ? String(e.payload.name) : "Participant";
    const role = e.payload?.role ? ROLE_LABEL[e.payload.role as Role] : null;
    return role && role !== name ? `${name}(${role})` : name;
  }
  if (e.actor_kind === "agent") {
    const a = e.actor_id ?? "agent";
    if (a.startsWith("drafter")) return `Design agent${a.includes(":") ? " · " + a.split(":")[1] : ""}`;
    if (a.startsWith("reviewer")) return `Review agent${a.includes(":") ? " · " + a.split(":")[1] : ""}`;
    if (a.startsWith("explainer")) return `Explainer agent${a.includes(":") ? " · " + a.split(":")[1] : ""}`;
    return a;
  }
  return "System";
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const gateName = (k: unknown) => GATE_TITLE[(k as GateKind) ?? "scenario"] ?? String(k);

/** One audit-log line */
export function describeEvent(e: EventRow): string {
  const p = e.payload ?? {};
  switch (e.type) {
    case "session_created":
      return "Created the session";
    case "seed_loaded":
      return `Loaded real trial records · ${String(p.batchId ?? "").slice(0, 24)} · sha256 ${String(p.sha256 ?? "").slice(0, 10)}`;
    case "joined":
      return "Joined the session";
    case "request":
      return `Request: ${String(p.text ?? "")}`;
    case "steer":
      return `Steer: ${String(p.text ?? "")}`;
    case "agent_started":
      return "Started drafting";
    case "agent_step":
      return p.no_change ? "Found nothing to change" : `Submitted a draft · ${plural(Array.isArray(p.changes) ? p.changes.length : 0, "change")}`;
    case "review_step": {
      const r = p.review as { verdict?: string; findings?: unknown[] } | undefined;
      return `Review ${r?.verdict ?? "?"} · ${plural(r?.findings?.length ?? 0, "finding")}`;
    }
    case "review_failed":
      return "Review agent did not respond → continuing with human review";
    case "agent_failed":
      return "Agent did not respond";
    case "provider_switch":
      return `Provider switch: ${String(p.from)} → ${String(p.to)}`;
    case "gate_opened":
      return `${gateName(p.kind)} opened · ${p.required_role ? `waiting for ${ROLE_LABEL[p.required_role as Role]}` : "awaiting approval"}`;
    case "gate_decided":
      return `${gateName(p.kind)}: ${p.decision === "approved" ? "approved" : "rejected"}${p.override ? " (proxy / findings acknowledged)" : ""}${p.comment ? ` · “${String(p.comment)}”` : ""}`;
    case "gate_superseded":
      return "Replaced the previous gate ① with the new draft";
    case "draft_discarded":
      return `Draft discarded · ${String(p.reason ?? "")}`;
    case "run_requested":
      return p.runner_online ? "Requested a run from the local runner" : "Runner offline → reviewing recorded trials";
    case "run_done":
      return "Local runner finished";
    case "run_failed":
      return "Local runner failed";
    case "explain_ready":
      return `Result explanations ready · ${plural(Array.isArray(p.run_ids) ? p.run_ids.length : 0, "run")}`;
    case "handoff":
      return `Ownership handed to ${String(p.to_name ?? "")}`;
    case "bundle_exported":
      return `Exported Evidence Bundle · sha256 ${String(p.sha256 ?? "").slice(0, 10)}`;
    default:
      return e.type;
  }
}
