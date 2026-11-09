"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildBundle } from "@/lib/bundle";
import { participantKey, useIsDesktop, useLocalValue, writeLocal } from "@/lib/client";
import { DEMO_LINE, GATE_TITLE, ROLE_LABEL } from "@/lib/constants";
import { fmtM, fmtValue } from "@/lib/format";
import { fetchSeed, type ReportData } from "@/lib/seed";
import { getBrowserSupabase, supabaseConfigured } from "@/lib/supabase";
import type { AgentStepRow, EventRow, GateKind, GateRow, ParticipantRow, Role, RunRequestRow, SessionRow } from "@/lib/types";
import { useSessionData } from "@/lib/useSession";
import AgentTimeline from "./AgentTimeline";
import AuditLog from "./AuditLog";
import GatePanel from "./GatePanel";
import HandoffMenu from "./HandoffMenu";
import JoinQR from "./JoinQR";
import ReplayCanvas from "./ReplayCanvas";
import SessionHeader from "./SessionHeader";
import SteerBox from "./SteerBox";
import { ToastStack, useToasts } from "./Toasts";

const DRAFTABLE = new Set(["drafting", "gate_scenario"]);

export default function SessionView() {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const meId = useLocalValue(participantKey(id));

  useEffect(() => {
    if (meId === null) router.replace(`/s/${id}/join`);
  }, [meId, id, router]);

  if (!supabaseConfigured()) return <ConfigMissing />;
  if (!meId) return <Centered>Checking your participant info…</Centered>;
  return <SessionInner id={id} meId={meId} initialRequest={search.get("req") ?? ""} />;
}

