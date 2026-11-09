// T1 — 재생 수치가 실제 기록·평가기와 맞는지 (docs/SPEC.md §19)
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BASE_SCENARIO, RUN_A01, RUN_B01 } from "./constants";
import { duration, frontGapM, indexAt, makeView, obstacleFrontX, toScreen } from "./replay";
import { summarizeSeed, type ReportData } from "./seed";

const seed = JSON.parse(
  readFileSync(path.resolve(__dirname, "../public/seed/strawberry-20261101-final/report-data.json"), "utf8"),
) as ReportData;
const run = (id: string) => seed.runs.find((r) => r.id === id)!;

describe("T1 replay", () => {
  it("앞면 간격 공식이 evaluate.py와 같다: 2.2 − x − 0.25", () => {
    expect(obstacleFrontX(BASE_SCENARIO)).toBeCloseTo(2.2, 12);
    for (const r of seed.runs) {
      for (const p of r.trajectory) expect(Math.abs(frontGapM(p.xM, BASE_SCENARIO) - p.frontGapM)).toBeLessThan(1e-6);
    }
  });

  it("궤적 최소 간격 = metrics.minFrontGapM, 마지막 간격은 ±0.02 이내", () => {
    for (const id of [RUN_A01, RUN_B01]) {
      const r = run(id);
      const min = Math.min(...r.trajectory.map((p) => p.frontGapM));
      expect(min).toBeCloseTo(r.metrics.minFrontGapM, 6);
      const last = r.trajectory[r.trajectory.length - 1].frontGapM;
      expect(Math.abs(last - r.metrics.minFrontGapM)).toBeLessThan(0.02);
    }
    expect(run(RUN_A01).metrics.minFrontGapM).toBeCloseTo(0.2226, 3);
    expect(run(RUN_B01).metrics.minFrontGapM).toBeCloseTo(0.7346, 3);
  });

  it("indexAt은 simTime ≤ t 인 마지막 샘플", () => {
    const tr = run(RUN_B01).trajectory;
    expect(indexAt(tr, -1)).toBe(0);
    expect(indexAt(tr, tr[10].simTime)).toBe(10);
    expect(indexAt(tr, tr[10].simTime + 0.001)).toBe(10);
    expect(indexAt(tr, 999)).toBe(tr.length - 1);
    expect(duration(tr)).toBeCloseTo(4.16, 6);
  });

  it("화면 좌표: x는 오른쪽으로, y(+)는 위로", () => {
    const v = makeView(720, BASE_SCENARIO, null);
    const [x0, y0] = toScreen(v, 0, 0, 0);
    const [x1, y1] = toScreen(v, 0, 1, 0.3);
    expect(x1).toBeGreaterThan(x0);
    expect(y1).toBeLessThan(y0);
  });

  it("시드 요약: A 5/5 FAIL, B 5/5 PASS, 10개 run", () => {
    const s = summarizeSeed(seed, "x");
    expect(s.runIds).toHaveLength(10);
    expect([s.A.count, s.A.fail, s.B.count, s.B.pass]).toEqual([5, 5, 5, 5]);
    expect(s.runs[RUN_B01].rerunCommand).toContain("farmtwin rerun");
    expect(s.initial.variants.A.stop_sensor_distance_m).toBe(0.3);
    expect(s.initial.variants.B.stop_sensor_distance_m).toBe(0.8);
  });
});

describe("seed summary in English", () => {
  it("records' Korean labels and verdicts are shown in English", () => {
    const s = summarizeSeed(seed, "x");
    expect(s.initial.variants.A.name).toBe("Late stop");
    expect(s.initial.variants.B.name).toBe("Early stop");
    expect(s.initial.scenario.crop_application.crop).toBe("Strawberry");
    expect(s.runs[RUN_A01].reason).toBe("Minimum front gap 0.2226 m is below the required 0.40 m.");
    expect(s.runs[RUN_B01].reason).toMatch(/requirements are all met/);
    expect(s.runs[RUN_A01].reasonCode).toBe("MIN_GAP_VIOLATION");
  });
});
