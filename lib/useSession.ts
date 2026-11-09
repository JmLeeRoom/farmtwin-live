"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getBrowserSupabase } from "./supabase";
import type { AgentStepRow, EventRow, GateRow, ParticipantRow, Role, RunRequestRow, SessionRow } from "./types";

export interface PresenceMeta {
  participantId: string;
  name: string;
  role: Role;
  at: string;
}

export interface CursorPayload {
  runA: string;
  runB: string;
  t: number;
  playing: boolean;
  speed: number;
  by: string;
}

export interface SessionData {
  session: SessionRow | null;
  participants: ParticipantRow[];
  gates: GateRow[];
  events: EventRow[];
  agentSteps: AgentStepRow[];
  runRequests: RunRequestRow[];
}

const EMPTY: SessionData = { session: null, participants: [], gates: [], events: [], agentSteps: [], runRequests: [] };
const STEP_COLUMNS =
  "id,session_id,role,provider,model_id,fallback_used,prompt_sha256,response_sha256,input_tokens,output_tokens,latency_ms,created_at";

/**
 * 세션 데이터: DB 행이 진실. Realtime 변경 알림이 오면 전체를 다시 읽는다(병합 로직 없음).
 * 구독이 끊겨도 5초 폴링 + 화면 복귀(visibilitychange)·online 이벤트로 재조회한다.
 */
export function useSessionData(sessionId: string, meId: string | null) {
  const sb = getBrowserSupabase();
  const [data, setData] = useState<SessionData>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState<Record<string, PresenceMeta>>({});
  const [rtStatus, setRtStatus] = useState<"connecting" | "live" | "polling">("connecting");
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const presenceCh = useRef<RealtimeChannel | null>(null);
  const cursorListeners = useRef(new Set<(c: CursorPayload) => void>());

  const load = useCallback(async () => {
    const my = ++seq.current;
    try {
      const [s, p, g, e, a, r] = await Promise.all([
        sb.from("sessions").select("*").eq("id", sessionId).maybeSingle(),
        sb.from("participants").select("*").eq("session_id", sessionId).order("joined_at"),
        sb.from("gates").select("*").eq("session_id", sessionId).order("created_at"),
        sb.from("events").select("*").eq("session_id", sessionId).order("id").limit(1000),
        sb.from("agent_steps").select(STEP_COLUMNS).eq("session_id", sessionId).order("created_at"),
        sb.from("run_requests").select("*").eq("session_id", sessionId).order("created_at"),
      ]);
      if (my !== seq.current) return;
      const firstError = [s, p, g, e, a, r].find((x) => x.error)?.error;
      if (firstError) throw new Error(firstError.message);
      if (!s.data) {
        setNotFound(true);
        return;
      }
      setData({
        session: s.data as SessionRow,
        participants: (p.data ?? []) as ParticipantRow[],
        gates: (g.data ?? []) as GateRow[],
        events: (e.data ?? []) as EventRow[],
        agentSteps: (a.data ?? []) as unknown as AgentStepRow[],
        runRequests: (r.data ?? []) as RunRequestRow[],
      });
      setError(null);
    } catch (err) {
      if (my === seq.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, [sb, sessionId]);

  const schedule = useCallback(
    (ms = 150) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void load(), ms);
    },
    [load],
  );

  // 최초 로드 + 폴링 + 화면 복귀·네트워크 복구 시 재조회
  useEffect(() => {
    schedule(0);
    const poll = setInterval(() => schedule(0), 5000);
    const onVisible = () => document.visibilityState === "visible" && schedule(0);
    const onOnline = () => schedule(0);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    return () => {
      clearInterval(poll);
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
    };
  }, [schedule]);

  // DB 변경 알림(Realtime postgres_changes) — 프레즌스와 채널을 나눠서, 이게 실패해도 프레즌스는 산다
  useEffect(() => {
    const filter = `session_id=eq.${sessionId}`;
    const ch = sb
      .channel(`db:${sessionId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "sessions", filter: `id=eq.${sessionId}` }, () => schedule())
      .on("postgres_changes", { event: "*", schema: "public", table: "participants", filter }, () => schedule())
      .on("postgres_changes", { event: "*", schema: "public", table: "gates", filter }, () => schedule())
      .on("postgres_changes", { event: "*", schema: "public", table: "events", filter }, () => schedule())
      .on("postgres_changes", { event: "*", schema: "public", table: "run_requests", filter }, () => schedule())
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setRtStatus("live");
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") setRtStatus("polling");
      });
    return () => {
      void sb.removeChannel(ch);
    };
  }, [sb, sessionId, schedule]);

  // 프레즌스 + 재생 커서 방송 (참가자 행을 읽은 뒤에 시작)
  const me = data.participants.find((p) => p.id === meId) ?? null;
  const meName = me?.name;
  const meRole = me?.role;
  useEffect(() => {
    if (!meId || !meName || !meRole) return;
    const listeners = cursorListeners.current;
    const ch = sb.channel(`presence:${sessionId}`, { config: { presence: { key: meId }, broadcast: { self: false } } });
    ch.on("presence", { event: "sync" }, () => {
      const state = ch.presenceState<PresenceMeta>();
      const map: Record<string, PresenceMeta> = {};
      for (const [key, metas] of Object.entries(state)) if (metas[0]) map[key] = metas[0];
      setOnline(map);
    });
    ch.on("broadcast", { event: "replay_cursor" }, ({ payload }) => {
      for (const fn of listeners) fn(payload as CursorPayload);
    });
    ch.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await ch.track({ participantId: meId, name: meName, role: meRole, at: new Date().toISOString() });
      }
    });
    presenceCh.current = ch;
    return () => {
      presenceCh.current = null;
      void sb.removeChannel(ch);
    };
  }, [sb, sessionId, meId, meName, meRole]);

  const sendCursor = useCallback((c: CursorPayload) => {
    void presenceCh.current?.send({ type: "broadcast", event: "replay_cursor", payload: c });
  }, []);

  const onCursor = useCallback((fn: (c: CursorPayload) => void) => {
    const set = cursorListeners.current;
    set.add(fn);
    return () => {
      set.delete(fn);
    };
  }, []);

  const refresh = useCallback(() => schedule(0), [schedule]);

  return useMemo(
    () => ({ ...data, loading, notFound, error, online, rtStatus, refresh, sendCursor, onCursor }),
    [data, loading, notFound, error, online, rtStatus, refresh, sendCursor, onCursor],
  );
}

export type SessionHook = ReturnType<typeof useSessionData>;
