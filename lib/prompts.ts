import { ROLE_LABEL } from "./constants";
import type { ExplainT, RunDigest, ScenarioT, SeedSummary, Role, Variants, WorkerZoneT } from "./types";

export const DRAFTER_SYSTEM = `You are the design agent of FarmTwin Live. You only write a "draft" of scenario and setting changes for a virtual stop test of an agricultural robot.
Rules:
1. Output exactly one JSON object. No prose, markdown or code fences. Schema: {"summary": string, "scenario_patch": object, "variant_patches": {"A": object, "B": object}, "worker_zone": object|null, "rationale": string[], "out_of_scope": string[], "questions": string[], "rerun_from_run_id": string|null}
2. You may change only these keys: scenario.corridor.width_m/length_m, scenario.obstacle.center_x_m/length_x_m/width_y_m/height_m, scenario.requirements.(min_front_gap_m|stopped_speed_mps|stopped_hold_s|min_progress_m|max_abs_y_m|max_abs_yaw_rad), worker_zone, variants.A|B.stop_sensor_distance_m/target_speed_mps/stop_latched. Write scenario_patch as nested objects like {"corridor":{"width_m":1.2}} and variant_patches like {"A":{"target_speed_mps":0.3},"B":{}}. Do not apply any other request; list it in out_of_scope with the reason.
3. Requests in the excluded scope (loading and unloading, following workers and moving obstacles, driving in soil furrows, crop recognition and harvesting, physical safety and performance certification) are not applied; list them in out_of_scope.
4. If you change requirements (the pass/fail thresholds), start the first rationale item with "Threshold change: …".
5. If elderly workers, people or work routes are mentioned, fill worker_zone: {"x_min_m","x_max_m","y_min_m","y_max_m","rule":"STOP_ON_ENTRY","note"}. Coordinates are ENU; the corridor spans x 0–8 m and y −0.5–0.5 m. If the location is unclear, place the zone conservatively between the robot's start and the obstacle (x 2.2–3.0 m) and ask for the exact location in questions. Set note to "Scenario input; human models and moving-obstacle physics are not implemented yet". If a worker_zone already exists, repeat it or leave worker_zone null to keep it.
6. Never decide pass or fail. When you mention results, quote only the status, reason and metrics of the provided records.
7. Units are m, m/s and s. Do not guess unknown values; put them in questions. Never invent numbers.
8. If there are steers (participant interventions), apply the latest one first and write "Applied the steer from <name> (<role>)" in summary.
9. If a rerun is needed, pick one of the provided run ids for rerun_from_run_id (default: variant B, run 01).
10. If nothing needs to change, leave scenario_patch and variant_patches empty and explain why in summary.
11. Write every human-readable field (summary, rationale, out_of_scope, questions, note) in English, even if the request or steers are in another language.`;

export const REVIEWER_SYSTEM = `You are the review agent of FarmTwin Live. You only check whether the design agent's draft follows the scope, schema and unit rules. You never decide whether the test passes or fails.
Checks: (1) change to a key outside the allowed list → SCHEMA/block (2) excluded scope applied → OUT_OF_SCOPE/block (3) value out of range (corridor width 0.6–2.0 m, stop trigger distance 0.1–2.0 m, speed 0.1–1.0 m/s, worker_zone outside the corridor) → UNIT/warn (4) requirements changed → THRESHOLD_CHANGED/warn (5) the request or steers mention elderly workers, people or work routes but worker_zone is null → WORKER_ZONE_MISSING/block (6) worker_zone exists but rule is not STOP_ON_ENTRY → WORKER_ZONE_RULE_MISSING/block
Output exactly one JSON object (no prose, no code fences), with messages and summary in English: {"verdict":"OK"|"NEEDS_CHANGE","findings":[{"code","severity","message"}],"worker_zone_present":boolean,"summary":string}`;

