"use client";

import { useMemo, useState } from "react";
import { GATE_TITLE, OFFLINE_NOTICE, ROLE_LABEL, RUN_A01, RUN_B01, SEED_BASE } from "@/lib/constants";
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
            ? "All three gates passed. Download the evidence with Evidence Bundle at the top."
            : session.state === "awaiting_run"
              ? "The local runner is re-running the trial in Webots. Gate ③ review opens when it finishes."
              : "No open gate. When a draft is ready, ① scenario approval appears on every screen at once."}
        </div>
      )}

      {history.length ? (
        <div className="flex flex-col gap-1">
          <h3 className="text-xs font-semibold text-slate-500">Past decisions</h3>
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
                  {superseded ? "Superseded" : g.status === "approved" ? "Approved" : "Rejected"}
                </span>
                {g.override ? <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-900">Proxy / findings acknowledged</span> : null}
                {who ? (
                  <span className="text-slate-600">
                    {who.name === ROLE_LABEL[who.role] ? who.name : `${who.name}(${ROLE_LABEL[who.role]})`}
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
      toast(decision === "rejected" ? "Write a reason for rejecting — it goes to the agent as a steer" : "A comment is required for a proxy or acknowledged approval", "warn");
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
    if (error) toast(`Failed: ${error.message}`, "error");
    else if (!r?.ok) toast(r?.reason === "already_decided" ? "This gate was already decided" : `Failed: ${r?.reason}`, "warn");
    else toast(decision === "approved" ? `${GATE_TITLE[gate.kind]} done` : "Rejected — your comment goes to the agent as a steer", "ok");
    setComment("");
    refresh();
  };

  return (
    <section className="overflow-hidden rounded-xl border-2 border-emerald-600 bg-white shadow-sm" aria-live="polite">
      <div className="flex flex-wrap items-center gap-2 bg-emerald-700 px-4 py-2 text-white">
        <h2 className="text-base font-bold">{GATE_TITLE[gate.kind]}</h2>
        <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs">
          Waiting for {ROLE_LABEL[gate.required_role]} · {roleOnline} online
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
          placeholder={canAct ? "Comment (required to reject)" : "Comment"}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none"
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || !canAct || hasBlock}
            onClick={() => decide("approved")}
            className="min-h-12 flex-1 rounded-lg bg-emerald-700 px-4 text-base font-bold text-white hover:bg-emerald-800 disabled:bg-slate-300"
          >
            Approve
          </button>
          <button
            type="button"
            disabled={busy || !canAct}
            onClick={() => decide("rejected")}
            className="min-h-12 rounded-lg border border-red-300 px-4 text-base font-semibold text-red-700 hover:bg-red-50 disabled:opacity-40"
          >
            Reject
          </button>
        </div>
        {hasBlock && me.role === "safety" ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => decide("approved", true)}
            className="min-h-11 rounded-lg border border-amber-400 bg-amber-50 px-4 text-sm font-semibold text-amber-900"
          >
            Acknowledge review findings and approve (comment required)
          </button>
        ) : null}
        {canProxy ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => decide("approved", true)}
            className="min-h-11 rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            No {ROLE_LABEL[gate.required_role]} online — approve as owner (comment required)
          </button>
        ) : null}
        {!canAct && !canProxy ? (
          <p className="text-xs text-slate-500">Only the {ROLE_LABEL[gate.required_role]} can decide. Decisions show on every screen at once.</p>
        ) : null}
        {hasBlock && me.role !== "safety" ? <p className="text-xs text-red-700">The review agent left a blocking finding. Only the safety lead can acknowledge it and approve.</p> : null}
      </div>
    </section>
  );
}

function ScenarioBody({ gate }: { gate: GateRow }) {
  const p = gate.payload;
  return (
    <>
      {p.threshold_changed ? (
        <div className="rounded-md bg-violet-100 px-3 py-1.5 text-xs font-semibold text-violet-900">Includes a threshold change — needs the safety lead</div>
      ) : null}
      {p.draft ? <DraftDetails draft={p.draft} changes={(p.changes as Change[]) ?? []} /> : null}
      {p.after?.worker_zone ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <b>Elderly-worker zone</b> · {fmtValue(p.after.worker_zone)} · stop on entry (STOP_ON_ENTRY)
          <div className="opacity-80">A scenario input; human models and moving-obstacle physics are not implemented yet</div>
        </div>
      ) : null}
      {p.review ? <ReviewDetails review={p.review} /> : null}
      <div className="text-[11px] text-slate-500">
        Draft {p.provider}/{p.model} · input hash {shortHash(p.input_sha256)} · rerun candidate {p.from_run_id ? runLabel(p.from_run_id) : "—"}
      </div>
    </>
  );
}

function RunBody({ gate }: { gate: GateRow }) {
  const p = gate.payload;
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="text-slate-700">Approving asks the local runner to re-run the trial in Webots. With no runner online, ③ review uses the real 2026-11-01 records.</p>
      <code className="block break-all rounded-lg bg-slate-900 px-3 py-2 text-xs text-emerald-200">{foldCommand(p.command)}</code>
      <div className="text-[11px] text-slate-500">
        input hash {shortHash(p.input_sha256)} · run {p.from_run_id ? runLabel(p.from_run_id) : "—"}
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
  const notice = p.source === "recorded" ? OFFLINE_NOTICE : p.notice;
  return (
    <div className="flex flex-col gap-2 text-sm">
      {notice ? <div className="rounded-lg bg-amber-100 px-3 py-2 text-xs font-semibold text-amber-950">{notice}</div> : null}
      {p.source === "rerun" ? (
        <div className="rounded-lg bg-sky-100 px-3 py-2 text-xs font-semibold text-sky-950">
          Fresh result: the local runner just re-ran {p.from_run_id ? runLabel(p.from_run_id) : "the archived input"} in Webots (archived input as is · not a run of the new scenario).
        </div>
      ) : null}
      {digest ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded px-2 py-0.5 text-sm font-bold ${pass ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-700"}`}>{digest.status}</span>
          <span className="font-semibold text-slate-800">
            {runLabel(runId)} · min front gap {fmtM(digest.metrics.minFrontGapM)}
          </span>
          <span className="text-xs text-slate-500">threshold ≥ {fmtM(session.scenario.requirements.min_front_gap_m, 2)} · judged by evaluate.py</span>
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
          <p className="mt-1 text-[11px] text-slate-500">Recorded verdict: {explain.quoted.status} · {explain.quoted.reason}</p>
        </div>
      ) : null}
      {digest ? (
        <div className="grid grid-cols-2 gap-1 text-xs text-slate-600 sm:grid-cols-4">
          <span>Stopped {digest.metrics.stopped ? "yes" : "no"}</span>
          <span>Time to stop {digest.metrics.stopTimeS.toFixed(2)} s</span>
          <span>Travel after stop {fmtM(digest.metrics.afterStopTravelM)}</span>
          <span>Progress {fmtM(digest.metrics.progressM)}</span>
        </div>
      ) : null}
      {isDesktop && (runId === RUN_A01 || runId === RUN_B01) ? (
        <a className="text-xs text-emerald-700 underline" href={`${SEED_BASE}/${runId}/scene.png`} target="_blank" rel="noreferrer">
          Open the Webots scene image
        </a>
      ) : null}
    </div>
  );
}
