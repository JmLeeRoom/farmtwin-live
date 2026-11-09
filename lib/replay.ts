import type { SeedTrajectoryPoint } from "./seed";
import type { ScenarioT, WorkerZoneT } from "./types";

/** farmtwin/evaluate.py _front_gap 과 동일: 장애물 앞면 x − 로봇 x − 로봇 앞 돌출. */
export function obstacleFrontX(s: Pick<ScenarioT, "obstacle">): number {
  return s.obstacle.center_x_m - s.obstacle.length_x_m / 2;
}

export function frontGapM(x: number, s: Pick<ScenarioT, "obstacle" | "geometry">): number {
  return obstacleFrontX(s) - x - s.geometry.front_extent_m;
}

export function duration(traj: SeedTrajectoryPoint[]): number {
  return traj.length ? traj[traj.length - 1].simTime : 0;
}

/** simTime ≤ t 인 마지막 샘플의 인덱스(보간 없음). t가 첫 샘플보다 작으면 0. */
export function indexAt(traj: SeedTrajectoryPoint[], t: number): number {
  if (!traj.length || t <= traj[0].simTime) return 0;
  let lo = 0;
  let hi = traj.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (traj[mid].simTime <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export interface View {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  pad: number;
  scale: number; // px per m
  laneHeight: number; // px, 통로 + 라벨
}

/** 통로 8m 중 동작이 일어나는 앞쪽만 크게 보여준다. worker_zone이 더 멀면 그만큼 넓힌다. */
export function makeView(width: number, s: ScenarioT, zone: WorkerZoneT | null): View {
  const pad = 16;
  const xMin = -0.5;
  const obstacleEnd = s.obstacle.center_x_m + s.obstacle.length_x_m / 2;
  const xMax = Math.min(Math.max(obstacleEnd + 0.5, zone ? zone.x_max_m + 0.3 : 0), s.corridor.length_m + 0.2);
  const half = s.corridor.width_m / 2;
  const yMin = -half - 0.1;
  const yMax = half + 0.1;
  const scale = Math.max(40, (width - pad * 2) / (xMax - xMin));
  return { xMin, xMax, yMin, yMax, pad, scale, laneHeight: (yMax - yMin) * scale + 30 };
}

/** ENU 월드(x 앞, y 왼쪽=위) → 레인 내부 화면 좌표. laneTop은 통로 영역의 위쪽 y(px). */
export function toScreen(v: View, laneTop: number, x: number, y: number): [number, number] {
  return [v.pad + (x - v.xMin) * v.scale, laneTop + (v.yMax - y) * v.scale];
}
