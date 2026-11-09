// 설계 에이전트 오케스트레이션: 락·대체·변경 없음·폴백·상태 검사 (메모리 DB + 가짜 LLM)
import { describe, expect, it } from "vitest";
import { pickRunId, runDraft, runExplain, type AgentDeps } from "./agent";
import { BASE_SCENARIO, RUN_A01, RUN_B01 } from "./constants";
import { UniqueViolation, type AgentDb, type NewAgentStep, type NewEvent, type NewGate } from "./db";
import type { CallFn, ProviderEntry } from "./providers";
import type { AgentStepRow, EventRow, GateRow, ParticipantRow, SessionRow } from "./types";

const SID = "11111111-1111-1111-1111-111111111111";

function memoryDb(init?: Partial<SessionRow>) {
  let evId = 0;
  const now = () => new Date().toISOString();
  const session: SessionRow = {
    id: SID,
    title: "t",
    seed_batch_id: "s",
    scenario: structuredClone(BASE_SCENARIO),
    variants: {
      A: { name: "늦은 정지", stop_sensor_distance_m: 0.3, target_speed_mps: 0.4, stop_latched: true },
      B: { name: "이른 정지", stop_sensor_distance_m: 0.8, target_speed_mps: 0.4, stop_latched: true },
    },
    worker_zone: null,
    owner_participant_id: "dev",
    state: "drafting",
    agent_busy: false,
    agent_busy_since: null,
    last_steer_consumed_id: 0,
    seed_summary: {
      batchId: "b",
      reportDataSha256: "h",
      A: { count: 5, pass: 0, fail: 5, meanMinFrontGapM: 0.2226 },
      B: { count: 5, pass: 5, fail: 0, meanMinFrontGapM: 0.7346 },
      runIds: [RUN_A01, RUN_B01],
      runs: {
        [RUN_A01]: { variantId: "A", status: "FAIL", reasonCode: "MIN_GAP_VIOLATION", reason: "r", metrics: { minFrontGapM: 0.2226, stopped: true, stopTimeS: 4.576, afterStopTravelM: 0.017, progressM: 1.727 }, rerunCommand: "cmd-a" },
        [RUN_B01]: { variantId: "B", status: "PASS", reasonCode: "REQUIREMENTS_MET", reason: "r", metrics: { minFrontGapM: 0.7346, stopped: true, stopTimeS: 3.296, afterStopTravelM: 0.017, progressM: 1.215 }, rerunCommand: "cmd-b" },
      },
      initial: { scenario: BASE_SCENARIO, variants: { A: { name: "A", stop_sensor_distance_m: 0.3, target_speed_mps: 0.4, stop_latched: true }, B: { name: "B", stop_sensor_distance_m: 0.8, target_speed_mps: 0.4, stop_latched: true } } },
    },
    explain_cache: {},
    created_at: now(),
    ...init,
  };
  const participants: ParticipantRow[] = [
    { id: "dev", session_id: SID, name: "재명", role: "developer", joined_at: now() },
    { id: "saf", session_id: SID, name: "어르신 담당", role: "safety", joined_at: now() },
  ];
  const events: EventRow[] = [];
  const gates: GateRow[] = [];
  const steps: AgentStepRow[] = [];
  const db: AgentDb = {
    async acquireLock() {
      if (session.agent_busy) return false;
      session.agent_busy = true;
      session.agent_busy_since = now();
      return true;
    },
    async releaseLock() {
      session.agent_busy = false;
    },
    async getSession() {
      return structuredClone(session);
    },
    async countAgentSteps() {
      return steps.length;
    },
    async listInputEvents(_id, after) {
      return events.filter((e) => (e.type === "request" || e.type === "steer") && e.id > after);
    },
    async listRecentSteers(_id, limit) {
      return events.filter((e) => e.type === "steer").slice(-limit);
    },
    async latestRequest() {
      return [...events].reverse().find((e) => e.type === "request") ?? null;
    },
    async listParticipants() {
      return participants;
    },
    async insertEvent(_id, e: NewEvent) {
      const row: EventRow = { id: ++evId, session_id: SID, type: e.type, actor_kind: e.actor_kind, actor_id: e.actor_id ?? null, payload: e.payload ?? {}, created_at: now() };
      events.push(row);
      return row;
    },
    async insertAgentStep(_id, s: NewAgentStep) {
      const row = { ...s, id: `step-${steps.length + 1}`, session_id: SID, created_at: now() } as AgentStepRow;
      steps.push(row);
      return row;
    },
    async updateSession(_id, patch) {
      Object.assign(session, patch);
    },
    async supersedePendingScenarioGates() {
      const out = gates.filter((g) => g.kind === "scenario" && g.status === "pending");
      for (const g of out) {
        g.status = "rejected";
        g.decision_comment = "superseded";
      }
      return out;
    },
    async insertGate(_id, g: NewGate) {
      if (gates.some((x) => x.status === "pending")) throw new UniqueViolation("pending");
      const row: GateRow = { id: `gate-${gates.length + 1}`, session_id: SID, kind: g.kind, required_role: g.required_role, status: "pending", payload: g.payload, decided_by: null, decision_comment: null, override: false, created_at: now(), decided_at: null };
      gates.push(row);
      return row;
    },
  };
  const human = (type: "request" | "steer", actor: "dev" | "saf", text: string) => db.insertEvent(SID, { type, actor_kind: "human", actor_id: actor, payload: { text } });
  return { db, session, events, gates, steps, human };
}

