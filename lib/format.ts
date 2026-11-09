import { GATE_TITLE, ROLE_LABEL } from "./constants";
import type { EventRow, GateKind, ParticipantRow, Role } from "./types";

export function timeHMS(iso: string): string {
  return new Date(iso).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Asia/Seoul",
  });
}

export const fmtM = (v: unknown, digits = 3) => (typeof v === "number" && Number.isFinite(v) ? `${v.toFixed(digits)} m` : "—");

export function fmtValue(v: unknown): string {
  if (v === null || v === undefined) return "없음";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(4)));
  if (typeof v === "boolean") return v ? "예" : "아니오";
  if (typeof v === "object") {
    const z = v as Record<string, unknown>;
    if ("x_min_m" in z) return `x ${z.x_min_m}–${z.x_max_m} m · y ${z.y_min_m}–${z.y_max_m} m`;
    return JSON.stringify(v);
  }
  return String(v);
}

export function whoOf(e: EventRow, byId: Map<string, ParticipantRow>): string {
  if (e.actor_kind === "human" && e.actor_id) {
    const p = byId.get(e.actor_id);
    if (p) return p.name === ROLE_LABEL[p.role] ? p.name : `${p.name}(${ROLE_LABEL[p.role]})`;
    const name = e.payload?.name ? String(e.payload.name) : "참가자";
    const role = e.payload?.role ? ROLE_LABEL[e.payload.role as Role] : null;
    return role && role !== name ? `${name}(${role})` : name;
  }
  if (e.actor_kind === "agent") {
    const a = e.actor_id ?? "agent";
    if (a.startsWith("drafter")) return `설계 에이전트${a.includes(":") ? " · " + a.split(":")[1] : ""}`;
    if (a.startsWith("reviewer")) return `검수 에이전트${a.includes(":") ? " · " + a.split(":")[1] : ""}`;
    if (a.startsWith("explainer")) return `설명 에이전트${a.includes(":") ? " · " + a.split(":")[1] : ""}`;
    return a;
  }
  return "시스템";
}

const gateName = (k: unknown) => GATE_TITLE[(k as GateKind) ?? "scenario"] ?? String(k);

/** 감사 로그 한 줄 */
export function describeEvent(e: EventRow): string {
  const p = e.payload ?? {};
  switch (e.type) {
    case "session_created":
      return "세션을 만들었습니다";
    case "seed_loaded":
      return `실제 기록 불러옴 · ${String(p.batchId ?? "").slice(0, 24)} · sha256 ${String(p.sha256 ?? "").slice(0, 10)}`;
    case "joined":
      return "세션에 참가했습니다";
    case "request":
      return `요청: ${String(p.text ?? "")}`;
    case "steer":
      return `개입: ${String(p.text ?? "")}`;
    case "agent_started":
      return "초안 작성을 시작했습니다";
    case "agent_step":
      return p.no_change ? "변경할 내용이 없다고 판단했습니다" : `초안 제출 · 변경 ${Array.isArray(p.changes) ? p.changes.length : 0}건`;
    case "review_step": {
      const r = p.review as { verdict?: string; findings?: unknown[] } | undefined;
      return `검수 ${r?.verdict ?? "?"} · 지적 ${r?.findings?.length ?? 0}건`;
    }
    case "review_failed":
      return "검수 에이전트 무응답 → 사람 검수로 진행";
    case "agent_failed":
      return "에이전트 응답 없음";
    case "provider_switch":
      return `제공자 전환: ${String(p.from)} → ${String(p.to)}`;
    case "gate_opened":
      return `${gateName(p.kind)} 게이트 열림 · ${p.required_role ? `${ROLE_LABEL[p.required_role as Role]} ` : ""}승인 대기`;
    case "gate_decided":
      return `${gateName(p.kind)} ${p.decision === "approved" ? "승인" : "반려"}${p.override ? "(대리·지적 확인)" : ""}${p.comment ? ` · “${String(p.comment)}”` : ""}`;
    case "gate_superseded":
      return "이전 ① 게이트를 새 초안으로 대체했습니다";
    case "draft_discarded":
      return `초안 폐기 · ${String(p.reason ?? "")}`;
    case "run_requested":
      return p.runner_online ? "로컬 러너에 실행을 요청했습니다" : "러너 오프라인 → 기존 기록으로 검수";
    case "run_done":
      return "로컬 러너 실행 완료";
    case "run_failed":
      return "로컬 러너 실행 실패";
    case "explain_ready":
      return `결과 설명 준비 · ${Array.isArray(p.run_ids) ? p.run_ids.length : 0}건`;
    case "handoff":
      return `소유자 인계 → ${String(p.to_name ?? "")}`;
    case "bundle_exported":
      return `Evidence Bundle 내보냄 · sha256 ${String(p.sha256 ?? "").slice(0, 10)}`;
    default:
      return e.type;
  }
}

/** 마지막 글자의 받침: -1 알 수 없음 · 0 없음 · 8 ㄹ · 그 밖은 받침 있음. 숫자는 한국어 읽기(영·일·이·삼…)로 본다. */
function finalJong(word: string): number {
  const ch = word.trim().slice(-1);
  if (!ch) return -1;
  const digit = "0123456789".indexOf(ch);
  if (digit >= 0) return [21, 8, 0, 16, 0, 0, 1, 8, 8, 0][digit];
  const c = ch.charCodeAt(0);
  if (c < 0xac00 || c > 0xd7a3) return -1;
  return (c - 0xac00) % 28;
}

/** '으로'/'로' (받침 없음·ㄹ받침 → 로) */
export function withRo(word: string): string {
  const j = finalJong(word);
  return `${word}${j < 0 ? "(으)로" : j === 0 || j === 8 ? "로" : "으로"}`;
}

/** '을'/'를' */
export function withEul(word: string): string {
  const j = finalJong(word);
  return `${word}${j < 0 ? "을(를)" : j === 0 ? "를" : "을"}`;
}
