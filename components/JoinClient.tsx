"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { participantKey, readLocal, writeLocal } from "@/lib/client";
import { ROLE_LABEL } from "@/lib/constants";
import { getBrowserSupabase, supabaseConfigured } from "@/lib/supabase";
import type { Role } from "@/lib/types";
import { Centered, ConfigMissing } from "./SessionView";

const ROLES: Role[] = ["safety", "reviewer", "developer"];
const ROLE_HINT: Record<Role, string> = {
  safety: "Approves elderly-worker zones and threshold changes",
  reviewer: "③ Review — checks the evidence and approves",
  developer: "② Run — approves the run request",
};
const parseRole = (v: string | null): Role => (v === "developer" || v === "reviewer" || v === "safety" ? v : "safety");

export default function JoinClient() {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const initialRole = parseRole(search.get("role"));
  const [role, setRole] = useState<Role>(initialRole);
  const [name, setName] = useState(ROLE_LABEL[initialRole]);
  const [title, setTitle] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabaseConfigured()) return;
    const sb = getBrowserSupabase();
    let alive = true;
    sb.from("sessions")
      .select("title")
      .eq("id", id)
      .maybeSingle()
      .then((r) => {
        if (!alive) return;
        if (r.error || !r.data) setNotFound(true);
        else setTitle(r.data.title as string);
      });
    // 이미 이 세션 참가자면 바로 들어간다
    const pid = readLocal(participantKey(id));
    if (pid) {
      sb.from("participants")
        .select("id")
        .eq("id", pid)
        .eq("session_id", id)
        .maybeSingle()
        .then((r) => {
          if (alive && r.data) router.replace(`/s/${id}`);
        });
    }
    return () => {
      alive = false;
    };
  }, [id, router]);

  if (!supabaseConfigured()) return <ConfigMissing />;
  if (notFound) return <Centered>Session not found. Scan the QR code again.</Centered>;

  const join = async () => {
    setBusy(true);
    setError(null);
    const sb = getBrowserSupabase();
    const p = await sb
      .from("participants")
      .insert({ session_id: id, name: name.trim() || ROLE_LABEL[role], role })
      .select("id")
      .single();
    if (p.error) {
      setError(p.error.message);
      setBusy(false);
      return;
    }
    const pid = p.data.id as string;
    await sb.from("events").insert({ session_id: id, type: "joined", actor_kind: "human", actor_id: pid, payload: { name, role } });
    writeLocal(participantKey(id), pid);
    router.replace(`/s/${id}`);
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-5 px-4 py-8">
      <div>
        <span className="text-sm font-bold text-emerald-700">FarmTwin Live · Join session</span>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">{title ?? "Loading the session…"}</h1>
      </div>
      <div className="flex flex-col gap-2">
        {ROLES.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => {
              setRole(r);
              if (Object.values(ROLE_LABEL).includes(name)) setName(ROLE_LABEL[r]);
            }}
            className={`flex min-h-14 flex-col items-start rounded-xl border-2 px-4 py-2 text-left ${role === r ? "border-emerald-600 bg-emerald-50" : "border-slate-200 bg-white"}`}
          >
            <span className="text-base font-bold text-slate-900">{ROLE_LABEL[r]}</span>
            <span className="text-xs text-slate-600">{ROLE_HINT[r]}</span>
          </button>
        ))}
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-semibold text-slate-700">Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} className="min-h-12 rounded-lg border border-slate-300 px-3 text-base" />
      </label>
      <button
        type="button"
        onClick={join}
        disabled={busy || !title}
        className="min-h-14 rounded-xl bg-emerald-700 text-lg font-bold text-white hover:bg-emerald-800 disabled:bg-slate-300"
      >
        {busy ? "Joining…" : `Join as ${ROLE_LABEL[role]}`}
      </button>
      {error ? <p className="text-sm text-red-700">Could not join: {error}</p> : null}
    </main>
  );
}