const entry = (label: ProviderEntry["label"]): ProviderEntry => ({ label, provider: label, modelId: `${label}-m`, model: `${label}-m` });

/** 프롬프트에 "어르신"이 있으면 worker_zone을 넣는 가짜 설계 에이전트 */
const fakeLLM =
  (opts: { failLabels?: string[]; reviewBlock?: boolean } = {}): CallFn =>
  async (e, instructions, prompt) => {
    if (opts.failLabels?.includes(e.label)) throw Object.assign(new Error("down"), { statusCode: 503 });
    if (instructions.includes("검수 에이전트")) {
      return {
        text: JSON.stringify({
          verdict: opts.reviewBlock ? "NEEDS_CHANGE" : "OK",
          findings: opts.reviewBlock ? [{ code: "WORKER_ZONE_MISSING", severity: "block", message: "구역 없음" }] : [],
          worker_zone_present: prompt.includes("x_min_m"),
          summary: "점검 완료",
        }),
        inputTokens: 1,
        outputTokens: 1,
      };
    }
    if (instructions.includes("설명 에이전트")) {
      return { text: JSON.stringify({ headline: "B PASS", bullets: ["b"], quoted: { status: "PASS", reason: "r", reasons: [] } }), inputTokens: 1, outputTokens: 1 };
    }
    const req = prompt.split("[요청]")[1] ?? "";
    const wantsZone = prompt.includes("어르신");
    const wantsSlow = req.includes("속도");
    const noop = prompt.includes("그대로");
    return {
      text: JSON.stringify({
        summary: wantsZone ? "어르신 담당(안전담당)의 개입 반영" : "초안",
        scenario_patch: {},
        variant_patches: { A: wantsSlow ? { target_speed_mps: 0.3 } : {}, B: noop ? {} : {} },
        worker_zone: wantsZone ? { x_min_m: 1.0, x_max_m: 2.0, y_min_m: -0.5, y_max_m: 0.5, rule: "STOP_ON_ENTRY" } : null,
        rationale: [],
        out_of_scope: [],
        questions: [],
        rerun_from_run_id: "run-B-01",
      }),
      inputTokens: 100,
      outputTokens: 50,
    };
  };

const deps = (db: AgentDb, callFn: CallFn, extra: Partial<AgentDeps> = {}): AgentDeps => ({
  db,
  drafters: [entry("codyssey"), entry("anthropic")],
  reviewers: [],
  maxSteps: 30,
  timeoutMs: 1000,
  callFn,
  ...extra,
});

