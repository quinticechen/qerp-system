-- 函式清理與資安建議（supabase/migrations/20261009133702_function_hardening.sql）。先載入 _helpers.sql 再執行本檔。

-- The unused functions are gone; the ones kept have a fixed search_path and are not callable by clients
do $$
declare
  v_name text;
begin
  foreach v_name in array array['is_admin', 'get_user_organizations', 'ensure_user_profile', 'generate_order_number'] loop
    perform pg_temp.check(not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = v_name),
      v_name || ' is dropped');
  end loop;

  foreach v_name in array array['handle_new_user', 'set_current_quantity', 'update_updated_at', 'update_updated_by'] loop
    perform pg_temp.check((select proconfig from pg_proc where pronamespace = 'public'::regnamespace and proname = v_name)
        @> array['search_path=public'],
      v_name || ' has a fixed search_path');
  end loop;

  foreach v_name in array array['handle_new_user', 'handle_organization_creation', 'update_updated_by', 'update_updated_at', 'set_current_quantity'] loop
    perform pg_temp.check(not has_function_privilege('anon', format('public.%I()', v_name), 'EXECUTE')
        and not has_function_privilege('authenticated', format('public.%I()', v_name), 'EXECUTE'),
      v_name || ' cannot be called by clients');
  end loop;
end $$;

-- The triggers still fire for signed-in users
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  v_user uuid := (fx->>'user_id')::uuid;
  v_org uuid := gen_random_uuid();
  v_product uuid := (fx->>'product_id')::uuid;
begin
  perform pg_temp.act_as(v_user);

  -- handle_organization_creation: the creator becomes a member of the new organization
  insert into public.organizations (id, name, owner_id) values (v_org, '觸發器測試組織', v_user);
  perform pg_temp.check(exists (select 1 from public.user_organizations where organization_id = v_org and user_id = v_user),
    'creating an organization still adds its owner as a member');

  -- update_updated_by on a product color the user did not edit before
  perform pg_temp.check((select updated_by is distinct from v_user from public.products_new where id = v_product), 'the seeded color was not edited by the user yet');
  update public.products_new set color_code = 'T-1' where id = v_product;
  perform pg_temp.check((select updated_by = v_user from public.products_new where id = v_product),
    'editing a product color still records who edited it');

  execute 'reset role';
end $$;

do $$ begin raise exception 'ALL TESTS PASSED'; end $$;
