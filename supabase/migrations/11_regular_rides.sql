-- safer random login codes
create or replace function public.customer_code_create(p_destination text, p_channel text default 'sms')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare cid uuid; recent int; code text; dest text; lang text;
begin
  code := lpad(((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint % 1000000))::text, 6, '0');
  if p_channel = 'email' then
    select id, email, language into cid, dest, lang from public.customers where email = lower(trim(p_destination));
  else
    select id, phone, language into cid, dest, lang from public.customers
     where length(private.digits(p_destination)) >= 7 and private.digits(phone) = private.digits(p_destination) order by created_at limit 1;
  end if;
  if cid is null then return jsonb_build_object('found', false); end if;
  select count(*) into recent from private.customer_login_codes where customer_id = cid and created_at > now() - interval '15 minutes';
  if recent >= 3 then return jsonb_build_object('found', true, 'throttled', true); end if;
  insert into private.customer_login_codes(customer_id, channel, destination, code_hash, expires_at)
  values (cid, coalesce(p_channel, 'sms'), dest, extensions.crypt(code, extensions.gen_salt('bf', 6)), now() + interval '10 minutes');
  return jsonb_build_object('found', true, 'customer_id', cid, 'code', code, 'destination', dest, 'language', lang);
end $$;
revoke all on function public.customer_code_create(text, text) from public, anon, authenticated;
grant execute on function public.customer_code_create(text, text) to service_role;

-- ---------- which days a contract drives ----------
create or replace function private.contract_dates(p_start date, p_end date, p_weekdays int[], p_excluded date[],
  p_skip_public boolean, p_skip_school boolean, p_region text default 'HE')
returns setof date language sql stable set search_path = '' as $$
  select d::date from generate_series(p_start, p_end, interval '1 day') d
  where extract(isodow from d)::int = any(p_weekdays)
    and not (d::date = any(coalesce(p_excluded, '{}')))
    and not (p_skip_public and exists (select 1 from public.holidays h where h.day = d::date and h.region = p_region and h.kind = 'public'))
    and not (p_skip_school and exists (select 1 from public.holidays h where h.day = d::date and h.region = p_region and h.kind = 'school'))
  order by 1
$$;