describe("runDraft", () => {
  it("요청 → ① 개발자 게이트, 입력 소비, 락 해제", async () => {
    const m = memoryDb();
    await m.human("request", "dev", "3번 통로 정지 시험 A/B");
    const r = await runDraft(deps(m.db, fakeLLM()), { sessionId: SID, trigger: "request" });
    expect(r.status).toBe(200);
    expect(m.gates).toHaveLength(1);
    expect(m.gates[0].required_role).toBe("developer");
    expect(m.gates[0].payload.from_run_id).toBe(RUN_B01);
    expect(m.gates[0].payload.command).toBe("cmd-b");
    expect(m.session.state).toBe("gate_scenario");
    expect(m.session.last_steer_consumed_id).toBe(1);
    expect(m.session.agent_busy).toBe(false);
    expect(m.steps[0].provider).toBe("codyssey");
  });

  it("안전담당 개입 → 기존 ① 대체, worker_zone 포함 → safety 게이트", async () => {
    const m = memoryDb();
    await m.human("request", "dev", "3번 통로 정지 시험");
    await runDraft(deps(m.db, fakeLLM()), { sessionId: SID, trigger: "request" });
    await m.human("steer", "saf", "3번 통로는 어르신이 아침에 풀 뽑으러 나오신다");
    const r = await runDraft(deps(m.db, fakeLLM()), { sessionId: SID, trigger: "steer" });
    expect(r.status).toBe(200);
    expect(m.gates.map((g) => [g.status, g.decision_comment])).toEqual([
      ["rejected", "superseded"],
      ["pending", null],
    ]);
    expect(m.gates[1].required_role).toBe("safety");
    expect(m.gates[1].payload.after?.worker_zone?.x_min_m).toBe(1);
    expect(m.events.some((e) => e.type === "gate_superseded")).toBe(true);
  });

  it("새 입력 없이 steer 트리거 → skipped, LLM 호출 없음", async () => {
    const m = memoryDb();
    let called = 0;
    const r = await runDraft(deps(m.db, async () => { called++; return { text: "{}", inputTokens: null, outputTokens: null }; }), { sessionId: SID, trigger: "steer" });
    expect(r.body.skipped).toBe("no_new_input");
    expect(called).toBe(0);
  });

  it("변경 없는 개입 → 게이트를 열지 않는다", async () => {
    const m = memoryDb();
    await m.human("steer", "dev", "그대로 진행");
    const r = await runDraft(deps(m.db, fakeLLM()), { sessionId: SID, trigger: "steer" });
    expect(r.body.no_change).toBe(true);
    expect(m.gates).toHaveLength(0);
    expect(m.session.last_steer_consumed_id).toBe(1);
  });

  it("이미 실행 중이면 409 busy", async () => {
    const m = memoryDb({ agent_busy: true });
    await m.human("request", "dev", "x");
    const r = await runDraft(deps(m.db, fakeLLM()), { sessionId: SID, trigger: "request" });
    expect(r.status).toBe(409);
    expect(r.body.reason).toBe("busy");
  });

  it("② 이후 단계에서는 409 state", async () => {
    const m = memoryDb({ state: "gate_run" });
    await m.human("steer", "saf", "x");
    const r = await runDraft(deps(m.db, fakeLLM()), { sessionId: SID, trigger: "steer" });
    expect(r.status).toBe(409);
    expect(r.body.reason).toBe("state");
    expect(m.session.agent_busy).toBe(false);
  });

  it("호출 한도 초과 → 429", async () => {
    const m = memoryDb();
    await m.human("request", "dev", "x");
    const r = await runDraft(deps(m.db, fakeLLM(), { maxSteps: 0 }), { sessionId: SID, trigger: "request" });
    expect(r.status).toBe(429);
  });

  it("코디세이 실패 → 공식 API 폴백, provider_switch 이벤트", async () => {
    const m = memoryDb();
    await m.human("request", "dev", "x");
    const r = await runDraft(deps(m.db, fakeLLM({ failLabels: ["codyssey"] })), { sessionId: SID, trigger: "request" });
    expect(r.status).toBe(200);
    expect(m.steps[0].provider).toBe("anthropic");
    expect(m.steps[0].fallback_used).toBe(true);
    const sw = m.events.find((e) => e.type === "provider_switch");
    expect(sw?.payload.from).toBe("codyssey");
  });

  it("전부 실패 → 502, agent_failed, 입력은 소비하지 않음, 락 해제", async () => {
    const m = memoryDb();
    await m.human("request", "dev", "x");
    const r = await runDraft(deps(m.db, fakeLLM({ failLabels: ["codyssey", "anthropic"] })), { sessionId: SID, trigger: "request" });
    expect(r.status).toBe(502);
    expect(m.events.some((e) => e.type === "agent_failed")).toBe(true);
    expect(m.session.last_steer_consumed_id).toBe(0);
    expect(m.session.agent_busy).toBe(false);
  });

  it("검수 에이전트 결과가 게이트에 실린다(block 포함)", async () => {
    const m = memoryDb();
    await m.human("request", "dev", "x");
    const r = await runDraft(deps(m.db, fakeLLM({ reviewBlock: true }), { reviewers: [entry("gemini")] }), { sessionId: SID, trigger: "request" });
    expect(r.status).toBe(200);
    expect(m.gates[0].payload.review?.findings[0].severity).toBe("block");
    expect(m.steps.map((s) => s.role)).toEqual(["drafter", "reviewer"]);
  });

  it("검수 에이전트가 죽어도 초안은 진행(review_failed)", async () => {
    const m = memoryDb();
    await m.human("request", "dev", "x");
    const r = await runDraft(deps(m.db, fakeLLM({ failLabels: ["gemini"] }), { reviewers: [entry("gemini")] }), { sessionId: SID, trigger: "request" });
    expect(r.status).toBe(200);
    expect(m.gates[0].payload.review).toBeNull();
    expect(m.events.some((e) => e.type === "review_failed")).toBe(true);
  });

  it("허용 외 키·판정 기준 변경 → out_of_scope 사유, safety 게이트", async () => {
    const m = memoryDb();
    await m.human("request", "dev", "x");
    const call: CallFn = async () => ({
      text: JSON.stringify({ summary: "s", scenario_patch: { requirements: { min_front_gap_m: 0.1 }, robot_model: "Y" }, rerun_from_run_id: "nope" }),
      inputTokens: 1,
      outputTokens: 1,
    });
    await runDraft(deps(m.db, call), { sessionId: SID, trigger: "request" });
    const g = m.gates[0];
    expect(g.required_role).toBe("safety");
    expect(g.payload.threshold_changed).toBe(true);
    expect(g.payload.draft?.out_of_scope.join(" ")).toContain("robot_model");
    expect(g.payload.from_run_id).toBe(RUN_B01);
  });
});

describe("runExplain", () => {
  it("캐시에 없는 run만 설명하고 explain_cache에 합친다", async () => {
    const m = memoryDb({ explain_cache: { [RUN_A01]: { headline: "A", bullets: [], quoted: { status: "FAIL", reason: "r", reasons: [] } } } });
    const r = await runExplain(deps(m.db, fakeLLM()), { sessionId: SID, runIds: [RUN_A01, RUN_B01] });
    expect(r.body.explained).toEqual([RUN_B01]);
    expect(Object.keys(m.session.explain_cache).sort()).toEqual([RUN_A01, RUN_B01].sort());
    expect(m.steps[0].role).toBe("explainer");
  });
});

describe("pickRunId", () => {
  it("정확·접두사·변형 폴백", () => {
    const ids = [RUN_A01, RUN_B01];
    expect(pickRunId(RUN_A01, ids).id).toBe(RUN_A01);
    expect(pickRunId("run-A-01", ids).id).toBe(RUN_A01);
    expect(pickRunId("run-A-09-zzz", ids)).toEqual({ id: RUN_A01, note: expect.stringContaining("요청한 run id 없음") });
    expect(pickRunId(null, ids).id).toBe(RUN_B01);
  });
});
