"use client";

import { useEffect, useMemo, useRef } from "react";
import { timeHMS, whoOf } from "@/lib/format";
import type { Change, DraftView, EventRow, ParticipantRow, ReviewT, SessionRow } from "@/lib/types";
import { DraftDetails, ReviewDetails } from "./DraftDetails";

const SHOWN = new Set([
  "request",
  "steer",
  "agent_started",
  "agent_step",
  "review_step",
  "review_failed",
  "agent_failed",
  "provider_switch",
  "gate_superseded",
  "draft_discarded",
  "explain_ready",
]);

interface Props {
  session: SessionRow;
  events: EventRow[];
  participants: ParticipantRow[];
  onRetry: () => void;
}

export default function AgentTimeline({ session, events, participants, onRetry }: Props) {
  const byId = useMemo(() => new Map(participants.map((p) => [p.id, p])), [participants]);
  const items = useMemo(() => events.filter((e) => SHOWN.has(e.type)), [events]);
  const endRef = useRef<HTMLDivElement>(null);
  const busy = session.agent_busy && session.agent_busy_since !== null;
  const lastFailed = [...items].reverse().find((e) => e.type === "agent_failed" || e.type === "agent_step");

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [items.length, busy]);

  return (
    <div className="flex flex-col gap-3">
      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500">
          No request yet. When the owner submits a request or anyone sends a steer, the design agent writes a draft.
        </p>
      ) : null}
      {items.map((e) => (
        <TimelineItem key={e.id} e={e} who={whoOf(e, byId)} />
      ))}
      {busy ? (
        <div className="flex animate-pulse items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          <span className="h-2 w-2 rounded-full bg-emerald-500" /> Design agent is working…
        </div>
      ) : null}
      {!busy && lastFailed?.type === "agent_failed" ? (
        <button type="button" onClick={onRetry} className="self-start rounded-md border border-red-300 bg-red-50 px-3 py-1.5 text-sm font-semibold text-red-700 hover:bg-red-100">
          Retry agent
        </button>
      ) : null}
      <div ref={endRef} />
    </div>
  );
}

function TimelineItem({ e, who }: { e: EventRow; who: string }) {
  const p = e.payload ?? {};
  const time = timeHMS(e.created_at);
  if (e.type === "request" || e.type === "steer") {
    const isReq = e.type === "request";
    return (
      <div className={`rounded-xl px-3 py-2 ${isReq ? "border border-slate-200 bg-white" : "border border-amber-200 bg-amber-50"}`}>
        <div className="mb-0.5 flex items-center gap-2 text-xs text-slate-500">
          <span className="font-semibold text-slate-700">{who}</span>
          <span>{isReq ? "Request" : "Steer"}</span>
          <span className="ml-auto tabular-nums">{time}</span>
        </div>
        <p className="text-sm text-slate-900">{String(p.text ?? "")}</p>
      </div>
    );
  }
  if (e.type === "agent_step") {
    const draft = p.draft as DraftView | undefined;
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 px-3 py-2">
        <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span className="font-semibold text-emerald-800">{who}</span>
          <span>{p.no_change ? "No change" : "Draft"}</span>
          {p.fallback_used ? <span className="rounded bg-amber-100 px-1 text-amber-900">Fallback</span> : null}
          {typeof p.latency_ms === "number" ? <span>{(p.latency_ms / 1000).toFixed(1)} s</span> : null}
          <span className="ml-auto tabular-nums">{time}</span>
        </div>
        {draft ? <DraftDetails draft={draft} changes={(p.changes as Change[]) ?? []} compact /> : null}
      </div>
    );
  }
  if (e.type === "review_step" && p.review) {
    return <ReviewDetails review={p.review as ReviewT} />;
  }
  const tone =
    e.type === "agent_failed" || e.type === "draft_discarded"
      ? "border-red-200 bg-red-50 text-red-800"
      : e.type === "provider_switch" || e.type === "review_failed"
        ? "border-amber-200 bg-amber-50 text-amber-900"
        : "border-slate-200 bg-white text-slate-600";
  const text: Record<string, string> = {
    agent_started: "Design agent started drafting",
    review_failed: "Review agent did not respond → continuing with human review",
    agent_failed: `Agent did not respond · ${Array.isArray(p.errors) ? (p.errors as Array<{ label: string; message: string }>).map((x) => `${x.label}: ${x.message}`).join(" | ").slice(0, 220) : ""}`,
    provider_switch: `Provider switch: ${String(p.from)} → ${String(p.to)}`,
    gate_superseded: "Replaced the previous gate ① with the new draft",
    draft_discarded: `Draft discarded · ${String(p.reason ?? "")}`,
    explain_ready: "Prepared result explanations for ③ review",
  };
  return (
    <div className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs ${tone}`}>
      <span>{text[e.type] ?? e.type}</span>
      <span className="ml-auto tabular-nums opacity-70">{time}</span>
    </div>
  );
}
