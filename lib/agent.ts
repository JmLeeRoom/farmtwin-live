import { RUN_B01 } from "./constants";
import { UniqueViolation, type AgentDb } from "./db";
import { applyDraft, diffState, sanitizeScenarioPatch, sanitizeVariantPatch, thresholdChanged } from "./patch";
import {
  DRAFTER_SYSTEM,
  EXPLAINER_SYSTEM,
  REVIEWER_SYSTEM,
  buildDraftPrompt,
  buildExplainPrompt,
  buildReviewPrompt,
  type SteerLine,
} from "./prompts";
import { AllProvidersFailed, runStructured, type CallFn, type ProviderEntry } from "./providers";
import { Draft, Explain, Review, type ReviewOut } from "./schemas";
import { canonical, sha256Hex } from "./sha";
import type { DraftView, EventRow, ExplainT, ParticipantRow, Role, ScenarioState } from "./types";

export interface AgentDeps {
  db: AgentDb;
  drafters: ProviderEntry[];
  reviewers: ProviderEntry[];
  maxSteps: number;
  timeoutMs: number;
  callFn?: CallFn;
}

export interface AgentResult {
  status: number;
  body: Record<string, unknown>;
}

const DRAFTABLE = new Set(["drafting", "gate_scenario"]);

export function pickRunId(requested: string | null, runIds: string[]): { id: string; note: string | null } {
  if (requested && runIds.includes(requested)) return { id: requested, note: null };
  if (requested) {
    const prefix = runIds.find((r) => r.startsWith(requested));
    if (prefix) return { id: prefix, note: null };
  }
  const variant = requested?.match(/run-([AB])-/)?.[1] ?? "B";
  const id =
    runIds.find((r) => r.startsWith(`run-${variant}-01-`)) ?? runIds.find((r) => r.startsWith("run-B-01-")) ?? runIds[0] ?? RUN_B01;
  return { id, note: requested ? `요청한 run id 없음(${requested}) → ${id.slice(0, 9)} 회차` : null };
}

