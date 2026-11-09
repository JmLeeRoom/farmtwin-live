import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const supabaseConfigured = () => Boolean(url && anon);

let browserClient: SupabaseClient | null = null;

/** 브라우저용 단일 클라이언트. 로그인 없음(해커톤용 anon + RLS 전체 허용). */
export function getBrowserSupabase(): SupabaseClient {
  if (!browserClient) {
    browserClient = createClient(url || "http://invalid.local", anon || "missing", {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { params: { eventsPerSecond: 10 } },
    });
  }
  return browserClient;
}

/** 서버 라우트용. 요청마다 새로 만든다. */
export function getServerSupabase(): SupabaseClient {
  return createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
}
