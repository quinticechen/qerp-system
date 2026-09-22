-- Fix: 擁有 canCreateUsers / canEditUsers 權限的組織成員（非組織擁有者本人）
-- 在新增使用者時，無法將對方寫入 user_organizations，導致新使用者永遠不會出現在成員列表中。
-- 原因：user_organizations 僅有 self-insert（user_id = auth.uid()）與
-- is_organization_owner（僅限 organizations.owner_id 本人）兩種 INSERT 政策，
-- 未涵蓋透過 organization_roles 授予 canCreateUsers 權限的一般管理員。

CREATE POLICY "Org members with canCreateUsers can add memberships"
  ON public.user_organizations
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.user_has_organization_permission(auth.uid(), organization_id, 'canCreateUsers')
  );

-- 同理，profiles 的 UPDATE 僅開放本人或全域 is_admin() ，
-- 而 is_admin() 依賴從未被寫入的舊版 user_roles 表，實際上永遠為 false。
-- 補上讓擁有 canEditUsers / canCreateUsers 權限者可以更新同組織成員的 profile
-- （例如新增使用者時補寫 phone，或日後編輯使用者資料）。

CREATE POLICY "Org members with canEditUsers can update member profiles"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_organizations uo
      WHERE uo.user_id = profiles.id
        AND (
          public.user_has_organization_permission(auth.uid(), uo.organization_id, 'canEditUsers')
          OR public.user_has_organization_permission(auth.uid(), uo.organization_id, 'canCreateUsers')
        )
    )
  );
