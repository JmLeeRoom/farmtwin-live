// Audit-log lines and display formats
import { describe, expect, it } from "vitest";
import { describeEvent, fmtM, fmtValue, timeHMS, whoOf } from "./format";
import type { EventRow, ParticipantRow } from "./types";

const ev = (type: string, payload: Record<string, unknown> = {}, actor: Partial<EventRow> = {}): EventRow => ({
  id: 1,
  session_id: "s",
  type,
  actor_kind: "system",
  actor_id: "system",
  payload,
  created_at: "2026-11-09T04:05:06.000Z",
  ...actor,
});

describe("format", () => {
  it("게이트 이벤트 문구(역할 있음/없음)", () => {
    expect(describeEvent(ev("gate_opened", { kind: "run", required_role: "developer" }))).toBe("② Run approval opened · waiting for Developer");
    expect(describeEvent(ev("gate_opened", { kind: "review" }))).toBe("③ Review approval opened · awaiting approval");
    expect(describeEvent(ev("gate_decided", { kind: "scenario", decision: "approved", override: true, comment: "checked" }))).toBe("① Scenario approval: approved (proxy / findings acknowledged) · “checked”");
    expect(describeEvent(ev("gate_decided", { kind: "run", decision: "rejected" }))).toBe("② Run approval: rejected");
  });

  it("실행·제공자·번들 문구", () => {
    expect(describeEvent(ev("run_requested", { runner_online: false }))).toContain("offline");
    expect(describeEvent(ev("run_requested", { runner_online: true }))).toContain("local runner");
    expect(describeEvent(ev("provider_switch", { from: "codyssey", to: "anthropic" }))).toBe("Provider switch: codyssey → anthropic");
    expect(describeEvent(ev("agent_step", { changes: [{}, {}] }))).toBe("Submitted a draft · 2 changes");
    expect(describeEvent(ev("agent_step", { no_change: true }))).toBe("Found nothing to change");
    expect(describeEvent(ev("bundle_exported", { sha256: "abcdef0123456789" }))).toBe("Exported Evidence Bundle · sha256 abcdef0123");
    expect(describeEvent(ev("unknown_type"))).toBe("unknown_type");
  });

  it("행위자 표시", () => {
    const byId = new Map<string, ParticipantRow>([["p1", { id: "p1", session_id: "s", name: "재명", role: "developer", joined_at: "" }],["p2", { id: "p2", session_id: "s", name: "Safety lead", role: "safety", joined_at: "" }]]);
    expect(whoOf(ev("steer", {}, { actor_kind: "human", actor_id: "p1" }), byId)).toBe("재명(Developer)");
    expect(whoOf(ev("steer", {}, { actor_kind: "human", actor_id: "p2" }), byId)).toBe("Safety lead");
    expect(whoOf(ev("joined", { name: "김", role: "safety" }, { actor_kind: "human", actor_id: "gone" }), byId)).toBe("김(Safety lead)");
    expect(whoOf(ev("agent_step", {}, { actor_kind: "agent", actor_id: "drafter:codyssey" }), byId)).toBe("Design agent · codyssey");
    expect(whoOf(ev("seed_loaded"), byId)).toBe("System");
  });

  it("값 형식", () => {
    expect(fmtM(0.22261)).toBe("0.223 m");
    expect(fmtM(undefined)).toBe("—");
    expect(fmtValue(null)).toBe("none");
    expect(fmtValue(0.123456)).toBe("0.1235");
    expect(fmtValue(true)).toBe("yes");
    expect(fmtValue({ x_min_m: 1, x_max_m: 2, y_min_m: -0.5, y_max_m: 0.5 })).toBe("x 1–2 m · y -0.5–0.5 m");
    expect(timeHMS("2026-11-09T04:05:06.000Z")).toBe("13:05:06");
  });
});