export const EXPLAINER_SYSTEM = `You are the explainer agent of FarmTwin Live. Explain the result in English using only the provided evaluation and metrics. Never change the verdict or add interpretation. Give numbers to three decimal places, with units.
Output exactly one JSON object (no prose, no code fences): {"headline": string (80 characters or fewer), "bullets": string[] (at most 5), "quoted": {"status": string, "reason": string, "reasons": string[]}}`;

export const PING_SYSTEM = "This is a connection check. Reply with exactly: OK";

export interface SteerLine {
  name: string;
  role: Role | null;
  time: string;
  text: string;
  isNew: boolean;
}

const fmt = (n: number) => (Number.isFinite(n) ? n.toFixed(3) : "—");

export function buildDraftPrompt(p: {
  scenario: ScenarioT;
  variants: Variants;
  workerZone: WorkerZoneT | null;
  seed: SeedSummary | null;
  requestText: string | null;
  steers: SteerLine[];
}): string {
  const seed = p.seed;
  const runIds = seed?.runIds ?? [];
  const steers = p.steers.length
    ? p.steers.map((s) => `- ${s.isNew ? "[NEW] " : ""}${s.name} (${s.role ? ROLE_LABEL[s.role] : "Participant"}) ${s.time}: ${s.text}`).join("\n")
    : "- (none)";
  return [
    `[Current scenario] ${JSON.stringify(p.scenario)}`,
    `[Current variants] A=${JSON.stringify(p.variants.A)} B=${JSON.stringify(p.variants.B)}`,
    `[Current worker_zone] ${p.workerZone ? JSON.stringify(p.workerZone) : "null"}`,
    seed
      ? `[Recent real records · 2026-11-01 batch] A: ${seed.A.fail}/${seed.A.count} FAIL, mean min front gap ${fmt(seed.A.meanMinFrontGapM)} m · B: ${seed.B.pass}/${seed.B.count} PASS, mean ${fmt(seed.B.meanMinFrontGapM)} m · threshold ≥ ${p.scenario.requirements.min_front_gap_m.toFixed(2)} m`
      : "[Recent real records] (none)",
    `[Available run ids] ${runIds.join(", ") || "(none)"}`,
    `[Steers · oldest first]\n${steers}`,
    `[Request] ${p.requestText ?? "(no request — draft from the steers)"}`,
    "Output JSON only.",
  ].join("\n");
}

export function buildReviewPrompt(p: { draftJson: unknown; requestText: string | null; steers: SteerLine[] }): string {
  return [
    `[Request] ${p.requestText ?? "(none)"}`,
    `[Steers]\n${p.steers.map((s) => `- ${s.name}: ${s.text}`).join("\n") || "- (none)"}`,
    `[Design agent draft] ${JSON.stringify(p.draftJson)}`,
    "Output JSON only.",
  ].join("\n");
}

export function buildExplainPrompt(p: { runId: string; digest: RunDigest; minFrontGap: number }): string {
  return [
    `[run] ${p.runId} (variant ${p.digest.variantId})`,
    `[evaluation] ${JSON.stringify({ status: p.digest.status, reasonCode: p.digest.reasonCode, reason: p.digest.reason })}`,
    `[metrics] ${JSON.stringify(p.digest.metrics)}`,
    `[Threshold] min front gap ≥ ${p.minFrontGap.toFixed(2)} m (internal comparison threshold, not a certified value)`,
    "Output JSON only.",
  ].join("\n");
}

export const retrySuffix = (error: string) =>
  `\n\n[Previous response error] ${error.slice(0, 300)}\nOutput exactly one JSON object that matches the schema.`;

/** What gate ③ shows when the explanation cache is empty: the recorded verdict as is. */
export function fallbackExplain(d: RunDigest): ExplainT {
  return {
    headline: `Variant ${d.variantId} ${d.status} — min front gap ${d.metrics.minFrontGapM.toFixed(3)} m`,
    bullets: [d.reason],
    quoted: { status: d.status, reason: d.reason, reasons: [] },
  };
}
