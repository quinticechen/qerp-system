-- RBAC R1 固定角色測試（docs/requirements/MULTI_TENANT_RBAC.md §4）。先載入 _helpers.sql 再執行本檔。

-- Every role holds exactly the permissions of docs/requirements/MULTI_TENANT_RBAC.md §4.3; removed keys are granted to nobody
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_owner uuid := (fx->>'user_id')::uuid;
  v_admin uuid := pg_temp.add_member(v_org, 'admin');
  v_editor uuid := pg_temp.add_member(v_org, 'editor');
  v_viewer uuid := pg_temp.add_member(v_org, 'viewer');
  v_view text[] := array[
    'canViewProducts', 'canViewCustomers', 'canViewFactories', 'canViewShelves',
    'canViewOrders', 'canViewPurchases', 'canViewInventory', 'canViewShipping'];
  v_write text[] := array[
    'canCreateProducts', 'canEditProducts', 'canCreateCustomers', 'canEditCustomers',
    'canCreateFactories', 'canEditFactories', 'canCreateShelves', 'canEditShelves',
    'canCreateOrders', 'canEditOrders', 'canCreatePurchases', 'canEditPurchases',
    'canCreateInventory', 'canEditInventory', 'canCreateShipping', 'canEditShipping'];
  v_member_view text[] := array['canViewUsers', 'canViewPermissions', 'canViewSystemSettings'];
  v_admin_only text[] := array['canCreateUsers', 'canEditUsers', 'canEditSystemSettings'];
  v_removed text[] := array[
    'canDeleteProducts', 'canEditPermissions', 'canManageOrganization', 'canManageUsers',
    'canManageRoles', 'canViewAll', 'canEditAll', 'canDeleteAll'];
  v_all text[];
  v_key text;
  v_user uuid;
  v_label text;
  v_expected text[];
begin
  v_all := v_view || v_write || v_member_view || v_admin_only || v_removed;

  perform pg_temp.check(
    (select array_agg(distinct permission_key order by permission_key) from public.role_permissions)
      = (select array_agg(k order by k) from unnest(v_view || v_write || v_member_view || v_admin_only) k),
    'the catalog holds exactly the 30 permission keys');

  for v_user, v_label, v_expected in
    select * from (values
      (v_owner, 'owner', v_view || v_write || v_member_view || v_admin_only),
      (v_admin, 'admin', v_view || v_write || v_member_view || v_admin_only),
      (v_editor, 'editor', v_view || v_write || v_member_view),
      (v_viewer, 'viewer', v_view)
    ) as t(u, l, e)
  loop
    foreach v_key in array v_all loop
      perform pg_temp.check(
        public.user_has_organization_permission(v_user, v_org, v_key) = (v_key = any(v_expected)),
        format('%s %s %s', v_label, case when v_key = any(v_expected) then 'has' else 'lacks' end, v_key));
    end loop;
  end loop;
end $$;

-- Pending, disabled and other organizations' members have no permissions
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  other jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_pending uuid := gen_random_uuid();
  v_disabled uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'admin');
begin
  insert into auth.users (id, aud, role, email)
  values (v_pending, 'authenticated', 'authenticated', 'sql-test-' || v_pending || '@example.test');
  insert into public.user_organizations (user_id, organization_id, is_active, accepted_at, role)
  values (v_pending, v_org, false, null, 'admin');
  update public.user_organizations set is_active = false where user_id = v_disabled and organization_id = v_org;

  perform pg_temp.check(not public.user_has_organization_permission(v_pending, v_org, 'canViewOrders'), 'a pending invitee has no permissions');
  perform pg_temp.check(not public.user_has_organization_permission(v_disabled, v_org, 'canViewOrders'), 'a disabled member has no permissions');
  perform pg_temp.check(not public.user_has_organization_permission((other->>'user_id')::uuid, v_org, 'canViewOrders'),
    'another organization''s owner has no permissions here');
end $$;

