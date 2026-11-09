-- FarmTwin Live · decide_gate 스모크 테스트 (docs/SPEC.md §19 T6·T7 자동판)
-- schema.sql 실행 후 Supabase SQL Editor에 붙여넣고 Run. 실패하면 EXCEPTION 메시지가 뜨고, 성공하면 마지막에 'SMOKE OK'.
-- 만든 테스트 행은 끝에서 지운다(title이 'smoke-%'인 세션).
do $$
declare
  s uuid; s2 uuid; s3 uuid;
  dev uuid; saf uuid; rev uuid;
  g1 uuid; g2 uuid; g3 uuid; r jsonb; n int; st text; gk text; rq text;
begin
  -- 1) ①승인 → ② 생성, 같은 게이트 두 번째 결정은 already_decided
  insert into sessions(title, seed_batch_id, scenario, variants, explain_cache)
  values ('smoke-1','strawberry-20261101-final','{"corridor":{"width_m":1}}','{"A":{},"B":{}}',
          '{"run-B-01-011d744785354c10976e57946e0bb1ec":{"headline":"B PASS"}}') returning id into s;
  insert into participants(session_id,name,role) values (s,'dev','developer') returning id into dev;
  insert into participants(session_id,name,role) values (s,'saf','safety') returning id into saf;
  insert into participants(session_id,name,role) values (s,'rev','reviewer') returning id into rev;
  insert into gates(session_id,kind,required_role,payload) values (s,'scenario','safety', jsonb_build_object(
    'after', jsonb_build_object('scenario','{"corridor":{"width_m":1.2}}'::jsonb,'variants','{"A":{},"B":{}}'::jsonb,
                                'worker_zone','{"x_min_m":1,"x_max_m":2,"y_min_m":-0.5,"y_max_m":0.5,"rule":"STOP_ON_ENTRY"}'::jsonb),
    'from_run_id','run-B-01-011d744785354c10976e57946e0bb1ec','command','farmtwin rerun','input_sha256','abc')) returning id into g1;
  update sessions set state='gate_scenario' where id=s;

  r := decide_gate(g1, saf, 'approved');
  if not (r->>'ok')::boolean or r->>'next' <> 'gate_run' then raise exception 'T6-1 첫 승인 실패: %', r; end if;
  r := decide_gate(g1, saf, 'approved');
  if (r->>'ok')::boolean or r->>'reason' <> 'already_decided' then raise exception 'T6-2 중복 승인이 막히지 않음: %', r; end if;
  select state into st from sessions where id=s;
  if st <> 'gate_run' then raise exception 'T6-3 state=% (gate_run 기대)', st; end if;
  select (scenario->'corridor'->>'width_m') into rq from sessions where id=s;
  if rq <> '1.2' then raise exception 'T6-4 after가 세션에 반영되지 않음: %', rq; end if;
  select count(*) into n from gates where session_id=s and kind='run' and status='pending';
  if n <> 1 then raise exception 'T6-5 ② pending 게이트 수=%', n; end if;

  -- 2) pending 게이트는 세션당 1개(부분 유니크 인덱스)
  begin
    insert into gates(session_id,kind,required_role,payload) values (s,'scenario','developer','{}');
    raise exception 'T6-6 두 번째 pending 게이트가 들어감';
  exception when unique_violation then null;
  end;

  -- 3) ②승인 + 러너 오프라인 → skipped_offline, ③이 기존 기록·설명 캐시로 즉시 열림
  delete from runners;
  select id into g2 from gates where session_id=s and kind='run' and status='pending';
  r := decide_gate(g2, dev, 'approved');
  if r->>'next' <> 'gate_review' then raise exception 'T7-1 오프라인 경로 실패: %', r; end if;
  select status into rq from run_requests where session_id=s;
  if rq <> 'skipped_offline' then raise exception 'T7-2 run_requests.status=%', rq; end if;
  select id, payload->>'source' into g3, gk from gates where session_id=s and kind='review' and status='pending';
  if gk <> 'recorded' then raise exception 'T7-3 ③ source=%', gk; end if;
  if (select payload->'explain'->>'headline' from gates where id=g3) <> 'B PASS' then raise exception 'T7-4 설명 캐시가 ③에 복사되지 않음'; end if;

  -- 4) 역할과 무관하게 함수는 결정만 기록(역할 검사는 UI 책임) → ③승인 → bundled
  r := decide_gate(g3, rev, 'approved');
  if r->>'next' <> 'bundled' then raise exception 'T7-5 ③승인 실패: %', r; end if;

  -- 5) 반려 → drafting + steer 이벤트(코멘트)
  insert into sessions(title, seed_batch_id, scenario, variants) values ('smoke-2','strawberry-20261101-final','{}','{}') returning id into s2;
  insert into participants(session_id,name,role) values (s2,'dev','developer') returning id into dev;
  insert into gates(session_id,kind,required_role,payload) values (s2,'scenario','developer','{}') returning id into g1;
  update sessions set state='gate_scenario' where id=s2;
  r := decide_gate(g1, dev, 'rejected', '속도를 0.3으로');
  if r->>'next' <> 'drafting' then raise exception 'T6-7 반려 실패: %', r; end if;
  select count(*) into n from events where session_id=s2 and type='steer' and payload->>'text'='속도를 0.3으로';
  if n <> 1 then raise exception 'T6-8 반려 코멘트 steer 이벤트 수=%', n; end if;

  -- 6) 러너 온라인 → queued + awaiting_run (③은 러너가 연다)
  insert into sessions(title, seed_batch_id, scenario, variants) values ('smoke-3','strawberry-20261101-final','{}','{}') returning id into s3;
  insert into participants(session_id,name,role) values (s3,'dev','developer') returning id into dev;
  insert into gates(session_id,kind,required_role,payload) values (s3,'run','developer',
    '{"from_run_id":"run-B-01-011d744785354c10976e57946e0bb1ec","command":"x","input_sha256":"y"}') returning id into g1;
  update sessions set state='gate_run' where id=s3;
  insert into runners(id,last_seen) values ('smoke-runner', now()) on conflict (id) do update set last_seen = now();
  r := decide_gate(g1, dev, 'approved');
  if r->>'next' <> 'awaiting_run' then raise exception 'T7-6 온라인 경로 실패: %', r; end if;
  select status into rq from run_requests where session_id=s3;
  if rq <> 'queued' then raise exception 'T7-7 run_requests.status=%', rq; end if;
  delete from runners where id='smoke-runner';

  -- 정리
  delete from sessions where title like 'smoke-%';
  raise notice 'SMOKE OK';
end $$;
