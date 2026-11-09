"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchSeed, type ReportData } from "@/lib/seed";
import type { WorkerZoneT } from "@/lib/types";
import ReplayCanvas from "./ReplayCanvas";

const DEMO_ZONE: WorkerZoneT = {
  x_min_m: 1.0,
  x_max_m: 2.0,
  y_min_m: -0.5,
  y_max_m: 0.5,
  rule: "STOP_ON_ENTRY",
  note: "Scenario input; human models and moving-obstacle physics are not implemented yet",
};

/** 세션·Supabase 없이 실제 기록만 재생한다(점검용·백업 데모용). */
export default function ReplayStandalone() {
  const [seed, setSeed] = useState<ReportData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zone, setZone] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchSeed()
      .then((r) => alive && setSeed(r.data))
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-4 px-4 py-6">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-xl font-bold text-slate-900">Replay</h1>
        <span className="text-sm text-slate-500">Real Webots records from 2026-11-01 — no session needed</span>
        <Link href="/" className="ml-auto text-sm text-emerald-700 underline">
          Create a session
        </Link>
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={zone} onChange={(e) => setZone(e.target.checked)} /> Overlay an example elderly-worker zone (input)
      </label>
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        {seed ? <ReplayCanvas seed={seed} workerZone={zone ? DEMO_ZONE : null} /> : <p className="text-sm text-slate-500">{error ?? "Loading the records…"}</p>}
      </div>
    </main>
  );
}
