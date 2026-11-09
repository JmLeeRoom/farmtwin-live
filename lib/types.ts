export type Role = "developer" | "reviewer" | "safety";
export type SessionState =
  | "drafting"
  | "gate_scenario"
  | "gate_run"
  | "awaiting_run"
  | "gate_review"
  | "bundled";
export type GateKind = "scenario" | "run" | "review";
export type GateStatus = "pending" | "approved" | "rejected";
export type VariantId = "A" | "B";

export interface WorkerZoneT {
  x_min_m: number;
  x_max_m: number;
  y_min_m: number;
  y_max_m: number;
  rule: "STOP_ON_ENTRY";
  note: string;
}

export interface Requirements {
  min_front_gap_m: number;
  stopped_speed_mps: number;
  stopped_hold_s: number;
  min_progress_m: number;
  max_abs_y_m: number;
  max_abs_yaw_rad: number;
}

export interface ScenarioT {
  corridor: { length_m: number; width_m: number };
  obstacle: { center_x_m: number; length_x_m: number; width_y_m: number; height_m: number };
  geometry: { front_extent_m: number; rear_extent_m: number; half_width_m: number };
  requirements: Requirements;
  crop_application: { crop: string; task: string; exclusions: string[] };
}

export interface VariantConfig {
  name: string;
  stop_sensor_distance_m: number;
  target_speed_mps: number;
  stop_latched: boolean;
}

export type Variants = Record<VariantId, VariantConfig>;

export interface ScenarioState {
  scenario: ScenarioT;
  variants: Variants;
  worker_zone: WorkerZoneT | null;
}

export interface RunMetrics {
  minFrontGapM: number;
  stopped: boolean;
  stopTimeS: number;
  afterStopTravelM: number;
  progressM: number;
}

export interface RunDigest {
  variantId: VariantId;
  status: string;
  reasonCode: string;
  reason: string;
  metrics: RunMetrics;
  rerunCommand: string | null;
}

export interface VariantSummary {
  count: number;
  pass: number;
  fail: number;
  meanMinFrontGapM: number;
}

export interface SeedSummary {
  batchId: string;
  reportDataSha256: string;
  A: VariantSummary;
  B: VariantSummary;
  runIds: string[];
  runs: Record<string, RunDigest>;
  initial: { scenario: ScenarioT; variants: Variants };
}

export interface ExplainT {
  headline: string;
  bullets: string[];
  quoted: { status: string; reason: string; reasons: string[] };
}

export interface SessionRow {
  id: string;
  title: string;
  seed_batch_id: string;
  scenario: ScenarioT;
  variants: Variants;
  worker_zone: WorkerZoneT | null;
  owner_participant_id: string | null;
  state: SessionState;
  agent_busy: boolean;
  agent_busy_since: string | null;
  last_steer_consumed_id: number;
  seed_summary: SeedSummary | null;
  explain_cache: Record<string, ExplainT>;
  created_at: string;
}

export interface ParticipantRow {
  id: string;
  session_id: string;
  name: string;
  role: Role;
  joined_at: string;
}

export interface EventRow {
  id: number;
  session_id: string;
  type: string;
  actor_kind: "human" | "agent" | "system";
  actor_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface Finding {
  code: string;
  severity: "info" | "warn" | "block";
  message: string;
}

export interface ReviewT {
  verdict: "OK" | "NEEDS_CHANGE";
  findings: Finding[];
  worker_zone_present: boolean;
  summary: string;
}

export interface Change {
  path: string;
  before: unknown;
  after: unknown;
}

export interface DraftView {
  summary: string;
  rationale: string[];
  out_of_scope: string[];
  questions: string[];
  worker_zone: WorkerZoneT | null;
  scenario_patch: Record<string, unknown>;
  variant_patches: Record<VariantId, Record<string, unknown>>;
}

export interface GatePayload {
  draft?: DraftView;
  review?: ReviewT | null;
  before?: ScenarioState;
  after?: ScenarioState;
  changes?: Change[];
  threshold_changed?: boolean;
  from_run_id?: string;
  command?: string;
  input_sha256?: string;
  provider?: string;
  model?: string;
  run_id?: string;
  source?: "recorded" | "rerun";
  explain?: ExplainT | null;
  notice?: string;
  result?: unknown;
  /** 로컬 러너 재실행(source='rerun')일 때 result.json·metrics.json을 RunDigest 형태로 */
  digest?: RunDigest;
}

export interface GateRow {
  id: string;
  session_id: string;
  kind: GateKind;
  required_role: Role;
  status: GateStatus;
  payload: GatePayload;
  decided_by: string | null;
  decision_comment: string | null;
  override: boolean;
  created_at: string;
  decided_at: string | null;
}

export interface AgentStepRow {
  id: string;
  session_id: string;
  role: "drafter" | "reviewer" | "explainer";
  provider: string;
  model_id: string;
  fallback_used: boolean;
  prompt_sha256: string;
  response_sha256: string;
  input_tokens: number | null;
  output_tokens: number | null;
  latency_ms: number | null;
  output?: unknown;
  created_at: string;
}

export interface RunRequestRow {
  id: string;
  session_id: string;
  from_run_id: string;
  command: string;
  input_sha256: string;
  status: "queued" | "running" | "done" | "failed" | "skipped_offline";
  result: unknown;
  created_at: string;
  updated_at: string | null;
}
