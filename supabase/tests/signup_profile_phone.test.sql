-- 註冊時寫入電話（supabase/migrations/20261009163659_signup_profile_phone.sql）。先載入 _helpers.sql 再執行本檔。

-- An invited sign-up keeps its phone on the profile; completing the invitation leaves no extra profile edit
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_admin uuid := pg_temp.add_member(v_org, 'admin');
  v_user uuid := gen_random_uuid();
begin
  insert into auth.users (id, aud, role, email, raw_user_meta_data)
  values (v_user, 'authenticated', 'authenticated', 'sql-test-' || v_user || '@example.test',
    jsonb_build_object('full_name', '王小美', 'phone', '0912345678'));

  perform pg_temp.check((select full_name = '王小美' and phone = '0912345678' from public.profiles where id = v_user),
    'the profile is created with the name and phone from sign-up');

  perform pg_temp.act_as(v_admin);
  perform public.complete_user_invitation(v_user, v_org, 'editor', '王小美', '0912345678');
  execute 'reset role';

  perform pg_temp.check(not exists (select 1 from public.record_audit_logs where table_name = 'profiles' and record_id = v_user and action = 'UPDATE'),
    'completing the invitation adds no profile edit to the history');
  perform pg_temp.check(exists (select 1 from public.record_audit_logs where table_name = 'user_organizations' and parent_id = v_user and action = 'INSERT'),
    'the membership is in the user''s history');
  perform pg_temp.check(not has_function_privilege('authenticated', 'public.handle_new_user()', 'EXECUTE'),
    'the trigger function stays closed to clients');
end $$;

-- A sign-up without a phone leaves it empty
do $$
declare
  v_user uuid := gen_random_uuid();
begin
  insert into auth.users (id, aud, role, email, raw_user_meta_data)
  values (v_user, 'authenticated', 'authenticated', 'sql-test-' || v_user || '@example.test', jsonb_build_object('phone', ' '));
  perform pg_temp.check((select phone is null from public.profiles where id = v_user), 'a blank phone is stored as empty');
end $$;

do $$ begin raise exception 'ALL TESTS PASSED'; end $$;
