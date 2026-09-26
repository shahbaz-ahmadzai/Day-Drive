alter table public.bookings  drop constraint if exists bookings_language_check;
alter table public.bookings  add  constraint bookings_language_check  check (language in ('en','de','ar','ps','fa'));
alter table public.customers drop constraint if exists customers_language_check;
alter table public.customers add  constraint customers_language_check check (language in ('en','de','ar','ps','fa'));

alter table public.drivers
  add column if not exists username text unique check (username is null or (username = lower(username) and username ~ '^[a-z0-9._-]{3,40}$')),
  add column if not exists app_language text not null default 'de' check (app_language in ('en','de','ar','ps','fa')),
  add column if not exists app_enabled boolean not null default false;

create table if not exists private.driver_credentials (
  driver_id uuid primary key references public.drivers(id) on delete cascade,
  pin_hash text not null,
  failed_attempts int not null default 0,
  locked_until timestamptz,
  pin_changed_at timestamptz not null default now()
);

create or replace function private.current_driver_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select id from public.drivers where auth_user_id = auth.uid() and status <> 'inactive' and app_enabled limit 1
$$;

create or replace function public.driver_check_pin(p_username text, p_pin text)
returns table (driver_id uuid, result text)
language plpgsql security definer set search_path = '' as $$
declare d record; c record;
begin
  select id, status, app_enabled into d from public.drivers where username = lower(trim(p_username));
  if d.id is null then return query select null::uuid, 'unknown'; return; end if;
  if d.status = 'inactive' or not d.app_enabled then return query select d.id, 'disabled'; return; end if;
  select * into c from private.driver_credentials where driver_credentials.driver_id = d.id;
  if c.driver_id is null then return query select d.id, 'no_pin'; return; end if;
  if c.locked_until is not null and c.locked_until > now() then return query select d.id, 'locked'; return; end if;
  if c.pin_hash = extensions.crypt(p_pin, c.pin_hash) then
    update private.driver_credentials set failed_attempts = 0, locked_until = null where driver_credentials.driver_id = d.id;
    return query select d.id, 'ok';
  else
    update private.driver_credentials
       set failed_attempts = failed_attempts + 1,
           locked_until = case when failed_attempts + 1 >= 5 then now() + interval '15 minutes' else null end
     where driver_credentials.driver_id = d.id;
    return query select d.id, 'wrong';
  end if;
end $$;

