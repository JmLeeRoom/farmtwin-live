import { BASE_SCENARIO, SEED_URL } from "./constants";
import { sha256Hex } from "./sha";
import type { RunDigest, ScenarioT, SeedSummary, VariantId, Variants, VariantSummary } from "./types";

/** report-data.json(2026-11-01 딸기 집하통로 batch)에서 이 앱이 쓰는 부분만. */
export interface SeedTrajectoryPoint {
  simTime: number;
  xM: number;
  yM: number;
  speedMps: number;
  frontGapM: number;
}

export interface SeedEvent {
  type: string;
  simTime: number;
  detail?: string;
  log?: string;
}

export interface SeedRun {
  id: string;
  variantId: VariantId;
  evaluation: { status: string; reasonCode: string; reason: string };
  metrics: {
    minFrontGapM: number;
    stopped: boolean;
    stopTimeS: number;
    afterStopTravelM: number;
    progressM: number;
  };
  events: SeedEvent[];
  trajectory: SeedTrajectoryPoint[];
  scene?: { href?: string };
  rerun?: { available?: boolean; command?: string };
}

export interface ReportData {
  batchId: string;
  source: string;
  title: string;
  scenario: {
    id: string;
    name: string;
    robot: string;
    sensor: string;
    requirements: Record<string, number>;
    cropApplication?: { crop?: string; task?: string; exclusions?: string[] };
  };
  variants: Array<{ id: VariantId; name: string; config: Record<string, number | boolean> }>;
  runs: SeedRun[];
}

export async function fetchSeed(): Promise<{ data: ReportData; text: string; sha256: string }> {
  const res = await fetch(SEED_URL, { cache: "force-cache" });
  if (!res.ok) throw new Error(`Could not load the trial records (${res.status})`);
  const text = await res.text();
  return { data: JSON.parse(text) as ReportData, text, sha256: sha256Hex(text) };
}

/** The 2026-11-01 records carry Korean labels; the app shows English, so Korean text falls back to the English defaults. */
const hasHangul = (s: unknown): boolean => typeof s === "string" && /[\uac00-\ud7a3]/.test(s);

export function normalizeScenario(data: ReportData): ScenarioT {
  const crop = data.scenario.cropApplication ?? {};
  const base = BASE_SCENARIO.crop_application;
  return {
    ...BASE_SCENARIO,
    crop_application: {
      crop: crop.crop && !hasHangul(crop.crop) ? crop.crop : base.crop,
      task: crop.task && !hasHangul(crop.task) ? crop.task : base.task,
      exclusions: crop.exclusions && !crop.exclusions.some(hasHangul) ? crop.exclusions : base.exclusions,
    },
  };
}

/** English text for the evaluator's recorded verdict (the original stays in report-data.json). */
export function englishReason(ev: { status: string; reasonCode: string; reason: string }, minFrontGapM: number): string {
  if (!hasHangul(ev.reason)) return ev.reason;
  const bar = BASE_SCENARIO.requirements.min_front_gap_m.toFixed(2);
  if (ev.reasonCode === "REQUIREMENTS_MET") return "Recording, motion, sensor stop, stop hold, front gap and corridor requirements are all met.";
  if (ev.reasonCode === "MIN_GAP_VIOLATION") return `Minimum front gap ${minFrontGapM.toFixed(4)} m is below the required ${bar} m.`;
  return `${ev.status} · ${ev.reasonCode}`;
}

export function normalizeVariants(data: ReportData): Variants {
  const pick = (id: VariantId) => {
    const v = data.variants.find((x) => x.id === id);
    return {
      name: v?.name && !hasHangul(v.name) ? v.name : id === "A" ? "Late stop" : "Early stop",
      stop_sensor_distance_m: Number(v?.config.stop_sensor_distance_m ?? (id === "A" ? 0.3 : 0.8)),
      target_speed_mps: Number(v?.config.target_speed_mps ?? 0.4),
      stop_latched: Boolean(v?.config.stop_latched ?? true),
    };
  };
  return { A: pick("A"), B: pick("B") };
}

function variantSummary(runs: SeedRun[], id: VariantId): VariantSummary {
  const rs = runs.filter((r) => r.variantId === id);
  const gaps = rs.map((r) => r.metrics.minFrontGapM).filter((g) => Number.isFinite(g));
  return {
    count: rs.length,
    pass: rs.filter((r) => r.evaluation.status === "PASS").length,
    fail: rs.filter((r) => r.evaluation.status === "FAIL").length,
    meanMinFrontGapM: gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : NaN,
  };
}

export function summarizeSeed(data: ReportData, reportDataSha256: string): SeedSummary {
  const runs: Record<string, RunDigest> = {};
  for (const r of data.runs) {
    runs[r.id] = {
      variantId: r.variantId,
      status: r.evaluation.status,
      reasonCode: r.evaluation.reasonCode,
      reason: englishReason(r.evaluation, r.metrics.minFrontGapM),
      metrics: { ...r.metrics },
      rerunCommand: r.rerun?.command ?? null,
    };
  }
  return {
    batchId: data.batchId,
    reportDataSha256,
    A: variantSummary(data.runs, "A"),
    B: variantSummary(data.runs, "B"),
    runIds: data.runs.map((r) => r.id),
    runs,
    initial: { scenario: normalizeScenario(data), variants: normalizeVariants(data) },
  };
}

/** run-A-03-… → "A-03" */
export const runLabel = (runId: string) => runId.replace(/^run-/, "").slice(0, 4);

/** 화면 표시용: PowerShell 명령의 로컬 절대경로를 접는다(원문은 payload에만). */
export function foldCommand(cmd: string | null | undefined): string {
  if (!cmd) return "—";
  const last = cmd.split(/\r?\n/).pop() ?? cmd;
  const m = last.match(/--from-run\s+'?[^']*?(run-[AB]-\d{2}-[0-9a-f]{6})[0-9a-f]*'?/);
  return m ? `python -m farmtwin rerun --from-run …/${m[1]}…` : last.replace(/[A-Z]:\\[^']+\\/g, "…\\");
}
