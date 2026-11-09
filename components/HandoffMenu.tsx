"use client";

import { useState } from "react";
import { ROLE_LABEL } from "@/lib/constants";
import { getBrowserSupabase } from "@/lib/supabase";
import type { ParticipantRow } from "@/lib/types";
import type { PresenceMeta } from "@/lib/useSession";

interface Props {
  sessionId: string;
  me: ParticipantRow;
  participants: ParticipantRow[];
  online: Record<string, PresenceMeta>;
  onDone: (msg: string, tone?: "ok" | "error") => void;
}

/** 소유자만 보인다. 소유자 = [요청 제출]·[대리 승인]·[따라보기 방송]을 할 수 있는 사람. */
export default function HandoffMenu({ sessionId, me, participants, online, onDone }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const others = participants.filter((p) => p.id !== me.id);

  const handoff = async (to: ParticipantRow) => {
    setBusy(true);
    const sb = getBrowserSupabase();
    const r = await sb.from("sessions").update({ owner_participant_id: to.id }).eq("id", sessionId).eq("owner_participant_id", me.id).select("id");
    if (r.error || !r.data?.length) {
      onDone("인계하지 못했습니다(이미 소유자가 바뀌었을 수 있음)", "error");
    } else {
      await sb.from("events").insert({
        session_id: sessionId,
        type: "handoff",
        actor_kind: "human",
        actor_id: me.id,
        payload: { from: me.id, to: to.id, to_name: to.name, to_role: to.role },
      });
      onDone(`${to.name}(${ROLE_LABEL[to.role]})에게 세션을 넘겼습니다`, "ok");
    }
    setBusy(false);
    setOpen(false);
  };

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
        인계
      </button>
      {open ? (
        <div className="absolute right-0 z-40 mt-1 w-64 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
          {others.length === 0 ? <p className="px-3 py-2 text-sm text-slate-500">넘겨받을 참가자가 없습니다</p> : null}
          {others.map((p) => (
            <button
              key={p.id}
              type="button"
              disabled={busy}
              onClick={() => handoff(p)}
              className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-slate-50 disabled:opacity-50"
            >
              <span>
                {p.name} <span className="text-slate-500">· {ROLE_LABEL[p.role]}</span>
              </span>
              <span className={`text-xs ${online[p.id] ? "text-emerald-600" : "text-slate-400"}`}>{online[p.id] ? "온라인" : "오프라인"}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
