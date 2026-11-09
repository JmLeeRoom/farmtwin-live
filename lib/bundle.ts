import { EVALUATOR_VERSION, RUN_A01, RUN_B01 } from "./constants";
import { canonical, sha256Hex } from "./sha";
import type { AgentStepRow, EventRow, GateRow, ParticipantRow, RunRequestRow, SessionRow } from "./types";

export interface BundleInput {
  session: SessionRow;
  participants: ParticipantRow[];
  gates: GateRow[];
  agentSteps: AgentStepRow[];
  runRequests: RunRequestRow[];
  events: EventRow[];
  generatedAt: string;
}

/** Evidence Bundle: 실행 기록 참조 + 사람 승인 기록 + 모델 출처를 같은 해시 체계로. bundle_sha256은 그 키를 뺀 정규화 JSON의 해시. */
export function buildBundle(i: BundleInput) {
  const eventsThroughId = i.events.reduce((m, e) => Math.max(m, e.id), 0);
  const patches = i.agentSteps
    .filter((s) => s.role === "drafter")
    .map((s) => {
      const o = (s.output ?? {}) as Record<string, unknown>;
      return { step_id: s.id, scenario_patch: o.scenario_patch ?? {}, variant_patches: o.variant_patches ?? {}, worker_zone: o.worker_zone ?? null };
    });
  const runIds = Array.from(new Set([RUN_A01, RUN_B01, ...i.runRequests.map((r) => r.from_run_id)]));
  const body = {
    bundle_version: 1,
    generated_at: i.generatedAt,
    session: { id: i.session.id, title: i.session.title, state: i.session.state },
    seed: {
      batch_id: i.session.seed_summary?.batchId ?? null,
      source: "recorded",
      report_data_sha256: i.session.seed_summary?.reportDataSha256 ?? null,
    },
    scenario: {
      initial: i.session.seed_summary?.initial ?? null,
      final: { scenario: i.session.scenario, variants: i.session.variants },
      patches,
    },
    worker_zone: i.session.worker_zone ?? null,
    participants: i.participants,
    gates: [...i.gates].sort((a, b) => a.created_at.localeCompare(b.created_at)),
    agent_steps: [...i.agentSteps].sort((a, b) => a.created_at.localeCompare(b.created_at)),
    run_requests: i.runRequests,
    events: [...i.events].filter((e) => e.id <= eventsThroughId).sort((a, b) => a.id - b.id),
    evidence_refs: { run_ids: runIds, evaluator_version: EVALUATOR_VERSION },
    events_through_id: eventsThroughId,
    seed_summary: i.session.seed_summary,
  };
  return { ...body, bundle_sha256: sha256Hex(canonical(body)) };
}

export function verifyBundle(bundle: Record<string, unknown>): boolean {
  const { bundle_sha256, ...rest } = bundle;
  return sha256Hex(canonical(rest)) === bundle_sha256;
}
