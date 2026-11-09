# farmtwin-live
@AGENTS.md

- docs/SPEC.md가 단일 진실. 명세 외 기능 추가 금지. 막히면 §20 엣지케이스부터 본다.
- 3시간 해커톤. 한 블록(§12)씩 구현하고 멈춰서 종료 기준을 보고한다.
- Next.js 16.4 + cacheComponents 켜짐: useParams·useSearchParams를 쓰는 클라이언트 컴포넌트는 `<Suspense>` 안에 둔다. `export const dynamic/revalidate/runtime` 금지(`maxDuration`만 허용). GET 라우트 핸들러는 첫 줄에서 `await connection()`(next/server)으로 요청 시점 실행을 강제한다. 코드를 쓰기 전에 node_modules/next/dist/docs의 해당 문서를 확인한다.
- Tailwind v4(@tailwindcss/turbopack, next.config.ts의 turbopack.rules). postcss 설정을 만들지 않는다.
- 폰은 http LAN으로 접속하므로 브라우저 코드에서 crypto.subtle·crypto.randomUUID를 쓰지 않는다(보안 컨텍스트 전용). id는 DB 기본값, 해시는 순수 JS sha256(lib/sha.ts).
- LLM 키는 서버 라우트에서만. 클라이언트는 gates·sessions.state를 직접 쓰지 않는다(`rpc('decide_gate')`만).
- AI SDK v7: `generateText({ instructions, prompt })`(`system`은 deprecated). OpenAI 호환 엔드포인트는 `createOpenAI(...).chat(modelId)`(기본은 Responses API). Anthropic 호환 base URL은 `/v1`까지 포함.
- 로직은 lib/에 순수 함수로 두고 vitest로 덮는다(lib/*.test.ts). 실제 LLM 호출 테스트 금지 — `runStructured`/`runDraft`의 `callFn`·`AgentDb` 주입으로 테스트한다.
- 검증: `npm run typecheck && npm run lint && npm test && npm run build`. gstack `/verify`의 레인 정책은 `.gstack/pregate.json`(base 브랜치 main에 있어야 읽힘).
- DB 변경은 supabase/schema.sql에 반영하고 supabase/smoke_test.sql이 `SMOKE OK`인지 확인한다.
