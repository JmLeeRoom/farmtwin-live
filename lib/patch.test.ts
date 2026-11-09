// T2 — 화이트리스트·병합·판정 기준 변경 감지
import { describe, expect, it } from "vitest";
import { BASE_SCENARIO } from "./constants";
import { applyDraft, diffState, sanitizeScenarioPatch, sanitizeVariantPatch, thresholdChanged } from "./patch";
import type { ScenarioState } from "./types";

const before: ScenarioState = {
  scenario: BASE_SCENARIO,
  variants: {
    A: { name: "늦은 정지", stop_sensor_distance_m: 0.3, target_speed_mps: 0.4, stop_latched: true },
    B: { name: "이른 정지", stop_sensor_distance_m: 0.8, target_speed_mps: 0.4, stop_latched: true },
  },
  worker_zone: null,
};

describe("T2 patch", () => {
  it("허용 외 키는 걷어내고 사유를 남긴다", () => {
    const r = sanitizeScenarioPatch({ robot_model: "X", geometry: { front_extent_m: 1 }, crop_application: { exclusions: [] }, corridor: { width_m: 1.2 } });
    expect(r.patch).toEqual({ corridor: { width_m: 1.2 } });
    expect(r.removed.join(" ")).toContain("scenario.robot_model");
    expect(r.removed.join(" ")).toContain("scenario.geometry.front_extent_m");
  });

  it("null 삭제 시도는 거부, 숫자 문자열은 숫자로", () => {
    const r = sanitizeScenarioPatch({ requirements: { min_front_gap_m: null, stopped_hold_s: "0.6" } });
    expect(r.patch).toEqual({ requirements: { stopped_hold_s: 0.6 } });
    expect(r.removed[0]).toContain("삭제 불가");
  });

  it("variant: 허용 키·불리언 처리", () => {
    const r = sanitizeVariantPatch({ target_speed_mps: "0.3", stop_latched: "false", controller_version: "x" }, "A");
    expect(r.patch).toEqual({ target_speed_mps: 0.3, stop_latched: false });
    expect(r.removed[0]).toContain("variants.A.controller_version");
  });

  it("판정 기준 변경을 감지한다", () => {
    const sp = sanitizeScenarioPatch({ requirements: { min_front_gap_m: 0.1 } });
    const after = applyDraft(before, { scenarioPatch: sp.patch, variantPatches: { A: {}, B: {} }, workerZone: null });
    const changes = diffState(before, after);
    expect(thresholdChanged(changes)).toBe(true);
    expect(after.scenario.requirements.min_front_gap_m).toBe(0.1);
    expect(before.scenario.requirements.min_front_gap_m).toBe(0.4); // 원본 불변
  });

  it("worker_zone null은 기존 유지, 새 구역은 변경으로 잡힌다", () => {
    const zone = { x_min_m: 1, x_max_m: 2, y_min_m: -0.5, y_max_m: 0.5, rule: "STOP_ON_ENTRY" as const, note: "n" };
    const a1 = applyDraft(before, { scenarioPatch: {}, variantPatches: { A: {}, B: {} }, workerZone: zone });
    expect(diffState(before, a1).map((c) => c.path)).toEqual(["worker_zone"]);
    const a2 = applyDraft(a1, { scenarioPatch: {}, variantPatches: { A: {}, B: {} }, workerZone: null });
    expect(a2.worker_zone).toEqual(zone);
    expect(diffState(a1, a2)).toHaveLength(0);
  });
});
