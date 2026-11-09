"use client";

import { useMemo, useState } from "react";
import { GATE_TITLE, ROLE_LABEL, RUN_A01, RUN_B01, SEED_BASE } from "@/lib/constants";
import { fmtM, fmtValue, timeHMS } from "@/lib/format";
import { fallbackExplain } from "@/lib/prompts";
import { foldCommand, runLabel } from "@/lib/seed";
import { shortHash } from "@/lib/sha";
import { getBrowserSupabase } from "@/lib/supabase";
import type { Change, GateRow, ParticipantRow, SessionRow } from "@/lib/types";
import type { PresenceMeta } from "@/lib/useSession";
import { DraftDetails, ReviewDetails } from "./DraftDetails";

interface Props {
  session: SessionRow;
  gates: GateRow[];
  participants: ParticipantRow[];
  online: Record<string, PresenceMeta>;
  me: ParticipantRow;
  isOwner: boolean;
  isDesktop: boolean;
  toast: (msg: string, tone?: "info" | "ok" | "warn" | "error") => void;
  refresh: () => void;
}

type DecideResult = { ok: boolean; reason?: string; next?: string };

export default function GatePanel({ session, gates, participants, online, me, isOwner, isDesktop, toast, refresh }: Props) {
  const pending = gates.find((g) => g.status === "pending") ?? null;
  const history = useMemo(() => gates.filter((g) => g.status !== "pending").slice().reverse().slice(0, 6), [gates]);
  const byId = useMemo(() => new Map(participants.map((p) => [p.id, p])), [participants]);

  return (
    <div className="flex flex-col gap-3">
      {pending ? (
        <PendingGate
          key={pending.id}
          gate={pending}
          session={session}
          participants={participants}
          online={online}
          me={me}
          isOwner={isOwner}
          isDesktop={isDesktop}
          toast={toast}
          refresh={refresh}
        />
      ) : (
        <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
          {session.state === "bundled"
            ? "세 게이트를 모두 통과했습니다. 상단의 Evidence Bundle로 증거를 내려받으세요."
            : session.state === "awaiting_run"
              ? "로컬 러너가 Webots로 재실행하는 중입니다. 끝나면 ③ 검수 게이트가 열립니다."
              : "열린 게이트가 없습니다. 초안이 나오면 ① 시나리오 승인이 모든 화면에 동시에 뜹니다."}
        </div>
      )}

      {history.length ? (
        <div className="flex flex-col gap-1">
          <h3 className="text-xs font-semibold text-slate-500">지난 결정</h3>
          {history.map((g) => {
            const who = g.decided_by ? byId.get(g.decided_by) : null;
            const superseded = g.decision_comment === "superseded";
            return (
              <div key={g.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-1.5 text-xs">
                <span className="font-semibold text-slate-700">{GATE_TITLE[g.kind]}</span>
                <span
                  className={`rounded px-1.5 py-0.5 font-bold ${
                    superseded ? "bg-slate-200 text-slate-600" : g.status === "approved" ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-700"
                  }`}
                >
                  {superseded ? "대체됨" : g.status === "approved" ? "승인" : "반려"}
                </span>
                {g.override ? <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-900">대리·지적 확인</span> : null}
                {who ? (
                  <span className="text-slate-600">
                    {who.name}({ROLE_LABEL[who.role]})
                  </span>
                ) : null}
                {g.decision_comment && !superseded ? <span className="text-slate-500">“{g.decision_comment}”</span> : null}
                {g.decided_at ? <span className="ml-auto tabular-nums text-slate-400">{timeHMS(g.decided_at)}</span> : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function PendingGate({
  gate,
  session,
  participants,
  online,
  me,
  isOwner,
  isDesktop,
  toast,
  refresh,
}: Omit<Props, "gates"> & { gate: GateRow }) {
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const p = gate.payload ?? {};
  const canAct = me.role === gate.required_role;
  const roleOnline = participants.filter((x) => x.role === gate.required_role && online[x.id]).length;
  const hasBlock = gate.kind === "scenario" && Boolean(p.review?.findings?.some((f) => f.severity === "block"));
  const canProxy = !canAct && isOwner && roleOnline === 0;

  const decide = async (decision: "approved" | "rejected", override = false) => {
    if ((decision === "rejected" || override) && !comment.trim()) {
      toast(decision === "rejected" ? "반려 사유를 적어 주세요 — 그대로 개입이 되어 에이전트에게 전달됩니다" : "대리·지적 확인 승인은 코멘트가 필요합니다", "warn");
      return;
    }
    setBusy(true);
    const { data, error } = await getBrowserSupabase().rpc("decide_gate", {
      p_gate_id: gate.id,
      p_participant_id: me.id,
      p_decision: decision,
      p_comment: comment.trim() || null,
      p_override: override,
    });
    setBusy(false);
    const r = data as DecideResult | null;
    if (error) toast(`처리 실패: ${error.message}`, "error");
    else if (!r?.ok) toast(r?.reason === "already_decided" ? "이미 처리된 게이트입니다" : `처리 실패: ${r?.reason}`, "warn");
    else toast(decision === "approved" ? `${GATE_TITLE[gate.kind]} 완료` : "반려했습니다 — 코멘트가 개입으로 전달됩니다", "ok");
    setComment("");
    refresh();
  };

  return (
    <section className="overflow-hidden rounded-xl border-2 border-emerald-600 bg-white shadow-sm" aria-live="polite">
      <div className="flex flex-wrap items-center gap-2 bg-emerald-700 px-4 py-2 text-white">
        <h2 className="text-base font-bold">{GATE_TITLE[gate.kind]}</h2>
        <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs">
          {ROLE_LABEL[gate.required_role]} 승인 대기 · 온라인 {roleOnline}명
        </span>
        <span className="ml-auto text-xs tabular-nums opacity-80">{timeHMS(gate.created_at)}</span>
      </div>

      <div className="flex flex-col gap-3 p-4">
        {gate.kind === "scenario" ? <ScenarioBody gate={gate} /> : null}
        {gate.kind === "run" ? <RunBody gate={gate} /> : null}
        {gate.kind === "review" ? <ReviewBody gate={gate} session={session} isDesktop={isDesktop} /> : null}
      </div>

      <div className="sticky bottom-0 flex flex-col gap-2 border-t border-slate-200 bg-white p-3 md:static">
        <input
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder={canAct ? "코멘트(반려 시 필수 — 개입으로 전달)" : "코멘트"}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none"
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || !canAct || hasBlock}
            onClick={() => decide("approved")}
            className="min-h-12 flex-1 rounded-lg bg-emerald-700 px-4 text-base font-bold text-white hover:bg-emerald-800 disabled:bg-slate-300"
          >
            승인
          </button>
          <button
            type="button"
            disabled={busy || !canAct}
            onClick={() => decide("rejected")}
            className="min-h-12 rounded-lg border border-red-300 px-4 text-base font-semibold text-red-700 hover:bg-red-50 disabled:opacity-40"
          >
            반려
          </button>
        </div>
        {hasBlock && me.role === "safety" ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => decide("approved", true)}
            className="min-h-11 rounded-lg border border-amber-400 bg-amber-50 px-4 text-sm font-semibold text-amber-900"
          >
            검수 지적 확인하고 승인(코멘트 필수)
          </button>
        ) : null}
        {canProxy ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => decide("approved", true)}
            className="min-h-11 rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            {ROLE_LABEL[gate.required_role]} 부재 — 소유자 대리 승인(코멘트 필수)
          </button>
        ) : null}
        {!canAct && !canProxy ? (
          <p className="text-xs text-slate-500">{ROLE_LABEL[gate.required_role]}만 결정할 수 있습니다. 결정은 모든 화면에 동시에 반영됩니다.</p>
        ) : null}
        {hasBlock && me.role !== "safety" ? <p className="text-xs text-red-700">검수 에이전트가 차단(block) 지적을 남겼습니다. 안전담당만 확인 후 승인할 수 있습니다.</p> : null}
      </div>
    </section>
  );
}

function ScenarioBody({ gate }: { gate: GateRow }) {
  const p = gate.payload;
  return (
    <>
      {p.threshold_changed ? (
        <div className="rounded-md bg-violet-100 px-3 py-1.5 text-xs font-semibold text-violet-900">판정 기준 변경 포함 — 안전담당 확인 필요</div>
      ) : null}
      {p.draft ? <DraftDetails draft={p.draft} changes={(p.changes as Change[]) ?? []} /> : null}
      {p.after?.worker_zone ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <b>고령 작업자 구역</b> · {fmtValue(p.after.worker_zone)} · 진입 시 정지(STOP_ON_ENTRY)
          <div className="opacity-80">시나리오 입력이며 사람 모델·동적 장애물 물리는 현재 미구현</div>
        </div>
      ) : null}
      {p.review ? <ReviewDetails review={p.review} /> : null}
      <div className="text-[11px] text-slate-500">
        초안 {p.provider}/{p.model} · 입력 해시 {shortHash(p.input_sha256)} · 재실행 후보 {p.from_run_id ? runLabel(p.from_run_id) : "—"}
      </div>
    </>
  );
}

function RunBody({ gate }: { gate: GateRow }) {
  const p = gate.payload;
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="text-slate-700">승인하면 로컬 러너에 Webots 재실행을 요청합니다. 러너가 없으면 2026-11-01 실제 기록으로 ③ 검수를 진행합니다.</p>
      <code className="block break-all rounded-lg bg-slate-900 px-3 py-2 text-xs text-emerald-200">{foldCommand(p.command)}</code>
      <div className="text-[11px] text-slate-500">
        입력 해시 {shortHash(p.input_sha256)} · 회차 {p.from_run_id ? runLabel(p.from_run_id) : "—"}
      </div>
    </div>
  );
}

function ReviewBody({ gate, session, isDesktop }: { gate: GateRow; session: SessionRow; isDesktop: boolean }) {
  const p = gate.payload;
  const runId = p.run_id ?? "";
  const digest = p.digest ?? session.seed_summary?.runs[runId];
  const explain = p.explain ?? session.explain_cache?.[runId] ?? (digest ? fallbackExplain(digest) : null);
  const pass = digest?.status === "PASS";
  return (
    <div className="flex flex-col gap-2 text-sm">
      {p.notice ? <div className="rounded-lg bg-amber-100 px-3 py-2 text-xs font-semibold text-amber-950">{p.notice}</div> : null}
      {p.source === "rerun" ? (
        <div className="rounded-lg bg-sky-100 px-3 py-2 text-xs font-semibold text-sky-950">
          로컬 러너가 {p.from_run_id ? runLabel(p.from_run_id) : "보관 입력"}을 Webots로 방금 재실행한 결과입니다(보관 입력 그대로 · 새 시나리오 실행 아님).
        </div>
      ) : null}
      {digest ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded px-2 py-0.5 text-sm font-bold ${pass ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-700"}`}>{digest.status}</span>
          <span className="font-semibold text-slate-800">
            {runLabel(runId)} · 최소 앞면 간격 {fmtM(digest.metrics.minFrontGapM)}
          </span>
          <span className="text-xs text-slate-500">기준 ≥ {fmtM(session.scenario.requirements.min_front_gap_m, 2)} · 판정: evaluate.py</span>
        </div>
      ) : null}
      {explain ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <p className="font-semibold text-slate-900">{explain.headline}</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-slate-700">
            {explain.bullets.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
          <p className="mt-1 text-[11px] text-slate-500">원문 판정: {explain.quoted.status} · {explain.quoted.reason}</p>
        </div>
      ) : null}
      {digest ? (
        <div className="grid grid-cols-2 gap-1 text-xs text-slate-600 sm:grid-cols-4">
          <span>정지 {digest.metrics.stopped ? "예" : "아니오"}</span>
          <span>정지까지 {digest.metrics.stopTimeS.toFixed(2)} s</span>
          <span>정지 후 이동 {fmtM(digest.metrics.afterStopTravelM)}</span>
          <span>진행 {fmtM(digest.metrics.progressM)}</span>
        </div>
      ) : null}
      {isDesktop && (runId === RUN_A01 || runId === RUN_B01) ? (
        <a className="text-xs text-emerald-700 underline" href={`${SEED_BASE}/${runId}/scene.png`} target="_blank" rel="noreferrer">
          Webots 기록 장면 열기
        </a>
      ) : null}
    </div>
  );
}
