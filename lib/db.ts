import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentStepRow, EventRow, GateKind, GatePayload, GateRow, ParticipantRow, Role, SessionRow } from "./types";

export type NewEvent = Pick<EventRow, "type" | "actor_kind"> & { actor_id?: string | null; payload?: Record<string, unknown> };
export type NewAgentStep = Omit<AgentStepRow, "id" | "session_id" | "created_at">;
export type NewGate = { kind: GateKind; required_role: Role; payload: GatePayload };

export class UniqueViolation extends Error {}

/** 서버 오케스트레이션(draft·explain)이 쓰는 DB 연산. 테스트에서는 메모리 구현으로 바꾼다. */
export interface AgentDb {
  acquireLock(sessionId: string): Promise<boolean>;
  releaseLock(sessionId: string): Promise<void>;
  getSession(sessionId: string): Promise<SessionRow | null>;
  countAgentSteps(sessionId: string): Promise<number>;
  listInputEvents(sessionId: string, afterId: number): Promise<EventRow[]>;
  listRecentSteers(sessionId: string, limit: number): Promise<EventRow[]>;
  latestRequest(sessionId: string): Promise<EventRow | null>;
  listParticipants(sessionId: string): Promise<ParticipantRow[]>;
  insertEvent(sessionId: string, e: NewEvent): Promise<EventRow>;
  insertAgentStep(sessionId: string, s: NewAgentStep): Promise<AgentStepRow>;
  updateSession(sessionId: string, patch: Partial<SessionRow>): Promise<void>;
  supersedePendingScenarioGates(sessionId: string): Promise<GateRow[]>;
  insertGate(sessionId: string, g: NewGate): Promise<GateRow>;
}

const LOCK_STALE_MS = 60_000;

function check<T>(r: { data: T | null; error: { message: string; code?: string } | null }, what: string): T {
  if (r.error) {
    if (r.error.code === "23505") throw new UniqueViolation(`${what}: ${r.error.message}`);
    throw new Error(`${what}: ${r.error.message}`);
  }
  return r.data as T;
}

export function supabaseAgentDb(sb: SupabaseClient): AgentDb {
  return {
    async acquireLock(id) {
      const now = new Date().toISOString();
      const free = await sb
        .from("sessions")
        .update({ agent_busy: true, agent_busy_since: now })
        .eq("id", id)
        .eq("agent_busy", false)
        .select("id");
      if (check(free, "lock").length > 0) return true;
      const stale = new Date(Date.now() - LOCK_STALE_MS).toISOString();
      const takeover = await sb
        .from("sessions")
        .update({ agent_busy: true, agent_busy_since: now })
        .eq("id", id)
        .eq("agent_busy", true)
        .lt("agent_busy_since", stale)
        .select("id");
      return check(takeover, "lock takeover").length > 0;
    },
    async releaseLock(id) {
      await sb.from("sessions").update({ agent_busy: false }).eq("id", id);
    },
    async getSession(id) {
      return check(await sb.from("sessions").select("*").eq("id", id).maybeSingle(), "session") as SessionRow | null;
    },
    async countAgentSteps(id) {
      const r = await sb.from("agent_steps").select("id", { count: "exact", head: true }).eq("session_id", id);
      if (r.error) throw new Error(`count: ${r.error.message}`);
      return r.count ?? 0;
    },
    async listInputEvents(id, afterId) {
      return check(
        await sb.from("events").select("*").eq("session_id", id).in("type", ["request", "steer"]).gt("id", afterId).order("id"),
        "inputs",
      ) as EventRow[];
    },
    async listRecentSteers(id, limit) {
      const rows = check(
        await sb.from("events").select("*").eq("session_id", id).eq("type", "steer").order("id", { ascending: false }).limit(limit),
        "steers",
      ) as EventRow[];
      return rows.reverse();
    },
    async latestRequest(id) {
      return check(
        await sb.from("events").select("*").eq("session_id", id).eq("type", "request").order("id", { ascending: false }).limit(1).maybeSingle(),
        "request",
      ) as EventRow | null;
    },
    async listParticipants(id) {
      return check(await sb.from("participants").select("*").eq("session_id", id), "participants") as ParticipantRow[];
    },
    async insertEvent(id, e) {
      return check(
        await sb
          .from("events")
          .insert({ session_id: id, type: e.type, actor_kind: e.actor_kind, actor_id: e.actor_id ?? null, payload: e.payload ?? {} })
          .select("*")
          .single(),
        "event",
      ) as EventRow;
    },
    async insertAgentStep(id, s) {
      return check(await sb.from("agent_steps").insert({ session_id: id, ...s }).select("*").single(), "agent_step") as AgentStepRow;
    },
    async updateSession(id, patch) {
      check(await sb.from("sessions").update(patch).eq("id", id).select("id"), "session update");
    },
    async supersedePendingScenarioGates(id) {
      return check(
        await sb
          .from("gates")
          .update({ status: "rejected", decision_comment: "superseded", decided_at: new Date().toISOString() })
          .eq("session_id", id)
          .eq("kind", "scenario")
          .eq("status", "pending")
          .select("*"),
        "supersede",
      ) as GateRow[];
    },
    async insertGate(id, g) {
      return check(
        await sb.from("gates").insert({ session_id: id, kind: g.kind, required_role: g.required_role, payload: g.payload }).select("*").single(),
        "gate",
      ) as GateRow;
    },
  };
}
