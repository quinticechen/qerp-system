-- profiles 已經有「擁有 canViewUsers 權限者可查看組織成員 profile」的 SELECT policy，
-- 但實際上 UserList / OrganizationRoleManagement 是先查 user_organizations /
-- user_organization_roles 取得成員清單，這兩張表仍然只開放 user_id = auth.uid()
-- （自己）或 is_organization_owner()（組織擁有者本人），導致非 owner 的 admin
-- 角色成員查詢組織成員清單時，RLS 直接把結果過濾到只剩自己一筆，UserPage /
-- PermissionPage 因此看起來「沒有其他使用者」。補上跟 profiles 同樣邏輯的
-- canViewUsers 權限政策。

CREATE POLICY "Org members with canViewUsers can view org memberships"
  ON public.user_organizations
  FOR SELECT
  TO authenticated
  USING (
    public.user_has_organization_permission(auth.uid(), organization_id, 'canViewUsers')
  );

CREATE POLICY "Org members with canViewUsers can view member roles"
  ON public.user_organization_roles
  FOR SELECT
  TO authenticated
  USING (
    public.user_has_organization_permission(auth.uid(), organization_id, 'canViewUsers')
  );