-- set_member_role: admins change other members' roles; nobody changes their own role or the owner's
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  other jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_owner uuid := (fx->>'user_id')::uuid;
  v_admin uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'admin');
  v_member uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'viewer');
  v_editor uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'editor');
begin
  perform pg_temp.act_as(v_admin);
  perform public.set_member_role(v_org, v_member, 'editor');
  execute 'reset role';
  perform pg_temp.check((select role from public.user_organizations where user_id = v_member and organization_id = v_org) = 'editor',
    'an admin can make a viewer an editor');
  perform pg_temp.check(public.user_has_organization_permission(v_member, v_org, 'canCreateOrders'), 'the new editor can create orders');

  perform pg_temp.act_as(v_admin);
  perform public.set_member_role(v_org, v_member, 'admin');
  execute 'reset role';
  perform pg_temp.check(public.user_has_organization_permission(v_member, v_org, 'canEditUsers'), 'an admin can promote a member to admin');

  perform pg_temp.check_raises_as(v_admin, format('select public.set_member_role(%L, %L, %L)', v_org, v_admin, 'viewer'),
    '不能修改自己的角色', 'nobody can change their own role');
  perform pg_temp.check_raises_as(v_admin, format('select public.set_member_role(%L, %L, %L)', v_org, v_owner, 'viewer'),
    '不能修改擁有者的角色', 'an admin cannot change the owner''s role');
  perform pg_temp.check_raises_as(v_admin, format('select public.set_member_role(%L, %L, %L)', v_org, v_member, 'owner'),
    '擁有者只能經由轉移擁有權產生', 'nobody can be made owner through a role change');
  perform pg_temp.check_raises_as(v_admin, format('select public.set_member_role(%L, %L, %L)', v_org, v_member, 'sales'),
    '角色不存在', 'only the three roles can be assigned');
  perform pg_temp.check_raises_as(v_admin, format('select public.set_member_role(%L, %L, %L)', v_org, (other->>'user_id')::uuid, 'viewer'),
    '此使用者不是組織成員', 'a non-member cannot be given a role');
  perform pg_temp.check_raises_as(v_editor, format('select public.set_member_role(%L, %L, %L)', v_org, v_member, 'viewer'),
    '權限不足', 'an editor cannot change roles');
  perform pg_temp.check_raises_as((other->>'user_id')::uuid, format('select public.set_member_role(%L, %L, %L)', v_org, v_member, 'viewer'),
    '權限不足', 'an outsider cannot change roles');
end $$;

-- set_member_active: admins disable and re-enable members who joined; not themselves, the owner or invitees
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_owner uuid := (fx->>'user_id')::uuid;
  v_admin uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'admin');
  v_editor uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'editor');
  v_pending uuid := gen_random_uuid();
begin
  insert into auth.users (id, aud, role, email)
  values (v_pending, 'authenticated', 'authenticated', 'sql-test-' || v_pending || '@example.test');
  insert into public.user_organizations (user_id, organization_id, is_active, accepted_at, role)
  values (v_pending, v_org, false, null, 'viewer');

  perform pg_temp.act_as(v_admin);
  perform public.set_member_active(v_org, v_editor, false);
  execute 'reset role';
  perform pg_temp.check(not public.user_has_organization_permission(v_editor, v_org, 'canViewOrders'), 'a disabled editor loses access');

  perform pg_temp.act_as(v_admin);
  perform public.set_member_active(v_org, v_editor, true);
  execute 'reset role';
  perform pg_temp.check(public.user_has_organization_permission(v_editor, v_org, 'canCreateOrders'), 're-enabling restores access');

  perform pg_temp.check_raises_as(v_admin, format('select public.set_member_active(%L, %L, false)', v_org, v_admin),
    '不能停用或啟用自己', 'nobody can disable themselves');
  perform pg_temp.check_raises_as(v_admin, format('select public.set_member_active(%L, %L, false)', v_org, v_owner),
    '不能停用擁有者', 'the owner cannot be disabled');
  perform pg_temp.check_raises_as(v_admin, format('select public.set_member_active(%L, %L, true)', v_org, v_pending),
    '此成員尚未接受邀請', 'an invitation cannot be activated without being accepted');
  perform pg_temp.check_raises_as(v_editor, format('select public.set_member_active(%L, %L, false)', v_org, v_admin),
    '權限不足', 'an editor cannot disable members');
