-- Plans and subscriptions (docs/requirements/PRICING_AND_BILLING.md).
-- Each organization has one subscription row. A new organization starts 'pending' (not activated):
-- it is activated either by paying through Stripe (the Query server's webhook writes this table
-- with the service role) or manually by the team (free plan, SQL in the requirement doc).

-- ── Plan limits ─────────────────────────────────────────────────────────────
-- Keep in step with src/lib/billingPlans.ts (pricing page) and the Stripe prices' lookup keys.
create or replace function private.plan_limits(p_plan text, p_status text)
returns table (max_members integer, query_messages_per_month integer)
language sql
immutable
set search_path = ''
as $$
  select case when p_status = 'pending' then 1 else
           case p_plan when 'free' then 3 when 'standard' then 10 when 'pro' then 30 else 1 end
         end,
         case when p_status = 'pending' then 0 else
           case p_plan when 'free' then 100 when 'standard' then 1000 when 'pro' then 5000 else 0 end
         end;
$$;

revoke all on function private.plan_limits(text, text) from public, anon, authenticated;

-- ── Subscriptions ───────────────────────────────────────────────────────────
create table public.organization_subscriptions (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  plan text not null default 'free' check (plan in ('free', 'standard', 'pro')),
  -- pending: not activated yet; active: in use; past_due: Stripe could not collect (still usable while Stripe retries)
  status text not null default 'pending' check (status in ('pending', 'active', 'past_due')),
  billing_period text check (billing_period in ('month', 'year', 'two_years')),
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  activated_by text check (activated_by in ('manual', 'stripe')),
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (plan = 'free' or billing_period is not null)
);

comment on table public.organization_subscriptions is
  'One row per organization: plan, status and Stripe subscription. Members read their own; written only by the Stripe webhook (service role) or the team';

alter table public.organization_subscriptions enable row level security;

revoke all on public.organization_subscriptions from anon, authenticated;
grant select on public.organization_subscriptions to authenticated;

create policy organization_subscriptions_select on public.organization_subscriptions
  for select to authenticated
  using (private.user_belongs_to_organization(auth.uid(), organization_id)
         or private.is_organization_owner(auth.uid(), organization_id));

create trigger update_organization_subscriptions_updated_at
  before update on public.organization_subscriptions
  for each row execute function public.update_updated_at();

-- Every new organization gets a pending row.
create or replace function private.create_organization_subscription()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.organization_subscriptions (organization_id) values (new.id)
  on conflict (organization_id) do nothing;
  return new;
end $$;

revoke all on function private.create_organization_subscription() from public, anon, authenticated;

create trigger create_organization_subscription
  after insert on public.organizations
  for each row execute function private.create_organization_subscription();

-- Organizations that exist today keep working: they are on the free plan, activated manually.
insert into public.organization_subscriptions (organization_id, plan, status, activated_by, activated_at)
select id, 'free', 'active', 'manual', now() from public.organizations
on conflict (organization_id) do nothing;

-- ── Member limit ────────────────────────────────────────────────────────────
-- Adding or reactivating a member beyond the plan's seats fails with 409 and a Chinese message.
create or replace function private.enforce_member_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan text;
  v_status text;
  v_max integer;
  v_count integer;
begin
  if not new.is_active or (tg_op = 'UPDATE' and old.is_active) then
    return new;
  end if;

  select s.plan, s.status into v_plan, v_status
  from public.organization_subscriptions s where s.organization_id = new.organization_id;
  select l.max_members into v_max from private.plan_limits(coalesce(v_plan, 'free'), coalesce(v_status, 'pending')) l;

  select count(*) into v_count from public.user_organizations m
  where m.organization_id = new.organization_id and m.is_active and m.id <> new.id;

  if v_count >= v_max then
    perform public.api_fail('55000', 'plan_member_limit',
      case when coalesce(v_status, 'pending') = 'pending'
        then '組織尚未開通，開通後才能邀請成員'
        else format('已達目前方案的成員上限（%s 人），請升級方案', v_max) end);
  end if;
  return new;
end $$;

revoke all on function private.enforce_member_limit() from public, anon, authenticated;

create trigger enforce_member_limit
  before insert or update of is_active on public.user_organizations
  for each row execute function private.enforce_member_limit();

-- ── What the organization may use ───────────────────────────────────────────
-- Read by the app (activation screen, plan display) and the Query server (monthly AI quota).
create or replace function private.get_organization_entitlement(_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_sub public.organization_subscriptions;
  v_limits record;
  v_members integer;
  v_used integer;
  v_month_start timestamptz := date_trunc('month', now() at time zone 'Asia/Taipei') at time zone 'Asia/Taipei';
begin
  if not (private.user_belongs_to_organization(auth.uid(), _organization_id)
          or private.is_organization_owner(auth.uid(), _organization_id)) then
    perform public.api_fail('42501', 'not_member', '你不是這個組織的成員');
  end if;

  select * into v_sub from public.organization_subscriptions where organization_id = _organization_id;
  select * into v_limits from private.plan_limits(coalesce(v_sub.plan, 'free'), coalesce(v_sub.status, 'pending'));

  select count(*) into v_members from public.user_organizations
  where organization_id = _organization_id and is_active;

  select count(*) into v_used
  from public.query_messages m join public.query_sessions s on s.id = m.session_id
  where s.organization_id = _organization_id and m.role = 'user' and m.created_at >= v_month_start;

  return jsonb_build_object(
    'plan', coalesce(v_sub.plan, 'free'),
    'status', coalesce(v_sub.status, 'pending'),
    'billing_period', v_sub.billing_period,
    'current_period_end', v_sub.current_period_end,
    'cancel_at_period_end', coalesce(v_sub.cancel_at_period_end, false),
    'max_members', v_limits.max_members,
    'members', v_members,
    'query_messages_per_month', v_limits.query_messages_per_month,
    'query_messages_used', v_used
  );
end $$;

revoke all on function private.get_organization_entitlement(uuid) from public, anon;
grant execute on function private.get_organization_entitlement(uuid) to authenticated;

create or replace function public.get_organization_entitlement(_organization_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$ select private.get_organization_entitlement(_organization_id) $$;

revoke all on function public.get_organization_entitlement(uuid) from public, anon;
grant execute on function public.get_organization_entitlement(uuid) to authenticated;
