import { fmtValue } from "@/lib/format";
import { changeLabel } from "@/lib/patch";
import type { Change, DraftView, ReviewT } from "@/lib/types";

/** 초안 요약·변경 목록·근거·범위 밖·질문 — 타임라인과 ①게이트에서 같이 쓴다. */
export function DraftDetails({ draft, changes, compact }: { draft: DraftView; changes: Change[]; compact?: boolean }) {
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="text-slate-800">{draft.summary}</p>
      {changes.length ? (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
          {changes.map((c) => (
            <li key={c.path} className="flex flex-wrap items-baseline gap-x-2 px-3 py-1.5 text-xs">
              <span className={`font-semibold ${c.path === "worker_zone" ? "text-amber-800" : c.path.includes("requirements") ? "text-violet-700" : "text-slate-700"}`}>
                {changeLabel(c.path)}
              </span>
              <span className="text-slate-400 line-through">{fmtValue(c.before)}</span>
              <span className="text-slate-400">→</span>
              <span className="font-semibold text-slate-900">{fmtValue(c.after)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-slate-500">No setting changes — proposes running the current scenario as is</p>
      )}
      {!compact && draft.rationale.length ? (
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-slate-600">
          {draft.rationale.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      ) : null}
      {draft.out_of_scope.length ? (
        <div className="rounded-md bg-slate-50 px-2 py-1.5 text-xs text-slate-500">
          <span className="font-semibold">Out of scope (not applied): </span>
          {draft.out_of_scope.join(" · ")}
        </div>
      ) : null}
      {draft.questions.length ? (
        <div className="rounded-md bg-sky-50 px-2 py-1.5 text-xs text-sky-900">
          <span className="font-semibold">Agent questions: </span>
          {draft.questions.join(" · ")}
        </div>
      ) : null}
    </div>
  );
}

const SEV: Record<string, string> = {
  block: "bg-red-100 text-red-800",
  warn: "bg-amber-100 text-amber-900",
  info: "bg-slate-100 text-slate-700",
};

export function ReviewDetails({ review }: { review: ReviewT }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-violet-200 bg-violet-50/50 p-2 text-xs">
      <div className="flex items-center gap-2">
        <span className="font-semibold text-violet-900">Review agent</span>
        <span className={`rounded px-1.5 py-0.5 font-bold ${review.verdict === "OK" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"}`}>
          {review.verdict}
        </span>
        <span className="text-slate-600">{review.summary}</span>
      </div>
      {review.findings.map((f, i) => (
        <div key={i} className="flex items-start gap-2">
          <span className={`shrink-0 rounded px-1.5 py-0.5 font-semibold ${SEV[f.severity] ?? SEV.info}`}>
            {f.severity} · {f.code}
          </span>
          <span className="text-slate-700">{f.message}</span>
        </div>
      ))}
    </div>
  );
}
