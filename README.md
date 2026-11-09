# FarmTwin Live

농장 로봇이 밭에 들어가기 전, 관련된 모든 사람이 **같은 검증 세션**에서 보고·개입하고·승인한다.

> 에이전트는 초안·설명·명령을 만들고, 판정은 규칙(evaluate.py)이, 승인은 사람이 한다.

- 개발자가 세션을 만들고 QR로 안전담당·검수자가 폰으로 들어온다.
- 설계 에이전트(코디세이 → Claude 공식 API 폴백)가 시험 시나리오 초안을 쓰고, 사람의 개입(steer)을 받아 다시 쓴다.
- ① 시나리오 → ② 실행 → ③ 검수 승인 게이트가 **모든 화면에 동시에** 뜬다(`decide_gate` 한 트랜잭션, 중복 클릭은 한 번만 반영).
- 결과는 2026-11-01 실제 Webots 기록(A 늦은 정지 5/5 FAIL · B 이른 정지 5/5 PASS)으로 재생한다. 고령 작업자 구역은 시나리오 입력으로 겹쳐 그린다.
- 승인 기록·모델 출처·입력 해시를 Evidence Bundle(JSON + sha256)로 내려받는다.

명세: [docs/SPEC.md](docs/SPEC.md) · 엣지케이스 §20 · gstack 순서 §18

---

## 1. Windows에서 실행 (PowerShell)

OneDrive 밖·영문 경로에 둔다.

```powershell
mkdir C:\Users\togod\dev -Force; cd C:\Users\togod\dev
git clone https://github.com/JmLeeRoom/farmtwin-live.git
cd farmtwin-live
git config core.longpaths true
npm install
Copy-Item .env.example .env.local     # VS Code로 열어 값을 채운다(메모장 BOM 주의)
npm run dev -- -H 0.0.0.0
```

`npm.ps1 cannot be loaded`가 나오면 `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

## 2. Supabase (5분)

1. supabase.com → New project → **SQL Editor**에 `supabase/schema.sql` 전체 붙여넣기 → Run
2. 같은 곳에 `supabase/smoke_test.sql` → Run → 메시지에 **`SMOKE OK`** (게이트 중복 승인·러너 오프라인·반려 경로 자동 확인, 테스트 행은 스스로 지움)
3. Project Settings → API Keys의 **Publishable key**(`sb_publishable_…`, legacy anon key도 됨)와 Project URL을 `.env.local`의 `NEXT_PUBLIC_SUPABASE_ANON_KEY`·`NEXT_PUBLIC_SUPABASE_URL`에

새 프로젝트는 테이블을 Data API에 자동 노출하지 않는다(2026-05-30부터 기본). `schema.sql`이 필요한 권한(grant)을 직접 주므로 생성 화면의 "Automatically expose new tables" 체크 여부와 상관없이 동작한다. 권한 오류(42501·permission denied)가 나면 schema.sql의 `grant` 네 줄만 다시 실행.

## 3. 연결 점검

- `http://localhost:3000/api/health?ping=1` → 설정된 제공자마다 `ok`·지연시간. 코디세이가 404면 base URL 경로 문제, 401이면 `CODYSSEY_AUTH_STYLE`을 `bearer` 또는 `x-api-key`로 바꿔 본다.
- `http://localhost:3000/replay` → Supabase 없이 실제 기록 재생만.

## 4. 폰으로 참가

`ipconfig | findstr IPv4`의 주소로 `http://<IP>:3000`. 192.168.\*.\*, 10.\*.\*.\*, 172.20.10.\*(아이폰 핫스팟)은 이미 허용돼 있다. 다른 대역이면 `.env.local`의 `DEV_LAN_HOSTS`에 넣고 dev 재시작. 안 열리면 Windows 방화벽에서 Node 허용.

같은 브라우저의 두 탭은 같은 참가자가 된다(localStorage). 노트북에서 두 사람을 만들려면 일반 창 + InPrivate 창.

## 5. 검증

```powershell
npm run typecheck; npm run lint; npm test; npm run build
```

`npm test`는 vitest(lib/*.test.ts) — 재생 공식이 실제 궤적과 1e-6 이내, 패치 화이트리스트, 스키마, 번들 해시 결정성, 제공자 폴백, 에이전트 오케스트레이션(락·대체·변경 없음·429·502)을 LLM·DB 없이 검사한다.

## 6. 배포 (Vercel)

Import → **Production Branch = main** → `.env.example`의 변수를 Environment Variables에 → Deploy. 데모와 QR은 **프로덕션 URL**로 한다(프리뷰 URL은 Vercel 로그인 보호 때문에 심사위원 폰에서 안 열린다).

브랜치: `main`은 뼈대(+ `.gstack/pregate.json`), 구현은 `live`. gstack은 `live`에서 `/review` → `/ship`(PR) → 처음 1회 `/setup-deploy` → `/land-and-deploy`(병합·프로덕션 배포·헬스체크).

## 7. 로컬 러너 (선택)

러너가 없으면 ② 승인 시 2026-11-01 기록으로 ③ 검수를 진행한다(화면에 명시). 노트북에서 실제 Webots 재실행을 붙이려면:

```powershell
$env:SUPABASE_URL = "<NEXT_PUBLIC_SUPABASE_URL 값>"; $env:SUPABASE_ANON_KEY = "<anon key>"
python scripts\local_runner.py --farmtwin-root "C:\Users\togod\OneDrive\바탕 화면\멘토링\FarmTwinAI"
```

DB에 저장된 명령 문자열은 실행하지 않고, 허용된 run id로 `python -m farmtwin rerun --from-run <폴더>`를 직접 조립한다. 보관 입력 재실행이며 새 시나리오 실행이 아니다.

## 구조

```
app/                    /  ·  /s/[id]  ·  /s/[id]/join  ·  /replay  ·  /api/agent/{draft,explain}  ·  /api/health
components/             SessionView(3열·모바일) · GatePanel · SteerBox · AgentTimeline · ReplayCanvas · AuditLog · SessionHeader · HandoffMenu · JoinQR
lib/                    agent(오케스트레이션) · providers(폴백) · schemas · prompts · patch(화이트리스트) · replay · seed · bundle · sha · db · useSession
supabase/               schema.sql(테이블·decide_gate·RLS·Realtime) · smoke_test.sql
public/seed/            strawberry-20261101-final (report-data.json · scene.png)
scripts/local_runner.py 선택 · 표준 라이브러리만
```

데모 범위 밖(말하지 않을 것): 사람 모델·동적 장애물 물리, 새 시나리오 Webots 실행, 실제 로봇 제어, RLS 잠금(데모 후 `/cso`).
