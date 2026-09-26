drop function if exists public.device_call(text, bigint, jsonb, text);
-- signature = hex(hmac_sha256(secret, device_uid || '|' || ts || '|' || payload_text)), payload_text = the exact JSON string the device sent
create or replace function public.device_call(p_device_uid text, p_ts bigint, p_payload_text text, p_sig text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare dev record; expected text; s record; ev jsonb; n int := 0; p_payload jsonb;
begin
  select d.*, sc.secret into dev from public.vehicle_devices d join private.vehicle_device_secrets sc on sc.device_id = d.id where d.device_uid = p_device_uid;
  if dev.id is null or not dev.is_active then return jsonb_build_object('ok', false, 'error', 'unknown device'); end if;
  if abs(extract(epoch from now()) - p_ts) > 300 then return jsonb_build_object('ok', false, 'error', 'clock', 'server_ts', floor(extract(epoch from now()))::bigint); end if;
  expected := encode(extensions.hmac(p_device_uid || '|' || p_ts::text || '|' || coalesce(p_payload_text, ''), dev.secret, 'sha256'), 'hex');
  if expected <> lower(coalesce(p_sig, '')) then return jsonb_build_object('ok', false, 'error', 'signature'); end if;
  begin p_payload := coalesce(nullif(p_payload_text, '')::jsonb, '{}'); exception when others then p_payload := '{}'; end;

  update public.vehicle_devices set last_seen_at = now(), last_state = coalesce(p_payload->'state', last_state),
         firmware_version = coalesce(p_payload->>'fw', firmware_version) where id = dev.id;

  for ev in select * from jsonb_array_elements(case when jsonb_typeof(p_payload->'events') = 'array' then p_payload->'events' else '[]' end) loop
    exit when n >= 50;
    insert into public.vehicle_events(vehicle_id, device_id, driver_id, shift_id, event_type, source, data, occurred_at)
    select dev.vehicle_id, dev.id, sh.driver_id, sh.id, left(coalesce(ev->>'type', 'unknown'), 40), 'device', coalesce(ev->'data', '{}'),
           case when (ev->>'ts') ~ '^\d{9,11}$' then to_timestamp((ev->>'ts')::bigint) else now() end
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
revoke all on function public.device_call(text, bigint, text, text) from public, anon, authenticated;
grant execute on function public.device_call(text, bigint, text, text) to service_role;
