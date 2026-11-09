// T3 — LLM 출력·사람 입력 스키마
import { describe, expect, it } from "vitest";
import { Draft, Review, SteerText, WorkerZone, extractJsonObject } from "./schemas";

describe("T3 schemas", () => {
  it("Draft 샘플 통과·기본값 채움", () => {
    const d = Draft.parse({ summary: "s", scenario_patch: { corridor: { width_m: 1.2 } } });
    expect(d.variant_patches).toEqual({ A: {}, B: {} });
    expect(d.worker_zone).toBeNull();
    expect(d.rerun_from_run_id).toBeNull();
  });

  it("긴 summary·rationale은 실패 대신 자른다", () => {
    const d = Draft.parse({ summary: "가".repeat(900), rationale: Array(10).fill("r") });
    expect(d.summary).toHaveLength(300);
    expect(d.rationale).toHaveLength(6);
  });

  it("worker_zone: 범위 역전·통로 밖 거부, 문자열 숫자는 허용", () => {
    expect(() => WorkerZone.parse({ x_min_m: 2, x_max_m: 1, y_min_m: -0.5, y_max_m: 0.5 })).toThrow();
    expect(() => WorkerZone.parse({ x_min_m: 1, x_max_m: 2, y_min_m: -0.5, y_max_m: 0.7 })).toThrow();
    const z = WorkerZone.parse({ x_min_m: "1", x_max_m: "2", y_min_m: -0.5, y_max_m: 0.5 });
    expect(z.rule).toBe("STOP_ON_ENTRY");
    expect(z.x_min_m).toBe(1);
  });

  it("Review: block finding 통과, 모르는 code는 OTHER", () => {
    const r = Review.parse({ verdict: "NEEDS_CHANGE", findings: [{ code: "WORKER_ZONE_MISSING", severity: "block", message: "m" }, { code: "WEIRD", severity: "warn", message: "m" }], worker_zone_present: false, summary: "s" });
    expect(r.findings[0].severity).toBe("block");
    expect(r.findings[1].code).toBe("OTHER");
  });

  it("SteerText: 빈 문자열·500자 초과 거부, 제어문자 제거", () => {
    expect(SteerText.safeParse("   ").success).toBe(false);
    expect(SteerText.safeParse("a".repeat(501)).success).toBe(false);
    expect(SteerText.parse("어르신\u0007 구역")).toBe("어르신 구역");
  });

  it("코드펜스·설명 문장이 섞인 응답에서 JSON만 뽑는다", () => {
    expect(extractJsonObject('설명입니다\n```json\n{"a":{"b":1}}\n```\n끝')).toEqual({ a: { b: 1 } });
    expect(() => extractJsonObject("JSON 없음")).toThrow();
  });
});
