// 감사 로그 문구·표시 형식
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
    expect(describeEvent(ev("gate_opened", { kind: "run", required_role: "developer" }))).toBe("② 실행 승인 게이트 열림 · 개발자 승인 대기");
    expect(describeEvent(ev("gate_opened", { kind: "review" }))).toBe("③ 검수 승인 게이트 열림 · 승인 대기");
    expect(describeEvent(ev("gate_decided", { kind: "scenario", decision: "approved", override: true, comment: "확인" }))).toBe("① 시나리오 승인 승인(대리·지적 확인) · “확인”");
    expect(describeEvent(ev("gate_decided", { kind: "run", decision: "rejected" }))).toBe("② 실행 승인 반려");
  });

  it("실행·제공자·번들 문구", () => {
    expect(describeEvent(ev("run_requested", { runner_online: false }))).toContain("오프라인");
    expect(describeEvent(ev("run_requested", { runner_online: true }))).toContain("로컬 러너");
    expect(describeEvent(ev("provider_switch", { from: "codyssey", to: "anthropic" }))).toBe("제공자 전환: codyssey → anthropic");
    expect(describeEvent(ev("agent_step", { changes: [{}, {}] }))).toBe("초안 제출 · 변경 2건");
    expect(describeEvent(ev("agent_step", { no_change: true }))).toContain("변경할 내용이 없다");
    expect(describeEvent(ev("bundle_exported", { sha256: "abcdef0123456789" }))).toBe("Evidence Bundle 내보냄 · sha256 abcdef0123");
    expect(describeEvent(ev("unknown_type"))).toBe("unknown_type");
  });

  it("행위자 표시", () => {
    const byId = new Map<string, ParticipantRow>([["p1", { id: "p1", session_id: "s", name: "재명", role: "developer", joined_at: "" }]]);
    expect(whoOf(ev("steer", {}, { actor_kind: "human", actor_id: "p1" }), byId)).toBe("재명(개발자)");
    expect(whoOf(ev("joined", { name: "김", role: "safety" }, { actor_kind: "human", actor_id: "gone" }), byId)).toBe("김(안전담당)");
    expect(whoOf(ev("agent_step", {}, { actor_kind: "agent", actor_id: "drafter:codyssey" }), byId)).toBe("설계 에이전트 · codyssey");
    expect(whoOf(ev("seed_loaded"), byId)).toBe("시스템");
  });

  it("값 형식", () => {
    expect(fmtM(0.22261)).toBe("0.223 m");
    expect(fmtM(undefined)).toBe("—");
    expect(fmtValue(null)).toBe("없음");
    expect(fmtValue(0.123456)).toBe("0.1235");
    expect(fmtValue(true)).toBe("예");
    expect(fmtValue({ x_min_m: 1, x_max_m: 2, y_min_m: -0.5, y_max_m: 0.5 })).toBe("x 1–2 m · y -0.5–0.5 m");
    expect(timeHMS("2026-11-09T04:05:06.000Z")).toBe("13:05:06");
  });
});
