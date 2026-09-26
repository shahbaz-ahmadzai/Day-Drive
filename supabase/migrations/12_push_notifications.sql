create extension if not exists pg_net with schema extensions;

-- send an event to the push-send edge function (fire and forget)
create or replace function private.notify_event(p_event jsonb) returns void language plpgsql security definer set search_path = '' as $$
declare sec text;
begin
  select decrypted_secret into sec from vault.decrypted_secrets where name = 'internal_function_secret';
  if sec is null then return; end if;
  perform net.http_post(
    url := 'https://fhvfzmbopjfldugnsoju.supabase.co/functions/v1/push-send',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-secret', sec),
    body := p_event,
    timeout_milliseconds := 5000);
exception when others then
  raise warning 'notify_event failed: %', sqlerrm;
end $$;

create or replace function private.bookings_notify() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.driver_id is not null and new.contract_id is null then
      perform private.notify_event(jsonb_build_object('type', 'ride_assigned', 'booking_id', new.id, 'driver_id', new.driver_id));
    end if;
    return new;
  end if;
  -- driver side
  if new.driver_id is not null and new.driver_id is distinct from old.driver_id then
    perform private.notify_event(jsonb_build_object('type', 'ride_assigned', 'booking_id', new.id, 'driver_id', new.driver_id));
  end if;
  if old.driver_id is not null and new.driver_id is distinct from old.driver_id and new.status <> 'cancelled' then
    perform private.notify_event(jsonb_build_object('type', 'ride_unassigned', 'booking_id', new.id, 'driver_id', old.driver_id));
  end if;
  if new.driver_id is not null and new.driver_id = old.driver_id then
    if new.status = 'cancelled' and old.status <> 'cancelled' then
      perform private.notify_event(jsonb_build_object('type', 'ride_cancelled', 'booking_id', new.id, 'driver_id', new.driver_id));
    elsif new.booking_start is distinct from old.booking_start or new.pickup_address is distinct from old.pickup_address
       or new.destination_address is distinct from old.destination_address then
      perform private.notify_event(jsonb_build_object('type', 'ride_changed', 'booking_id', new.id, 'driver_id', new.driver_id));
    end if;
  end if;
  -- customer side
  if new.customer_id is not null and (
       (new.status = 'on_the_way' and old.status is distinct from 'on_the_way')
    or (new.arrived_at is not null and old.arrived_at is null)
    or (new.driver_id is not null and old.driver_id is null)) then
    perform private.notify_event(jsonb_build_object('type', 'ride_status', 'booking_id', new.id, 'customer_id', new.customer_id,
      'status', case when new.arrived_at is not null and old.arrived_at is null then 'arrived' when new.status = 'on_the_way' then 'on_the_way' else 'driver_assigned' end));
  end if;
  return new;
end $$;
drop trigger if exists bookings_notify on public.bookings;
create trigger bookings_notify after insert or update on public.bookings for each row execute function private.bookings_notify();

create or replace function private.messages_notify() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.notify_event(jsonb_build_object('type', 'message', 'booking_id', new.booking_id, 'message_id', new.id, 'from', new.sender_type));
  return new;
end $$;
drop trigger if exists ride_messages_notify on public.ride_messages;
create trigger ride_messages_notify after insert on public.ride_messages for each row execute function private.messages_notify();

-- the app needs the public key to subscribe
create or replace function public.push_public_key() returns text language sql stable security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'vapid_public_key'
$$;
grant execute on function public.push_public_key() to anon, authenticated;

create or replace function public.push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_audience text, p_user_agent text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Please log in.'; end if;
  if p_audience = 'driver' and private.current_driver_id() is null then raise exception 'Not a driver.'; end if;
  if p_audience = 'customer' and private.current_customer_id() is null then raise exception 'Not a customer.'; end if;
  if p_audience = 'admin' and not private.is_admin() then raise exception 'Not an admin.'; end if;
  insert into public.push_subscriptions(user_id, audience, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_audience, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update set user_id = excluded.user_id, audience = excluded.audience, p256dh = excluded.p256dh, auth = excluded.auth, failed_count = 0;
end $$;
revoke execute on function public.push_subscribe(text, text, text, text, text) from anon;

-- internal: vapid secrets for the push-send function (service role only)
revoke all on function public.get_secret(text) from anon, authenticated;
