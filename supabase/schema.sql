-- FarmTwin Live schema (docs/SPEC.md §5). Supabase SQL Editor에 전체를 붙여넣고 Run.
create extension if not exists pgcrypto;

create table sessions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  seed_batch_id text not null,                 -- 'strawberry-20261101-final'
  scenario jsonb not null,                     -- 현재 승인된 시나리오 스냅샷(시드에서 시작)
  variants jsonb not null,                     -- {"A":{...},"B":{...}}
  worker_zone jsonb,                           -- null | {x_min_m,x_max_m,y_min_m,y_max_m,rule,note}
  owner_participant_id uuid,
  state text not null default 'drafting'
    check (state in ('drafting','gate_scenario','gate_run','awaiting_run','gate_review','bundled')),
  agent_busy boolean not null default false,       -- 에이전트 단일 실행 락
  agent_busy_since timestamptz,                    -- 60초 지나면 만료된 락으로 본다
  last_steer_consumed_id bigint not null default 0,-- 이 id 이하의 steer는 초안에 이미 반영됨
  seed_summary jsonb,                              -- {A:{count,pass,fail,meanMinFrontGapM}, B:{…}, batchId, reportDataSha256}
  explain_cache jsonb not null default '{}',       -- {run_id: Explain} 세션 생성 직후 미리 채움
  created_at timestamptz not null default now()
);

create table participants (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  name text not null,
  role text not null check (role in ('developer','reviewer','safety')),
  joined_at timestamptz not null default now()
);