end $$;

-- Clients cannot change who a member is, their role or status directly; resending an invitation still works
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_owner uuid := (fx->>'user_id')::uuid;
  v_admin uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'admin');
  v_editor uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'editor');
  v_newcomer uuid := gen_random_uuid();
  v_changed int;
begin
  insert into auth.users (id, aud, role, email)
  values (v_newcomer, 'authenticated', 'authenticated', 'sql-test-' || v_newcomer || '@example.test');

  perform pg_temp.check_raises_as(v_admin,
    format('update public.user_organizations set role = %L where user_id = %L and organization_id = %L', 'viewer', v_editor, v_org),
    '成員的角色與狀態只能經由系統功能修改', 'an admin cannot change a role by updating the row');
  perform pg_temp.check_raises_as(v_owner,
    format('update public.user_organizations set is_active = false where user_id = %L and organization_id = %L', v_editor, v_org),
    '成員的角色與狀態只能經由系統功能修改', 'the owner cannot change a status by updating the row');
  perform pg_temp.check_raises_as(v_owner,
    format('insert into public.user_organizations (user_id, organization_id, role) values (%L, %L, %L)', v_newcomer, v_org, 'admin'),
    '成員只能經由邀請加入組織', 'the owner cannot add a member by inserting a row');

  -- An editor has no update rights on memberships at all: its own row stays as it was
  perform pg_temp.act_as(v_editor);
  update public.user_organizations set invited_at = now() where user_id = v_editor and organization_id = v_org;
  get diagnostics v_changed = row_count;
  execute 'reset role';
  perform pg_temp.check(v_changed = 0, 'an editor cannot update memberships, updated ' || v_changed);

  perform pg_temp.act_as(v_admin);
  update public.user_organizations set invited_at = now() where user_id = v_editor and organization_id = v_org;
  get diagnostics v_changed = row_count;
  execute 'reset role';
  perform pg_temp.check(v_changed = 1, 'an admin can still refresh invited_at when resending an invitation');
end $$;

-- Inviting an existing account: the invitee gets the invited role only after accepting
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_admin uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'admin');
  v_editor uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'editor');
  v_invitee uuid := gen_random_uuid();
  v_email text;
  v_returned uuid;
  v_invitation_role text;
begin
  insert into auth.users (id, aud, role, email)
  values (v_invitee, 'authenticated', 'authenticated', 'sql-test-' || v_invitee || '@example.test')
  returning email into v_email;

  perform pg_temp.act_as(v_admin);
  v_returned := public.add_existing_user_to_organization(v_email, v_org, 'editor');
  execute 'reset role';
  perform pg_temp.check(v_returned = v_invitee, 'the invitation returns the existing account');
  perform pg_temp.check(not public.user_has_organization_permission(v_invitee, v_org, 'canViewOrders'), 'an invitee has no access before accepting');

  perform pg_temp.act_as(v_invitee);
  select role_display_name into v_invitation_role from public.get_my_pending_invitations() where organization_id = v_org;
  perform public.accept_organization_invitation(v_org);
  execute 'reset role';
  perform pg_temp.check(v_invitation_role = '編輯者', 'the invitation shows the invited role, got ' || coalesce(v_invitation_role, 'none'));
  perform pg_temp.check(public.user_has_organization_permission(v_invitee, v_org, 'canCreateOrders'), 'the accepted invitee is an editor');
  perform pg_temp.check(not public.user_has_organization_permission(v_invitee, v_org, 'canEditUsers'), 'the accepted invitee is not an admin');

  perform pg_temp.check_raises_as(v_admin, format('select public.add_existing_user_to_organization(%L, %L, %L)', v_email, v_org, 'owner'),
    '指定的角色無效', 'nobody can be invited as owner');
  perform pg_temp.check_raises_as(v_editor, format('select public.add_existing_user_to_organization(%L, %L, %L)', v_email, v_org, 'viewer'),
    '權限不足', 'an editor cannot invite');
  perform pg_temp.check_raises_as(v_editor,
    format('select public.complete_user_invitation(%L, %L, %L)', gen_random_uuid(), v_org, 'viewer'),
    '權限不足', 'an editor cannot complete a sign-up invitation');
