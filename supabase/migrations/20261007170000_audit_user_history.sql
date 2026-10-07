-- 用戶編輯紀錄：
-- 1. 組織成員（user_organizations）與成員角色（user_organization_roles）的紀錄以該用戶為所屬對象（parent），
--    讓用戶的編輯紀錄能一次查到個人資料、成員狀態與角色的變更。
-- 2. 個人資料（profiles）沒有組織，同組織的有效成員也能看到彼此個人資料的變更紀錄。

do $$
declare
  member_table text;
begin
  foreach member_table in array array['user_organizations', 'user_organization_roles'] loop
    execute format('drop trigger if exists audit_record_changes on public.%I', member_table);
    execute format(
      'create trigger audit_record_changes after insert or update or delete on public.%I '
      'for each row execute function public.log_record_change(%L, %L)',
      member_table, 'user_id', 'profiles'
    );
  end loop;
end $$;

-- Link the membership and role rows logged so far to their user as well
update public.record_audit_logs
set parent_table = 'profiles',
    parent_id = coalesce(new_data ->> 'user_id', old_data ->> 'user_id')::uuid
where table_name in ('user_organizations', 'user_organization_roles')
  and parent_id is null;

create policy "org_members_read_member_profile_logs" on public.record_audit_logs
  for select to authenticated
  using (
    table_name = 'profiles'
    and record_id in (
      select member.user_id
      from public.user_organizations member
      where member.is_active = true
        and member.organization_id in (
          select mine.organization_id from public.user_organizations mine
          where mine.user_id = auth.uid() and mine.is_active = true
        )
    )
  );