function steerLines(steers: EventRow[], participants: ParticipantRow[], consumedUpTo: number): SteerLine[] {
  const byId = new Map(participants.map((p) => [p.id, p]));
  return steers.map((e) => {
    const p = e.actor_id ? byId.get(e.actor_id) : undefined;
    const time = new Date(e.created_at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul" });
    return {
      name: p?.name ?? String(e.payload?.name ?? "참가자"),
      role: (p?.role ?? (e.payload?.role as Role | undefined)) ?? null,
      time,
      text: String(e.payload?.text ?? ""),
      isNew: e.id > consumedUpTo,
    };
  });
}

export async function runDraft(deps: AgentDeps, input: { sessionId: string; trigger: "request" | "steer" | "reject" }): Promise<AgentResult> {
  const { db } = deps;
  const { sessionId, trigger } = input;
  if (!(await db.acquireLock(sessionId))) return { status: 409, body: { ok: false, reason: "busy" } };
  const started = Date.now();
  try {
    const s = await db.getSession(sessionId);
    if (!s) return { status: 404, body: { ok: false, reason: "not_found" } };
    if (!DRAFTABLE.has(s.state)) return { status: 409, body: { ok: false, reason: "state", state: s.state } };
    if ((await db.countAgentSteps(sessionId)) >= deps.maxSteps) return { status: 429, body: { ok: false, reason: "max_steps" } };

    const inputs = await db.listInputEvents(sessionId, s.last_steer_consumed_id ?? 0);
    if (trigger !== "request" && inputs.length === 0) return { status: 200, body: { ok: true, skipped: "no_new_input" } };
    const latestRequest = await db.latestRequest(sessionId);
    const participants = await db.listParticipants(sessionId);
    const recent = await db.listRecentSteers(sessionId, 8);
    const steers = steerLines(recent, participants, s.last_steer_consumed_id ?? 0);
    const requestText = latestRequest ? String(latestRequest.payload?.text ?? "") : null;
    const consumedIds = inputs.map((e) => e.id);

    await db.insertEvent(sessionId, { type: "agent_started", actor_kind: "agent", actor_id: "drafter", payload: { trigger, input_ids: consumedIds } });

    if (deps.drafters.length === 0) {
      await db.insertEvent(sessionId, { type: "agent_failed", actor_kind: "system", actor_id: "system", payload: { errors: [{ label: "config", message: "설정된 LLM 제공자가 없습니다(.env)" }] } });
      return { status: 502, body: { ok: false, reason: "no_provider" } };
    }

    const prompt = buildDraftPrompt({
      scenario: s.scenario,
      variants: s.variants,
      workerZone: s.worker_zone,
      seed: s.seed_summary,
      requestText,
      steers,
    });

    let res;
    try {
      res = await runStructured({
        entries: deps.drafters,
        instructions: DRAFTER_SYSTEM,
        prompt,
        schema: Draft,
        timeoutMs: deps.timeoutMs,
        maxOutputTokens: 1500,
        budgetMs: 40000,
        callFn: deps.callFn,
      });
    } catch (err) {
      const errors = err instanceof AllProvidersFailed ? err.errors : [{ label: "unknown", message: String(err) }];
      await db.insertEvent(sessionId, { type: "agent_failed", actor_kind: "system", actor_id: "system", payload: { errors } });
      return { status: 502, body: { ok: false, reason: "agent_failed", errors } };
    }

    const d = res.value;
    const sp = sanitizeScenarioPatch(d.scenario_patch);
    const va = sanitizeVariantPatch(d.variant_patches.A, "A");
    const vb = sanitizeVariantPatch(d.variant_patches.B, "B");
    const before: ScenarioState = { scenario: s.scenario, variants: s.variants, worker_zone: s.worker_zone ?? null };
    const after = applyDraft(before, {
      scenarioPatch: sp.patch,
      variantPatches: { A: va.patch, B: vb.patch },
      workerZone: d.worker_zone,
    });
    const changes = diffState(before, after);
    const threshold = thresholdChanged(changes);
    const run = pickRunId(d.rerun_from_run_id, s.seed_summary?.runIds ?? []);
    const draft: DraftView = {
      summary: d.summary,
      rationale: run.note ? [...d.rationale, run.note] : d.rationale,
      out_of_scope: [...d.out_of_scope, ...sp.removed, ...va.removed, ...vb.removed],
      questions: d.questions,
      worker_zone: d.worker_zone,
      scenario_patch: sp.patch,
      variant_patches: { A: va.patch, B: vb.patch },
    };
    // 변경 없는 개입은 열려 있는 ①을 그대로 둔다. 열린 ①이 없으면(반려 직후 등) 같은 내용이라도 ①을 다시 열어 흐름이 멈추지 않게 한다.
    const noChange = changes.length === 0 && trigger !== "request" && s.state === "gate_scenario";
    const actor = `drafter:${res.entry.label}/${res.entry.modelId}`;

    const step = await db.insertAgentStep(sessionId, {
      role: "drafter",
      provider: res.entry.provider,
      model_id: res.entry.modelId,
      fallback_used: res.fallbackUsed,
      prompt_sha256: sha256Hex(DRAFTER_SYSTEM + "\n\n" + res.promptUsed),
      response_sha256: sha256Hex(res.raw),
      input_tokens: res.inputTokens,
      output_tokens: res.outputTokens,
      latency_ms: res.latencyMs,
      output: draft,
    });
    await db.insertEvent(sessionId, {
      type: "agent_step",
      actor_kind: "agent",
      actor_id: actor,
      payload: {
        step_id: step.id,
        draft,
        changes,
        threshold_changed: threshold,
        no_change: noChange,
        consumed_ids: consumedIds,
        provider: res.entry.provider,
        model: res.entry.modelId,
        fallback_used: res.fallbackUsed,
        latency_ms: res.latencyMs,
      },
    });
    if (res.fallbackUsed) {
      await db.insertEvent(sessionId, {
        type: "provider_switch",
        actor_kind: "system",
        actor_id: "system",
        payload: { from: res.errors[0]?.label ?? "?", to: res.entry.label, errors: res.errors },
      });
    }
    if (consumedIds.length) await db.updateSession(sessionId, { last_steer_consumed_id: Math.max(...consumedIds) });

    let review: ReviewOut | null = null;
    if (deps.reviewers.length && Date.now() - started < 42000) {
      try {
        const rv = await runStructured({
          entries: deps.reviewers,
          instructions: REVIEWER_SYSTEM,
          prompt: buildReviewPrompt({ draftJson: { ...draft, after }, requestText, steers }),
          schema: Review,
          timeoutMs: deps.timeoutMs,
          maxOutputTokens: 800,
          budgetMs: 15000,
          callFn: deps.callFn,
        });
        review = rv.value;
        const rstep = await db.insertAgentStep(sessionId, {
          role: "reviewer",
          provider: rv.entry.provider,
          model_id: rv.entry.modelId,
          fallback_used: rv.fallbackUsed,
          prompt_sha256: sha256Hex(REVIEWER_SYSTEM + "\n\n" + rv.promptUsed),
          response_sha256: sha256Hex(rv.raw),
          input_tokens: rv.inputTokens,
          output_tokens: rv.outputTokens,
          latency_ms: rv.latencyMs,
          output: review,
        });
        await db.insertEvent(sessionId, {
          type: "review_step",
          actor_kind: "agent",
          actor_id: `reviewer:${rv.entry.label}/${rv.entry.modelId}`,
          payload: { step_id: rstep.id, review, provider: rv.entry.provider, model: rv.entry.modelId },
        });
      } catch (err) {
        const errors = err instanceof AllProvidersFailed ? err.errors : [{ label: "reviewer", message: String(err) }];
        await db.insertEvent(sessionId, { type: "review_failed", actor_kind: "system", actor_id: "system", payload: { errors } });
      }
    }

    if (noChange) return { status: 200, body: { ok: true, no_change: true, questions: d.questions } };

    const fresh = await db.getSession(sessionId);
    if (!fresh || !DRAFTABLE.has(fresh.state)) {
      await db.insertEvent(sessionId, { type: "draft_discarded", actor_kind: "system", actor_id: "system", payload: { reason: "그사이 다음 단계로 넘어갔습니다", state: fresh?.state } });
      return { status: 409, body: { ok: false, reason: "state_changed" } };
    }

    for (const g of await db.supersedePendingScenarioGates(sessionId)) {
      await db.insertEvent(sessionId, { type: "gate_superseded", actor_kind: "system", actor_id: "system", payload: { gate_id: g.id } });
    }
    const requiredRole: Role = after.worker_zone || threshold ? "safety" : "developer";
    let gate;
    try {
      gate = await db.insertGate(sessionId, {
        kind: "scenario",
        required_role: requiredRole,
        payload: {
          draft,
          review,
          before,
          after,
          changes,
          threshold_changed: threshold,
          from_run_id: run.id,
          command: s.seed_summary?.runs[run.id]?.rerunCommand ?? `python -m farmtwin rerun --from-run ${run.id}`,
          input_sha256: sha256Hex(canonical(after)),
          provider: res.entry.provider,
          model: res.entry.modelId,
        },
      });
    } catch (err) {
      if (err instanceof UniqueViolation) {
        await db.insertEvent(sessionId, { type: "draft_discarded", actor_kind: "system", actor_id: "system", payload: { reason: "다른 게이트가 진행 중입니다" } });
        return { status: 409, body: { ok: false, reason: "pending_gate_exists" } };
      }
      throw err;
    }
    await db.updateSession(sessionId, { state: "gate_scenario" });
    await db.insertEvent(sessionId, {
      type: "gate_opened",
      actor_kind: "system",
      actor_id: "system",
      payload: { gate_id: gate.id, kind: "scenario", required_role: requiredRole },
    });
    return { status: 200, body: { ok: true, gate_id: gate.id, required_role: requiredRole } };
  } finally {
    await db.releaseLock(sessionId);
  }
}

export async function runExplain(deps: AgentDeps, input: { sessionId: string; runIds: string[] }): Promise<AgentResult> {
  const { db } = deps;
  const s = await db.getSession(input.sessionId);
  if (!s) return { status: 404, body: { ok: false, reason: "not_found" } };
  const seed = s.seed_summary;
  if (!seed) return { status: 400, body: { ok: false, reason: "no_seed" } };
  const todo = input.runIds.filter((id) => seed.runs[id] && !s.explain_cache?.[id]);
  if (!todo.length) return { status: 200, body: { ok: true, skipped: "cached" } };
  if (!deps.drafters.length) return { status: 200, body: { ok: false, skipped: "no_provider" } };

  const results: Record<string, ExplainT> = {};
  const errors: Array<{ label: string; message: string }> = [];
  let last: { provider: string; model: string } | null = null;
  for (const runId of todo) {
    try {
      const r = await runStructured({
        entries: deps.drafters,
        instructions: EXPLAINER_SYSTEM,
        prompt: buildExplainPrompt({ runId, digest: seed.runs[runId], minFrontGap: s.scenario.requirements.min_front_gap_m }),
        schema: Explain,
        timeoutMs: deps.timeoutMs,
        maxOutputTokens: 600,
        budgetMs: 25000,
        callFn: deps.callFn,
      });
      results[runId] = r.value;
      last = { provider: r.entry.provider, model: r.entry.modelId };
      await db.insertAgentStep(input.sessionId, {
        role: "explainer",
        provider: r.entry.provider,
        model_id: r.entry.modelId,
        fallback_used: r.fallbackUsed,
        prompt_sha256: sha256Hex(EXPLAINER_SYSTEM + "\n\n" + r.promptUsed),
        response_sha256: sha256Hex(r.raw),
        input_tokens: r.inputTokens,
        output_tokens: r.outputTokens,
        latency_ms: r.latencyMs,
        output: { run_id: runId, ...r.value },
      });
    } catch (err) {
      errors.push(...(err instanceof AllProvidersFailed ? err.errors : [{ label: "explainer", message: String(err) }]));
    }
  }
  if (Object.keys(results).length) {
    const fresh = await db.getSession(input.sessionId);
    await db.updateSession(input.sessionId, { explain_cache: { ...(fresh?.explain_cache ?? {}), ...results } });
    await db.insertEvent(input.sessionId, {
      type: "explain_ready",
      actor_kind: "agent",
      actor_id: last ? `explainer:${last.provider}/${last.model}` : "explainer",
      payload: { run_ids: Object.keys(results), ...last },
    });
  }
  return { status: 200, body: { ok: errors.length === 0, explained: Object.keys(results), errors } };
}
