-- Run in Supabase Dashboard → SQL Editor (after subscription_periods table exists).
-- Tracks subscribe / lapse / re-subscribe periods via the existing iOS sync_subscription_state RPC.

create or replace function public.sync_subscription_state(
  p_is_active boolean,
  p_product_id text,
  p_expires_at timestamptz,
  p_will_auto_renew boolean,
  p_original_transaction_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  was_active boolean;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  select subscription_is_active into was_active
  from public.profiles
  where id = uid;

  update public.profiles
  set
    subscription_is_active = p_is_active,
    subscription_product_id = p_product_id,
    subscription_expires_at = p_expires_at,
    subscription_will_auto_renew = p_will_auto_renew,
    original_transaction_id = coalesce(p_original_transaction_id, original_transaction_id),
    updated_at = now(),
    last_seen_at = now()
  where id = uid;

  if p_is_active and not coalesce(was_active, false) then
    insert into public.subscription_periods (
      user_id,
      started_at,
      product_id,
      original_transaction_id
    ) values (
      uid,
      now(),
      p_product_id,
      p_original_transaction_id
    );
  elsif not p_is_active and coalesce(was_active, false) then
    update public.subscription_periods
    set ended_at = now()
    where user_id = uid
      and ended_at is null;
  end if;

  insert into public.usage_events (user_id, event_type, metadata)
  values (
    uid,
    'subscription_snapshot',
    jsonb_build_object(
      'is_active', p_is_active,
      'product_id', p_product_id,
      'expires_at', p_expires_at,
      'will_auto_renew', p_will_auto_renew,
      'original_transaction_id', p_original_transaction_id
    )
  );
end;
$$;

alter function public.sync_subscription_state(boolean, text, timestamptz, boolean, text) owner to postgres;
grant execute on function public.sync_subscription_state(boolean, text, timestamptz, boolean, text) to authenticated;

-- One-time: seed an open period for users already subscribed before this migration.
insert into public.subscription_periods (user_id, started_at, product_id, original_transaction_id)
select
  p.id,
  coalesce(p.updated_at, p.created_at),
  p.subscription_product_id,
  p.original_transaction_id
from public.profiles p
where p.subscription_is_active = true
  and not exists (
    select 1
    from public.subscription_periods sp
    where sp.user_id = p.id
      and sp.ended_at is null
  );

notify pgrst, 'reload schema';
