create sequence public.booking_number_seq;

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  booking_reference text unique,
  client_token uuid not null default gen_random_uuid(),   -- lets the website cancel its own pending booking
  source text not null default 'website' check (source in ('website','admin','phone','email','app','partner')),
  service_type text not null default 'other' check (service_type in ('airport_transfer','vip_executive','business_travel','wedding_events','family_group','school_children','long_term_monthly','hourly','city_tour','other')),
  status text not null default 'pending_payment' check (status in ('pending_payment','confirmed','assigned','on_the_way','in_progress','completed','cancelled','expired','no_show')),
  payment_status text not null default 'pending' check (payment_status in ('pending','paid','failed','refunded','partially_refunded','cash_on_ride','invoice')),
  -- customer (snapshot at booking time)
  customer_id uuid references public.customers(id) on delete set null,
  customer_first_name text not null,
  customer_last_name text not null,
  customer_email text,
  customer_phone text,
  language text not null default 'de' check (language in ('en','de')),
  passengers int not null default 1 check (passengers between 1 and 20),
  luggage int not null default 0 check (luggage >= 0),
  flight_number text,
  customer_notes text,
  -- route
  pickup_address text not null,
  pickup_lat numeric(9,6), pickup_lng numeric(9,6), pickup_place_id text,
  destination_address text not null,
  destination_lat numeric(9,6), destination_lng numeric(9,6), destination_place_id text,
  stops jsonb not null default '[]'::jsonb,        -- [{address,lat,lng,placeId,waitMinutes}]
  service_area_id uuid references public.service_areas(id) on delete set null,
  -- time
  booking_start timestamptz not null,
  booking_end timestamptz not null,
  timezone text not null default 'Europe/Berlin',
  distance_km numeric(8,2),
  driving_duration_minutes int,
  wait_minutes int not null default 0,
  duration_minutes int,
  route_source text,
  -- vehicle / driver
  vehicle_id uuid references public.vehicles(id) on delete set null,
  vehicle_name text,
  driver_id uuid references public.drivers(id) on delete set null,
  -- money
  price_amount numeric(10,2) not null default 0 check (price_amount >= 0),
  wait_fee numeric(10,2) not null default 0,
  currency text not null default 'EUR',
  payment_provider text,
  payment_method text,
  payment_order_id text,
  payment_reference text,
  payment_expires_at timestamptz,
  paid_at timestamptz,
  refunded_amount numeric(10,2) not null default 0,
  refunded_at timestamptz,
  -- lifecycle
  ride_code text,
  cancelled_at timestamptz,
  cancel_reason text,
  completed_at timestamptz,
  terms_accepted_at timestamptz,
  admin_notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (booking_end > booking_start)
);
create index bookings_start on public.bookings(booking_start);
create index bookings_status on public.bookings(status);
create index bookings_vehicle_time on public.bookings(vehicle_id, booking_start);
create index bookings_driver_time on public.bookings(driver_id, booking_start);
create index bookings_customer on public.bookings(customer_id);

create or replace function private.assign_booking_reference()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.booking_reference is null or btrim(new.booking_reference) = '' then
    new.booking_reference := 'DD-' || to_char(coalesce(new.created_at, now()) at time zone 'Europe/Berlin', 'YYMMDD') || '-' ||
                             lpad(nextval('public.booking_number_seq')::text, 4, '0');
  end if;
  if new.ride_code is null then
    new.ride_code := lpad((floor(random() * 10000))::int::text, 4, '0');
  end if;
  return new;
end $$;
create trigger bookings_reference before insert on public.bookings for each row execute function private.assign_booking_reference();
create trigger bookings_updated before update on public.bookings for each row execute function private.set_updated_at();

