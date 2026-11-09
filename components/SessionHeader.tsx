"use client";

import { ROLE_COLOR, ROLE_LABEL, STATE_LABEL } from "@/lib/constants";
import type { EventRow, ParticipantRow, SessionRow } from "@/lib/types";
import type { PresenceMeta } from "@/lib/useSession";

interface Props {
  session: SessionRow;
  participants: ParticipantRow[];
  online: Record<string, PresenceMeta>;
  me: ParticipantRow;
  events: EventRow[];
  rtStatus: "connecting" | "live" | "polling";
  onQR: () => void;
  onExport: () => void;
  exporting: boolean;
  handoff?: React.ReactNode;
}

export default function SessionHeader({ session, participants, online, me, events, rtStatus, onQR, onExport, exporting, handoff }: Props) {
  const lastAgent = [...events].reverse().find((e) => e.type === "agent_step" || e.type === "explain_ready");
  const provider = lastAgent ? `${String(lastAgent.payload?.provider ?? "")}/${String(lastAgent.payload?.model ?? "")}` : null;
  const switched = lastAgent?.payload?.fallback_used === true;
  const bundled = session.state === "bundled";
  return (
    <header className="z-30 border-b border-slate-200 bg-white/95 backdrop-blur md:sticky md:top-0">
      <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2 md:px-4 md:py-3">
        <div className="min-w-0 max-w-full">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold tracking-wide text-emerald-700">FarmTwin Live</span>
            <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-500">{session.id.slice(0, 8)}</span>
            <span
              className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] ${rtStatus === "live" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}
              title={rtStatus === "live" ? "Realtime connected" : "Realtime not connected — refreshing every 5 s"}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${rtStatus === "live" ? "bg-emerald-500" : "bg-amber-500"}`} />
              {rtStatus === "live" ? "Live" : rtStatus === "polling" ? "Polling" : "Connecting"}
            </span>
          </div>
          <h1 className="truncate text-base font-bold text-slate-900 sm:text-lg">{session.title}</h1>
        </div>

        <div className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-200 md:text-sm">
          {STATE_LABEL[session.state]}
        </div>

        <ul className="flex w-full items-center gap-1.5 overflow-x-auto pb-0.5 md:w-auto md:flex-wrap md:overflow-visible md:pb-0" aria-label="Participants">
          {participants.map((p) => {
            const isOnline = Boolean(online[p.id]);
            const owner = session.owner_participant_id === p.id;
            return (
              <li key={p.id} className={`flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs ring-1 ${ROLE_COLOR[p.role]} ${isOnline ? "" : "opacity-50"}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${isOnline ? "bg-emerald-500" : "bg-slate-400"}`} />
                {owner ? <span title="Owner">👑</span> : null}
                <span className="font-semibold">{p.name}</span>
                {p.name !== ROLE_LABEL[p.role] ? <span className="opacity-70">{ROLE_LABEL[p.role]}</span> : null}
                {p.id === me.id ? <span className="opacity-70">(you)</span> : null}
              </li>
            );
          })}
        </ul>

        <div className="flex flex-wrap items-center gap-2 md:ml-auto">
          {provider ? (
            <span className={`hidden rounded px-2 py-1 font-mono text-[11px] md:inline ${switched ? "bg-amber-100 text-amber-900" : "bg-slate-100 text-slate-600"}`} title="Provider/model of the last agent call">
              {switched ? "fallback · " : ""}
              {provider}
            </span>
          ) : null}
          <button type="button" onClick={onQR} className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 md:px-3 md:py-1.5 md:text-sm">
            QR invite
          </button>
          {handoff}
          <button
            type="button"
            onClick={onExport}
            disabled={exporting}
            className={`rounded-md px-2.5 py-1 text-xs font-semibold md:px-3 md:py-1.5 md:text-sm ${bundled ? "bg-emerald-700 text-white hover:bg-emerald-800" : "border border-slate-300 text-slate-700 hover:bg-slate-50"} disabled:opacity-50`}
          >
            {exporting ? "Building…" : "Evidence Bundle"}
          </button>
        </div>
      </div>
    </header>
  );
}
