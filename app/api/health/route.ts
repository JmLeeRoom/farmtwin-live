import { NextResponse, connection } from "next/server";
import { PING_SYSTEM } from "@/lib/prompts";
import { callText, describeError, drafterEntries, reviewerEntries } from "@/lib/providers";
import { getServerSupabase, supabaseConfigured } from "@/lib/supabase";

export const maxDuration = 60;

const ENV_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "CODYSSEY_ANTHROPIC_BASE_URL",
  "CODYSSEY_DRAFT_KEY",
  "CODYSSEY_MODEL",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_MODEL",
  "CODYSSEY_OPENAI_BASE_URL",
  "CODYSSEY_REVIEW_KEY",
  "REVIEWER_MODEL",
  "GOOGLE_GENERATIVE_AI_API_KEY",
] as const;

/** GET /api/health — env 유무(값은 내보내지 않음)·Supabase 연결. ?ping=1 이면 제공자마다 "OK" 1회 호출. */
export async function GET(request: Request) {
  await connection();
  const ping = new URL(request.url).searchParams.get("ping") === "1";
  const env = Object.fromEntries(ENV_KEYS.map((k) => [k, Boolean(process.env[k])]));

  let supabase: { ok: boolean; error?: string } = { ok: false, error: "env missing" };
  if (supabaseConfigured()) {
    const r = await getServerSupabase().from("sessions").select("id", { count: "exact", head: true });
    supabase = r.error ? { ok: false, error: r.error.message } : { ok: true };
  }

  const drafters = drafterEntries();
  const reviewers = reviewerEntries();
  const providers = [
    ...drafters.map((e, i) => ({ role: i === 0 ? "drafter(main)" : "drafter(fallback)", e })),
    ...reviewers.map((e) => ({ role: "reviewer", e })),
  ];

  const result = await Promise.all(
    providers.map(async ({ role, e }) => {
      const base = { role, label: e.label, provider: e.provider, model: e.modelId };
      if (!ping) return base;
      const t0 = Date.now();
      try {
        const r = await callText(e, PING_SYSTEM, "OK", { timeoutMs: 12000, maxOutputTokens: 16 });
        return { ...base, ok: true, latency_ms: Date.now() - t0, reply: r.text.slice(0, 20) };
      } catch (err) {
        return { ...base, ok: false, latency_ms: Date.now() - t0, error: describeError(err) };
      }
    }),
  );

  return NextResponse.json({
    ok: supabase.ok && drafters.length > 0,
    supabase,
    env,
    drafter_order: drafters.map((e) => e.label),
    providers: result,
    hint: ping ? undefined : "Add ?ping=1 to call each provider once and check the connection",
  });
}
