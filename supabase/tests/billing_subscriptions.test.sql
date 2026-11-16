-- Tests for plans and subscriptions (migration 20261116171234_billing_subscriptions.sql). Load _helpers.sql first.

-- A new organization starts pending: only the owner, no Query messages; nobody else can join yet
do $$
declare
  v_owner uuid := gen_random_uuid();
  v_org uuid;
  v_sub public.organization_subscriptions;
  v_ent jsonb;
begin
  insert into auth.users (id, aud, role, email) values (v_owner, 'authenticated', 'authenticated', 'sql-test-' || v_owner || '@example.test');
  insert into public.organizations (name, owner_id) values ('SQL 計費測試', v_owner) returning id into v_org;

  select * into v_sub from public.organization_subscriptions where organization_id = v_org;
  perform pg_temp.check(v_sub.status = 'pending' and v_sub.plan = 'free', 'a new organization is pending');
  perform pg_temp.check(exists (select 1 from public.user_organizations where organization_id = v_org and user_id = v_owner and is_active),
    'the owner still becomes a member');

  v_ent := pg_temp.call_as(v_owner, format('select public.get_organization_entitlement(%L)', v_org));
  perform pg_temp.check(v_ent->>'status' = 'pending' and (v_ent->>'max_members')::int = 1 and (v_ent->>'query_messages_per_month')::int = 0,
    'pending: one seat, no Query, got ' || v_ent::text);

  begin
    perform pg_temp.add_member(v_org, 'editor');
    raise exception 'FAIL: a pending organization accepted a second member';
  exception when sqlstate 'PGRST' then
    perform pg_temp.check(sqlerrm::json->>'hint' = 'plan_member_limit', 'pending refuses with plan_member_limit');
    perform pg_temp.check(sqlerrm::json->>'message' = '組織尚未開通，開通後才能邀請成員', 'pending message, got ' || sqlerrm);
  end;
end $$;

-- Free plan: three seats; the fourth (new or reactivated) is refused, and upgrading lifts the limit
do $$
declare
  v_owner uuid := gen_random_uuid();
  v_org uuid;
  v_third uuid;
  v_membership uuid;
begin
  insert into auth.users (id, aud, role, email) values (v_owner, 'authenticated', 'authenticated', 'sql-test-' || v_owner || '@example.test');
  insert into public.organizations (name, owner_id) values ('SQL 計費測試', v_owner) returning id into v_org;
  update public.organization_subscriptions set status = 'active', activated_by = 'manual', activated_at = now() where organization_id = v_org;

  perform pg_temp.add_member(v_org, 'editor');
  v_third := pg_temp.add_member(v_org, 'viewer');
  perform pg_temp.check((select count(*) from public.user_organizations where organization_id = v_org and is_active) = 3, 'free plan fits three');

  begin
    perform pg_temp.add_member(v_org, 'viewer');
    raise exception 'FAIL: the free plan accepted a fourth member';
  exception when sqlstate 'PGRST' then
    perform pg_temp.check(sqlerrm::json->>'message' = '已達目前方案的成員上限（3 人），請升級方案', 'free limit message, got ' || sqlerrm);
    perform pg_temp.check(sqlerrm::json->>'code' = '55000', 'limit is a 409 conflict');
  end;

  -- Deactivating frees a seat; reactivating while full is refused
  select id into v_membership from public.user_organizations where organization_id = v_org and user_id = v_third;
  update public.user_organizations set is_active = false where id = v_membership;
  perform pg_temp.add_member(v_org, 'viewer');
  begin
    update public.user_organizations set is_active = true where id = v_membership;
    raise exception 'FAIL: reactivating a member beyond the limit was allowed';
  exception when sqlstate 'PGRST' then
    null;
  end;

  update public.organization_subscriptions set plan = 'standard', billing_period = 'month', activated_by = 'stripe' where organization_id = v_org;
  update public.user_organizations set is_active = true where id = v_membership;
  perform pg_temp.check((select count(*) from public.user_organizations where organization_id = v_org and is_active) = 4, 'standard fits more');
end $$;

-- Members read their own organization's subscription; others can't, and nobody can change it from the client
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  other jsonb := pg_temp.seed_fixture();
  v_user uuid := (fx->>'user_id')::uuid;
  v_org uuid := (fx->>'org_id')::uuid;
  v_viewer uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'viewer');
  v_count int;
  v_ent jsonb;
begin
  perform pg_temp.act_as(v_viewer);
  select count(*) into v_count from public.organization_subscriptions where organization_id = v_org;
  execute 'reset role';
  perform pg_temp.check(v_count = 1, 'a viewer can read the plan');

  perform pg_temp.act_as((other->>'user_id')::uuid);
  select count(*) into v_count from public.organization_subscriptions where organization_id = v_org;
  execute 'reset role';
  perform pg_temp.check(v_count = 0, 'another organization cannot read it');

  perform pg_temp.check_raises_as(v_user,
    format('update public.organization_subscriptions set plan = %L where organization_id = %L', 'pro', v_org),
    'permission denied', 'the owner cannot change the plan directly');
  perform pg_temp.check_raises_as(v_user,
    format('insert into public.organization_subscriptions (organization_id, status) values (%L, %L)', (other->>'org_id')::uuid, 'active'),
    'permission denied', 'clients cannot insert subscriptions');

  perform pg_temp.check_api_error_as((other->>'user_id')::uuid,
    format('select public.get_organization_entitlement(%L)', v_org), '42501', 'not_member', 'non-members get no entitlement');

  v_ent := pg_temp.call_as(v_viewer, format('select public.get_organization_entitlement(%L)', v_org));
  perform pg_temp.check(v_ent->>'plan' = 'pro' and (v_ent->>'max_members')::int = 30 and (v_ent->>'query_messages_per_month')::int = 5000,
    'pro limits, got ' || v_ent::text);
  perform pg_temp.check((v_ent->>'members')::int = 2, 'members are counted');
end $$;

-- The monthly Query count includes this month's user messages from everyone in the organization only
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  v_user uuid := (fx->>'user_id')::uuid;
  v_org uuid := (fx->>'org_id')::uuid;
  v_editor uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'editor');
  v_session uuid;
  v_session2 uuid;
  v_ent jsonb;
begin
  insert into public.query_sessions (user_id, organization_id) values (v_user, v_org) returning id into v_session;
  insert into public.query_sessions (user_id, organization_id) values (v_editor, v_org) returning id into v_session2;
  insert into public.query_messages (session_id, role, content) values
    (v_session, 'user', '一'), (v_session, 'assistant', '回覆'), (v_session2, 'user', '二');
  insert into public.query_messages (session_id, role, content, created_at) values (v_session, 'user', '上個月', now() - interval '40 days');

  v_ent := pg_temp.call_as(v_user, format('select public.get_organization_entitlement(%L)', v_org));
  perform pg_temp.check((v_ent->>'query_messages_used')::int = 2, 'two questions this month, got ' || v_ent::text);
end $$;

-- Organizations that existed before the migration were activated on the free plan
do $$
begin
  perform pg_temp.check(not exists (
    select 1 from public.organizations o
    left join public.organization_subscriptions s on s.organization_id = o.id
    where s.organization_id is null), 'every organization has a subscription row');
end $$;

do $$ begin raise exception 'ALL TESTS PASSED'; end $$;
