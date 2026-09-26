-- signed tokens the driver app passes to the ESP32 over Bluetooth (the ESP32 checks the signature offline)
-- format: base64url(json payload) || '.' || hex(hmac_sha256(device_secret, base64url(json payload)))
create or replace function private.b64url(p bytea) returns text language sql immutable set search_path = '' as $$
  select translate(rtrim(encode(p, 'base64'), '='), E'+/\n', '-_')
$$;

create or replace function private.vehicle_token(p_vehicle_id uuid, p_shift_id uuid, p_action text, p_valid_seconds int default 600)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare dev record; payload text; body text;
begin
  select d.id, d.device_uid, d.mode, s.secret into dev
    from public.vehicle_devices d join private.vehicle_device_secrets s on s.device_id = d.id
   where d.vehicle_id = p_vehicle_id and d.is_active;
  if dev.id is null then return null; end if;
  payload := jsonb_build_object('v', 1, 'dev', dev.device_uid, 'act', p_action, 'shift', p_shift_id,
               'iat', floor(extract(epoch from now()))::bigint, 'exp', floor(extract(epoch from now()))::bigint + p_valid_seconds,
               'n', encode(extensions.gen_random_bytes(6), 'hex'))::text;
  body := private.b64url(convert_to(payload, 'utf8'));
  return jsonb_build_object('device_uid', dev.device_uid, 'mode', dev.mode, 'action', p_action,
    'token', body || '.' || encode(extensions.hmac(body, dev.secret, 'sha256'), 'hex'),
    'expires_at', now() + make_interval(secs => p_valid_seconds));
end $$;
create or replace function private.vehicle_unlock_token(p_vehicle_id uuid, p_shift_id uuid) returns jsonb
language sql security definer set search_path = '' as $$ select private.vehicle_token(p_vehicle_id, p_shift_id, 'unlock') $$;
create or replace function private.vehicle_lock_token(p_vehicle_id uuid, p_shift_id uuid) returns jsonb
language sql security definer set search_path = '' as $$ select private.vehicle_token(p_vehicle_id, p_shift_id, 'lock') $$;

-- a fresh unlock token during an open shift (e.g. the first one expired before the driver reached the car)
create or replace function public.driver_unlock_token()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.driver_shifts;
begin
  select * into s from public.driver_shifts where driver_id = private.current_driver_id() and status = 'open';
  if s.id is null then raise exception 'Start your shift first.'; end if;
  return private.vehicle_unlock_token(s.vehicle_id, s.id);
end $$;
revoke execute on function public.driver_unlock_token() from anon;

-- the app reports what the ESP32 answered over Bluetooth (unlocked, engine on …)
create or replace function public.driver_report_vehicle_event(p_event_type text, p_data jsonb default '{}')
returns void language plpgsql security definer set search_path = '' as $$
declare d uuid := private.current_driver_id(); s public.driver_shifts; dev uuid;
begin
  if d is null then raise exception 'Not a driver login.'; end if;
  if p_event_type not in ('unlocked','locked','engine_on','engine_off','start_blocked','ble_connected','ble_failed','odometer') then raise exception 'Unknown event.'; end if;
  select * into s from public.driver_shifts where driver_id = d and status = 'open';
  if s.id is null then
    select vehicle_id into s.vehicle_id from public.driver_shifts where driver_id = d order by started_at desc limit 1;
  end if;
  if s.vehicle_id is null then raise exception 'No vehicle.'; end if;
  select id into dev from public.vehicle_devices where vehicle_id = s.vehicle_id;
  insert into public.vehicle_events(vehicle_id, device_id, driver_id, shift_id, event_type, source, data)
  values (s.vehicle_id, dev, d, s.id, p_event_type, 'app', coalesce(p_data, '{}'));
  if p_event_type = 'unlocked' and s.id is not null then
    update public.driver_shifts set device_confirmed_at = coalesce(device_confirmed_at, now()), unlock_method = coalesce(unlock_method, 'ble') where id = s.id;
  end if;
  if p_event_type = 'odometer' and (p_data->>'km') ~ '^\d+$' then
    update public.vehicles set odometer_km = greatest(coalesce(odometer_km,0), (p_data->>'km')::int) where id = s.vehicle_id;
  end if;
end $$;
revoke execute on function public.driver_report_vehicle_event(text, jsonb) from anon;