create table events (                            -- 추가만 하는 감사 로그
  id bigserial primary key,
  session_id uuid not null references sessions(id) on delete cascade,
  type text not null,  -- request|steer|agent_started|agent_step|review_step|gate_opened|gate_decided|handoff|run_requested|run_done|provider_switch|bundle_exported
  actor_kind text not null check (actor_kind in ('human','agent','system')),
  actor_id text,       -- participants.id | 'drafter:<provider>/<model>' | 'reviewer:<provider>/<model>' | 'system'
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index events_session_idx on events (session_id, id);

create table gates (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  kind text not null check (kind in ('scenario','run','review')),
  required_role text not null check (required_role in ('developer','reviewer','safety')),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  payload jsonb not null default '{}',
  decided_by uuid references participants(id),
  decision_comment text,
  override boolean not null default false,     -- block 지적을 안전담당이 코멘트와 함께 넘긴 경우
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create unique index one_pending_gate_per_session on gates (session_id) where status = 'pending';  -- pending은 세션당 1개

create table agent_steps (                       -- 모델 출처(provenance)
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  role text not null check (role in ('drafter','reviewer','explainer')),
  provider text not null,
  model_id text not null,
  fallback_used boolean not null default false,
  prompt_sha256 text not null,
  response_sha256 text not null,
  input_tokens int, output_tokens int, latency_ms int,
  output jsonb not null,
  created_at timestamptz not null default now()
);

create table run_requests (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  from_run_id text not null,                   -- 시드 batch의 run id (whitelist)
  command text not null,                       -- 표시용. 러너는 이 문자열을 실행하지 않고 from_run_id로 직접 조립한다
  input_sha256 text not null,                  -- scenario+variants+worker_zone 정규화 JSON 해시
  status text not null default 'queued'
    check (status in ('queued','running','done','failed','skipped_offline')),
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create table runners (id text primary key, last_seen timestamptz not null);

-- 게이트 결정 + 후속 전이를 한 트랜잭션으로. 클라이언트는 이 함수만 호출한다(supabase.rpc('decide_gate', {...})).
create or replace function decide_gate(
  p_gate_id uuid, p_participant_id uuid, p_decision text, p_comment text default null, p_override boolean default false
) returns jsonb language plpgsql as $$
declare
  g gates%rowtype; s sessions%rowtype;
  v_runner_online boolean; v_next uuid; v_run uuid; v_after jsonb; v_from_run text;
begin
  if p_decision not in ('approved','rejected') then return jsonb_build_object('ok', false, 'reason', 'bad_decision'); end if;

  update gates set status = p_decision, decided_by = p_participant_id, decision_comment = p_comment,
         override = p_override, decided_at = now()
   where id = p_gate_id and status = 'pending'
   returning * into g;
  if not found then return jsonb_build_object('ok', false, 'reason', 'already_decided'); end if;   -- 동시 클릭: 두 번째는 여기서 끝

  select * into s from sessions where id = g.session_id for update;

  insert into events(session_id, type, actor_kind, actor_id, payload)
  values (g.session_id, 'gate_decided', 'human', p_participant_id::text,
          jsonb_build_object('gate_id', g.id, 'kind', g.kind, 'decision', p_decision, 'comment', p_comment, 'override', p_override));

  if p_decision = 'rejected' then                       -- 어느 게이트든 반려 = drafting으로, 코멘트는 steer가 된다
    update sessions set state = 'drafting' where id = s.id;
    insert into events(session_id, type, actor_kind, actor_id, payload)
    values (s.id, 'steer', 'human', p_participant_id::text,
            jsonb_build_object('text', coalesce(nullif(p_comment, ''), '반려'), 'from_gate', g.kind));
    return jsonb_build_object('ok', true, 'next', 'drafting');
  end if;

  if g.kind = 'scenario' then                           -- ①승인: after를 세션에 반영하고 ②를 연다
    v_after := g.payload->'after';
    update sessions set scenario = v_after->'scenario', variants = v_after->'variants',
           worker_zone = v_after->'worker_zone', state = 'gate_run' where id = s.id;
    insert into gates(session_id, kind, required_role, payload)
    values (s.id, 'run', 'developer', jsonb_build_object(
              'from_run_id', g.payload->>'from_run_id', 'command', g.payload->>'command',
              'input_sha256', g.payload->>'input_sha256'))
    returning id into v_next;
    insert into events(session_id, type, actor_kind, actor_id, payload)
    values (s.id, 'gate_opened', 'system', 'system', jsonb_build_object('gate_id', v_next, 'kind', 'run', 'required_role', 'developer'));
    return jsonb_build_object('ok', true, 'next', 'gate_run', 'gate_id', v_next);
  end if;

  if g.kind = 'run' then                                -- ②승인: 실행 요청. 러너 없으면 기존 기록으로 ③을 즉시 연다
    v_from_run := g.payload->>'from_run_id';
    select exists(select 1 from runners where last_seen > now() - interval '30 seconds') into v_runner_online;
    insert into run_requests(session_id, from_run_id, command, input_sha256, status)
    values (s.id, v_from_run, g.payload->>'command', g.payload->>'input_sha256',
            case when v_runner_online then 'queued' else 'skipped_offline' end)
    returning id into v_run;
    insert into events(session_id, type, actor_kind, actor_id, payload)
    values (s.id, 'run_requested', 'system', 'system', jsonb_build_object('run_request_id', v_run, 'runner_online', v_runner_online));
    if v_runner_online then
      update sessions set state = 'awaiting_run' where id = s.id;   -- ③은 러너가 결과를 올린 뒤 연다(§15)
      return jsonb_build_object('ok', true, 'next', 'awaiting_run');
    end if;
    insert into gates(session_id, kind, required_role, payload)
    values (s.id, 'review', 'reviewer', jsonb_build_object(
              'run_id', v_from_run, 'source', 'recorded', 'explain', s.explain_cache -> v_from_run,
              'notice', '로컬 러너 오프라인 — 2026-11-01 기록(batch-20261101-081329)으로 검수를 진행합니다. 새 시나리오의 실행 결과가 아닙니다.'))
    returning id into v_next;
    update sessions set state = 'gate_review' where id = s.id;
    insert into events(session_id, type, actor_kind, actor_id, payload)
    values (s.id, 'gate_opened', 'system', 'system', jsonb_build_object('gate_id', v_next, 'kind', 'review', 'required_role', 'reviewer'));
    return jsonb_build_object('ok', true, 'next', 'gate_review', 'gate_id', v_next);
  end if;

  if g.kind = 'review' then                             -- ③승인: 끝
    update sessions set state = 'bundled' where id = s.id;
    return jsonb_build_object('ok', true, 'next', 'bundled');
  end if;
  return jsonb_build_object('ok', false, 'reason', 'unknown_kind');
end $$;

alter publication supabase_realtime add table sessions, participants, events, gates, run_requests;

-- Data API 권한: 2026-05-30 이후 새 프로젝트(10-30부터는 기존 프로젝트도)는 public 테이블·함수를 Data API에 자동 노출하지 않는다.
-- 그래서 명시적으로 준다. 이미 권한이 있는 프로젝트에서도 그대로 통과한다.
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on sessions, participants, events, gates, agent_steps, run_requests, runners to anon, authenticated, service_role;
grant usage, select on all sequences in schema public to anon, authenticated, service_role;
grant execute on function decide_gate(uuid, uuid, text, text, boolean) to anon, authenticated, service_role;

-- 해커톤 한정: anon 전체 허용. 데모 후 반드시 잠근다.
do $$ declare t text; begin
  foreach t in array array['sessions','participants','events','gates','agent_steps','run_requests','runners'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy anon_all on %I for all to anon using (true) with check (true)', t);
  end loop; end $$;
