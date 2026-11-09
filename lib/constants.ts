import type { Role, ScenarioT, SessionState } from "./types";

export const SEED_BATCH_DIR = "strawberry-20261101-final";
export const SEED_BASE = `/seed/${SEED_BATCH_DIR}`;
export const SEED_URL = `${SEED_BASE}/report-data.json`;
export const RUN_A01 = "run-A-01-e77456e9377e4b529962612e240b0d23";
export const RUN_B01 = "run-B-01-011d744785354c10976e57946e0bb1ec";
export const EVALUATOR_VERSION = "stop-evaluator-v1";

/** scenarios/strawberry_transport_stop.json 의 설계 가정(현장 실측 아님). report-data.json에는 통로·장애물 치수가 없어서 여기 고정한다. */
export const BASE_SCENARIO: ScenarioT = {
  corridor: { length_m: 8.0, width_m: 1.0 },
  obstacle: { center_x_m: 2.6, length_x_m: 0.8, width_y_m: 0.8, height_m: 0.7 },
  geometry: { front_extent_m: 0.25, rear_extent_m: 0.3, half_width_m: 0.23 },
  requirements: {
    min_front_gap_m: 0.4,
    stopped_speed_mps: 0.02,
    stopped_hold_s: 0.5,
    min_progress_m: 1.0,
    max_abs_y_m: 0.1,
    max_abs_yaw_rad: 0.05,
  },
  crop_application: {
    crop: "Strawberry",
    task: "Harvest-crate hauling assist",
    exclusions: [
      "Driving in soil furrows",
      "Harvesting and crop recognition",
      "Loading and unloading",
      "Following workers and moving obstacles",
      "Reduced bending (ergonomic effect)",
      "Physical safety and performance certification",
    ],
  },
};

export const REQUIREMENT_KEYS = [
  "min_front_gap_m",
  "stopped_speed_mps",
  "stopped_hold_s",
  "min_progress_m",
  "max_abs_y_m",
  "max_abs_yaw_rad",
] as const;

export const SCENARIO_ALLOWED_PATHS = new Set<string>([
  "corridor.width_m",
  "corridor.length_m",
  "obstacle.center_x_m",
  "obstacle.length_x_m",
  "obstacle.width_y_m",
  "obstacle.height_m",
  ...REQUIREMENT_KEYS.map((k) => `requirements.${k}`),
]);

export const VARIANT_ALLOWED_KEYS = new Set<string>([
  "stop_sensor_distance_m",
  "target_speed_mps",
  "stop_latched",
]);

export const ROLE_LABEL: Record<Role, string> = {
  developer: "Developer",
  reviewer: "Reviewer",
  safety: "Safety lead",
};

export const ROLE_COLOR: Record<Role, string> = {
  developer: "bg-sky-100 text-sky-800 ring-sky-300",
  reviewer: "bg-violet-100 text-violet-800 ring-violet-300",
  safety: "bg-amber-100 text-amber-900 ring-amber-300",
};

export const STATE_LABEL: Record<SessionState, string> = {
  drafting: "Drafting",
  gate_scenario: "① Awaiting scenario approval",
  gate_run: "② Awaiting run approval",
  awaiting_run: "Local runner running",
  gate_review: "③ Awaiting review approval",
  bundled: "Done · Evidence Bundle ready",
};

export const GATE_TITLE = {
  scenario: "① Scenario approval",
  run: "② Run approval",
  review: "③ Review approval",
} as const;

export const DEMO_REQUEST =
  "Tomorrow at 05:00 we run a stop test for the strawberry crate-hauling robot in collection aisle 3. Draft a test scenario that compares stop settings A and B.";
export const DEMO_STEER = "Elderly workers weed in aisle 3 every morning. The robot must always stop in that section.";

export const OFFLINE_NOTICE =
  "Local runner offline — this review uses the 2026-11-01 records (batch-20261101-081329). These are not results of the new scenario.";

export const DEMO_LINE = "The agent drafts. The rules (evaluate.py) judge. People approve.";
