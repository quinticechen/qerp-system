-- 用戶編輯紀錄測試。先載入 _helpers.sql 再執行本檔。

-- Membership and role changes are filed under the user they belong to
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  v_owner uuid := (fx->>'user_id')::uuid;
  v_member uuid := gen_random_uuid();
  v_role uuid;
  v_logs int;
begin
  insert into auth.users (id, aud, role, email)
  values (v_member, 'authenticated', 'authenticated', 'sql-test-' || v_member || '@example.test');
  select id into v_role from public.organization_roles where organization_id = (fx->>'org_id')::uuid limit 1;

  insert into public.user_organizations (user_id, organization_id, is_active) values (v_member, (fx->>'org_id')::uuid, true);
  insert into public.user_organization_roles (user_id, organization_id, role_id) values (v_member, (fx->>'org_id')::uuid, v_role);

  perform pg_temp.act_as(v_owner);
  update public.user_organizations set is_active = false where user_id = v_member and organization_id = (fx->>'org_id')::uuid;
  execute 'reset role';

  select count(*) into v_logs from public.record_audit_logs
  where parent_id = v_member and parent_table = 'profiles'
    and table_name in ('user_organizations', 'user_organization_roles');
  perform pg_temp.check(v_logs >= 3, 'membership and role rows are filed under the user, got ' || v_logs);
end $$;

-- A member's profile edits are visible to other members of the organization, not to outsiders
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  outsider jsonb := pg_temp.seed_fixture();
  v_owner uuid := (fx->>'user_id')::uuid;
  v_member uuid := gen_random_uuid();
  v_owner_sees int;
  v_outsider_sees int;
begin
  insert into auth.users (id, aud, role, email)
  values (v_member, 'authenticated', 'authenticated', 'sql-test-' || v_member || '@example.test');
  insert into public.user_organizations (user_id, organization_id, is_active) values (v_member, (fx->>'org_id')::uuid, true);

  perform pg_temp.act_as(v_member);
  update public.profiles set full_name = '新名字' where id = v_member;

  perform pg_temp.act_as(v_owner);
  select count(*) into v_owner_sees from public.record_audit_logs where table_name = 'profiles' and record_id = v_member;
  perform pg_temp.act_as((outsider->>'user_id')::uuid);
  select count(*) into v_outsider_sees from public.record_audit_logs where table_name = 'profiles' and record_id = v_member;
  execute 'reset role';

  perform pg_temp.check(v_owner_sees >= 1, 'a fellow member sees the profile edit, saw ' || v_owner_sees);
  perform pg_temp.check(v_outsider_sees = 0, 'an outsider does not see it, saw ' || v_outsider_sees);
end $$;

do $$ begin raise exception 'ALL TESTS PASSED'; end $$;