create or replace function public.driver_set_pin(p_driver_id uuid, p_pin text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_pin !~ '^\d{4,6}$' then raise exception 'The PIN must have 4 to 6 digits.'; end if;
  insert into private.driver_credentials(driver_id, pin_hash) values (p_driver_id, extensions.crypt(p_pin, extensions.gen_salt('bf', 8)))
  on conflict (driver_id) do update set pin_hash = excluded.pin_hash, failed_attempts = 0, locked_until = null, pin_changed_at = now();
end $$;
revoke all on function public.driver_check_pin(text, text) from public, anon, authenticated;
revoke all on function public.driver_set_pin(uuid, text) from public, anon, authenticated;
grant execute on function public.driver_check_pin(text, text) to service_role;
grant execute on function public.driver_set_pin(uuid, text) to service_role;

create table if not exists public.driver_shifts (
  id uuid primary key default gen_random_uuid(),
  shift_no bigint generated always as identity,
  driver_id uuid not null references public.drivers(id),
  vehicle_id uuid not null references public.vehicles(id),
  status text not null default 'open' check (status in ('open','closed')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  start_odometer_km int,
  end_odometer_km int,
  start_lat numeric(9,6), start_lng numeric(9,6),
  end_lat numeric(9,6),   end_lng numeric(9,6),
  uber_earnings numeric(10,2) not null default 0 check (uber_earnings >= 0),
  bolt_earnings numeric(10,2) not null default 0 check (bolt_earnings >= 0),
  other_platform_earnings numeric(10,2) not null default 0 check (other_platform_earnings >= 0),
  cash_earnings numeric(10,2) not null default 0 check (cash_earnings >= 0),
  card_earnings numeric(10,2) not null default 0 check (card_earnings >= 0),
  report_note text,
  unlock_method text check (unlock_method in ('ble','lte','manual','none')),
  device_confirmed_at timestamptz,
  closed_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at)
);
create unique index if not exists driver_shifts_one_open_per_driver  on public.driver_shifts(driver_id)  where status = 'open';
create unique index if not exists driver_shifts_one_open_per_vehicle on public.driver_shifts(vehicle_id) where status = 'open';
create index if not exists driver_shifts_vehicle_started on public.driver_shifts(vehicle_id, started_at desc);
create index if not exists driver_shifts_driver_started  on public.driver_shifts(driver_id, started_at desc);
drop trigger if exists driver_shifts_updated on public.driver_shifts;
create trigger driver_shifts_updated before update on public.driver_shifts for each row execute function private.set_updated_at();
drop trigger if exists driver_shifts_audit on public.driver_shifts;
create trigger driver_shifts_audit after insert or update on public.driver_shifts for each row execute function private.write_audit();

alter table public.driver_shifts enable row level security;
create policy "Admins read shifts"   on public.driver_shifts for select using ((select private.is_admin()));
create policy "Managers edit shifts" on public.driver_shifts for update using ((select private.has_role(array['owner','admin','dispatcher'])))
  with check ((select private.has_role(array['owner','admin','dispatcher'])));
create policy "Drivers read own shifts" on public.driver_shifts for select using (driver_id = (select private.current_driver_id()));

alter table public.finance_entries add column if not exists shift_id uuid references public.driver_shifts(id);
create index if not exists finance_entries_shift on public.finance_entries(shift_id);

alter table public.bookings
  add column if not exists driver_accepted_at timestamptz,
  add column if not exists on_the_way_at timestamptz,
  add column if not exists arrived_at timestamptz,
  add column if not exists picked_up_at timestamptz,
  add column if not exists code_verified boolean not null default false,
  add column if not exists shift_id uuid references public.driver_shifts(id),
  add column if not exists collected_amount numeric(10,2),
  add column if not exists collected_method text check (collected_method in ('cash','card','none'));
create index if not exists bookings_driver_start on public.bookings(driver_id, booking_start);

create policy "Drivers read own rides" on public.bookings for select using (driver_id is not null and driver_id = (select private.current_driver_id()));
create policy "Drivers read own vehicles" on public.vehicles for select using ((select private.current_driver_id()) is not null and status <> 'inactive');
create policy "Drivers read own profile" on public.drivers for select using (id = (select private.current_driver_id()));
create policy "Drivers read expense categories" on public.finance_categories for select using ((select private.current_driver_id()) is not null and kind = 'expense' and is_active);

create or replace function public.driver_me()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare d uuid := private.current_driver_id(); r jsonb;
begin
  if d is null then raise exception 'Not a driver login.'; end if;
  select jsonb_build_object(
    'driver', (select jsonb_build_object('id', id, 'name', display_name, 'first_name', first_name, 'language', app_language, 'employee_number', employee_number) from public.drivers where id = d),
    'shift', (select to_jsonb(s) || jsonb_build_object('vehicle_name', v.display_name, 'plate', v.plate_number)
                from public.driver_shifts s join public.vehicles v on v.id = s.vehicle_id where s.driver_id = d and s.status = 'open'),
    'default_vehicle', (select vehicle_id from public.vehicle_assignments where driver_id = d and ends_at is null limit 1),
    'rides_today', (select count(*) from public.bookings where driver_id = d and status in ('assigned','on_the_way','in_progress')
                      and booking_start < now() + interval '24 hours')
  ) into r;
  return r;
end $$;

create or replace function public.driver_start_shift(p_vehicle_id uuid, p_odometer_km int default null, p_lat numeric default null, p_lng numeric default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare d uuid := private.current_driver_id(); s public.driver_shifts; v record; busy record;
begin
  if d is null then raise exception 'Not a driver login.'; end if;
  if exists (select 1 from public.driver_shifts where driver_id = d and status = 'open') then raise exception 'You already have an open shift.'; end if;
  select id, display_name, status into v from public.vehicles where id = p_vehicle_id;
  if v.id is null or v.status = 'inactive' then raise exception 'This vehicle is not available.'; end if;
  select s2.id, dr.display_name into busy from public.driver_shifts s2 join public.drivers dr on dr.id = s2.driver_id where s2.vehicle_id = p_vehicle_id and s2.status = 'open';
  if busy.id is not null then raise exception 'This vehicle is in use by %.', busy.display_name; end if;
  insert into public.driver_shifts(driver_id, vehicle_id, start_odometer_km, start_lat, start_lng)
  values (d, p_vehicle_id, p_odometer_km, p_lat, p_lng) returning * into s;
  if p_odometer_km is not null then
    update public.vehicles set odometer_km = greatest(coalesce(odometer_km, 0), p_odometer_km) where id = p_vehicle_id;
  end if;
  insert into public.vehicle_events(vehicle_id, driver_id, shift_id, event_type, source, data)
  values (p_vehicle_id, d, s.id, 'shift_started', 'app', jsonb_build_object('odometer_km', p_odometer_km));
  return jsonb_build_object('shift', to_jsonb(s), 'unlock', private.vehicle_unlock_token(p_vehicle_id, s.id));
end $$;

create or replace function public.driver_end_shift(
  p_uber numeric default 0, p_bolt numeric default 0, p_other_platform numeric default 0,
  p_cash numeric default 0, p_card numeric default 0, p_odometer_km int default null,
  p_note text default null, p_lat numeric default null, p_lng numeric default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare d uuid := private.current_driver_id(); s public.driver_shifts; open_rides int; dname text;
begin
  if d is null then raise exception 'Not a driver login.'; end if;
  select * into s from public.driver_shifts where driver_id = d and status = 'open' for update;
  if s.id is null then raise exception 'You have no open shift.'; end if;
  select count(*) into open_rides from public.bookings where driver_id = d and status in ('on_the_way','in_progress');
  if open_rides > 0 then raise exception 'Please finish your current ride first.'; end if;
  if least(coalesce(p_uber,0), coalesce(p_bolt,0), coalesce(p_other_platform,0), coalesce(p_cash,0), coalesce(p_card,0)) < 0 then raise exception 'Amounts cannot be negative.'; end if;
  if p_odometer_km is not null and s.start_odometer_km is not null and p_odometer_km < s.start_odometer_km then raise exception 'The odometer is lower than at the start of the shift.'; end if;

  update public.driver_shifts set status = 'closed', ended_at = now(),
    uber_earnings = coalesce(p_uber,0), bolt_earnings = coalesce(p_bolt,0), other_platform_earnings = coalesce(p_other_platform,0),
    cash_earnings = coalesce(p_cash,0), card_earnings = coalesce(p_card,0), end_odometer_km = p_odometer_km,
    report_note = nullif(trim(p_note), ''), end_lat = p_lat, end_lng = p_lng, closed_by = auth.uid()
  where id = s.id returning * into s;
  if p_odometer_km is not null then
    update public.vehicles set odometer_km = greatest(coalesce(odometer_km, 0), p_odometer_km) where id = s.vehicle_id;
  end if;

  select display_name into dname from public.drivers where id = d;
  if coalesce(p_uber,0) > 0 then
    insert into public.finance_entries(entry_date, kind, category_code, vehicle_id, driver_id, shift_id, description, vendor, payment_method, gross_amount, vat_rate, receipt_status)
    values ((now() at time zone 'Europe/Berlin')::date, 'income', 'income_partner', s.vehicle_id, d, s.id, 'Uber – shift #' || s.shift_no || ' (' || dname || ')', 'Uber', 'bank_transfer', p_uber, 19, 'not_required');
  end if;
  if coalesce(p_bolt,0) > 0 then
    insert into public.finance_entries(entry_date, kind, category_code, vehicle_id, driver_id, shift_id, description, vendor, payment_method, gross_amount, vat_rate, receipt_status)
    values ((now() at time zone 'Europe/Berlin')::date, 'income', 'income_partner', s.vehicle_id, d, s.id, 'Bolt – shift #' || s.shift_no || ' (' || dname || ')', 'Bolt', 'bank_transfer', p_bolt, 19, 'not_required');
  end if;
  if coalesce(p_other_platform,0) > 0 then
    insert into public.finance_entries(entry_date, kind, category_code, vehicle_id, driver_id, shift_id, description, vendor, payment_method, gross_amount, vat_rate, receipt_status)
    values ((now() at time zone 'Europe/Berlin')::date, 'income', 'income_partner', s.vehicle_id, d, s.id, 'Other platforms – shift #' || s.shift_no || ' (' || dname || ')', 'Other platform', 'bank_transfer', p_other_platform, 19, 'not_required');
  end if;
  if coalesce(p_cash,0) > 0 then
    insert into public.finance_entries(entry_date, kind, category_code, vehicle_id, driver_id, shift_id, description, payment_method, gross_amount, vat_rate, receipt_status)
    values ((now() at time zone 'Europe/Berlin')::date, 'income', 'income_cash', s.vehicle_id, d, s.id, 'Own cash rides – shift #' || s.shift_no || ' (' || dname || ')', 'cash', p_cash, 19, 'not_required');
  end if;
  if coalesce(p_card,0) > 0 then
    insert into public.finance_entries(entry_date, kind, category_code, vehicle_id, driver_id, shift_id, description, payment_method, gross_amount, vat_rate, receipt_status)
    values ((now() at time zone 'Europe/Berlin')::date, 'income', 'income_card', s.vehicle_id, d, s.id, 'Own card rides – shift #' || s.shift_no || ' (' || dname || ')', 'card', p_card, 19, 'not_required');
  end if;

  insert into public.vehicle_events(vehicle_id, driver_id, shift_id, event_type, source, data)
  values (s.vehicle_id, d, s.id, 'shift_ended', 'app', jsonb_build_object('odometer_km', p_odometer_km));

  return jsonb_build_object('shift', to_jsonb(s), 'summary', public.driver_shift_summary(s.id), 'lock', private.vehicle_lock_token(s.vehicle_id, s.id));
end $$;

create or replace function public.driver_shift_summary(p_shift_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'shift_id', s.id, 'shift_no', s.shift_no, 'driver_id', s.driver_id, 'vehicle_id', s.vehicle_id,
    'started_at', s.started_at, 'ended_at', s.ended_at,
    'minutes', round(extract(epoch from (coalesce(s.ended_at, now()) - s.started_at)) / 60),
    'km', case when s.end_odometer_km is not null and s.start_odometer_km is not null then s.end_odometer_km - s.start_odometer_km end,
    'platform_earnings', s.uber_earnings + s.bolt_earnings + s.other_platform_earnings,
    'uber', s.uber_earnings, 'bolt', s.bolt_earnings, 'other_platform', s.other_platform_earnings,
    'cash', s.cash_earnings, 'card', s.card_earnings,
    'day_drive_rides', (select count(*) from public.bookings b where b.shift_id = s.id and b.status = 'completed'),
    'day_drive_collected', (select coalesce(sum(b.collected_amount),0) from public.bookings b where b.shift_id = s.id and b.status = 'completed'),
    'expenses', (select coalesce(sum(e.gross_amount),0) from public.finance_entries e where e.shift_id = s.id and e.kind = 'expense' and e.status = 'active'),
    'expense_count', (select count(*) from public.finance_entries e where e.shift_id = s.id and e.kind = 'expense' and e.status = 'active'),
    'missing_receipts', (select count(*) from public.finance_entries e where e.shift_id = s.id and e.kind = 'expense' and e.status = 'active' and e.receipt_status = 'missing')
  )
  from public.driver_shifts s
  where s.id = p_shift_id
    and (s.driver_id = private.current_driver_id() or private.is_admin())
$$;

create or replace function public.driver_add_expense(
  p_category text, p_amount numeric, p_receipt_path text default null, p_note text default null,
  p_vendor text default null, p_payment_method text default 'card', p_fuel_liters numeric default null,
  p_odometer_km int default null, p_no_receipt_reason text default null, p_vat_rate numeric default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare d uuid := private.current_driver_id(); s public.driver_shifts; c public.finance_categories; e public.finance_entries; dname text;
begin
  if d is null then raise exception 'Not a driver login.'; end if;
  select * into c from public.finance_categories where code = p_category and kind = 'expense' and is_active;
  if c.code is null then raise exception 'Unknown expense category.'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > 5000 then raise exception 'Please enter the amount.'; end if;
  if p_receipt_path is null and nullif(trim(p_no_receipt_reason), '') is null then raise exception 'Please add the receipt photo or say why there is none.'; end if;
  if p_receipt_path is not null and p_receipt_path not like 'drivers/' || d::text || '/%' then raise exception 'Invalid receipt file.'; end if;
  select * into s from public.driver_shifts where driver_id = d and status = 'open';
  select display_name into dname from public.drivers where id = d;
  insert into public.finance_entries(entry_date, kind, category_code, vehicle_id, driver_id, shift_id, description, vendor,
      payment_method, gross_amount, vat_rate, fuel_liters, odometer_km, receipt_path, receipt_status, no_receipt_reason)
  values ((now() at time zone 'Europe/Berlin')::date, 'expense', c.code, s.vehicle_id, d, s.id,
      coalesce(nullif(trim(p_note), ''), c.name_en) || ' – ' || dname, nullif(trim(p_vendor), ''),
      case when p_payment_method in ('cash','card','fuel_card','other') then p_payment_method else 'card' end,
      round(p_amount, 2), coalesce(p_vat_rate, c.default_vat_rate), p_fuel_liters, p_odometer_km, p_receipt_path,
      case when p_receipt_path is not null then 'attached' else 'missing' end, nullif(trim(p_no_receipt_reason), ''))
  returning * into e;
  if p_odometer_km is not null and s.vehicle_id is not null then
    update public.vehicles set odometer_km = greatest(coalesce(odometer_km, 0), p_odometer_km) where id = s.vehicle_id;
  end if;
  return jsonb_build_object('id', e.id, 'entry_no', e.entry_no, 'amount', e.gross_amount, 'category', c.name_en, 'receipt', e.receipt_status);
end $$;

create or replace function public.driver_my_expenses(p_days int default 7)
returns setof jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', e.id, 'date', e.entry_date, 'created_at', e.created_at, 'category', e.category_code,
         'category_name', c.name_en, 'amount', e.gross_amount, 'receipt', e.receipt_status, 'shift_id', e.shift_id, 'status', e.status)
  from public.finance_entries e join public.finance_categories c on c.code = e.category_code
  where e.driver_id = private.current_driver_id() and e.kind = 'expense'
    and e.created_at > now() - make_interval(days => least(greatest(p_days, 1), 62))
  order by e.created_at desc
$$;

create or replace function public.driver_ride_action(p_booking_id uuid, p_action text, p_code text default null,
  p_collected_method text default null, p_collected_amount numeric default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare d uuid := private.current_driver_id(); b public.bookings; s uuid; msg text;
begin
  if d is null then raise exception 'Not a driver login.'; end if;
  select * into b from public.bookings where id = p_booking_id and driver_id = d for update;
  if b.id is null then raise exception 'This ride is not assigned to you.'; end if;
  if b.status in ('completed','cancelled','expired','no_show') then raise exception 'This ride is already closed.'; end if;
  select id into s from public.driver_shifts where driver_id = d and status = 'open';

  if p_action = 'accept' then
    update public.bookings set driver_accepted_at = coalesce(driver_accepted_at, now()), status = case when status = 'confirmed' then 'assigned' else status end where id = b.id;
    msg := 'Driver accepted the ride';
  elsif p_action = 'on_the_way' then
    if s is null then raise exception 'Start your shift first.'; end if;
    update public.bookings set status = 'on_the_way', on_the_way_at = now(), driver_accepted_at = coalesce(driver_accepted_at, now()), shift_id = s,
      vehicle_id = coalesce((select vehicle_id from public.driver_shifts where id = s), vehicle_id) where id = b.id;
    update public.bookings set vehicle_name = (select display_name from public.vehicles where id = bookings.vehicle_id) where id = b.id;
    msg := 'Driver is on the way';
  elsif p_action = 'arrived' then
    update public.bookings set arrived_at = now(), status = case when status in ('confirmed','assigned') then 'on_the_way' else status end where id = b.id;
    msg := 'Driver arrived at the pickup';
  elsif p_action = 'picked_up' then
    if coalesce((select c.require_ride_code from public.ride_contracts c where c.id = b.contract_id), true)
       and (p_code is null or p_code <> b.ride_code) then
      raise exception 'The ride code is wrong. Please ask the passenger again.';
    end if;
    update public.bookings set status = 'in_progress', picked_up_at = now(), code_verified = coalesce(p_code = b.ride_code, false), shift_id = coalesce(shift_id, s) where id = b.id;
    msg := 'Passenger picked up' || case when p_code = b.ride_code then ' (code checked)' else '' end;
  elsif p_action = 'complete' then
    if b.status <> 'in_progress' then raise exception 'Mark the passenger as picked up first.'; end if;
    if b.payment_method = 'balance' or b.payment_status in ('paid','invoice') then
      update public.bookings set status = 'completed', completed_at = now(), collected_method = 'none', collected_amount = 0 where id = b.id;
    else
      if p_collected_method is null or p_collected_method not in ('cash','card','none') then raise exception 'How did the customer pay?'; end if;
      update public.bookings set status = 'completed', completed_at = now(),
        collected_method = p_collected_method,
        collected_amount = case when p_collected_method = 'none' then 0 else coalesce(p_collected_amount, price_amount) end,
        payment_status = case when p_collected_method = 'none' then 'pending' else 'paid' end,
        paid_at = case when p_collected_method = 'none' then null else now() end,
        payment_method = case when p_collected_method = 'none' then payment_method else p_collected_method end
      where id = b.id;
      if p_collected_method in ('cash','card') then
        insert into public.finance_entries(entry_date, kind, category_code, vehicle_id, driver_id, shift_id, booking_id, description, payment_method, gross_amount, vat_rate, receipt_status)
        values ((now() at time zone 'Europe/Berlin')::date, 'income', case when p_collected_method = 'cash' then 'income_cash' else 'income_card' end,
          b.vehicle_id, d, coalesce(b.shift_id, s), b.id, 'Ride ' || b.booking_reference || ' – ' || b.customer_first_name || ' ' || b.customer_last_name,
          p_collected_method, coalesce(p_collected_amount, b.price_amount), 19, 'not_required');
      end if;
    end if;
    msg := 'Ride completed';
  elsif p_action = 'no_show' then
    if b.arrived_at is null then raise exception 'Mark "arrived" first.'; end if;
    if now() < b.booking_start + interval '10 minutes' and now() < b.arrived_at + interval '10 minutes' then raise exception 'Please wait at least 10 minutes before marking a no-show.'; end if;
    update public.bookings set status = 'no_show' where id = b.id;
    msg := 'Customer did not show up';
  elsif p_action = 'release' then
    if b.status not in ('confirmed','assigned') then raise exception 'You can only hand back a ride before you are on the way.'; end if;
    update public.bookings set driver_id = null, driver_accepted_at = null, status = 'confirmed' where id = b.id;
    msg := 'Driver handed the ride back to the office';
  else
    raise exception 'Unknown action.';
  end if;

  insert into public.booking_events(booking_id, event_type, message, data, created_by)
  values (b.id, 'driver_' || p_action, msg || coalesce(': ' || nullif(trim(p_note), ''), ''), jsonb_build_object('driver_id', d), auth.uid());
  select * into b from public.bookings where id = b.id;
  return jsonb_build_object('id', b.id, 'status', b.status, 'payment_status', b.payment_status, 'message', msg);
end $$;

create or replace function public.driver_my_rides(p_days int default 3)
returns setof jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', b.id, 'reference', b.booking_reference, 'status', b.status, 'start', b.booking_start, 'end', b.booking_end,
    'pickup', b.pickup_address, 'pickup_lat', b.pickup_lat, 'pickup_lng', b.pickup_lng,
    'destination', b.destination_address, 'destination_lat', b.destination_lat, 'destination_lng', b.destination_lng,
    'stops', b.stops, 'passengers', b.passengers, 'luggage', b.luggage, 'flight', b.flight_number,
    'customer_name', b.customer_first_name || ' ' || left(b.customer_last_name, 1) || '.', 'customer_phone', b.customer_phone,
    'customer_notes', b.customer_notes, 'price', b.price_amount, 'payment_method', b.payment_method, 'payment_status', b.payment_status,
    'collect', not (coalesce(b.payment_method,'') = 'balance' or b.payment_status in ('paid','invoice')),
    'vehicle', b.vehicle_name, 'accepted_at', b.driver_accepted_at, 'arrived_at', b.arrived_at, 'picked_up_at', b.picked_up_at,
    'contract_id', b.contract_id, 'service_type', b.service_type, 'unread_messages',
      (select count(*) from public.ride_messages m where m.booking_id = b.id and m.sender_type <> 'driver' and m.read_by_driver_at is null))
  from public.bookings b
  where b.driver_id = private.current_driver_id()
    and b.status in ('confirmed','assigned','on_the_way','in_progress')
    and b.booking_start < now() + make_interval(days => least(greatest(p_days, 1), 31))
    and b.booking_start > now() - interval '12 hours'
  order by b.booking_start
$$;

create policy "Drivers upload own receipts" on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = 'drivers'
              and (storage.foldername(name))[2] = (select private.current_driver_id())::text);
create policy "Drivers read own receipts" on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = 'drivers'
         and (storage.foldername(name))[2] = (select private.current_driver_id())::text);

revoke execute on function public.driver_me() from anon;
revoke execute on function public.driver_start_shift(uuid, int, numeric, numeric) from anon;
revoke execute on function public.driver_end_shift(numeric, numeric, numeric, numeric, numeric, int, text, numeric, numeric) from anon;
revoke execute on function public.driver_shift_summary(uuid) from anon;
revoke execute on function public.driver_add_expense(text, numeric, text, text, text, text, numeric, int, text, numeric) from anon;
revoke execute on function public.driver_my_expenses(int) from anon;
revoke execute on function public.driver_ride_action(uuid, text, text, text, numeric, text) from anon;
revoke execute on function public.driver_my_rides(int) from anon;
