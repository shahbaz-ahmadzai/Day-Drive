create table if not exists public.vehicle_devices (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null unique references public.vehicles(id) on delete cascade,
  device_uid text not null unique check (device_uid ~ '^[A-Za-z0-9_-]{4,64}$'),
  mode text not null default 'ble' check (mode in ('ble','lte','ble_lte')),
  is_active boolean not null default true,
  firmware_version text,
  last_seen_at timestamptz,
  last_state jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists private.vehicle_device_secrets (
  device_id uuid primary key references public.vehicle_devices(id) on delete cascade,
  secret text not null,
  rotated_at timestamptz not null default now()
);
create table if not exists public.vehicle_events (
  id bigint generated always as identity primary key,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  device_id uuid references public.vehicle_devices(id) on delete set null,
  driver_id uuid references public.drivers(id) on delete set null,
  shift_id uuid,
  event_type text not null,
  source text not null default 'app' check (source in ('app','device','admin','system')),
  data jsonb not null default '{}',
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists vehicle_events_vehicle_time on public.vehicle_events(vehicle_id, occurred_at desc);
create index if not exists vehicle_events_driver_time on public.vehicle_events(driver_id, occurred_at desc);

create table if not exists public.ride_messages (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  sender_type text not null check (sender_type in ('customer','driver','office','system')),
  sender_user uuid references auth.users(id) on delete set null,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now(),
  read_by_driver_at timestamptz,
  read_by_customer_at timestamptz,
  read_by_office_at timestamptz
);
create index if not exists ride_messages_booking on public.ride_messages(booking_id, created_at);

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  audience text not null check (audience in ('driver','customer','admin')),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  failed_count int not null default 0,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user on public.push_subscriptions(user_id);

alter table public.customers add column if not exists auth_user_id uuid unique references auth.users(id) on delete set null;
create table if not exists private.customer_login_codes (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  channel text not null check (channel in ('sms','email')),
  destination text not null,
  code_hash text not null,
  purpose text not null default 'login' check (purpose in ('login','balance_payment')),
  booking_id uuid,
  attempts int not null default 0,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists customer_login_codes_customer on private.customer_login_codes(customer_id, created_at desc);

alter table public.vehicles
  add column if not exists regular_price_per_km numeric(8,2) check (regular_price_per_km is null or regular_price_per_km >= 0),
  add column if not exists regular_minimum_fare numeric(8,2) check (regular_minimum_fare is null or regular_minimum_fare >= 0);

create sequence if not exists private.contract_number_seq;
create table if not exists public.ride_contracts (
  id uuid primary key default gen_random_uuid(),
  reference text unique,
  customer_id uuid not null references public.customers(id),
  status text not null default 'request' check (status in ('request','negotiating','approved','active','paused','ended','declined','withdrawn')),
  purpose text not null default 'other' check (purpose in ('school','work','other')),
  trip_type text not null default 'round_trip' check (trip_type in ('one_way','round_trip')),
  destination_name text,
  destination_address text not null,
  destination_lat numeric(9,6) not null,
  destination_lng numeric(9,6) not null,
  destination_place_id text,
  return_time time,
  start_date date not null,
  end_date date not null,
  weekdays int[] not null default '{1,2,3,4,5}' check (weekdays <@ '{1,2,3,4,5,6,7}' and cardinality(weekdays) > 0),
  weekday_times jsonb not null default '{}',
  skip_public_holidays boolean not null default true,
  skip_school_holidays boolean not null default false,
  excluded_dates date[] not null default '{}',
  passengers int not null default 1 check (passengers between 1 and 20),
  luggage int not null default 0 check (luggage between 0 and 20),
  child_seats int not null default 0 check (child_seats between 0 and 8),
  children jsonb not null default '[]',
  customer_notes text,
  admin_notes text,
  language text not null default 'de' check (language in ('en','de','ar','ps','fa')),
  requested_vehicle_id uuid references public.vehicles(id),
  vehicle_id uuid references public.vehicles(id),
  driver_id uuid references public.drivers(id),
  estimated_km numeric(8,2),
  estimated_minutes int,
  ride_count int,
  initial_price_per_ride numeric(10,2),
  agreed_price_per_ride numeric(10,2),
  allow_balance_extra_rides boolean not null default true,
  extra_ride_discount_pct numeric(5,2) not null default 0 check (extra_ride_discount_pct between 0 and 100),
  min_reserved_rides int not null default 0 check (min_reserved_rides >= 0),
  require_ride_code boolean not null default false,
  charge_no_show boolean not null default true,
  approved_at timestamptz,
  approved_by uuid references auth.users(id),
  generated_until date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date),
  check (end_date <= start_date + 400),
  check (trip_type = 'one_way' or return_time is not null)
);
create index if not exists ride_contracts_customer on public.ride_contracts(customer_id);
create index if not exists ride_contracts_status on public.ride_contracts(status);

create table if not exists public.ride_contract_pickups (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.ride_contracts(id) on delete cascade,
  sort_order int not null default 0,
  label text,
  address text not null,
  lat numeric(9,6) not null,
  lng numeric(9,6) not null,
  place_id text,
  pickup_time time not null,
  created_at timestamptz not null default now()
);
create index if not exists ride_contract_pickups_contract on public.ride_contract_pickups(contract_id, sort_order);

create table if not exists public.ride_contract_offers (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.ride_contracts(id) on delete cascade,
  from_party text not null check (from_party in ('customer','office')),
  price_per_ride numeric(10,2) not null check (price_per_ride > 0),
  note text,
  status text not null default 'open' check (status in ('open','accepted','rejected','superseded')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  answered_at timestamptz
);
create index if not exists ride_contract_offers_contract on public.ride_contract_offers(contract_id, created_at desc);

create table if not exists public.holidays (
  day date not null,
  region text not null default 'HE',
  kind text not null check (kind in ('public','school')),
  name text not null,
  primary key (day, region, kind)
);

alter table public.bookings add column if not exists contract_id uuid references public.ride_contracts(id);
alter table public.bookings add column if not exists contract_leg text check (contract_leg in ('outbound','return'));
create index if not exists bookings_contract on public.bookings(contract_id, booking_start);
create unique index if not exists bookings_contract_leg_day on public.bookings(contract_id, contract_leg, ((booking_start at time zone 'Europe/Berlin')::date))
  where contract_id is not null and status <> 'cancelled';

create table if not exists public.customer_ledger (
  id uuid primary key default gen_random_uuid(),
  entry_no bigint generated always as identity,
  customer_id uuid not null references public.customers(id),
  contract_id uuid references public.ride_contracts(id),
  booking_id uuid references public.bookings(id),
  kind text not null check (kind in ('deposit','ride','extra_ride','no_show','refund','adjustment')),
  amount numeric(10,2) not null check (amount <> 0),
  method text check (method in ('bank_transfer','cash','card','paypal','other')),
  reference text,
  note text,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists customer_ledger_customer on public.customer_ledger(customer_id, created_at desc);
create unique index if not exists customer_ledger_one_charge_per_booking on public.customer_ledger(booking_id) where booking_id is not null and kind in ('ride','extra_ride','no_show');

create or replace function private.ledger_guard() returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'Balance entries cannot be changed or deleted. Add a correction instead.'; end $$;
drop trigger if exists customer_ledger_guard on public.customer_ledger;
create trigger customer_ledger_guard before update or delete on public.customer_ledger for each row execute function private.ledger_guard();

insert into public.finance_categories(code, kind, scope, name_en, name_de, default_vat_rate, account_skr03, sort_order)
values ('income_prepaid', 'income', 'any', 'Customer deposits (prepaid rides)', 'Kundenguthaben (Vorauszahlung)', 19, '8400', 45),
       ('refund', 'expense', 'company', 'Refunds to customers', 'Erstattungen an Kunden', 19, '8400', 400)
on conflict (code) do nothing;

do $$ declare t text; begin
  foreach t in array array['vehicle_devices','ride_contracts'] loop
    execute format('drop trigger if exists %1$s_updated on public.%1$s; create trigger %1$s_updated before update on public.%1$s for each row execute function private.set_updated_at();', t);
    execute format('drop trigger if exists %1$s_audit on public.%1$s; create trigger %1$s_audit after insert or update or delete on public.%1$s for each row execute function private.write_audit();', t);
  end loop;
end $$;

create or replace function private.assign_contract_reference() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.reference is null then new.reference := 'DD-R-' || lpad(nextval('private.contract_number_seq')::text, 4, '0'); end if;
  return new;
end $$;
drop trigger if exists ride_contracts_reference on public.ride_contracts;
create trigger ride_contracts_reference before insert on public.ride_contracts for each row execute function private.assign_contract_reference();

alter table public.vehicle_devices enable row level security;
alter table public.vehicle_events enable row level security;
alter table public.ride_messages enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.ride_contracts enable row level security;
alter table public.ride_contract_pickups enable row level security;
alter table public.ride_contract_offers enable row level security;
alter table public.holidays enable row level security;
alter table public.customer_ledger enable row level security;

create policy "Admins read devices" on public.vehicle_devices for select using ((select private.is_admin()));
create policy "Owners/admins manage devices" on public.vehicle_devices for all using ((select private.has_role(array['owner','admin']))) with check ((select private.has_role(array['owner','admin'])));
create policy "Admins read vehicle events" on public.vehicle_events for select using ((select private.is_admin()));
create policy "Admins read messages" on public.ride_messages for select using ((select private.is_admin()));
create policy "Managers write messages" on public.ride_messages for insert with check ((select private.has_role(array['owner','admin','dispatcher'])) and sender_type = 'office');
create policy "Managers mark messages read" on public.ride_messages for update using ((select private.has_role(array['owner','admin','dispatcher']))) with check ((select private.has_role(array['owner','admin','dispatcher'])));
create policy "Own push subscriptions" on public.push_subscriptions for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "Admins read contracts" on public.ride_contracts for select using ((select private.is_admin()));
create policy "Managers edit contracts" on public.ride_contracts for all using ((select private.has_role(array['owner','admin','dispatcher']))) with check ((select private.has_role(array['owner','admin','dispatcher'])));
create policy "Admins read pickups" on public.ride_contract_pickups for select using ((select private.is_admin()));
create policy "Managers edit pickups" on public.ride_contract_pickups for all using ((select private.has_role(array['owner','admin','dispatcher']))) with check ((select private.has_role(array['owner','admin','dispatcher'])));
create policy "Admins read offers" on public.ride_contract_offers for select using ((select private.is_admin()));
create policy "Managers make offers" on public.ride_contract_offers for insert with check ((select private.has_role(array['owner','admin','dispatcher'])) and from_party = 'office');
create policy "Everyone reads holidays" on public.holidays for select using (true);
create policy "Owners/admins manage holidays" on public.holidays for all using ((select private.has_role(array['owner','admin']))) with check ((select private.has_role(array['owner','admin'])));
create policy "Finance roles read ledger" on public.customer_ledger for select using ((select private.has_role(array['owner','admin','accountant','dispatcher'])));
create policy "Finance roles add ledger" on public.customer_ledger for insert with check ((select private.has_role(array['owner','admin','accountant'])));

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='ride_messages') then
    alter publication supabase_realtime add table public.ride_messages;
  end if;
end $$;