-- ---------- booking timeline ----------
create table public.booking_events (
  id bigint generated always as identity primary key,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  event_type text not null,          -- created, status_changed, assigned, payment, note, sms_sent, email_sent …
  message text,
  data jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index booking_events_booking on public.booking_events(booking_id, created_at);

create or replace function private.log_booking_changes()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.booking_events(booking_id, event_type, message, created_by)
    values (new.id, 'created', 'Booking created (' || new.source || ')', auth.uid());
    return new;
  end if;
  if new.status is distinct from old.status then
    insert into public.booking_events(booking_id, event_type, message, data, created_by)
    values (new.id, 'status_changed', 'Status: ' || old.status || ' → ' || new.status, jsonb_build_object('from', old.status, 'to', new.status), auth.uid());
  end if;
  if new.payment_status is distinct from old.payment_status then
    insert into public.booking_events(booking_id, event_type, message, data, created_by)
    values (new.id, 'payment', 'Payment: ' || old.payment_status || ' → ' || new.payment_status, jsonb_build_object('from', old.payment_status, 'to', new.payment_status), auth.uid());
  end if;
  if new.vehicle_id is distinct from old.vehicle_id or new.driver_id is distinct from old.driver_id then
    insert into public.booking_events(booking_id, event_type, message, data, created_by)
    values (new.id, 'assigned', 'Vehicle / driver changed', jsonb_build_object('vehicle_id', new.vehicle_id, 'driver_id', new.driver_id), auth.uid());
  end if;
  return new;
end $$;
create trigger bookings_events after insert or update on public.bookings for each row execute function private.log_booking_changes();

-- ---------- payments (one row per payment attempt) ----------
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete restrict,
  provider text not null,               -- paypal, stripe, cash, bank_transfer …
  method text,                          -- paypal, applepay, card, cash
  provider_order_id text,
  provider_capture_id text,
  amount numeric(10,2) not null,
  currency text not null default 'EUR',
  status text not null default 'created' check (status in ('created','approved','completed','failed','refunded','cancelled')),
  raw_response jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index payments_booking on public.payments(booking_id);
create trigger payments_updated before update on public.payments for each row execute function private.set_updated_at();

-- ---------- notifications (log of SMS / e-mails sent) ----------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('sms','email','whatsapp','push')),
  provider text,
  template text,                        -- booking_confirmation, reminder, test …
  recipient text not null,
  subject text,
  body text,
  booking_id uuid references public.bookings(id) on delete set null,
  status text not null default 'queued' check (status in ('queued','sent','delivered','failed')),
  provider_message_id text,
  error text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index notifications_booking on public.notifications(booking_id);

-- ---------- inbox (filled by Resend later) ----------
create table public.inbox_messages (
  id uuid primary key default gen_random_uuid(),
  provider text default 'resend',
  provider_message_id text unique,
  mailbox text,
  from_email text not null,
  from_name text,
  to_email text,
  subject text,
  text_body text,
  html_body text,
  attachments jsonb not null default '[]'::jsonb,
  booking_id uuid references public.bookings(id) on delete set null,
  is_read boolean not null default false,
  is_starred boolean not null default false,
  archived_at timestamptz,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index inbox_received on public.inbox_messages(received_at desc);

-- ---------- RLS ----------
alter table public.bookings enable row level security;
alter table public.booking_events enable row level security;
alter table public.payments enable row level security;
alter table public.notifications enable row level security;
alter table public.inbox_messages enable row level security;

create policy "Admins read bookings" on public.bookings for select to authenticated using ((select private.is_admin()));
create policy "Managers create bookings" on public.bookings for insert to authenticated with check ((select private.has_role(array['owner','admin','dispatcher'])));
create policy "Managers update bookings" on public.bookings for update to authenticated
  using ((select private.has_role(array['owner','admin','dispatcher']))) with check ((select private.has_role(array['owner','admin','dispatcher'])));
-- no delete policy: bookings are cancelled, never deleted

create policy "Admins read booking events" on public.booking_events for select to authenticated using ((select private.is_admin()));
create policy "Managers add booking notes" on public.booking_events for insert to authenticated with check ((select private.has_role(array['owner','admin','dispatcher'])));

create policy "Admins read payments" on public.payments for select to authenticated using ((select private.is_admin()));
create policy "Admins read notifications" on public.notifications for select to authenticated using ((select private.is_admin()));

create policy "Admins read inbox" on public.inbox_messages for select to authenticated using ((select private.is_admin()));
create policy "Admins update inbox flags" on public.inbox_messages for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

-- ---------- expire unpaid bookings ----------
create or replace function public.expire_pending_bookings()
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update public.bookings
     set status = 'expired', cancel_reason = coalesce(cancel_reason, 'Payment time ran out')
   where status = 'pending_payment' and payment_status = 'pending'
     and payment_expires_at is not null and payment_expires_at < now();
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.expire_pending_bookings() from public, anon, authenticated;