end $$;

-- Transferring ownership: the new owner has every permission, the previous owner stays an admin
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_owner uuid := (fx->>'user_id')::uuid;
  v_editor uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'editor');
begin
  perform pg_temp.check_raises_as(v_editor, format('select public.transfer_organization_ownership(%L, %L)', v_org, v_editor),
    '只有組織擁有者可以轉移所有權', 'only the owner can transfer ownership');

  perform pg_temp.act_as(v_owner);
  perform public.transfer_organization_ownership(v_org, v_editor);
  execute 'reset role';

  perform pg_temp.check((select owner_id from public.organizations where id = v_org) = v_editor, 'the editor is the new owner');
  perform pg_temp.check(public.user_has_organization_permission(v_editor, v_org, 'canEditSystemSettings'), 'the new owner has every permission');
  perform pg_temp.check((select role from public.user_organizations where user_id = v_owner and organization_id = v_org) = 'admin',
    'the previous owner is now an admin');
  perform pg_temp.check(public.user_has_organization_permission(v_owner, v_org, 'canEditUsers'), 'the previous owner keeps admin permissions');
  perform pg_temp.check_raises_as(v_owner, format('select public.transfer_organization_ownership(%L, %L)', v_org, v_owner),
    '只有組織擁有者可以轉移所有權', 'the previous owner can no longer transfer ownership');
end $$;

-- Creating an organization makes the creator an admin member; no per-organization role rows are created
do $$
declare
  v_user uuid := gen_random_uuid();
  v_org uuid;
begin
  insert into auth.users (id, aud, role, email)
  values (v_user, 'authenticated', 'authenticated', 'sql-test-' || v_user || '@example.test');

  perform pg_temp.act_as(v_user);
  insert into public.organizations (name, owner_id) values ('新組織', v_user) returning id into v_org;
  execute 'reset role';

  perform pg_temp.check((select role from public.user_organizations where user_id = v_user and organization_id = v_org and is_active) = 'admin',
    'the creator is an active admin member');
  perform pg_temp.check(to_regclass('public.organization_roles') is null, 'the legacy role table is gone');
end $$;

-- Signed-in users can read the role catalog; anonymous callers can neither read it nor call the permission functions
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  v_rows int;
begin
  perform pg_temp.act_as((fx->>'user_id')::uuid);
  select count(*) into v_rows from public.role_permissions;
  execute 'reset role';
  perform pg_temp.check(v_rows > 0, 'a signed-in user can read the role catalog');

  perform pg_temp.check(not has_table_privilege('anon', 'public.role_permissions', 'SELECT'), 'anon cannot read the role catalog');
  perform pg_temp.check(not has_function_privilege('anon', 'public.user_has_organization_permission(uuid, uuid, text)', 'EXECUTE'),
    'anon cannot call user_has_organization_permission');
  perform pg_temp.check(not has_function_privilege('anon', 'public.is_organization_owner(uuid, uuid)', 'EXECUTE'),
    'anon cannot call is_organization_owner');
  perform pg_temp.check(not has_function_privilege('anon', 'public.set_member_role(uuid, uuid, text)', 'EXECUTE'),
    'anon cannot call set_member_role');
end $$;

do $$ begin raise exception 'ALL TESTS PASSED'; end $$;
