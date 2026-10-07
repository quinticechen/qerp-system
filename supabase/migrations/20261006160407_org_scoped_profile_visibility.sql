CREATE POLICY "Org members with canViewUsers can view member profiles"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_organizations uo
      WHERE uo.user_id = profiles.id
        AND public.user_has_organization_permission(auth.uid(), uo.organization_id, 'canViewUsers')
    )
  );
