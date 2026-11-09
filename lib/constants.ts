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
    crop: "딸기",
    task: "수확상자 운반 보조",
    exclusions: [
      "토경 고랑 주행",
      "수확·작물 인식",
      "적재·상하차",
      "작업자 추종·동적 장애물",
      "허리 숙임 감소 효과",
      "실물 안전·성능 인증",
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
  developer: "개발자",
  reviewer: "검수자",
  safety: "안전담당",
};

export const ROLE_COLOR: Record<Role, string> = {
  developer: "bg-sky-100 text-sky-800 ring-sky-300",
  reviewer: "bg-violet-100 text-violet-800 ring-violet-300",
  safety: "bg-amber-100 text-amber-900 ring-amber-300",
};

export const STATE_LABEL: Record<SessionState, string> = {
  drafting: "초안 작성 단계",
  gate_scenario: "① 시나리오 승인 대기",
  gate_run: "② 실행 승인 대기",
  awaiting_run: "로컬 러너 실행 중",
  gate_review: "③ 검수 승인 대기",
  bundled: "완료 · Evidence Bundle 준비됨",
};

export const GATE_TITLE = {
  scenario: "① 시나리오 승인",
  run: "② 실행 승인",
  review: "③ 검수 승인",
} as const;

export const DEMO_REQUEST =
  "내일 05:00 3번 집하통로에서 딸기 수확상자 운반 로봇 정지 시험을 한다. 정지 설정 A/B를 비교해서 진행할 시나리오 초안을 만들어 줘.";
export const DEMO_STEER = "3번 통로는 어르신이 아침에 풀 뽑으러 나오신다. 그 구간에서는 반드시 멈춰야 한다.";

export const OFFLINE_NOTICE =
  "로컬 러너 오프라인 — 2026-11-01 기록(batch-20261101-081329)으로 검수를 진행합니다. 새 시나리오의 실행 결과가 아닙니다.";

export const DEMO_LINE = "에이전트는 초안·설명·명령을 만들고, 판정은 규칙(evaluate.py)이, 승인은 사람이 한다.";
