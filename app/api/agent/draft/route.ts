import { NextResponse } from "next/server";
import { runDraft } from "@/lib/agent";
import { supabaseAgentDb } from "@/lib/db";
import { drafterEntries, reviewerEntries } from "@/lib/providers";
import { DraftRequest } from "@/lib/schemas";
import { getServerSupabase, supabaseConfigured } from "@/lib/supabase";

export const maxDuration = 60;

export async function POST(request: Request) {
  if (!supabaseConfigured()) return NextResponse.json({ ok: false, reason: "supabase_not_configured" }, { status: 500 });
  const parsed = DraftRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, reason: "bad_request" }, { status: 400 });
  try {
    const r = await runDraft(
      {
        db: supabaseAgentDb(getServerSupabase()),
        drafters: drafterEntries(),
        reviewers: reviewerEntries(),
        maxSteps: Number(process.env.AGENT_MAX_STEPS_PER_SESSION ?? 30),
        timeoutMs: Number(process.env.AGENT_TIMEOUT_MS ?? 15000),
      },
      parsed.data,
    );
    return NextResponse.json(r.body, { status: r.status });
  } catch (err) {
    return NextResponse.json({ ok: false, reason: "server_error", message: String(err).slice(0, 300) }, { status: 500 });
  }
}
