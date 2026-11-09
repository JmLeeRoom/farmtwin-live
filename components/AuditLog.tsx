"use client";

import { useMemo } from "react";
import { describeEvent, timeHMS, whoOf } from "@/lib/format";
import type { EventRow, ParticipantRow } from "@/lib/types";

export default function AuditLog({ events, participants }: { events: EventRow[]; participants: ParticipantRow[] }) {
  const byId = useMemo(() => new Map(participants.map((p) => [p.id, p])), [participants]);
  const rows = useMemo(() => [...events].reverse().slice(0, 200), [events]);
  return (
    <ol className="max-h-[420px] overflow-y-auto text-xs" aria-label="감사 로그">
      {rows.map((e) => (
        <li key={e.id} className="grid grid-cols-[64px_1fr] gap-2 border-b border-slate-100 py-1.5">
          <span className="tabular-nums text-slate-400">{timeHMS(e.created_at)}</span>
          <span className="text-slate-700">
            <span className={`font-semibold ${e.actor_kind === "agent" ? "text-emerald-700" : e.actor_kind === "system" ? "text-slate-500" : "text-slate-900"}`}>
              {whoOf(e, byId)}
            </span>{" "}
            · {describeEvent(e)}
          </span>
        </li>
      ))}
    </ol>
  );
}
