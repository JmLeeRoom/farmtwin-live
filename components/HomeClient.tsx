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
  const [title, setTitle] = useState("Strawberry crate-hauling robot · aisle 3 stop test");
  const [name, setName] = useState("Developer");
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
          title: title.trim() || "FarmTwin Live session",
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
        .insert({ session_id: sid, name: name.trim() || "Developer", role: "developer" })
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
          Before a farm robot enters the field,
          <br />
          everyone who owns the risk signs off in one live session.
        </h1>
        <p className="text-slate-600">
          A design agent drafts the test scenario; the developer, the safety lead and the reviewer join live to steer it and approve it. Results replay from real Webots records (2026-11-01), and every approval and model call is kept in an Evidence Bundle.
        </p>
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{DEMO_LINE}</p>
      </div>

      {!configured ? (
        <p className="rounded-lg bg-amber-100 px-4 py-3 text-sm text-amber-950">
          Supabase environment variables are missing. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to <code>.env.local</code> and restart the dev server.
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
          <span className="text-sm font-semibold text-slate-700">Session title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-semibold text-slate-700">Your name (developer · owner)</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2" />
        </label>
        <button
          type="submit"
          disabled={busy || !configured}
          className="min-h-12 rounded-lg bg-emerald-700 px-4 text-base font-bold text-white hover:bg-emerald-800 disabled:bg-slate-300"
        >
          {busy ? "Creating session…" : "Create session"}
        </button>
        {error ? <p className="text-sm text-red-700">Could not create the session: {error}</p> : null}
      </form>

      <div className="flex flex-wrap gap-4 text-sm text-slate-500">
        <Link href="/replay" className="underline hover:text-slate-800">
          Just replay the records (no session)
        </Link>
        <a href="/api/health?ping=1" className="underline hover:text-slate-800">
          Connection check (/api/health?ping=1)
        </a>
      </div>
    </main>
  );
}
