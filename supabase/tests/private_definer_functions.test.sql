-- SECURITY DEFINER 函式移到 private schema（supabase/migrations/20261009140512_private_definer_functions.sql）。先載入 _helpers.sql 再執行本檔。

-- Nothing in the exposed schema runs as its owner for a client
do $$
declare
  v_list text;
begin
  select string_agg(p.proname, ', ') into v_list
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.prosecdef
    and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  perform pg_temp.check(v_list is null, 'no SECURITY DEFINER function in public is callable by clients, found ' || coalesce(v_list, ''));

  select string_agg(p.proname, ', ') into v_list
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.prorettype <> 'trigger'::regtype;
  perform pg_temp.check(v_list is null, 'only trigger functions stay SECURITY DEFINER in public, found ' || coalesce(v_list, ''));

  perform pg_temp.check(not has_schema_privilege('anon', 'private', 'USAGE'), 'anon cannot use the private schema');
  perform pg_temp.check(to_regprocedure('public.api_assign_document_number(uuid, text)') is null
      and to_regprocedure('private.api_assign_document_number(uuid, text)') is not null,
    'document numbering is no longer exposed');
  perform pg_temp.check(not has_function_privilege('authenticated', 'public.touch_query_session_updated_at()', 'EXECUTE'),
    'the query session trigger function cannot be called by clients');
end $$;

-- Each wrapper keeps its name and parameters, runs as the caller and forwards to the implementation
do $$
declare
  v_fn record;
begin
  for v_fn in
    select p.proname, pg_get_function_arguments(p.oid) as args, q.oid as impl,
           pg_get_function_arguments(q.oid) as impl_args, p.proconfig
    from pg_proc p
    join pg_proc q on q.proname = p.proname and q.pronamespace = 'private'::regnamespace
    where p.pronamespace = 'public'::regnamespace
  loop
    perform pg_temp.check(v_fn.args = v_fn.impl_args, v_fn.proname || ' keeps its parameters');
    perform pg_temp.check(v_fn.proconfig @> array['search_path=""'], v_fn.proname || ' has a fixed search_path');
    perform pg_temp.check((select prosecdef from pg_proc where oid = v_fn.impl), v_fn.proname || ' implementation runs as its owner');
  end loop;
  perform pg_temp.check((select count(*) from pg_proc p join pg_proc q on q.proname = p.proname
      where p.pronamespace = 'public'::regnamespace and q.pronamespace = 'private'::regnamespace) = 40,
    'all 40 client functions have a wrapper');
  -- Policies refer to functions by OID, so they moved along with the implementations
  perform pg_temp.check(not exists (select 1 from pg_depend d join pg_proc p on p.oid = d.refobjid
      where d.classid = 'pg_policy'::regclass and p.pronamespace = 'public'::regnamespace
        and exists (select 1 from pg_proc q where q.proname = p.proname and q.pronamespace = 'private'::regnamespace)),
    'no policy goes through a wrapper');
  perform pg_temp.check(exists (select 1 from pg_depend d
      where d.classid = 'pg_policy'::regclass and d.refobjid = 'private.user_has_organization_permission(uuid, uuid, text)'::regprocedure),
    'policies call the permission check in private directly');
end $$;

-- Through the wrappers: named parameters, set-returning functions, permission refusals and direct inserts still work
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_editor uuid := pg_temp.add_member(v_org, 'editor');
  v_viewer uuid := pg_temp.add_member(v_org, 'viewer');
  v_result jsonb;
  v_number text;
begin
  v_result := pg_temp.call_as(v_editor, format('select public.create_customer(%L, %L, %L, p_phone => %L, p_dry_run => true)', v_org, '包裝函式客戶', '陳先生', '0911'));
  perform pg_temp.check((v_result->>'dry_run')::boolean, 'a dry run through the wrapper answers');
  perform pg_temp.check_api_error_as(v_viewer, format('select public.create_customer(%L, %L, %L, p_phone => %L)', v_org, '訪客客戶', '陳先生', '0911'),
    '42501', 'forbidden', 'a viewer is still refused through the wrapper');

  perform pg_temp.check(pg_temp.call_as(v_editor, format('select to_jsonb(public.user_has_organization_permission(%L, %L, %L))',
      v_editor, v_org, 'canCreateCustomers'))::boolean, 'the permission check answers through the wrapper');
  perform pg_temp.check(pg_temp.call_as((fx->>'user_id')::uuid, format('select to_jsonb(count(*)) from public.get_organization_member_status(%L)', v_org))::int >= 3,
    'a set-returning RPC answers through the wrapper');

  -- A direct insert by a signed-in user still gets a system number
  perform pg_temp.act_as(v_editor);
  insert into public.orders (customer_id, user_id, organization_id, order_number)
  values ((fx->>'customer_id')::uuid, v_editor, v_org, 'X-1') returning order_number into v_number;
  execute 'reset role';
  perform pg_temp.check(v_number ~ '^B\d{12}$', 'a direct insert is numbered by the system, got ' || coalesce(v_number, 'none'));
end $$;

do $$ begin raise exception 'ALL TESTS PASSED'; end $$;
