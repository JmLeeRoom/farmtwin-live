// T5 — 제공자 폴백·스키마 재시도·base URL 정규화
import { describe, expect, it } from "vitest";
import { AllProvidersFailed, drafterEntries, normalizeAnthropicBase, normalizeOpenAIBase, reviewerEntries, runStructured, type CallFn, type ProviderEntry } from "./providers";
import { Draft } from "./schemas";

const entry = (label: ProviderEntry["label"]): ProviderEntry => ({ label, provider: label, modelId: `${label}-model`, model: `${label}-model` });
const GOOD = JSON.stringify({ summary: "ok", scenario_patch: {} });

describe("T5 providers", () => {
  it("첫 제공자가 실패하면 다음 제공자로 넘어가고 fallbackUsed=true", async () => {
    const calls: string[] = [];
    const callFn: CallFn = async (e) => {
      calls.push(e.label);
      if (e.label === "codyssey") throw Object.assign(new Error("boom"), { statusCode: 500 });
      return { text: GOOD, inputTokens: 10, outputTokens: 5 };
    };
    const r = await runStructured({ entries: [entry("codyssey"), entry("anthropic")], instructions: "s", prompt: "p", schema: Draft, callFn });
    expect(calls).toEqual(["codyssey", "anthropic"]);
    expect(r.fallbackUsed).toBe(true);
    expect(r.entry.label).toBe("anthropic");
    expect(r.errors[0].message).toContain("HTTP 500");
  });

  it("스키마 오류면 같은 모델로 1회 재시도(오류 문장을 붙여서)", async () => {
    const prompts: string[] = [];
    let n = 0;
    const callFn: CallFn = async (_e, _s, prompt) => {
      prompts.push(prompt);
      n += 1;
      return { text: n === 1 ? "```json\n{\"nope\":1}\n```" : `설명\n${GOOD}`, inputTokens: null, outputTokens: null };
    };
    const r = await runStructured({ entries: [entry("codyssey"), entry("anthropic")], instructions: "s", prompt: "p", schema: Draft, callFn });
    expect(n).toBe(2);
    expect(prompts[1]).toContain("[이전 응답 오류]");
    expect(r.fallbackUsed).toBe(false);
    expect(r.promptUsed).toBe(prompts[1]);
  });

  it("전부 실패하면 AllProvidersFailed", async () => {
    const callFn: CallFn = async () => {
      throw new Error("down");
    };
    await expect(runStructured({ entries: [entry("codyssey"), entry("anthropic")], instructions: "s", prompt: "p", schema: Draft, callFn })).rejects.toBeInstanceOf(AllProvidersFailed);
  });

  it("base URL 정규화: Anthropic은 /v1까지, OpenAI는 빈 경로에만 /v1", () => {
    expect(normalizeAnthropicBase("https://api.example.com")).toBe("https://api.example.com/v1");
    expect(normalizeAnthropicBase("https://api.example.com/v1/")).toBe("https://api.example.com/v1");
    expect(normalizeAnthropicBase("https://x.dev/anthropic")).toBe("https://x.dev/anthropic/v1");
    expect(normalizeOpenAIBase("https://api.example.com")).toBe("https://api.example.com/v1");
    expect(normalizeOpenAIBase("https://generativelanguage.googleapis.com/v1beta/openai/")).toBe("https://generativelanguage.googleapis.com/v1beta/openai");
  });

  it("env에서 제공자 순서를 만든다(DRAFTER_ORDER, 키 없는 제공자 제외)", () => {
    const env = { CODYSSEY_ANTHROPIC_BASE_URL: "https://c.example", CODYSSEY_DRAFT_KEY: "k1234567", CODYSSEY_MODEL: "m", ANTHROPIC_API_KEY: "k7654321" };
    expect(drafterEntries(env).map((e) => e.label)).toEqual(["codyssey", "anthropic"]);
    expect(drafterEntries({ ...env, DRAFTER_ORDER: "anthropic,codyssey" }).map((e) => e.label)).toEqual(["anthropic", "codyssey"]);
    expect(drafterEntries({ ANTHROPIC_API_KEY: "k" }).map((e) => e.label)).toEqual(["anthropic"]);
    expect(reviewerEntries({}).length).toBe(0);
    expect(reviewerEntries({ GOOGLE_GENERATIVE_AI_API_KEY: "g" })[0].label).toBe("gemini");
  });
});
