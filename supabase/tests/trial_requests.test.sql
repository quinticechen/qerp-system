-- Tests for free-trial requests (migration 20261116163046_trial_requests.sql). Load _helpers.sql first.

-- Run one statement as a signed-out visitor; returns the error message, or null when it succeeded
create or replace function pg_temp.anon_try(statement text)
returns text language plpgsql as $$
declare
  v_error text;
begin
  perform set_config('request.jwt.claims', '{"role": "anon"}', true);
  execute 'set local role anon';
  begin
    execute statement;
  exception when others then
    v_error := sqlerrm;
  end;
  execute 'reset role';
  return v_error;
end $$;

-- A signed-out visitor can submit the form; the row gets the defaults
do $$
declare
  v_error text;
  v_row public.trial_requests;
begin
  v_error := pg_temp.anon_try($q$
    insert into public.trial_requests (contact_name, phone, company_name, email, company_size, note)
    values ('測試王小明', '0912-000-001', '測試紡織', 'test@example.com', '11-50', '下午方便')
  $q$);
  perform pg_temp.check(v_error is null, 'anon can insert a request, got ' || coalesce(v_error, ''));

  select * into v_row from public.trial_requests where phone = '0912-000-001';
  perform pg_temp.check(v_row.status = 'new', 'status defaults to new');
  perform pg_temp.check(v_row.company_size = '11-50', 'optional fields are stored');

  v_error := pg_temp.anon_try($q$
    insert into public.trial_requests (contact_name, phone, company_name) values ('測試', '02 2700 0002', '測試公司')
  $q$);
  perform pg_temp.check(v_error is null, 'email, size and note are optional, got ' || coalesce(v_error, ''));
end $$;

-- Visitors cannot read, change or delete requests, or set the status themselves
do $$
declare
  v_count int;
  v_error text;
begin
  insert into public.trial_requests (contact_name, phone, company_name) values ('測試', '0912-000-003', '測試公司');

  perform set_config('request.jwt.claims', '{"role": "anon"}', true);
  execute 'set local role anon';
  begin
    select count(*) into v_count from public.trial_requests;
    v_error := null;
  exception when others then
    v_error := sqlerrm;
  end;
  execute 'reset role';
  perform pg_temp.check(v_error is not null or v_count = 0, 'anon cannot read requests');

  v_error := pg_temp.anon_try($q$
    insert into public.trial_requests (contact_name, phone, company_name, status) values ('測試', '0912-000-004', '測試公司', 'activated')
  $q$);
  perform pg_temp.check(v_error is not null, 'anon cannot set the status');

  perform pg_temp.anon_try($q$ update public.trial_requests set status = 'activated' where phone = '0912-000-003' $q$);
  perform pg_temp.anon_try($q$ delete from public.trial_requests where phone = '0912-000-003' $q$);
  perform pg_temp.check((select status from public.trial_requests where phone = '0912-000-003') = 'new', 'anon cannot update or delete');
end $$;

-- Signed-in members can submit, but cannot read other people's requests
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  v_count int;
begin
  insert into public.trial_requests (contact_name, phone, company_name) values ('測試', '0912-000-005', '測試公司');
  perform pg_temp.act_as((fx->>'user_id')::uuid);
  insert into public.trial_requests (contact_name, phone, company_name) values ('測試', '0912-000-006', '測試公司');
  begin
    select count(*) into v_count from public.trial_requests;
  exception when insufficient_privilege then
    v_count := 0;
  end;
  execute 'reset role';
  perform pg_temp.check(v_count = 0, 'members cannot read requests');
  perform pg_temp.check(exists (select 1 from public.trial_requests where phone = '0912-000-006'), 'members can submit');
end $$;

-- Invalid input is rejected
do $$
begin
  perform pg_temp.check(pg_temp.anon_try($q$
    insert into public.trial_requests (contact_name, phone, company_name) values ('測試', 'abc', '測試公司') $q$) is not null,
    'phone must be digits');
  perform pg_temp.check(pg_temp.anon_try($q$
    insert into public.trial_requests (contact_name, phone, company_name) values ('  ', '0912000007', '測試公司') $q$) is not null,
    'name cannot be blank');
  perform pg_temp.check(pg_temp.anon_try($q$
    insert into public.trial_requests (contact_name, phone, company_name, email) values ('測試', '0912000008', '測試公司', 'not-an-email') $q$) is not null,
    'email must look like an email');
  perform pg_temp.check(pg_temp.anon_try($q$
    insert into public.trial_requests (contact_name, phone, company_name, company_size) values ('測試', '0912000009', '測試公司', 'huge') $q$) is not null,
    'company size must be one of the options');
end $$;

-- The same phone cannot submit twice within 10 minutes
do $$
declare
  v_error text;
begin
  perform pg_temp.check(pg_temp.anon_try($q$
    insert into public.trial_requests (contact_name, phone, company_name) values ('測試', '0912-000-010', '測試公司') $q$) is null,
    'first request goes through');
  v_error := pg_temp.anon_try($q$
    insert into public.trial_requests (contact_name, phone, company_name) values ('測試', '0912-000-010', '測試公司') $q$);
  perform pg_temp.check(v_error = '申請太頻繁，請稍後再試', 'a repeat within 10 minutes is refused, got ' || coalesce(v_error, 'no error'));

  update public.trial_requests set created_at = now() - interval '11 minutes' where phone = '0912-000-010';
  perform pg_temp.check(pg_temp.anon_try($q$
    insert into public.trial_requests (contact_name, phone, company_name) values ('測試', '0912-000-010', '測試公司') $q$) is null,
    'after 10 minutes the same phone may ask again');
end $$;

do $$ begin raise exception 'ALL TESTS PASSED'; end $$;
