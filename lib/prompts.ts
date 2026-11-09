import { ROLE_LABEL } from "./constants";
import type { ExplainT, RunDigest, ScenarioT, SeedSummary, Role, Variants, WorkerZoneT } from "./types";

export const DRAFTER_SYSTEM = `당신은 FarmTwin Live의 설계 에이전트다. 농업로봇 가상 정지시험의 시나리오·설정 변경 "초안"만 작성한다.
규칙:
1. 출력은 JSON 객체 하나. 설명 문장·마크다운·코드펜스 금지. 스키마: {"summary": string, "scenario_patch": object, "variant_patches": {"A": object, "B": object}, "worker_zone": object|null, "rationale": string[], "out_of_scope": string[], "questions": string[], "rerun_from_run_id": string|null}
2. 바꿀 수 있는 키는 허용 목록뿐이다: scenario.corridor.width_m/length_m, scenario.obstacle.center_x_m/length_x_m/width_y_m/height_m, scenario.requirements.(min_front_gap_m|stopped_speed_mps|stopped_hold_s|min_progress_m|max_abs_y_m|max_abs_yaw_rad), worker_zone, variants.A|B.stop_sensor_distance_m/target_speed_mps/stop_latched. scenario_patch는 {"corridor":{"width_m":1.2}}처럼 중첩 객체로, variant_patches는 {"A":{"target_speed_mps":0.3},"B":{}}처럼 쓴다. 그 외 요청은 반영하지 말고 out_of_scope에 이유와 함께 적는다.
3. 제외 범위(적재·상하차, 작업자 추종·동적 장애물, 토경 고랑 주행, 작물 인식·수확, 실물 안전·성능 인증)에 해당하는 요청은 반영하지 않고 out_of_scope에 적는다.
4. requirements(판정 기준)를 바꾸면 rationale 첫 항목을 "판정 기준 변경: …"으로 시작한다.
5. 고령 작업자·사람·작업 동선이 언급되면 worker_zone을 채운다: {"x_min_m","x_max_m","y_min_m","y_max_m","rule":"STOP_ON_ENTRY","note"}. 좌표계는 ENU, 통로 x 0~8m, y −0.5~0.5m. 위치가 불명확하면 로봇 출발점과 장애물(x 2.2~3.0m) 사이에서 보수적으로 잡고 questions에 정확한 위치를 묻는다. note에 "시나리오 입력이며 사람 모델·동적 장애물 물리는 현재 미구현"을 쓴다. 현재 worker_zone이 이미 있으면 그대로 다시 적거나 null로 두어 유지한다.
6. 합격/불합격을 판정하지 않는다. 결과를 말할 때는 제공된 기록의 status·reason과 metrics 숫자만 그대로 인용한다.
7. 단위는 m, m/s, s. 모르는 값은 추정하지 말고 questions에 적는다. 수치를 지어내지 않는다.
8. 스티어링(참가자 개입)이 있으면 최신 것을 우선 반영하고 summary에 "〈이름〉(역할)의 개입 반영"을 명시한다.
9. 재실행이 필요하면 rerun_from_run_id에 제공된 run id 중 하나를 고른다(기본: 설정 B의 01 회차).
10. 변경이 필요 없으면 scenario_patch와 variant_patches를 비우고 summary에 그 이유를 쓴다.`;

export const REVIEWER_SYSTEM = `당신은 FarmTwin Live의 검수 에이전트다. 설계 에이전트의 초안이 범위·스키마·단위 규칙을 지켰는지만 점검한다. 시험의 합격/불합격은 판정하지 않는다.
점검: (1) 허용 키 외 변경 → SCHEMA/block (2) 제외 범위 반영 → OUT_OF_SCOPE/block (3) 수치 범위 이탈(통로 폭 0.6~2.0m, 정지 임계값 0.1~2.0m, 속도 0.1~1.0m/s, worker_zone이 통로 밖) → UNIT/warn (4) requirements 변경 → THRESHOLD_CHANGED/warn (5) 요청·스티어링에 고령 작업자·사람·동선이 있는데 worker_zone이 null → WORKER_ZONE_MISSING/block (6) worker_zone은 있는데 rule이 STOP_ON_ENTRY가 아님 → WORKER_ZONE_RULE_MISSING/block
출력은 JSON 객체 하나(설명 문장·코드펜스 금지): {"verdict":"OK"|"NEEDS_CHANGE","findings":[{"code","severity","message"}],"worker_zone_present":boolean,"summary":string}`;