-- admin: register an ESP32 for a car; the secret is shown ONCE (to flash into the device)
create or replace function public.admin_register_device(p_vehicle_id uuid, p_device_uid text, p_mode text default 'ble')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare dev public.vehicle_devices; sec text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  if not private.has_role(array['owner','admin']) then raise exception 'Only owner/admin can register devices.'; end if;
  insert into public.vehicle_devices(vehicle_id, device_uid, mode) values (p_vehicle_id, p_device_uid, coalesce(p_mode, 'ble'))
  on conflict (vehicle_id) do update set device_uid = excluded.device_uid, mode = excluded.mode, is_active = true
  returning * into dev;
  insert into private.vehicle_device_secrets(device_id, secret) values (dev.id, sec)
  on conflict (device_id) do update set secret = excluded.secret, rotated_at = now();
  return jsonb_build_object('device_id', dev.id, 'device_uid', dev.device_uid, 'mode', dev.mode, 'secret', sec);
end $$;
revoke execute on function public.admin_register_device(uuid, text, text) from anon;

-- device over the internet (LTE): verify its signature, answer "may the car start?"
-- signature = hex(hmac_sha256(secret, device_uid || '|' || ts || '|' || payload_text))
create or replace function public.device_call(p_device_uid text, p_ts bigint, p_payload jsonb, p_sig text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare dev record; expected text; s record; ev jsonb; n int := 0;
begin
  select d.*, sc.secret into dev from public.vehicle_devices d join private.vehicle_device_secrets sc on sc.device_id = d.id where d.device_uid = p_device_uid;
  if dev.id is null or not dev.is_active then return jsonb_build_object('ok', false, 'error', 'unknown device'); end if;
  if abs(extract(epoch from now()) - p_ts) > 300 then return jsonb_build_object('ok', false, 'error', 'clock', 'server_ts', floor(extract(epoch from now()))::bigint); end if;
  expected := encode(extensions.hmac(p_device_uid || '|' || p_ts::text || '|' || coalesce(p_payload, '{}')::text, dev.secret, 'sha256'), 'hex');
  if expected <> lower(coalesce(p_sig, '')) then return jsonb_build_object('ok', false, 'error', 'signature'); end if;

  update public.vehicle_devices set last_seen_at = now(), last_state = coalesce(p_payload->'state', last_state),
         firmware_version = coalesce(p_payload->>'fw', firmware_version) where id = dev.id;

  -- events sent by the device (engine on/off, blocked start …)
  for ev in select * from jsonb_array_elements(coalesce(p_payload->'events', '[]')) loop
    exit when n >= 50;
    insert into public.vehicle_events(vehicle_id, device_id, driver_id, shift_id, event_type, source, data, occurred_at)
    select dev.vehicle_id, dev.id, sh.driver_id, sh.id, left(coalesce(ev->>'type', 'unknown'), 40), 'device', coalesce(ev->'data', '{}'),
           coalesce(to_timestamp((ev->>'ts')::bigint), now())
      from (select 1) x left join public.driver_shifts sh on sh.vehicle_id = dev.vehicle_id and sh.status = 'open';
    n := n + 1;
  end loop;
  if (p_payload->'state'->>'odometer_km') ~ '^\d+$' then
    update public.vehicles set odometer_km = greatest(coalesce(odometer_km,0), (p_payload->'state'->>'odometer_km')::int) where id = dev.vehicle_id;
  end if;

  select sh.id, sh.started_at, dr.first_name into s from public.driver_shifts sh join public.drivers dr on dr.id = sh.driver_id
   where sh.vehicle_id = dev.vehicle_id and sh.status = 'open';
  if s.id is not null then
    update public.driver_shifts set device_confirmed_at = coalesce(device_confirmed_at, now()), unlock_method = coalesce(unlock_method, 'lte') where id = s.id;
  end if;
  return jsonb_build_object('ok', true, 'allowed', s.id is not null, 'shift_id', s.id, 'driver', s.first_name,
                            'server_ts', floor(extract(epoch from now()))::bigint, 'poll_seconds', case when s.id is null then 20 else 60 end);
end $$;
revoke all on function public.device_call(text, bigint, jsonb, text) from public, anon, authenticated;
grant execute on function public.device_call(text, bigint, jsonb, text) to service_role;
