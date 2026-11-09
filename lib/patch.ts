import { SCENARIO_ALLOWED_PATHS, VARIANT_ALLOWED_KEYS } from "./constants";
import type { Change, ScenarioState, VariantId, WorkerZoneT } from "./types";

type Obj = Record<string, unknown>;

const isPlainObject = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** 중첩 patch를 "a.b.c" 경로 목록으로 편다. 배열·null·원시값은 잎. */
export function flatten(obj: Obj, prefix = ""): Array<[string, unknown]> {
  const out: Array<[string, unknown]> = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (isPlainObject(v) && Object.keys(v).length > 0) out.push(...flatten(v, path));
    else out.push([path, v]);
  }
  return out;
}

function setPath(target: Obj, path: string, value: unknown) {
  const parts = path.split(".");
  let cur = target;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!isPlainObject(cur[parts[i]])) cur[parts[i]] = {};
    cur = cur[parts[i]] as Obj;
  }
  cur[parts[parts.length - 1]] = value;
}

function getPath(source: unknown, path: string): unknown {
  let cur: unknown = source;
  for (const p of path.split(".")) {
    if (!isPlainObject(cur)) return undefined;
    cur = cur[p];
  }
  return cur;
}

function toNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

export interface Sanitized {
  patch: Obj;
  removed: string[];
}

/** 허용 경로·숫자 값만 남긴다. null(삭제)·허용 외 키·숫자 아님은 버리고 사유를 out_of_scope로 돌려준다. */
export function sanitizeScenarioPatch(patch: unknown): Sanitized {
  const out: Obj = {};
  const removed: string[] = [];
  if (!isPlainObject(patch)) return { patch: out, removed };
  for (const [path, value] of flatten(patch)) {
    if (!SCENARIO_ALLOWED_PATHS.has(path)) {
      removed.push(`허용되지 않은 키: scenario.${path}`);
      continue;
    }
    if (value === null || value === undefined) {
      removed.push(`삭제 불가: scenario.${path}`);
      continue;
    }
    const n = toNumber(value);
    if (n === null) {
      removed.push(`숫자가 아님: scenario.${path}`);
      continue;
    }
    setPath(out, path, n);
  }
  return { patch: out, removed };
}

export function sanitizeVariantPatch(patch: unknown, id: VariantId): Sanitized {
  const out: Obj = {};
  const removed: string[] = [];
  if (!isPlainObject(patch)) return { patch: out, removed };
  for (const [key, value] of Object.entries(patch)) {
    if (!VARIANT_ALLOWED_KEYS.has(key)) {
      removed.push(`허용되지 않은 키: variants.${id}.${key}`);
      continue;
    }
    if (value === null || value === undefined) {
      removed.push(`삭제 불가: variants.${id}.${key}`);
      continue;
    }
    if (key === "stop_latched") {
      if (typeof value === "boolean") out[key] = value;
      else if (value === "true" || value === "false") out[key] = value === "true";
      else removed.push(`참/거짓 아님: variants.${id}.${key}`);
      continue;
    }
    const n = toNumber(value);
    if (n === null) removed.push(`숫자가 아님: variants.${id}.${key}`);
    else out[key] = n;
  }
  return { patch: out, removed };
}

export function deepMerge<T>(base: T, patch: Obj): T {
  const out = structuredClone(base) as Obj;
  for (const [path, value] of flatten(patch)) setPath(out, path, value);
  return out as T;
}

/** worker_zone은 null이면 "기존 유지"(초안이 빠뜨려도 구역이 사라지지 않게). */
export function applyDraft(
  before: ScenarioState,
  p: { scenarioPatch: Obj; variantPatches: Record<VariantId, Obj>; workerZone: WorkerZoneT | null },
): ScenarioState {
  return {
    scenario: deepMerge(before.scenario, p.scenarioPatch),
    variants: {
      A: deepMerge(before.variants.A, p.variantPatches.A),
      B: deepMerge(before.variants.B, p.variantPatches.B),
    },
    worker_zone: p.workerZone ?? before.worker_zone ?? null,
  };
}

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** 허용 경로와 worker_zone 중 바뀐 것만. */
export function diffState(before: ScenarioState, after: ScenarioState): Change[] {
  const changes: Change[] = [];
  for (const path of SCENARIO_ALLOWED_PATHS) {
    const a = getPath(before.scenario, path);
    const b = getPath(after.scenario, path);
    if (!sameValue(a, b)) changes.push({ path: `scenario.${path}`, before: a ?? null, after: b ?? null });
  }
  for (const id of ["A", "B"] as const) {
    for (const key of VARIANT_ALLOWED_KEYS) {
      const a = getPath(before.variants[id], key);
      const b = getPath(after.variants[id], key);
      if (!sameValue(a, b)) changes.push({ path: `variants.${id}.${key}`, before: a ?? null, after: b ?? null });
    }
  }
  if (!sameValue(before.worker_zone, after.worker_zone)) {
    changes.push({ path: "worker_zone", before: before.worker_zone ?? null, after: after.worker_zone ?? null });
  }
  return changes;
}

export const thresholdChanged = (changes: Change[]) =>
  changes.some((c) => c.path.startsWith("scenario.requirements."));

/** 화면용 경로 이름 */
export function changeLabel(path: string): string {
  const map: Record<string, string> = {
    "scenario.corridor.width_m": "통로 폭",
    "scenario.corridor.length_m": "통로 길이",
    "scenario.obstacle.center_x_m": "장애물 중심 x",
    "scenario.obstacle.length_x_m": "장애물 길이",
    "scenario.obstacle.width_y_m": "장애물 폭",
    "scenario.obstacle.height_m": "장애물 높이",
    "scenario.requirements.min_front_gap_m": "판정 기준 · 최소 앞면 간격",
    "scenario.requirements.stopped_speed_mps": "판정 기준 · 정지 속력",
    "scenario.requirements.stopped_hold_s": "판정 기준 · 정지 유지",
    "scenario.requirements.min_progress_m": "판정 기준 · 최소 진행",
    "scenario.requirements.max_abs_y_m": "판정 기준 · 옆 벗어남",
    "scenario.requirements.max_abs_yaw_rad": "판정 기준 · 방향 틀어짐",
    worker_zone: "고령 작업자 구역",
  };
  if (map[path]) return map[path];
  const m = path.match(/^variants\.([AB])\.(.+)$/);
  if (m) {
    const k: Record<string, string> = {
      stop_sensor_distance_m: "정지 시작 거리",
      target_speed_mps: "목표 속도",
      stop_latched: "정지 유지(latch)",
    };
    return `설정 ${m[1]} · ${k[m[2]] ?? m[2]}`;
  }
  return path;
}
