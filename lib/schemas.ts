import { z } from "zod";

const clip = (n: number) => (s: string) => s.slice(0, n);

export const WorkerZone = z
  .object({
    x_min_m: z.coerce.number().min(0).max(8),
    x_max_m: z.coerce.number().min(0).max(8),
    y_min_m: z.coerce.number().min(-0.5).max(0.5),
    y_max_m: z.coerce.number().min(-0.5).max(0.5),
    rule: z.literal("STOP_ON_ENTRY").default("STOP_ON_ENTRY"),
    note: z.string().default("시나리오 입력 · 사람 모델·동적 장애물 물리 미구현"),
  })
  .refine((v) => v.x_min_m < v.x_max_m && v.y_min_m < v.y_max_m, { message: "worker_zone 범위 역전" });

const Patch = z.record(z.string(), z.unknown());

/** 설계 에이전트 출력. 길이 초과는 실패시키지 않고 자른다(재시도 비용을 줄이려고). */
export const Draft = z.object({
  summary: z.string().transform(clip(300)),
  scenario_patch: Patch.default({}),
  variant_patches: z
    .object({ A: Patch.default({}), B: Patch.default({}) })
    .default({ A: {}, B: {} }),
  worker_zone: WorkerZone.nullable().default(null),
  rationale: z.array(z.string()).default([]).transform((a) => a.slice(0, 6)),
  out_of_scope: z.array(z.string()).default([]),
  questions: z.array(z.string()).default([]).transform((a) => a.slice(0, 3)),
  rerun_from_run_id: z.string().nullable().default(null),
});
export type DraftOut = z.infer<typeof Draft>;

export const FINDING_CODES = [
  "OUT_OF_SCOPE",
  "SCHEMA",
  "UNIT",
  "THRESHOLD_CHANGED",
  "WORKER_ZONE_MISSING",
  "WORKER_ZONE_RULE_MISSING",
  "OTHER",
] as const;

export const Review = z.object({
  verdict: z.enum(["OK", "NEEDS_CHANGE"]),
  findings: z
    .array(
      z.object({
        code: z.enum(FINDING_CODES).catch("OTHER"),
        severity: z.enum(["info", "warn", "block"]).catch("warn"),
        message: z.string(),
      }),
    )
    .default([]),
  worker_zone_present: z.boolean(),
  summary: z.string().transform(clip(200)),
});
export type ReviewOut = z.infer<typeof Review>;

export const Explain = z.object({
  headline: z.string().transform(clip(80)),
  bullets: z.array(z.string()).transform((a) => a.slice(0, 5)),
  quoted: z.object({
    status: z.string(),
    reason: z.string(),
    reasons: z.array(z.string()).default([]),
  }),
});
export type ExplainOut = z.infer<typeof Explain>;

/** 사람이 입력하는 개입·요청·코멘트. 제어문자 제거 후 1~500자. */
export const SteerText = z
  .string()
  .transform((s) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ""))
  .pipe(z.string().trim().min(1).max(500));

export const DraftRequest = z.object({
  sessionId: z.string().uuid(),
  trigger: z.enum(["request", "steer", "reject"]).default("steer"),
});

export const ExplainRequest = z.object({
  sessionId: z.string().uuid(),
  runIds: z.array(z.string()).min(1).max(4),
});

/** LLM 응답에서 첫 { 부터 마지막 } 까지만 떼어 JSON으로 읽는다(코드펜스·설명 문장 방어). */
export function extractJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("응답에 JSON 객체가 없습니다");
  return JSON.parse(text.slice(start, end + 1));
}
