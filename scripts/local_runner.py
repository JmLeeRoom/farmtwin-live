#!/usr/bin/env python3
"""FarmTwin Live 로컬 러너 (선택 · Python 표준 라이브러리만) — docs/SPEC.md §15

하는 일
  - 30초마다 runners 하트비트(id, last_seen). ②승인 시 decide_gate가 30초 안의 하트비트를 보면 '온라인'으로 판단한다.
  - 5초마다 status='queued' 실행 요청을 하나 가져와 조건부로 'running'으로 바꾼 뒤(먼저 잡은 러너만 실행),
    FarmTwinAI의 `python -m farmtwin rerun --from-run <보관 run 폴더>`로 Webots 재실행을 한다.
  - 끝나면 run_requests.result를 채우고, ③ 검수 게이트(source='rerun')를 직접 열고 세션을 gate_review로 바꾼다.
    (러너 온라인 경로에서는 decide_gate가 ③을 만들지 않는다.)

안전
  - DB의 command 문자열은 절대 실행하지 않는다. from_run_id를 시드 batch의 run 목록과 대조한 뒤 인자 배열을 직접 조립한다.
  - `farmtwin rerun`은 보관 입력을 그대로 재실행한다(새 시나리오 실행 아님). 버전 불일치면 rerun이 스스로 거부한다 — 설계대로다.

사용 (PowerShell)
  $env:SUPABASE_URL = "https://<project>.supabase.co"
  $env:SUPABASE_ANON_KEY = "<anon key>"
  python scripts\\local_runner.py --farmtwin-root "C:\\Users\\togod\\OneDrive\\바탕 화면\\멘토링\\FarmTwinAI"
  # 연결만 확인:  python scripts\\local_runner.py --farmtwin-root ... --once --dry-run
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

DEFAULT_BATCH = "strawberry-20261101-final"
RUN_ID_RE = re.compile(r"^run-[AB]-\d{2}-[0-9a-f]{32}$")


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def log(msg: str) -> None:
    print(f"[{dt.datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


class Rest:
    """Supabase PostgREST 최소 클라이언트 (anon key)."""

    def __init__(self, url: str, key: str) -> None:
        self.base = url.rstrip("/") + "/rest/v1"
        self.key = key

    def call(self, method: str, path: str, body: object | None = None, prefer: str | None = None) -> object:
        headers = {"apikey": self.key, "Authorization": f"Bearer {self.key}", "Content-Type": "application/json", "Accept": "application/json"}
        if prefer:
            headers["Prefer"] = prefer
        data = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(self.base + path, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=20) as res:
                raw = res.read().decode("utf-8")
                return json.loads(raw) if raw.strip() else None
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")[:300]
            raise RuntimeError(f"{method} {path.split('?')[0]} → HTTP {e.code}: {detail}") from None

    @staticmethod
    def q(value: str) -> str:
        return urllib.parse.quote(value, safe="")


def load_run_ids(farmtwin_root: Path, batch: str) -> set[str]:
    """시드 batch의 run 목록(whitelist). report-data.json의 runs[].id → 없으면 폴더 이름."""
    batch_dir = farmtwin_root / "output" / batch
    ids: set[str] = set()
    report = batch_dir / "report-data.json"
    if report.is_file():
        data = json.loads(report.read_text(encoding="utf-8"))
        for run in data.get("runs", []):
            rid = run.get("id") or run.get("runId")
            if isinstance(rid, str):
                ids.add(rid)
    if not ids and batch_dir.is_dir():
        ids = {p.name for p in batch_dir.iterdir() if p.is_dir() and p.name.startswith("run-")}
    return {i for i in ids if RUN_ID_RE.match(i)}


def read_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def digest_of(run_dir: Path) -> dict:
    """result.json·metrics.json → 화면의 RunDigest 형태."""
    result = read_json(run_dir / "result.json")
    metrics = read_json(run_dir / "metrics.json")
    variant = "B" if run_dir.name.startswith("run-B-") else "A"
    return {
        "variantId": variant,
        "status": str(result.get("status", "UNKNOWN")),
        "reasonCode": str(result.get("reason_code", "")),
        "reason": str(result.get("reason", "")),
        "metrics": {
            "minFrontGapM": float(metrics.get("min_front_gap_m") or 0.0),
            "stopped": bool(metrics.get("stopped")),
            "stopTimeS": float(metrics.get("stop_time_s") or 0.0),
            "afterStopTravelM": float(metrics.get("after_stop_travel_m") or 0.0),
            "progressM": float(metrics.get("progress_m") or 0.0),
        },
        "rerunCommand": None,
    }


def run_rerun(args: argparse.Namespace, from_run_dir: Path) -> tuple[bool, Path | None, str]:
    """`python -m farmtwin rerun --from-run <dir>` 실행. (성공 여부, 새 batch 폴더, 출력 끝부분)"""
    cmd = [str(args.python), "-m", "farmtwin", "rerun", "--from-run", str(from_run_dir)]
    log("실행: " + " ".join(cmd[1:5]) + f" … {from_run_dir.name}")
    env = dict(os.environ, PYTHONIOENCODING="utf-8")
    try:
        p = subprocess.run(cmd, cwd=str(args.farmtwin_root), capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=args.timeout, env=env)
    except subprocess.TimeoutExpired:
        return False, None, f"시간 초과({args.timeout}s)"
    out = (p.stdout or "") + ("\n" + p.stderr if p.stderr else "")
    batch_dir = None
    for line in out.splitlines():
        m = re.match(r"\s*결과 폴더:\s*(.+?)\s*$", line)
        if m:
            batch_dir = Path(m.group(1))
    return p.returncode == 0 and batch_dir is not None, batch_dir, out[-1500:]


def handle(rest: Rest, args: argparse.Namespace, rid_whitelist: set[str], req: dict) -> None:
    rq_id, session_id, from_run = req["id"], req["session_id"], str(req.get("from_run_id", ""))
    claimed = rest.call(
        "PATCH",
        f"/run_requests?id=eq.{rest.q(rq_id)}&status=eq.queued",
        {"status": "running", "updated_at": now_iso()},
        prefer="return=representation",
    )
    if not claimed:
        log(f"다른 러너가 먼저 잡음: {rq_id}")
        return
    actor = f"runner:{args.runner_id}"

    def fail(reason: str, tail: str = "") -> None:
        rest.call("PATCH", f"/run_requests?id=eq.{rest.q(rq_id)}", {"status": "failed", "updated_at": now_iso(), "result": {"error": reason, "output_tail": tail}})
        rest.call("POST", "/events", {"session_id": session_id, "type": "run_failed", "actor_kind": "system", "actor_id": actor, "payload": {"run_request_id": rq_id, "reason": reason}})
        log(f"실패: {reason}")

    if from_run not in rid_whitelist:
        fail(f"허용 목록에 없는 run id: {from_run[:60]}")
        return
    from_dir = args.farmtwin_root / "output" / args.batch / from_run
    if not from_dir.is_dir():
        fail(f"보관 run 폴더 없음: {from_dir}")
        return
    if args.dry_run:
        fail("dry-run: 실행하지 않음")
        return

    ok, batch_dir, tail = run_rerun(args, from_dir)
    if not ok or batch_dir is None:
        fail("rerun 실패(버전 불일치·Webots 오류 등) — 화면에서 기존 기록으로 검수 진행", tail)
        return
    runs = sorted(p for p in batch_dir.iterdir() if p.is_dir() and p.name.startswith("run-"))
    if not runs:
        fail(f"새 run 폴더 없음: {batch_dir}", tail)
        return
    new_run = runs[0]
    digest = digest_of(new_run)
    result = {"batch": batch_dir.name, "run_id": new_run.name, "result": read_json(new_run / "result.json"), "metrics": read_json(new_run / "metrics.json")}
    rest.call("PATCH", f"/run_requests?id=eq.{rest.q(rq_id)}", {"status": "done", "updated_at": now_iso(), "result": result})
    rest.call("POST", "/events", {"session_id": session_id, "type": "run_done", "actor_kind": "system", "actor_id": actor, "payload": {"run_request_id": rq_id, "run_id": new_run.name, "status": digest["status"]}})
    try:
        gate = rest.call(
            "POST",
            "/gates",
            {
                "session_id": session_id,
                "kind": "review",
                "required_role": "reviewer",
                "payload": {"run_id": new_run.name, "from_run_id": from_run, "source": "rerun", "explain": None, "digest": digest, "result": result},
            },
            prefer="return=representation",
        )
    except RuntimeError as e:
        log(f"③ 게이트를 열지 못함(이미 열린 게이트가 있을 수 있음): {e}")
        return
    gate_id = gate[0]["id"] if isinstance(gate, list) and gate else None
    rest.call("PATCH", f"/sessions?id=eq.{rest.q(session_id)}&state=eq.awaiting_run", {"state": "gate_review"})
    rest.call("POST", "/events", {"session_id": session_id, "type": "gate_opened", "actor_kind": "system", "actor_id": actor, "payload": {"gate_id": gate_id, "kind": "review", "required_role": "reviewer"}})
    log(f"완료: {new_run.name} {digest['status']} · ③ 검수 게이트 열림")


def main() -> int:
    ap = argparse.ArgumentParser(description="FarmTwin Live 로컬 러너")
    ap.add_argument("--farmtwin-root", type=Path, required=True, help="FarmTwinAI 프로젝트 폴더")
    ap.add_argument("--python", type=Path, default=None, help="FarmTwinAI 가상환경 python (기본: <root>\\.venv\\Scripts\\python.exe)")
    ap.add_argument("--batch", default=DEFAULT_BATCH)
    ap.add_argument("--runner-id", default=os.environ.get("RUNNER_ID", "togod-win"))
    ap.add_argument("--poll", type=float, default=5.0)
    ap.add_argument("--heartbeat", type=float, default=30.0)
    ap.add_argument("--timeout", type=int, default=600, help="재실행 1회 제한 시간(초)")
    ap.add_argument("--once", action="store_true", help="하트비트 1회 + 대기열 1회 확인 후 종료")
    ap.add_argument("--dry-run", action="store_true", help="실행하지 않고 failed로 표시(연결 점검)")
    args = ap.parse_args()

    url, key = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL"), os.environ.get("SUPABASE_ANON_KEY") or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    if not url or not key:
        print("SUPABASE_URL·SUPABASE_ANON_KEY 환경변수가 필요합니다.", file=sys.stderr)
        return 2
    args.farmtwin_root = args.farmtwin_root.resolve()
    if args.python is None:
        win = args.farmtwin_root / ".venv" / "Scripts" / "python.exe"
        args.python = win if win.is_file() else args.farmtwin_root / ".venv" / "bin" / "python"
    whitelist = load_run_ids(args.farmtwin_root, args.batch)
    if not whitelist:
        print(f"시드 batch의 run 목록을 읽지 못했습니다: {args.farmtwin_root / 'output' / args.batch}", file=sys.stderr)
        return 2
    rest = Rest(url, key)
    log(f"러너 {args.runner_id} 시작 · 허용 run {len(whitelist)}개 · python {args.python}")

    last_beat = 0.0
    while True:
        try:
            if time.monotonic() - last_beat >= args.heartbeat or args.once:
                rest.call("POST", "/runners?on_conflict=id", {"id": args.runner_id, "last_seen": now_iso()}, prefer="resolution=merge-duplicates,return=minimal")
                last_beat = time.monotonic()
            queued = rest.call("GET", "/run_requests?status=eq.queued&select=*&order=created_at.asc&limit=1")
            if isinstance(queued, list) and queued:
                handle(rest, args, whitelist, queued[0])
                last_beat = 0.0  # 긴 실행 뒤에는 바로 하트비트
        except (RuntimeError, OSError, ValueError) as e:
            log(f"오류: {e}")
        if args.once:
            return 0
        time.sleep(args.poll)


if __name__ == "__main__":
    raise SystemExit(main())
