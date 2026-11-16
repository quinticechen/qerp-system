-- Free-trial requests from the public Home page (docs/requirements/HOME_PAGE.md).
-- Visitors are not signed in and belong to no organization yet, so this table has no organization_id:
-- anyone may add a request, nobody can read or change one through the API. The team reads them
-- in the Supabase dashboard (service role), calls the person and opens their account.

create table public.trial_requests (
  id uuid primary key default gen_random_uuid(),
  contact_name text not null check (char_length(btrim(contact_name)) between 1 and 50),
  phone text not null check (phone ~ '^[0-9+()\- ]{8,20}$'),
  company_name text not null check (char_length(btrim(company_name)) between 1 and 100),
  email text check (email is null or (char_length(email) <= 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')),
  company_size text check (company_size is null or company_size in ('1-10', '11-50', '51-200', '201+')),
  note text check (note is null or char_length(note) <= 1000),
  status text not null default 'new' check (status in ('new', 'contacted', 'activated', 'declined')),
  created_at timestamptz not null default now()
);

comment on table public.trial_requests is 'Free-trial requests from the Home page; insert-only for clients, handled by the team in the dashboard';
comment on column public.trial_requests.status is 'new → contacted → activated, or declined; set by the team';

create index trial_requests_created_at_idx on public.trial_requests (created_at desc);
create index trial_requests_phone_created_at_idx on public.trial_requests (phone, created_at desc);

alter table public.trial_requests enable row level security;

-- Clients may only insert the form's own fields; id, status and created_at always take their defaults.
revoke all on public.trial_requests from anon, authenticated;
grant insert (contact_name, phone, company_name, email, company_size, note) on public.trial_requests to anon, authenticated;

create policy trial_requests_insert on public.trial_requests
  for insert to anon, authenticated
  with check (status = 'new');
-- No SELECT, UPDATE or DELETE policy: requests hold personal data and are read only with the service role.

-- Rate limit: the same phone once per 10 minutes, and at most 30 requests per hour in total.
-- Runs as owner because clients cannot read the table. 'PT429' makes PostgREST answer HTTP 429.
create or replace function private.trial_requests_throttle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.trial_requests
    where phone = new.phone and created_at > now() - interval '10 minutes'
  ) or (
    select count(*) from public.trial_requests where created_at > now() - interval '1 hour'
  ) >= 30 then
    raise exception using errcode = 'PT429', message = '申請太頻繁，請稍後再試';
  end if;
  return new;
end $$;

revoke all on function private.trial_requests_throttle() from public, anon, authenticated;

create trigger trial_requests_throttle
  before insert on public.trial_requests
  for each row execute function private.trial_requests_throttle();
