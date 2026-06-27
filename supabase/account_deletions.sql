-- Run once in Supabase Dashboard → SQL Editor.
-- Logs account deletions before auth user is removed (self-delete via app RPC, or admin via edge function).

create table if not exists public.account_deletions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  email text,
  full_name text,
  routes_built_count int not null default 0,
  subscription_is_active boolean not null default false,
  subscription_product_id text,
  subscription_expires_at timestamptz,
  profile_created_at timestamptz,
  last_seen_at timestamptz,
  deleted_at timestamptz not null default now(),
  deletion_source text not null default 'self'
    check (deletion_source in ('self', 'admin'))
);

create index if not exists account_deletions_deleted_at_idx
  on public.account_deletions (deleted_at desc);

create index if not exists account_deletions_source_idx
  on public.account_deletions (deletion_source, deleted_at desc);

alter table public.account_deletions enable row level security;

-- No policies for authenticated: only service role (admin edge function) reads/writes this table.

create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  uid uuid := auth.uid();
  p public.profiles%rowtype;
  auth_email text;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  select * into p from public.profiles where id = uid;

  if p.id is null then
    select email into auth_email from auth.users where id = uid;
  end if;

  insert into public.account_deletions (
    user_id,
    email,
    full_name,
    routes_built_count,
    subscription_is_active,
    subscription_product_id,
    subscription_expires_at,
    profile_created_at,
    last_seen_at,
    deletion_source
  ) values (
    uid,
    coalesce(p.email, auth_email),
    p.full_name,
    coalesce(p.routes_built_count, 0),
    coalesce(p.subscription_is_active, false),
    p.subscription_product_id,
    p.subscription_expires_at,
    p.created_at,
    p.last_seen_at,
    'self'
  );

  delete from auth.users where id = uid;
end;
$$;

alter function public.delete_own_account() owner to postgres;

revoke all on function public.delete_own_account() from public, anon;
grant execute on function public.delete_own_account() to authenticated, service_role;

notify pgrst, 'reload schema';