export const EXPLAINER_SYSTEM = `당신은 FarmTwin Live의 설명 에이전트다. 제공된 evaluation과 metrics만으로 결과를 한국어로 설명한다. 판정을 바꾸거나 추가 해석을 덧붙이지 않는다. 숫자는 소수 셋째 자리까지, 단위 포함.
출력은 JSON 객체 하나(설명 문장·코드펜스 금지): {"headline": string(80자 이내), "bullets": string[](최대 5개), "quoted": {"status": string, "reason": string, "reasons": string[]}}`;

export const PING_SYSTEM = "연결 확인용 호출이다. OK 두 글자만 답한다.";

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
    ? p.steers
        .map((s) => `- ${s.isNew ? "[새 개입] " : ""}${s.name}(${s.role ? ROLE_LABEL[s.role] : "참가자"}) ${s.time}: ${s.text}`)
        .join("\n")
    : "- (없음)";
  return [
    `[현재 시나리오] ${JSON.stringify(p.scenario)}`,
    `[현재 설정] A=${JSON.stringify(p.variants.A)} B=${JSON.stringify(p.variants.B)}`,
    `[현재 worker_zone] ${p.workerZone ? JSON.stringify(p.workerZone) : "null"}`,
    seed
      ? `[최근 실제 기록 요약 · 2026-11-01 batch] A: ${seed.A.fail}/${seed.A.count} FAIL, 최소 앞면 간격 평균 ${fmt(seed.A.meanMinFrontGapM)}m · B: ${seed.B.pass}/${seed.B.count} PASS, 평균 ${fmt(seed.B.meanMinFrontGapM)}m · 기준 ≥${p.scenario.requirements.min_front_gap_m.toFixed(2)}m`
      : "[최근 실제 기록 요약] (없음)",
    `[사용 가능한 run id] ${runIds.join(", ") || "(없음)"}`,
    `[스티어링 · 오래된 것부터]\n${steers}`,
    `[요청] ${p.requestText ?? "(요청 없음 — 스티어링을 기준으로 초안을 만든다)"}`,
    "JSON만 출력.",
  ].join("\n");
}

export function buildReviewPrompt(p: { draftJson: unknown; requestText: string | null; steers: SteerLine[] }): string {
  return [
    `[요청] ${p.requestText ?? "(없음)"}`,
    `[스티어링]\n${p.steers.map((s) => `- ${s.name}: ${s.text}`).join("\n") || "- (없음)"}`,
    `[설계 에이전트 초안] ${JSON.stringify(p.draftJson)}`,
    "JSON만 출력.",
  ].join("\n");
}

export function buildExplainPrompt(p: { runId: string; digest: RunDigest; minFrontGap: number }): string {
  return [
    `[run] ${p.runId} (설정 ${p.digest.variantId})`,
    `[evaluation] ${JSON.stringify({ status: p.digest.status, reasonCode: p.digest.reasonCode, reason: p.digest.reason })}`,
    `[metrics] ${JSON.stringify(p.digest.metrics)}`,
    `[판정 기준] 최소 앞면 간격 ≥ ${p.minFrontGap.toFixed(2)} m (내부 비교 기준, 인증값 아님)`,
    "JSON만 출력.",
  ].join("\n");
}

export const retrySuffix = (error: string) =>
  `\n\n[이전 응답 오류] ${error.slice(0, 300)}\n스키마에 맞는 JSON 객체 하나만 다시 출력한다.`;

/** 설명 캐시가 비었을 때 ③게이트가 보여줄 원문 */
export function fallbackExplain(d: RunDigest): ExplainT {
  return {
    headline: `설정 ${d.variantId} ${d.status} — 최소 앞면 간격 ${d.metrics.minFrontGapM.toFixed(3)} m`,
    bullets: [d.reason],
    quoted: { status: d.status, reason: d.reason, reasons: [] },
  };
}
