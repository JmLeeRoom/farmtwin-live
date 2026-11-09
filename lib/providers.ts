import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText, type LanguageModel } from "ai";
import type { z } from "zod";
import { extractJsonObject } from "./schemas";
import { retrySuffix } from "./prompts";

/** 한 제공자 = 한 에이전트 참가자. provider·modelId는 출처 기록(agent_steps, Evidence Bundle)에 그대로 남는다. */
export interface ProviderEntry {
  label: "codyssey" | "anthropic" | "codyssey-openai" | "gemini";
  provider: string;
  modelId: string;
  model: LanguageModel;
}

type Env = Record<string, string | undefined>;

/** Anthropic 호환 base URL은 AI SDK 규칙상 /v1까지 포함해야 한다. 코디세이 문서가 /v1 없이 주면 붙인다. */
export function normalizeAnthropicBase(url: string): string {
  const u = url.trim().replace(/\/+$/, "");
  return /\/v1$/.test(u) ? u : `${u}/v1`;
}

/** OpenAI 호환 base URL: 경로가 비어 있으면 /v1을 붙이고, 이미 경로가 있으면(예: …/openai) 그대로 둔다. */
export function normalizeOpenAIBase(url: string): string {
  const u = url.trim().replace(/\/+$/, "");
  try {
    const p = new URL(u).pathname;
    return p === "" || p === "/" ? `${u}/v1` : u;
  } catch {
    return u;
  }
}

function codysseyEntry(env: Env): ProviderEntry | null {
  const base = env.CODYSSEY_ANTHROPIC_BASE_URL;
  const key = env.CODYSSEY_DRAFT_KEY;
  const modelId = env.CODYSSEY_MODEL;
  if (!base || !key || !modelId) return null;
  const style = (env.CODYSSEY_AUTH_STYLE ?? "both").toLowerCase();
  const provider = createAnthropic({
    baseURL: normalizeAnthropicBase(base),
    ...(style === "bearer" ? { authToken: key } : { apiKey: key }),
    ...(style === "both" ? { headers: { Authorization: `Bearer ${key}` } } : {}),
  });
  return { label: "codyssey", provider: "codyssey", modelId, model: provider(modelId) };
}

function anthropicEntry(env: Env): ProviderEntry | null {
  const key = env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const modelId = env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
  const provider = createAnthropic({ apiKey: key });
  return { label: "anthropic", provider: "anthropic", modelId, model: provider(modelId) };
}

export function drafterEntries(env: Env = process.env): ProviderEntry[] {
  const all: Record<string, ProviderEntry | null> = { codyssey: codysseyEntry(env), anthropic: anthropicEntry(env) };
  const order = (env.DRAFTER_ORDER ?? "codyssey,anthropic").split(",").map((s) => s.trim());
  const out: ProviderEntry[] = [];
  for (const name of order) {
    const e = all[name];
    if (e && !out.includes(e)) out.push(e);
  }
  for (const e of Object.values(all)) if (e && !out.includes(e)) out.push(e);
  return out;
}

/** 검수 에이전트는 설계 에이전트와 다른 모델이어야 의미가 있다(작성자·검수자 분리). */
export function reviewerEntries(env: Env = process.env): ProviderEntry[] {
  const out: ProviderEntry[] = [];
  if (env.CODYSSEY_OPENAI_BASE_URL && env.CODYSSEY_REVIEW_KEY && env.REVIEWER_MODEL) {
    const p = createOpenAI({ baseURL: normalizeOpenAIBase(env.CODYSSEY_OPENAI_BASE_URL), apiKey: env.CODYSSEY_REVIEW_KEY });
    out.push({ label: "codyssey-openai", provider: "codyssey-openai", modelId: env.REVIEWER_MODEL, model: p.chat(env.REVIEWER_MODEL) });
  }
  if (env.GOOGLE_GENERATIVE_AI_API_KEY) {
    const modelId = env.GEMINI_MODEL || "gemini-2.5-flash";
    const p = createGoogleGenerativeAI({ apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY });
    out.push({ label: "gemini", provider: "gemini", modelId, model: p(modelId) });
  }
  return out;
}

