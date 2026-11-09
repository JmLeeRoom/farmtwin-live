"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { participantKey, writeLocal } from "@/lib/client";
import { DEMO_LINE, RUN_A01, RUN_B01, SEED_BATCH_DIR } from "@/lib/constants";
import { fetchSeed, summarizeSeed } from "@/lib/seed";
import { getBrowserSupabase, supabaseConfigured } from "@/lib/supabase";

export default function HomeClient() {
  const router = useRouter();
  const search = useSearchParams();
  const [title, setTitle] = useState("딸기 수확상자 운반 로봇 · 3번 집하통로 정지 시험");
  const [name, setName] = useState("개발자");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const configured = supabaseConfigured();

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const sb = getBrowserSupabase();
      const { data, sha256 } = await fetchSeed();
      const summary = summarizeSeed(data, sha256);
      const s = await sb
        .from("sessions")
        .insert({
          title: title.trim() || "FarmTwin Live 세션",
          seed_batch_id: SEED_BATCH_DIR,
          scenario: summary.initial.scenario,
          variants: summary.initial.variants,
          seed_summary: summary,
        })
        .select("id")
        .single();
      if (s.error) throw new Error(s.error.message);
      const sid = s.data.id as string;
      const p = await sb
        .from("participants")
        .insert({ session_id: sid, name: name.trim() || "개발자", role: "developer" })
        .select("id")
        .single();
      if (p.error) throw new Error(p.error.message);
      const pid = p.data.id as string;
      const o = await sb.from("sessions").update({ owner_participant_id: pid }).eq("id", sid);
      if (o.error) throw new Error(o.error.message);
      await sb.from("events").insert([
        { session_id: sid, type: "session_created", actor_kind: "human", actor_id: pid, payload: { title, name, role: "developer" } },
        { session_id: sid, type: "seed_loaded", actor_kind: "system", actor_id: "system", payload: { batchId: data.batchId, sha256 } },
      ]);
      writeLocal(participantKey(sid), pid);
      // ③ 검수 게이트용 설명을 미리 만들어 둔다(기다리지 않음)
      void fetch("/api/agent/explain", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: sid, runIds: [RUN_A01, RUN_B01] }),
      }).catch(() => undefined);
      const req = search.get("req");
      router.push(`/s/${sid}${req ? `?req=${encodeURIComponent(req)}` : ""}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-8 px-4 py-10">
      <div className="flex flex-col gap-3">
        <span className="text-sm font-bold tracking-wide text-emerald-700">FarmTwin Live</span>
        <h1 className="text-3xl font-bold leading-tight text-slate-900 sm:text-4xl">
          농장 로봇이 밭에 들어가기 전,
          <br />
          관련된 모든 사람이 같은 검증 세션에서 승인한다.
        </h1>
        <p className="text-slate-600">
          설계 에이전트가 시험 시나리오 초안을 쓰고, 개발자·안전담당·검수자가 실시간으로 들어와 개입하고 승인합니다. 결과는 실제 Webots 기록(2026-11-01)으로 재생하고, 승인 기록과 모델 출처를 Evidence Bundle로 남깁니다.
        </p>
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{DEMO_LINE}</p>
      </div>

      {!configured ? (
        <p className="rounded-lg bg-amber-100 px-4 py-3 text-sm text-amber-950">
          Supabase 환경변수가 없습니다. <code>.env.local</code>에 NEXT_PUBLIC_SUPABASE_URL·NEXT_PUBLIC_SUPABASE_ANON_KEY를 넣고 dev 서버를 다시 시작하세요.
        </p>
      ) : null}

      <form
        className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="text-sm font-semibold text-slate-700">세션 제목</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-semibold text-slate-700">내 이름 (개발자 · 소유자)</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2" />
        </label>
        <button
          type="submit"
          disabled={busy || !configured}
          className="min-h-12 rounded-lg bg-emerald-700 px-4 text-base font-bold text-white hover:bg-emerald-800 disabled:bg-slate-300"
        >
          {busy ? "세션 만드는 중…" : "세션 만들기"}
        </button>
        {error ? <p className="text-sm text-red-700">세션을 만들지 못했습니다: {error}</p> : null}
      </form>

      <div className="flex flex-wrap gap-4 text-sm text-slate-500">
        <Link href="/replay" className="underline hover:text-slate-800">
          세션 없이 기록 재생만 보기
        </Link>
        <a href="/api/health?ping=1" className="underline hover:text-slate-800">
          연결 점검(/api/health?ping=1)
        </a>
      </div>
    </main>
  );
}
