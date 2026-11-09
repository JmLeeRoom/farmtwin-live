"use client";

import { useState } from "react";
import { DEMO_REQUEST, DEMO_STEER } from "@/lib/constants";
import { SteerText } from "@/lib/schemas";
import { getBrowserSupabase } from "@/lib/supabase";
import type { ParticipantRow, SessionRow } from "@/lib/types";

interface Props {
  session: SessionRow;
  me: ParticipantRow;
  isOwner: boolean;
  initialRequest: string;
  toast: (msg: string, tone?: "info" | "ok" | "warn" | "error") => void;
  refresh: () => void;
}

const DRAFTABLE = new Set(["drafting", "gate_scenario"]);

export default function SteerBox({ session, me, isOwner, initialRequest, toast, refresh }: Props) {
  const sb = getBrowserSupabase();
  const [steer, setSteer] = useState("");
  const [request, setRequest] = useState(initialRequest);
  const [sending, setSending] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const draftable = DRAFTABLE.has(session.state);

  const sendSteer = async () => {
    const parsed = SteerText.safeParse(steer);
    if (!parsed.success) return toast("A steer must be 1–500 characters", "warn");
    setSending(true);
    const r = await sb.from("events").insert({
      session_id: session.id,
      type: "steer",
      actor_kind: "human",
      actor_id: me.id,
      payload: { text: parsed.data, name: me.name, role: me.role },
    });
    setSending(false);
    if (r.error) return toast(`Could not send: ${r.error.message}`, "error");
    setSteer("");
    toast(draftable ? "Steer sent — the agent will pick it up shortly" : "Steer recorded (applied if a gate is rejected)", "ok");
    refresh();
  };

  const submitRequest = async () => {
    const parsed = SteerText.safeParse(request);
    if (!parsed.success) return toast("A request must be 1–500 characters", "warn");
    setRequesting(true);
    const ins = await sb.from("events").insert({
      session_id: session.id,
      type: "request",
      actor_kind: "human",
      actor_id: me.id,
      payload: { text: parsed.data, name: me.name, role: me.role },
    });
    if (ins.error) {
      setRequesting(false);
      return toast(`Could not record the request: ${ins.error.message}`, "error");
    }
    refresh();
    try {
      const res = await fetch("/api/agent/draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: session.id, trigger: "request" }),
      });
      const body = (await res.json().catch(() => ({}))) as { reason?: string; errors?: Array<{ label: string; message: string }> };
      if (res.status === 409 && body.reason === "busy") toast("The agent is already working — it will pick this up next", "info");
      else if (res.status === 409) toast("At this step the request is only recorded (applied if a gate is rejected)", "info");
      else if (res.status === 429) toast("This session reached its agent call limit", "warn");
      else if (!res.ok) toast(`Agent did not respond · ${body.errors?.[0]?.message ?? body.reason ?? res.status}`, "error");
    } catch {
      toast("Could not reach the server", "error");
    }
    setRequesting(false);
    refresh();
  };

  return (
    <div className="flex flex-col gap-3">
      {isOwner ? (
        <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3">
          <label htmlFor="request" className="text-xs font-semibold text-slate-600">
            Request (owner)
          </label>
          <textarea
            id="request"
            rows={2}
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            placeholder="e.g. Tomorrow 05:00, hauling test in aisle 3, compare stop settings A and B"
            className="w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={submitRequest}
              disabled={requesting}
              className="rounded-md bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
            >
              {requesting ? "Agent working…" : "Submit request"}
            </button>
            <button type="button" onClick={() => setRequest(DEMO_REQUEST)} className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
              Fill demo request
            </button>
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
        <label htmlFor="steer" className="text-xs font-semibold text-amber-900">
          Steer — anyone can redirect the agent
        </label>
        <textarea
          id="steer"
          rows={2}
          value={steer}
          onChange={(e) => setSteer(e.target.value)}
          placeholder="e.g. Elderly workers weed in aisle 3 every morning"
          className="w-full resize-y rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={sendSteer}
            disabled={sending}
            className="min-h-11 rounded-md bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50"
          >
            {sending ? "Sending…" : "Send steer"}
          </button>
          <button type="button" onClick={() => setSteer(DEMO_STEER)} className="rounded-full border border-amber-300 bg-white px-3 py-1.5 text-xs text-amber-900">
            Example: elderly workers’ zone
          </button>
        </div>
        {!draftable ? <p className="text-xs text-amber-900">At this step steers are only recorded (applied if a gate is rejected).</p> : null}
      </div>
    </div>
  );
}
