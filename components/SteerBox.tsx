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
    if (!parsed.success) return toast("개입은 1~500자로 입력해 주세요", "warn");
    setSending(true);
    const r = await sb.from("events").insert({
      session_id: session.id,
      type: "steer",
      actor_kind: "human",
      actor_id: me.id,
      payload: { text: parsed.data, name: me.name, role: me.role },
    });
    setSending(false);
    if (r.error) return toast(`보내지 못했습니다: ${r.error.message}`, "error");
    setSteer("");
    toast(draftable ? "개입을 보냈습니다 — 에이전트가 곧 반영합니다" : "개입이 기록됐습니다(반려 시 반영)", "ok");
    refresh();
  };

  const submitRequest = async () => {
    const parsed = SteerText.safeParse(request);
    if (!parsed.success) return toast("요청은 1~500자로 입력해 주세요", "warn");
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
      return toast(`요청을 기록하지 못했습니다: ${ins.error.message}`, "error");
    }
    refresh();
    try {
      const res = await fetch("/api/agent/draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: session.id, trigger: "request" }),
      });
      const body = (await res.json().catch(() => ({}))) as { reason?: string; errors?: Array<{ label: string; message: string }> };
      if (res.status === 409 && body.reason === "busy") toast("에이전트가 이미 작업 중입니다 — 끝나면 이어서 반영합니다", "info");
      else if (res.status === 409) toast("지금 단계에서는 요청이 기록만 됩니다(반려 시 반영)", "info");
      else if (res.status === 429) toast("이 세션의 에이전트 호출 한도에 도달했습니다", "warn");
      else if (!res.ok) toast(`에이전트 응답 없음 · ${body.errors?.[0]?.message ?? body.reason ?? res.status}`, "error");
    } catch {
      toast("서버에 닿지 못했습니다", "error");
    }
    setRequesting(false);
    refresh();
  };

  return (
    <div className="flex flex-col gap-3">
      {isOwner ? (
        <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3">
          <label htmlFor="request" className="text-xs font-semibold text-slate-600">
            요청(소유자)
          </label>
          <textarea
            id="request"
            rows={2}
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            placeholder="예: 내일 05:00 3번 집하통로 운반 시험, 정지 설정 A/B 비교"
            className="w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={submitRequest}
              disabled={requesting}
              className="rounded-md bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
            >
              {requesting ? "에이전트 작업 중…" : "요청 제출"}
            </button>
            <button type="button" onClick={() => setRequest(DEMO_REQUEST)} className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
              데모 요청 채우기
            </button>
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
        <label htmlFor="steer" className="text-xs font-semibold text-amber-900">
          개입 — 누구나 에이전트 작업 방향을 바꿀 수 있습니다
        </label>
        <textarea
          id="steer"
          rows={2}
          value={steer}
          onChange={(e) => setSteer(e.target.value)}
          placeholder="예: 3번 통로는 어르신이 아침에 풀 뽑으러 나오신다"
          className="w-full resize-y rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={sendSteer}
            disabled={sending}
            className="min-h-11 rounded-md bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50"
          >
            {sending ? "보내는 중…" : "개입 보내기"}
          </button>
          <button type="button" onClick={() => setSteer(DEMO_STEER)} className="rounded-full border border-amber-300 bg-white px-3 py-1.5 text-xs text-amber-900">
            예시: 어르신 작업 구간
          </button>
        </div>
        {!draftable ? <p className="text-xs text-amber-900">현재 단계에서는 개입이 기록만 됩니다(반려 시 반영).</p> : null}
      </div>
    </div>
  );
}