function SessionInner({ id, meId, initialRequest }: { id: string; meId: string; initialRequest: string }) {
  const router = useRouter();
  const isDesktop = useIsDesktop();
  const data = useSessionData(id, meId);
  const me = data.participants.find((p) => p.id === meId) ?? null;
  const { toasts, push } = useToasts();
  const [showQR, setShowQR] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [seed, setSeed] = useState<ReportData | null>(null);
  const [seedError, setSeedError] = useState<string | null>(null);
  const triggered = useRef(0);
  const seen = useRef<number | null>(null);
  const s = data.session;
  const isOwner = Boolean(s && me && s.owner_participant_id === me.id);

  // 저장된 참가자 id가 이 세션에 없으면 다시 참가
  useEffect(() => {
    if (!data.loading && s && data.participants.length && !me) {
      writeLocal(participantKey(id), null);
      router.replace(`/s/${id}/join`);
    }
  }, [data.loading, s, data.participants.length, me, id, router]);

  // 데스크톱만 재생용 기록(647KB)을 받는다
  useEffect(() => {
    if (!isDesktop || seed) return;
    let alive = true;
    fetchSeed()
      .then((r) => alive && setSeed(r.data))
      .catch((e) => alive && setSeedError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [isDesktop, seed]);

  // 새 개입·요청을 보면 3초 뒤 설계 에이전트 호출(어느 기기든). 중복은 서버 락이 거른다.
  const pendingInputMax = useMemo(() => {
    if (!s) return 0;
    let m = 0;
    for (const e of data.events) if ((e.type === "steer" || e.type === "request") && e.id > s.last_steer_consumed_id) m = Math.max(m, e.id);
    return m;
  }, [data.events, s]);
  const refresh = data.refresh;
  const callDraft = useCallback(
    async (trigger: "steer" | "request") => {
      const res = await fetch("/api/agent/draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: id, trigger }),
      }).catch(() => null);
      refresh();
      return res;
    },
    [id, refresh],
  );
  const state = s?.state;
  const busy = s?.agent_busy;
  const busySince = s?.agent_busy_since;
  useEffect(() => {
    if (!state || !pendingInputMax || !DRAFTABLE.has(state) || pendingInputMax <= triggered.current) return;
    if (busy && busySince && Date.now() - Date.parse(busySince) < 60_000) return; // 끝나면 다시 평가된다
    const target = pendingInputMax;
    const timer = setTimeout(async () => {
      const res = await callDraft("steer");
      if (!res) return;
      if (res.status === 409) {
        const b = (await res.json().catch(() => ({}))) as { reason?: string };
        if (b.reason === "busy") return;
      }
      triggered.current = Math.max(triggered.current, target);
    }, 3000);
    return () => clearTimeout(timer);
  }, [state, busy, busySince, pendingInputMax, callDraft]);

  // 새 이벤트 알림(폰 사용자를 위해): 게이트 열림·제공자 전환·에이전트 실패
  useEffect(() => {
    if (data.loading) return;
    const max = data.events.reduce((m, e) => Math.max(m, e.id), 0);
    if (seen.current === null) {
      seen.current = max;
      return;
    }
    for (const e of data.events) {
      if (e.id <= seen.current) continue;
      if (e.type === "gate_opened") {
        const k = e.payload?.kind as GateKind;
        const role = e.payload?.required_role as Role | undefined;
        push(`${GATE_TITLE[k] ?? "Gate"} opened — ${role ? `waiting for ${ROLE_LABEL[role]}` : "awaiting approval"}`, "info");
      }
      if (e.type === "provider_switch") push(`Provider switch: ${String(e.payload?.from)} → ${String(e.payload?.to)}`, "warn");
      if (e.type === "agent_failed") push("Agent did not respond — retry, or continue without it", "error");
    }
    seen.current = max;
  }, [data.events, data.loading, push]);

  const exportBundle = async () => {
    if (!me) return;
    setExporting(true);
    try {
      const sb = getBrowserSupabase();
      const [ss, p, g, a, r, e] = await Promise.all([
        sb.from("sessions").select("*").eq("id", id).single(),
        sb.from("participants").select("*").eq("session_id", id),
        sb.from("gates").select("*").eq("session_id", id),
        sb.from("agent_steps").select("*").eq("session_id", id),
        sb.from("run_requests").select("*").eq("session_id", id),
        sb.from("events").select("*").eq("session_id", id).order("id").limit(5000),
      ]);
      const err = [ss, p, g, a, r, e].find((x) => x.error)?.error;
      if (err || !ss.data) throw new Error(err?.message ?? "Session not found");
      const bundle = buildBundle({
        session: ss.data as SessionRow,
        participants: (p.data ?? []) as ParticipantRow[],
        gates: (g.data ?? []) as GateRow[],
        agentSteps: (a.data ?? []) as AgentStepRow[],
        runRequests: (r.data ?? []) as RunRequestRow[],
        events: (e.data ?? []) as EventRow[],
        generatedAt: new Date().toISOString(),
      });
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
      link.href = url;
      link.download = `farmtwin-live-bundle-${id.slice(0, 8)}-${stamp}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      await sb.from("events").insert({
        session_id: id,
        type: "bundle_exported",
        actor_kind: "human",
        actor_id: me.id,
        payload: { sha256: bundle.bundle_sha256, events_through_id: bundle.events_through_id },
      });
      push(`Downloaded Evidence Bundle · sha256 ${bundle.bundle_sha256.slice(0, 10)}`, "ok");
      refresh();
    } catch (err) {
      push(`Could not build the bundle: ${err instanceof Error ? err.message : String(err)}`, "error");
    } finally {
      setExporting(false);
    }
  };

  if (data.notFound) {
    return (
      <Centered>
        Session not found.{" "}
        <Link href="/" className="text-emerald-700 underline">
          Create a new session
        </Link>
      </Centered>
    );
  }
  if (!s || !me) return <Centered>{data.error ? `Could not load: ${data.error}` : "Loading the session…"}</Centered>;

  const header = (
    <SessionHeader
      session={s}
      participants={data.participants}
      online={data.online}
      me={me}
      events={data.events}
      rtStatus={data.rtStatus}
      onQR={() => setShowQR(true)}
      onExport={exportBundle}
      exporting={exporting}
      handoff={isOwner ? <HandoffMenu sessionId={id} me={me} participants={data.participants} online={data.online} onDone={push} /> : null}
    />
  );
  const gatePanel = (
    <GatePanel session={s} gates={data.gates} participants={data.participants} online={data.online} me={me} isOwner={isOwner} isDesktop={isDesktop} toast={push} refresh={refresh} />
  );
  const steerBox = <SteerBox session={s} me={me} isOwner={isOwner} initialRequest={initialRequest} toast={push} refresh={refresh} />;
  const timeline = <AgentTimeline session={s} events={data.events} participants={data.participants} onRetry={() => void callDraft("steer")} />;

  return (
    <div className="min-h-screen bg-slate-100">
      <ToastStack toasts={toasts} />
      {header}
      <div className="border-b border-emerald-100 bg-emerald-50 px-4 py-1.5 text-center text-xs text-emerald-900">{DEMO_LINE}</div>
      {data.error ? <div className="bg-amber-100 px-4 py-1.5 text-center text-xs text-amber-900">Connection problem: {data.error} — retrying automatically</div> : null}

      {isDesktop ? (
        <main className="mx-auto grid max-w-[1500px] grid-cols-12 gap-4 p-4">
          <section className="col-span-12 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 xl:col-span-5">
            <SectionTitle title="Test replay" note="Real records · judged by evaluate.py" />
            {seed ? (
              <ReplayCanvas
                seed={seed}
                workerZone={s.worker_zone}
                inputMinGap={s.scenario.requirements.min_front_gap_m}
                cursorOut={data.sendCursor}
                cursorIn={data.onCursor}
                canBroadcast={isOwner}
                meId={me.id}
              />
            ) : (
              <p className="text-sm text-slate-500">{seedError ? `Could not load the records: ${seedError}` : "Loading the records…"}</p>
            )}
            <ScenarioCard session={s} />
          </section>
          <section className="col-span-12 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 md:col-span-6 xl:col-span-4">
            <SectionTitle title="Agent session" note="draft → steer → re-draft" />
            <div className="max-h-[560px] overflow-y-auto pr-1">{timeline}</div>
            {steerBox}
          </section>
          <section className="col-span-12 flex flex-col gap-4 md:col-span-6 xl:col-span-3">
            <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4">
              <SectionTitle title="Approval gates" note="on every screen at once" />
              {gatePanel}
            </div>
            <div className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-4">
              <SectionTitle title="Audit log" note="who did what, when" />
              <AuditLog events={data.events} participants={data.participants} />
            </div>
          </section>
        </main>
      ) : (
        <main className="flex flex-col gap-3 p-3 pb-24">
          {gatePanel}
          {steerBox}
          <details className="rounded-xl border border-slate-200 bg-white p-3" open>
            <summary className="text-sm font-semibold text-slate-700">Agent timeline</summary>
            <div className="mt-2">{timeline}</div>
          </details>
          <details className="rounded-xl border border-slate-200 bg-white p-3">
            <summary className="text-sm font-semibold text-slate-700">Current scenario</summary>
            <div className="mt-2">
              <ScenarioCard session={s} />
            </div>
          </details>
          <details className="rounded-xl border border-slate-200 bg-white p-3">
            <summary className="text-sm font-semibold text-slate-700">Audit log</summary>
            <div className="mt-2">
              <AuditLog events={data.events} participants={data.participants} />
            </div>
          </details>
        </main>
      )}
      {showQR ? <JoinQR sessionId={id} onClose={() => setShowQR(false)} /> : null}
    </div>
  );
}

function ScenarioCard({ session }: { session: SessionRow }) {
  const sc = session.scenario;
  const v = session.variants;
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-xl bg-slate-50 p-3 text-xs text-slate-700 sm:grid-cols-3">
      <span>Corridor {sc.corridor.length_m} × {sc.corridor.width_m} m</span>
      <span>Obstacle center x {sc.obstacle.center_x_m} m</span>
      <span>Threshold ≥ {fmtM(sc.requirements.min_front_gap_m, 2)}</span>
      <span>
        A stop trigger {fmtM(v.A.stop_sensor_distance_m, 2)} · {v.A.target_speed_mps} m/s
      </span>
      <span>
        B stop trigger {fmtM(v.B.stop_sensor_distance_m, 2)} · {v.B.target_speed_mps} m/s
      </span>
      <span className={session.worker_zone ? "font-semibold text-amber-800" : "text-slate-400"}>
        Worker zone {session.worker_zone ? fmtValue(session.worker_zone) : "none"}
      </span>
      <span className="col-span-full text-[11px] text-slate-500">
        {sc.crop_application.crop} · {sc.crop_application.task} · design assumptions (not field-measured) · excluded: {sc.crop_application.exclusions.join(", ")}
      </span>
    </div>
  );
}

function SectionTitle({ title, note }: { title: string; note?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <h2 className="text-sm font-bold text-slate-800">{title}</h2>
      {note ? <span className="text-[11px] text-slate-500">{note}</span> : null}
    </div>
  );
}

export function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6 text-center text-sm text-slate-600">{children}</div>;
}

export function ConfigMissing() {
  return (
    <Centered>
      Supabase environment variables (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY) are missing. Add them to .env.local or Vercel and restart.
    </Centered>
  );
}
