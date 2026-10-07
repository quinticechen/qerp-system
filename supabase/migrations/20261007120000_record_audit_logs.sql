-- 編輯紀錄：所有業務資料表的新增、修改、刪除都寫入 record_audit_logs，
-- 每筆紀錄包含被修改資料的 uuid、所屬單據 uuid、修改前後內容與編輯者。

create table public.record_audit_logs (
  id uuid primary key default gen_random_uuid(),
  -- No foreign keys: the trail must outlive the records and organizations it describes
  organization_id uuid,
  table_name text not null,
  record_id uuid not null,
  parent_table text,
  parent_id uuid,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  old_data jsonb,
  new_data jsonb,
  changed_fields text[] not null default '{}',
  changed_by uuid,
  changed_at timestamptz not null default now()
);

create index record_audit_logs_record_idx on public.record_audit_logs (record_id, changed_at desc);
create index record_audit_logs_parent_idx on public.record_audit_logs (parent_id, changed_at desc);
create index record_audit_logs_org_idx on public.record_audit_logs (organization_id, changed_at desc);

alter table public.record_audit_logs enable row level security;

-- Members read their organization's trail; rows without an organization (profiles) are visible
-- to the editor and to the person the record belongs to
create policy "org_members_read_audit_logs" on public.record_audit_logs
  for select to authenticated
  using (
    organization_id in (
      select uo.organization_id from public.user_organizations uo
      where uo.user_id = auth.uid() and uo.is_active = true
    )
    or (organization_id is null and (changed_by = auth.uid() or record_id = auth.uid()))
  );

-- The trail is append-only and written exclusively by the trigger below
revoke insert, update, delete, truncate on public.record_audit_logs from anon, authenticated;

-- Trigger arguments: [0] column holding the parent document id, [1] parent table name
create or replace function public.log_record_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_parent_column text := tg_argv[0];
  v_parent_table text := tg_argv[1];
  v_parent_id uuid;
  v_org uuid;
  v_changed text[] := '{}';
begin
  if tg_op = 'UPDATE' then
    select coalesce(array_agg(n.key order by n.key), '{}') into v_changed
    from jsonb_each(v_new) n
    where n.key not in ('updated_at', 'updated_by')
      and n.value is distinct from v_old -> n.key;

    -- Bookkeeping-only updates are not edits
    if cardinality(v_changed) = 0 then
      return null;
    end if;
  end if;

  if v_parent_column is not null then
    v_parent_id := (v_row ->> v_parent_column)::uuid;
  end if;

  if v_row ? 'organization_id' then
    v_org := (v_row ->> 'organization_id')::uuid;
  elsif tg_table_name = 'organizations' then
    v_org := (v_row ->> 'id')::uuid;
  elsif v_parent_id is not null then
    execute format('select organization_id from public.%I where id = $1', v_parent_table)
      into v_org using v_parent_id;
    -- During a cascading delete the parent row is already gone; recover it from the parent's trail
    if v_org is null then
      select l.organization_id into v_org
      from public.record_audit_logs l
      where l.record_id = v_parent_id and l.organization_id is not null
      order by l.changed_at desc
      limit 1;
    end if;
  end if;

  insert into public.record_audit_logs (
    organization_id, table_name, record_id, parent_table, parent_id,
    action, old_data, new_data, changed_fields, changed_by
  ) values (
    v_org, tg_table_name, (v_row ->> 'id')::uuid, v_parent_table, v_parent_id,
    tg_op, v_old, v_new, v_changed, auth.uid()
  );

  return null;
end;
$$;

revoke execute on function public.log_record_change() from public, anon, authenticated;

do $$
declare
  audited record;
begin
  for audited in
    select * from (values
      ('orders', null, null),
      ('order_products', 'order_id', 'orders'),
      ('order_factories', 'order_id', 'orders'),
      ('purchase_orders', null, null),
      ('purchase_order_items', 'purchase_order_id', 'purchase_orders'),
      ('purchase_order_relations', 'purchase_order_id', 'purchase_orders'),
      ('inventories', null, null),
      ('inventory_rolls', 'inventory_id', 'inventories'),
      ('shippings', null, null),
      ('shipping_items', 'shipping_id', 'shippings'),
      ('products_new', null, null),
      ('customers', null, null),
      ('factories', null, null),
      ('warehouses', null, null),
      ('organizations', null, null),
      ('organization_roles', null, null),
      ('user_organizations', null, null),
      ('user_organization_roles', null, null),
      ('profiles', null, null)
    ) as t(table_name, parent_column, parent_table)
  loop
    execute format(
      'create trigger audit_record_changes after insert or update or delete on public.%I '
      'for each row execute function public.log_record_change(%s)',
      audited.table_name,
      case when audited.parent_column is null then ''
           else quote_literal(audited.parent_column) || ', ' || quote_literal(audited.parent_table) end
    );
  end loop;
end $$;
