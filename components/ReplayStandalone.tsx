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
  note: "시나리오 입력 · 사람 모델·동적 장애물 물리 미구현",
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
        <h1 className="text-xl font-bold text-slate-900">기록 재생</h1>
        <span className="text-sm text-slate-500">세션 없이 2026-11-01 실제 Webots 기록만 봅니다</span>
        <Link href="/" className="ml-auto text-sm text-emerald-700 underline">
          세션 만들기
        </Link>
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={zone} onChange={(e) => setZone(e.target.checked)} /> 예시 고령 작업자 구역 겹쳐 보기(입력)
      </label>
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        {seed ? <ReplayCanvas seed={seed} workerZone={zone ? DEMO_ZONE : null} /> : <p className="text-sm text-slate-500">{error ?? "기록을 불러오는 중…"}</p>}
      </div>
    </main>
  );
}
