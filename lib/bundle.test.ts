// T4 — 순수 JS sha256·정규화·Bundle 해시
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildBundle, verifyBundle } from "./bundle";
import { BASE_SCENARIO } from "./constants";
import { canonical, sha256Hex } from "./sha";
import type { SessionRow } from "./types";

describe("T4 sha256·bundle", () => {
  it("node crypto와 같은 sha256 (경계 길이 포함)", () => {
    const samples = ["", "abc", "가나다 FarmTwin", "x".repeat(55), "y".repeat(56), "z".repeat(64), "w".repeat(1000)];
    for (const s of samples) expect(sha256Hex(s)).toBe(createHash("sha256").update(s, "utf8").digest("hex"));
  });

  it("canonical: 키 순서와 무관", () => {
    expect(canonical({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: null } })).toBe(canonical({ a: { c: null, d: [1, { x: 1, y: 2 }] }, b: 1 }));
    expect(canonical({ a: undefined, b: 1 })).toBe('{"b":1}');
  });

  it("Bundle 해시가 결정적이고 검증된다", () => {
    const session = {
      id: "00000000-0000-0000-0000-000000000001",
      title: "t",
      seed_batch_id: "s",
      scenario: BASE_SCENARIO,
      variants: { A: { name: "A", stop_sensor_distance_m: 0.3, target_speed_mps: 0.4, stop_latched: true }, B: { name: "B", stop_sensor_distance_m: 0.8, target_speed_mps: 0.4, stop_latched: true } },
      worker_zone: null,
      owner_participant_id: null,
      state: "bundled",
      agent_busy: false,
      agent_busy_since: null,
      last_steer_consumed_id: 0,
      seed_summary: null,
      explain_cache: {},
      created_at: "2026-11-09T00:00:00Z",
    } satisfies SessionRow;
    const input = { session, participants: [], gates: [], agentSteps: [], runRequests: [], events: [{ id: 3, session_id: session.id, type: "x", actor_kind: "system" as const, actor_id: null, payload: {}, created_at: "2026-11-09T00:00:01Z" }], generatedAt: "2026-11-09T01:00:00Z" };
    const b1 = buildBundle(input);
    const b2 = buildBundle({ ...input, events: [...input.events] });
    expect(b1.bundle_sha256).toBe(b2.bundle_sha256);
    expect(b1.events_through_id).toBe(3);
    expect(verifyBundle(b1)).toBe(true);
    expect(verifyBundle({ ...b1, session: { ...b1.session, title: "변조" } })).toBe(false);
  });
});