-- quote for the website form (no login): ride days, number of rides, starting price per ride
create or replace function public.contract_quote(p_start date, p_end date, p_weekdays int[], p_trip_type text,
  p_excluded date[] default '{}', p_skip_public boolean default true, p_skip_school boolean default false,
  p_vehicle_id uuid default null, p_km numeric default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare days date[]; legs int; v record; ppr numeric; res jsonb := '[]';
begin
  if p_start is null or p_end is null or p_end < p_start then raise exception 'Please choose the dates.'; end if;
  if p_end > p_start + 400 then raise exception 'A contract can last at most about one year.'; end if;
  if p_start < (now() at time zone 'Europe/Berlin')::date then raise exception 'The start date is in the past.'; end if;
  days := array(select private.contract_dates(p_start, p_end, p_weekdays, p_excluded, p_skip_public, p_skip_school));
  legs := coalesce(array_length(days, 1), 0) * case when p_trip_type = 'one_way' then 1 else 2 end;
  for v in select id, display_name, category_label, seats, luggage_large, image_path,
      coalesce(regular_price_per_km, price_per_km) as ppk, coalesce(regular_minimum_fare, minimum_fare) as minf
    from public.vehicles where status = 'active' and online_booking and (p_vehicle_id is null or id = p_vehicle_id) order by sort_order loop
    ppr := round(greatest(coalesce(p_km, 0) * v.ppk, v.minf), 2);
    res := res || jsonb_build_object('vehicle_id', v.id, 'name', v.display_name, 'category', v.category_label, 'seats', v.seats,
      'luggage', v.luggage_large, 'price_per_ride', ppr, 'total', round(ppr * legs, 2));
  end loop;
  return jsonb_build_object('days', to_jsonb(days), 'day_count', coalesce(array_length(days, 1), 0), 'ride_count', legs, 'vehicles', res);
end $$;
grant execute on function public.contract_quote(date, date, int[], text, date[], boolean, boolean, uuid, numeric) to anon, authenticated;

-- ---------- create the single rides of a contract ----------
create or replace function private.contract_generate(p_contract_id uuid, p_from date default null)
returns int language plpgsql security definer set search_path = '' as $$
declare c public.ride_contracts; cu public.customers; p record; first_p record; d date; n int := 0;
  pickups jsonb; stops_out jsonb; stops_back jsonb; t_out time; t_back time; dur int; ret_time time; start_ts timestamptz;
  svc text; vname text;
begin
  select * into c from public.ride_contracts where id = p_contract_id for update;
  select * into cu from public.customers where id = c.customer_id;
  select * into first_p from public.ride_contract_pickups where contract_id = c.id order by sort_order, pickup_time limit 1;
  if first_p.id is null then raise exception 'The contract has no pickup point.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('address', address, 'lat', lat, 'lng', lng, 'label', label, 'time', to_char(pickup_time, 'HH24:MI'), 'waitMinutes', 0) order by sort_order, pickup_time), '[]')
    into pickups from public.ride_contract_pickups where contract_id = c.id;
  stops_out := pickups - 0;                                                -- outbound: first pickup is the start, the others are stops
  select coalesce(jsonb_agg(e order by ord desc), '[]') into stops_back from jsonb_array_elements(pickups) with ordinality x(e, ord) where ord > 1; -- way back: drop off in reverse order
  dur := greatest(coalesce(c.estimated_minutes, 30), 10);
  svc := case c.purpose when 'school' then 'school_children' when 'work' then 'business_travel' else 'long_term_monthly' end;
  select display_name into vname from public.vehicles where id = c.vehicle_id;

  for d in select private.contract_dates(greatest(c.start_date, coalesce(p_from, c.start_date), (now() at time zone 'Europe/Berlin')::date),
                                          c.end_date, c.weekdays, c.excluded_dates, c.skip_public_holidays, c.skip_school_holidays) loop
    t_out := coalesce((c.weekday_times -> extract(isodow from d)::int::text ->> 'outbound')::time, first_p.pickup_time);
    start_ts := (d + t_out) at time zone 'Europe/Berlin';
    if start_ts > now() and not exists (select 1 from public.bookings b where b.contract_id = c.id and b.contract_leg = 'outbound'
         and (b.booking_start at time zone 'Europe/Berlin')::date = d and b.status <> 'cancelled') then
      insert into public.bookings(source, service_type, status, payment_status, payment_method, customer_id, customer_first_name, customer_last_name,
        customer_email, customer_phone, language, passengers, luggage, customer_notes, pickup_address, pickup_lat, pickup_lng, pickup_place_id,
        destination_address, destination_lat, destination_lng, destination_place_id, stops, booking_start, booking_end, timezone,
        distance_km, duration_minutes, vehicle_id, vehicle_name, driver_id, price_amount, currency, contract_id, contract_leg, created_by)
      values ('admin', svc, case when c.driver_id is not null then 'assigned' else 'confirmed' end, 'pending', 'balance', cu.id,
        coalesce(cu.first_name, ''), coalesce(cu.last_name, ''), cu.email, cu.phone, c.language, c.passengers, c.luggage,
        concat_ws(' · ', 'Regular ride ' || c.reference, nullif(first_p.label, ''), c.customer_notes),
        first_p.address, first_p.lat, first_p.lng, first_p.place_id,
        c.destination_address, c.destination_lat, c.destination_lng, c.destination_place_id, stops_out - 0 - 0 #- '{0}',
        start_ts, start_ts + make_interval(mins => dur), 'Europe/Berlin', c.estimated_km, dur, c.vehicle_id, vname, c.driver_id,
        c.agreed_price_per_ride, 'EUR', c.id, 'outbound', auth.uid());
      n := n + 1;
    end if;
    if c.trip_type = 'round_trip' then
      ret_time := coalesce((c.weekday_times -> extract(isodow from d)::int::text ->> 'return')::time, c.return_time);
      start_ts := (d + ret_time) at time zone 'Europe/Berlin';
      if start_ts > now() and not exists (select 1 from public.bookings b where b.contract_id = c.id and b.contract_leg = 'return'
           and (b.booking_start at time zone 'Europe/Berlin')::date = d and b.status <> 'cancelled') then
        insert into public.bookings(source, service_type, status, payment_status, payment_method, customer_id, customer_first_name, customer_last_name,
          customer_email, customer_phone, language, passengers, luggage, customer_notes, pickup_address, pickup_lat, pickup_lng, pickup_place_id,
          destination_address, destination_lat, destination_lng, destination_place_id, stops, booking_start, booking_end, timezone,
          distance_km, duration_minutes, vehicle_id, vehicle_name, driver_id, price_amount, currency, contract_id, contract_leg, created_by)
        values ('admin', svc, case when c.driver_id is not null then 'assigned' else 'confirmed' end, 'pending', 'balance', cu.id,
          coalesce(cu.first_name, ''), coalesce(cu.last_name, ''), cu.email, cu.phone, c.language, c.passengers, c.luggage,
          concat_ws(' · ', 'Regular ride ' || c.reference || ' (return)', c.customer_notes),
          c.destination_address, c.destination_lat, c.destination_lng, c.destination_place_id,
          first_p.address, first_p.lat, first_p.lng, first_p.place_id, stops_back,
          start_ts, start_ts + make_interval(mins => dur), 'Europe/Berlin', c.estimated_km, dur, c.vehicle_id, vname, c.driver_id,
          c.agreed_price_per_ride, 'EUR', c.id, 'return', auth.uid());
        n := n + 1;
      end if;
    end if;
  end loop;
  update public.ride_contracts set generated_until = c.end_date,
    ride_count = (select count(*) from public.bookings b where b.contract_id = c.id and b.status <> 'cancelled') where id = c.id;
  return n;
end $$;

-- ---------- office actions ----------
create or replace function public.admin_contract_offer(p_contract_id uuid, p_price numeric, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare o public.ride_contract_offers;
begin
  if not private.has_role(array['owner','admin','dispatcher']) then raise exception 'Not allowed.'; end if;
  update public.ride_contract_offers set status = 'superseded' where contract_id = p_contract_id and status = 'open';
  insert into public.ride_contract_offers(contract_id, from_party, price_per_ride, note, created_by) values (p_contract_id, 'office', p_price, p_note, auth.uid()) returning * into o;
  update public.ride_contracts set status = 'negotiating' where id = p_contract_id and status in ('request','negotiating');
  return to_jsonb(o);
end $$;

-- approve + create all rides (price = the agreed price, or the one given here)
create or replace function public.admin_activate_contract(p_contract_id uuid, p_vehicle_id uuid, p_driver_id uuid default null, p_price numeric default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.ride_contracts; n int; v record;
begin
  if not private.has_role(array['owner','admin','dispatcher']) then raise exception 'Not allowed.'; end if;
  select * into c from public.ride_contracts where id = p_contract_id for update;
  if c.id is null then raise exception 'Contract not found.'; end if;
  if c.status not in ('request','negotiating','approved','paused') then raise exception 'This contract cannot be activated (status %).', c.status; end if;
  select id, seats into v from public.vehicles where id = p_vehicle_id and status <> 'inactive';
  if v.id is null then raise exception 'Choose a vehicle.'; end if;
  if v.seats < c.passengers then raise exception 'The vehicle has not enough seats.'; end if;
  if coalesce(p_price, c.agreed_price_per_ride) is null then raise exception 'Enter the agreed price per ride.'; end if;
  update public.ride_contract_offers set status = case when price_per_ride = coalesce(p_price, c.agreed_price_per_ride) then 'accepted' else 'superseded' end, answered_at = now()
   where contract_id = c.id and status = 'open';
  update public.ride_contracts set status = 'active', vehicle_id = p_vehicle_id, driver_id = p_driver_id,
    agreed_price_per_ride = coalesce(p_price, agreed_price_per_ride), approved_at = now(), approved_by = auth.uid() where id = c.id;
  n := private.contract_generate(c.id);
  return jsonb_build_object('created_rides', n, 'contract', (select to_jsonb(r) from public.ride_contracts r where r.id = c.id));
end $$;

create or replace function public.admin_contract_status(p_contract_id uuid, p_status text, p_from date default null, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.ride_contracts; n int := 0; from_ts timestamptz;
begin
  if not private.has_role(array['owner','admin','dispatcher']) then raise exception 'Not allowed.'; end if;
  select * into c from public.ride_contracts where id = p_contract_id for update;
  if p_status not in ('paused','active','ended','declined') then raise exception 'Unknown status.'; end if;
  from_ts := greatest(now(), (coalesce(p_from, (now() at time zone 'Europe/Berlin')::date))::timestamp at time zone 'Europe/Berlin');
  if p_status in ('paused','ended','declined') then
    update public.bookings set status = 'cancelled', cancelled_at = now(), cancel_reason = coalesce(p_reason, 'Contract ' || p_status)
     where contract_id = c.id and booking_start >= from_ts and status in ('confirmed','assigned');
    get diagnostics n = row_count;
    update public.ride_contracts set status = p_status, end_date = case when p_status = 'ended' then greatest(start_date, coalesce(p_from, end_date) - 1) else end_date end where id = c.id;
  else
    update public.ride_contracts set status = 'active' where id = c.id;
    n := private.contract_generate(c.id, p_from);
  end if;
  return jsonb_build_object('rides_changed', n);
end $$;

-- change fixed driver / vehicle / times for all future rides
create or replace function public.admin_contract_reassign(p_contract_id uuid, p_vehicle_id uuid default null, p_driver_id uuid default null, p_from date default null)
returns int language plpgsql security definer set search_path = '' as $$
declare n int; vname text; from_ts timestamptz;
begin
  if not private.has_role(array['owner','admin','dispatcher']) then raise exception 'Not allowed.'; end if;
  from_ts := greatest(now(), (coalesce(p_from, (now() at time zone 'Europe/Berlin')::date))::timestamp at time zone 'Europe/Berlin');
  update public.ride_contracts set vehicle_id = coalesce(p_vehicle_id, vehicle_id), driver_id = p_driver_id where id = p_contract_id;
  select display_name into vname from public.vehicles where id = p_vehicle_id;
  update public.bookings set vehicle_id = coalesce(p_vehicle_id, vehicle_id), vehicle_name = coalesce(vname, vehicle_name), driver_id = p_driver_id,
    status = case when p_driver_id is null then 'confirmed' else 'assigned' end
   where contract_id = p_contract_id and booking_start >= from_ts and status in ('confirmed','assigned');
  get diagnostics n = row_count; return n;
end $$;

-- ---------- customer actions ----------
create or replace function public.customer_contract(p_contract_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('contract', to_jsonb(c) - 'admin_notes',
    'pickups', (select coalesce(jsonb_agg(to_jsonb(p) order by p.sort_order), '[]') from public.ride_contract_pickups p where p.contract_id = c.id),
    'offers', (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'from', o.from_party, 'price', o.price_per_ride, 'note', o.note, 'status', o.status, 'at', o.created_at) order by o.created_at), '[]') from public.ride_contract_offers o where o.contract_id = c.id),
    'upcoming', (select coalesce(jsonb_agg(private.booking_json(b) order by b.booking_start), '[]') from (select * from public.bookings b where b.contract_id = c.id and b.booking_end > now() and b.status <> 'cancelled' order by b.booking_start limit 60) b),
    'done', (select count(*) from public.bookings b where b.contract_id = c.id and b.status = 'completed'),
    'left', (select count(*) from public.bookings b where b.contract_id = c.id and b.status in ('confirmed','assigned') and b.booking_start > now()))
  from public.ride_contracts c
  where c.id = p_contract_id and c.customer_id = private.current_customer_id()
$$;

create or replace function public.customer_contract_offer(p_contract_id uuid, p_price numeric, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.ride_contracts; o public.ride_contract_offers;
begin
  select * into c from public.ride_contracts where id = p_contract_id and customer_id = private.current_customer_id();
  if c.id is null then raise exception 'Contract not found.'; end if;
  if c.status not in ('request','negotiating') then raise exception 'The price can no longer be changed.'; end if;
  if p_price is null or p_price <= 0 then raise exception 'Enter a price.'; end if;
  update public.ride_contract_offers set status = 'superseded' where contract_id = c.id and status = 'open';
  insert into public.ride_contract_offers(contract_id, from_party, price_per_ride, note, created_by) values (c.id, 'customer', round(p_price, 2), left(p_note, 1000), auth.uid()) returning * into o;
  update public.ride_contracts set status = 'negotiating' where id = c.id;
  return to_jsonb(o);
end $$;

create or replace function public.customer_accept_offer(p_offer_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare o public.ride_contract_offers; c public.ride_contracts;
begin
  select * into o from public.ride_contract_offers where id = p_offer_id and status = 'open' and from_party = 'office';
  select * into c from public.ride_contracts where id = o.contract_id and customer_id = private.current_customer_id();
  if o.id is null or c.id is null then raise exception 'Offer not found.'; end if;
  update public.ride_contract_offers set status = 'accepted', answered_at = now() where id = o.id;
  update public.ride_contracts set agreed_price_per_ride = o.price_per_ride, status = 'approved' where id = c.id;
  return jsonb_build_object('ok', true, 'price_per_ride', o.price_per_ride);
end $$;

create or replace function public.customer_withdraw_contract(p_contract_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  update public.ride_contracts set status = 'withdrawn' where id = p_contract_id and customer_id = private.current_customer_id() and status in ('request','negotiating','approved');
  if not found then raise exception 'This request can no longer be withdrawn. Please contact us.'; end if;
  return jsonb_build_object('ok', true);
end $$;

-- pause single days or a period (free) – the days are skipped and nothing is charged
create or replace function public.customer_pause_contract(p_contract_id uuid, p_from date, p_to date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.ride_contracts; n int;
begin
  select * into c from public.ride_contracts where id = p_contract_id and customer_id = private.current_customer_id() for update;
  if c.id is null then raise exception 'Contract not found.'; end if;
  if p_to < p_from then raise exception 'Check the dates.'; end if;
  if p_to > p_from + 120 then raise exception 'Please contact us for pauses longer than 4 months.'; end if;
  update public.bookings set status = 'cancelled', cancelled_at = now(), cancel_reason = 'Paused by the customer'
   where contract_id = c.id and status in ('confirmed','assigned') and booking_start > now()
     and (booking_start at time zone 'Europe/Berlin')::date between p_from and p_to;
  get diagnostics n = row_count;
  update public.ride_contracts set excluded_dates = array(select distinct unnest(excluded_dates || array(select generate_series(p_from, p_to, interval '1 day')::date)))
   where id = c.id;
  return jsonb_build_object('cancelled_rides', n);
end $$;

-- extra ride paid from the contract balance: how much may be used right now
create or replace function private.balance_available_for_extra(p_customer uuid) returns numeric language plpgsql stable security definer set search_path = '' as $$
declare avail numeric; keep numeric := 0; allow boolean := true;
begin
  avail := private.customer_balance(p_customer) - private.customer_held(p_customer);
  select bool_and(allow_balance_extra_rides), coalesce(sum(min_reserved_rides * coalesce(agreed_price_per_ride, 0)), 0) into allow, keep
    from public.ride_contracts where customer_id = p_customer and status = 'active';
  if allow is false then return 0; end if;
  return greatest(avail - coalesce(keep, 0), 0);
end $$;
create or replace function public.customer_balance_for_booking()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare cid uuid := private.current_customer_id();
begin
  if cid is null then return jsonb_build_object('logged_in', false); end if;
  return jsonb_build_object('logged_in', true, 'available', private.balance_available_for_extra(cid),
    'discount_pct', (select coalesce(max(extra_ride_discount_pct), 0) from public.ride_contracts where customer_id = cid and status = 'active'));
end $$;

grant execute on function public.customer_balance_for_booking() to authenticated;
revoke execute on function public.customer_contract(uuid) from anon;
revoke execute on function public.customer_contract_offer(uuid, numeric, text) from anon;
revoke execute on function public.customer_accept_offer(uuid) from anon;
revoke execute on function public.customer_withdraw_contract(uuid) from anon;
revoke execute on function public.customer_pause_contract(uuid, date, date) from anon;
revoke execute on function public.admin_contract_offer(uuid, numeric, text) from anon;
revoke execute on function public.admin_activate_contract(uuid, uuid, uuid, numeric) from anon;
revoke execute on function public.admin_contract_status(uuid, text, date, text) from anon;
revoke execute on function public.admin_contract_reassign(uuid, uuid, uuid, date) from anon;

-- ---------- public holidays Hessen (school holidays: add in Settings → they change every year) ----------
insert into public.holidays(day, region, kind, name) values
 ('2026-01-01','HE','public','Neujahr'),('2026-04-03','HE','public','Karfreitag'),('2026-04-06','HE','public','Ostermontag'),
 ('2026-05-01','HE','public','Tag der Arbeit'),('2026-05-14','HE','public','Christi Himmelfahrt'),('2026-05-25','HE','public','Pfingstmontag'),
 ('2026-06-04','HE','public','Fronleichnam'),('2026-10-03','HE','public','Tag der Deutschen Einheit'),('2026-12-25','HE','public','1. Weihnachtstag'),
 ('2026-12-26','HE','public','2. Weihnachtstag'),
 ('2027-01-01','HE','public','Neujahr'),('2027-03-26','HE','public','Karfreitag'),('2027-03-29','HE','public','Ostermontag'),
 ('2027-05-01','HE','public','Tag der Arbeit'),('2027-05-06','HE','public','Christi Himmelfahrt'),('2027-05-17','HE','public','Pfingstmontag'),
 ('2027-05-27','HE','public','Fronleichnam'),('2027-10-03','HE','public','Tag der Deutschen Einheit'),('2027-12-25','HE','public','1. Weihnachtstag'),
 ('2027-12-26','HE','public','2. Weihnachtstag'),
 ('2028-01-01','HE','public','Neujahr'),('2028-04-14','HE','public','Karfreitag'),('2028-04-17','HE','public','Ostermontag'),
 ('2028-05-01','HE','public','Tag der Arbeit'),('2028-05-25','HE','public','Christi Himmelfahrt'),('2028-06-05','HE','public','Pfingstmontag'),
 ('2028-06-15','HE','public','Fronleichnam'),('2028-10-03','HE','public','Tag der Deutschen Einheit'),('2028-12-25','HE','public','1. Weihnachtstag'),
 ('2028-12-26','HE','public','2. Weihnachtstag')
on conflict do nothing;
