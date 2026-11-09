"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BASE_SCENARIO } from "@/lib/constants";
import { duration, frontGapM, indexAt, makeView, obstacleFrontX, toScreen, type View } from "@/lib/replay";
import { runLabel, type ReportData, type SeedRun } from "@/lib/seed";
import type { WorkerZoneT } from "@/lib/types";
import type { CursorPayload } from "@/lib/useSession";

interface Props {
  seed: ReportData;
  workerZone: WorkerZoneT | null;
  /** 세션에서 바뀐 판정 기준(입력). 기록 기준(0.40m)과 다르면 두 번째 선으로 그린다. */
  inputMinGap?: number;
  cursorOut?: (c: CursorPayload) => void;
  cursorIn?: (fn: (c: CursorPayload) => void) => () => void;
  canBroadcast?: boolean;
  meId?: string;
}

const LANE_COLOR = { A: "#475569", B: "#0f766e" } as const;
const SPEEDS = [1, 2, 4] as const;

export default function ReplayCanvas({ seed, workerZone, inputMinGap, cursorOut, cursorIn, canBroadcast, meId }: Props) {
  const runsA = useMemo(() => seed.runs.filter((r) => r.variantId === "A"), [seed]);
  const runsB = useMemo(() => seed.runs.filter((r) => r.variantId === "B"), [seed]);
  const [runAId, setRunAId] = useState(runsA[0]?.id ?? "");
  const [runBId, setRunBId] = useState(runsB[0]?.id ?? "");
  const runA = runsA.find((r) => r.id === runAId) ?? runsA[0];
  const runB = runsB.find((r) => r.id === runBId) ?? runsB[0];
  const lanes = useMemo(() => [runA, runB].filter(Boolean) as SeedRun[], [runA, runB]);
  const dur = useMemo(() => Math.max(0.1, ...lanes.map((r) => duration(r.trajectory))), [lanes]);

  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(1);
  const [broadcast, setBroadcast] = useState(false);
  const [follow, setFollow] = useState(false);
  const tRef = useRef(0);
  const live = useRef({ runAId, runBId, playing, speed });

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(640);

  useEffect(() => {
    tRef.current = t;
    live.current = { runAId, runBId, playing, speed };
  }, [t, runAId, runBId, playing, speed]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(280, Math.floor(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 재생 루프
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const nt = Math.min(tRef.current + ((now - last) / 1000) * speed, dur);
      last = now;
      tRef.current = nt;
      setT(nt);
      if (nt >= dur) {
        setPlaying(false);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, dur]);

  // 따라보기 방송(소유자) — 5Hz
  useEffect(() => {
    if (!broadcast || !cursorOut || !meId) return;
    const id = setInterval(() => {
      const l = live.current;
      cursorOut({ runA: l.runAId, runB: l.runBId, t: tRef.current, playing: l.playing, speed: l.speed, by: meId });
    }, 200);
    return () => clearInterval(id);
  }, [broadcast, cursorOut, meId]);

  // 따라보기 수신 — 로컬 재생을 돌리고 0.15s 넘게 어긋나면 맞춘다
  useEffect(() => {
    if (!follow || !cursorIn) return;
    return cursorIn((c) => {
      setRunAId(c.runA);
      setRunBId(c.runB);
      setSpeed(c.speed);
      setPlaying(c.playing);
      if (Math.abs(tRef.current - c.t) > 0.15) {
        tRef.current = c.t;
        setT(c.t);
      }
    });
  }, [follow, cursorIn]);

  const view = useMemo(() => makeView(width, BASE_SCENARIO, workerZone), [width, workerZone]);
  const height = Math.round(view.laneHeight * lanes.length);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    lanes.forEach((run, i) => drawLane(ctx, view, i * view.laneHeight, run, t, workerZone, inputMinGap));
  }, [width, height, view, lanes, t, workerZone, inputMinGap]);

  const restart = () => {
    tRef.current = 0;
    setT(0);
    setPlaying(true);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <label className="flex items-center gap-1">
          <span className="font-semibold text-slate-600">A</span>
          <select className="rounded border border-slate-300 bg-white px-1.5 py-1" value={runA?.id} onChange={(e) => setRunAId(e.target.value)} disabled={follow}>
            {runsA.map((r) => (
              <option key={r.id} value={r.id}>
                {runLabel(r.id)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1">
          <span className="font-semibold text-teal-700">B</span>
          <select className="rounded border border-slate-300 bg-white px-1.5 py-1" value={runB?.id} onChange={(e) => setRunBId(e.target.value)} disabled={follow}>
            {runsB.map((r) => (
              <option key={r.id} value={r.id}>
                {runLabel(r.id)}
              </option>
            ))}
          </select>
        </label>
        <span className="ml-auto rounded bg-slate-100 px-2 py-1 text-slate-600">실제 기록 · 2026-11-01 · Webots R2025a</span>
      </div>

      <div ref={wrapRef} className="w-full overflow-hidden rounded-lg border border-slate-200 bg-white">
        <canvas ref={canvasRef} style={{ width: `${width}px`, height: `${height}px` }} aria-label="A/B 정지 시험 재생" role="img" />
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {lanes.map((run) => (
          <Readout key={run.id} run={run} t={t} />
        ))}
      </div>

      <div className="flex flex-col gap-1">
        <div className="relative h-4">
          {lanes.flatMap((run) =>
            run.events.map((ev) => (
              <span
                key={`${run.id}-${ev.type}-${ev.simTime}`}
                title={`${run.variantId} · ${ev.type} · ${ev.simTime.toFixed(3)}s`}
                className="absolute top-0 h-3 w-0.5"
                style={{ left: `${Math.min(100, (ev.simTime / dur) * 100)}%`, background: LANE_COLOR[run.variantId], opacity: 0.7 }}
              />
            )),
          )}
        </div>
        <input
          type="range"
          min={0}
          max={dur}
          step={0.032}
          value={t}
          disabled={follow}
          onChange={(e) => {
            const v = Number(e.target.value);
            tRef.current = v;
            setT(v);
          }}
          className="w-full accent-emerald-700"
          aria-label="재생 위치"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button
          type="button"
          onClick={() => (t >= dur ? restart() : setPlaying((p) => !p))}
          disabled={follow}
          className="rounded-md bg-emerald-700 px-3 py-1.5 font-semibold text-white hover:bg-emerald-800 disabled:opacity-40"
        >
          {playing ? "일시정지" : t >= dur ? "다시 재생" : "재생"}
        </button>
        <div className="flex overflow-hidden rounded-md border border-slate-300">
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSpeed(s)}
              disabled={follow}
              className={`px-2.5 py-1.5 ${speed === s ? "bg-slate-800 text-white" : "bg-white text-slate-700"}`}
            >
              {s}×
            </button>
          ))}
        </div>
        <span className="tabular-nums text-slate-500">
          t = {t.toFixed(2)} / {dur.toFixed(2)} s
        </span>
        <div className="ml-auto flex items-center gap-3 text-xs text-slate-600">
          {canBroadcast && cursorOut ? (
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={broadcast} onChange={(e) => setBroadcast(e.target.checked)} /> 모두에게 따라보기 방송
            </label>
          ) : null}
          {!canBroadcast && cursorIn ? (
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> 소유자 화면 따라보기
            </label>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Readout({ run, t }: { run: SeedRun; t: number }) {
  const i = indexAt(run.trajectory, t);
  const p = run.trajectory[i];
  const done = t >= duration(run.trajectory);
  const pass = run.evaluation.status === "PASS";
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
      <div className="mb-1 flex items-center gap-2">
        <span className="rounded px-1.5 py-0.5 font-bold text-white" style={{ background: LANE_COLOR[run.variantId] }}>
          {run.variantId}
        </span>
        <span className="font-semibold text-slate-700">{runLabel(run.id)}</span>
        {done ? (
          <span className={`ml-auto rounded px-1.5 py-0.5 font-bold ${pass ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-700"}`}>
            {run.evaluation.status}
          </span>
        ) : null}
      </div>
      <div className="grid grid-cols-3 gap-1 tabular-nums text-slate-700">
        <span>t {p?.simTime.toFixed(2)} s</span>
        <span>v {p?.speedMps.toFixed(2)} m/s</span>
        <span>간격 {p?.frontGapM.toFixed(3)} m</span>
      </div>
      {done ? (
        <div className="mt-1 text-slate-600">
          최소 앞면 간격 <b className="tabular-nums">{run.metrics.minFrontGapM.toFixed(3)} m</b> · 기준 ≥ 0.40 m
        </div>
      ) : null}
    </div>
  );
}

function drawLane(
  ctx: CanvasRenderingContext2D,
  v: View,
  top: number,
  run: SeedRun,
  t: number,
  zone: WorkerZoneT | null,
  inputMinGap: number | undefined,
) {
  const s = BASE_SCENARIO;
  const half = s.corridor.width_m / 2;
  const laneTop = top + 24;
  const P = (x: number, y: number) => toScreen(v, laneTop, x, y);
  const minGap = s.requirements.min_front_gap_m;
  const front = obstacleFrontX(s);

  ctx.font = "600 12px system-ui, -apple-system, 'Malgun Gothic', sans-serif";
  ctx.fillStyle = "#334155";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(
    `${run.variantId} · ${run.variantId === "A" ? "늦은 정지(센서 0.30 m)" : "이른 정지(센서 0.80 m)"} · ${runLabel(run.id)}`,
    v.pad,
    top + 16,
  );

  // 통로 바닥과 벽
  const [fx0, fy0] = P(0, half);
  const [fx1, fy1] = P(Math.min(s.corridor.length_m, v.xMax), -half);
  ctx.fillStyle = "#eef2f6";
  ctx.fillRect(fx0, fy0, fx1 - fx0, fy1 - fy0);
  ctx.strokeStyle = "#2f6b3f";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(fx0, fy0);
  ctx.lineTo(fx1, fy0);
  ctx.moveTo(fx0, fy1);
  ctx.lineTo(fx1, fy1);
  ctx.stroke();

  // 출발선
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = "#94a3b8";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(fx0, fy0);
  ctx.lineTo(fx0, fy1);
  ctx.stroke();

  // 고령 작업자 구역(시나리오 입력)
  if (zone) {
    const [zx0, zy0] = P(zone.x_min_m, zone.y_max_m);
    const [zx1, zy1] = P(zone.x_max_m, zone.y_min_m);
    ctx.fillStyle = "rgba(245, 158, 11, 0.16)";
    ctx.fillRect(zx0, zy0, zx1 - zx0, zy1 - zy0);
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = "#d97706";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(zx0, zy0, zx1 - zx0, zy1 - zy0);
    ctx.setLineDash([]);
    ctx.fillStyle = "#92400e";
    ctx.font = "600 11px system-ui, -apple-system, 'Malgun Gothic', sans-serif";
    ctx.fillText("고령 작업자 구역 · 입력", zx0 + 4, zy0 + 13);
  }

  // 기준선: 로봇 앞면이 넘으면 안 되는 위치
  const drawLimit = (gap: number, color: string, label: string, dy: number) => {
    const [lx, ly0] = P(front - gap, half);
    const [, ly1] = P(front - gap, -half);
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(lx, ly0);
    ctx.lineTo(lx, ly1);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    ctx.font = "11px system-ui, -apple-system, 'Malgun Gothic', sans-serif";
    ctx.fillText(label, lx + 3, ly1 - 4 - dy);
  };
  drawLimit(minGap, "#b91c1c", `기준 ${minGap.toFixed(2)} m`, 0);
  if (inputMinGap !== undefined && Math.abs(inputMinGap - minGap) > 1e-9) {
    drawLimit(inputMinGap, "#7c3aed", `새 기준 ${inputMinGap.toFixed(2)} m(입력)`, 12);
  }
  ctx.setLineDash([]);

  // 장애물
  const [ox0, oy0] = P(front, s.obstacle.width_y_m / 2);
  const [ox1, oy1] = P(front + s.obstacle.length_x_m, -s.obstacle.width_y_m / 2);
  ctx.fillStyle = "#e46b2a";
  ctx.fillRect(ox0, oy0, ox1 - ox0, oy1 - oy0);
  ctx.strokeStyle = "#9a3412";
  ctx.lineWidth = 1;
  ctx.strokeRect(ox0, oy0, ox1 - ox0, oy1 - oy0);
  ctx.fillStyle = "#fff";
  ctx.font = "600 11px system-ui, -apple-system, 'Malgun Gothic', sans-serif";
  ctx.fillText("장애물", ox0 + 6, (oy0 + oy1) / 2 + 4);

  // 로봇
  const p = run.trajectory[indexAt(run.trajectory, t)];
  if (!p) return;
  const g = s.geometry;
  const [rx0, ry0] = P(p.xM - g.rear_extent_m, p.yM + g.half_width_m);
  const [rx1, ry1] = P(p.xM + g.front_extent_m, p.yM - g.half_width_m);
  ctx.fillStyle = LANE_COLOR[run.variantId];
  roundRect(ctx, rx0, ry0, rx1 - rx0, ry1 - ry0, 5);
  ctx.fill();
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(rx1 - 3, ry0 + 4);
  ctx.lineTo(rx1 - 3, ry1 - 4);
  ctx.stroke();

  // 앞면 간격
  const gap = frontGapM(p.xM, s);
  const ok = gap >= minGap - 1e-9;
  const [gx0, gy] = P(p.xM + g.front_extent_m, 0);
  const [gx1] = P(front, 0);
  ctx.strokeStyle = ok ? "#15803d" : "#dc2626";
  ctx.fillStyle = ok ? "#15803d" : "#dc2626";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(gx0, gy);
  ctx.lineTo(gx1, gy);
  ctx.stroke();
  ctx.font = "700 12px system-ui, -apple-system, 'Malgun Gothic', sans-serif";
  const label = `${gap.toFixed(3)} m`;
  const tw = ctx.measureText(label).width;
  const mid = (gx0 + gx1) / 2;
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.fillRect(mid - tw / 2 - 3, gy - 16, tw + 6, 15);
  ctx.fillStyle = ok ? "#15803d" : "#dc2626";
  ctx.fillText(label, mid - tw / 2, gy - 4);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