export interface TextResult {
  text: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

export type CallFn = (
  entry: ProviderEntry,
  instructions: string,
  prompt: string,
  opts: { timeoutMs: number; maxOutputTokens: number },
) => Promise<TextResult>;

export const callText: CallFn = async (entry, instructions, prompt, opts) => {
  const r = await generateText({
    model: entry.model,
    instructions,
    prompt,
    maxRetries: 0,
    maxOutputTokens: opts.maxOutputTokens,
    abortSignal: AbortSignal.timeout(opts.timeoutMs),
  });
  return { text: r.text, inputTokens: r.usage?.inputTokens ?? null, outputTokens: r.usage?.outputTokens ?? null };
};

/** 화면·이벤트에 남길 에러 문장. 키는 지운다. */
export function describeError(err: unknown, env: Env = process.env): string {
  const e = err as { name?: string; message?: string; statusCode?: number; url?: string; responseBody?: string };
  let msg = [e?.statusCode ? `HTTP ${e.statusCode}` : null, e?.url ?? null, e?.message ?? String(err)]
    .filter(Boolean)
    .join(" · ");
  if (e?.responseBody) msg += ` · ${e.responseBody.slice(0, 160)}`;
  for (const k of ["CODYSSEY_DRAFT_KEY", "CODYSSEY_REVIEW_KEY", "ANTHROPIC_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"]) {
    const v = env[k];
    if (v && v.length > 6) msg = msg.split(v).join("[key]");
  }
  return msg.slice(0, 400);
}

export interface StructuredResult<T> {
  value: T;
  raw: string;
  promptUsed: string;
  entry: ProviderEntry;
  fallbackUsed: boolean;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
  errors: Array<{ label: string; message: string }>;
}

export class AllProvidersFailed extends Error {
  constructor(public errors: Array<{ label: string; message: string }>) {
    super(errors.length ? errors.map((e) => `${e.label}: ${e.message}`).join(" | ") : "No LLM provider is configured");
  }
}

/**
 * 제공자 순서대로 호출 → JSON 추출 → zod 검증. 검증 실패면 같은 모델로 1회 재시도, 그래도 실패하거나
 * 호출 자체가 실패하면 다음 제공자. 전부 실패하면 AllProvidersFailed.
 */
export async function runStructured<S extends z.ZodTypeAny>(p: {
  entries: ProviderEntry[];
  instructions: string;
  prompt: string;
  schema: S;
  timeoutMs?: number;
  maxOutputTokens?: number;
  budgetMs?: number;
  callFn?: CallFn;
}): Promise<StructuredResult<z.output<S>>> {
  const call = p.callFn ?? callText;
  const timeoutMs = p.timeoutMs ?? 15000;
  const maxOutputTokens = p.maxOutputTokens ?? 1500;
  const budgetMs = p.budgetMs ?? 45000;
  const started = Date.now();
  const errors: Array<{ label: string; message: string }> = [];

  for (let i = 0; i < p.entries.length; i++) {
    const entry = p.entries[i];
    let prompt = p.prompt;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (Date.now() - started > budgetMs) {
        errors.push({ label: entry.label, message: "Time budget exceeded" });
        break;
      }
      let res: TextResult;
      try {
        res = await call(entry, p.instructions, prompt, { timeoutMs, maxOutputTokens });
      } catch (err) {
        errors.push({ label: entry.label, message: describeError(err) });
        break; // 호출 실패 → 다음 제공자
      }
      try {
        const value = p.schema.parse(extractJsonObject(res.text));
        return {
          value,
          raw: res.text,
          promptUsed: prompt,
          entry,
          fallbackUsed: i > 0,
          inputTokens: res.inputTokens,
          outputTokens: res.outputTokens,
          latencyMs: Date.now() - started,
          errors,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push({ label: entry.label, message: `Schema error: ${message.slice(0, 200)}` });
        prompt = p.prompt + retrySuffix(message);
      }
    }
  }
  throw new AllProvidersFailed(errors);
}
