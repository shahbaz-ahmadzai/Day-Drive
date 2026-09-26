-- ---------- who is the logged-in customer ----------
create or replace function private.current_customer_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select id from public.customers where auth_user_id = auth.uid() limit 1
$$;

create or replace function private.digits(p text) returns text language sql immutable set search_path = '' as $$
  select right(regexp_replace(coalesce(p, ''), '\D', '', 'g'), 10)
$$;

-- every booking gets a customer record (by e-mail, else by phone) so it shows in "My Day Drive"
create or replace function private.link_booking_customer() returns trigger language plpgsql security definer set search_path = '' as $$
declare cid uuid; em text := lower(nullif(trim(new.customer_email), ''));
begin
  if new.customer_id is not null then return new; end if;
  if em is not null then
    select id into cid from public.customers where email = em;
    if cid is null then
      insert into public.customers(email, first_name, last_name, phone, language)
      values (em, new.customer_first_name, new.customer_last_name, new.customer_phone, coalesce(new.language, 'de')) returning id into cid;
    end if;
  elsif length(private.digits(new.customer_phone)) >= 7 then
    select id into cid from public.customers where private.digits(phone) = private.digits(new.customer_phone) order by created_at limit 1;
    if cid is null then
      insert into public.customers(first_name, last_name, phone, language)
      values (new.customer_first_name, new.customer_last_name, new.customer_phone, coalesce(new.language, 'de')) returning id into cid;
    end if;
  end if;
  new.customer_id := cid;
  return new;
end $$;
drop trigger if exists bookings_link_customer on public.bookings;
create trigger bookings_link_customer before insert on public.bookings for each row execute function private.link_booking_customer();
create index if not exists customers_phone_digits on public.customers((private.digits(phone)));

-- ---------- login codes (used by the customer-auth edge function with the service key) ----------
create or replace function public.customer_code_create(p_destination text, p_channel text default 'sms')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare cid uuid; recent int; code text := lpad((floor(random() * 1000000))::int::text, 6, '0'); dest text; lang text; ph text;
begin
  if p_channel = 'email' then
    select id, email, language, phone into cid, dest, lang, ph from public.customers where email = lower(trim(p_destination));
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

create or replace function public.customer_code_verify(p_destination text, p_code text, p_channel text default 'sms')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  select c.* into r from private.customer_login_codes c join public.customers cu on cu.id = c.customer_id
   where c.used_at is null and c.expires_at > now() and c.channel = coalesce(p_channel, 'sms')
     and (case when c.channel = 'email' then cu.email = lower(trim(p_destination)) else private.digits(cu.phone) = private.digits(p_destination) end)
   order by c.created_at desc limit 1;
  if r.id is null then return jsonb_build_object('ok', false, 'error', 'expired'); end if;
  if r.attempts >= 5 then return jsonb_build_object('ok', false, 'error', 'too_many'); end if;
  if r.code_hash <> extensions.crypt(p_code, r.code_hash) then
    update private.customer_login_codes set attempts = attempts + 1 where id = r.id;
    return jsonb_build_object('ok', false, 'error', 'wrong');
  end if;
  update private.customer_login_codes set used_at = now() where id = r.id;
  return jsonb_build_object('ok', true, 'customer_id', r.customer_id);
end $$;
revoke all on function public.customer_code_create(text, text) from public, anon, authenticated;
revoke all on function public.customer_code_verify(text, text, text) from public, anon, authenticated;
grant execute on function public.customer_code_create(text, text) to service_role;
grant execute on function public.customer_code_verify(text, text, text) to service_role;

-- ---------- balance ----------
create or replace function private.customer_balance(p_customer uuid) returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce(sum(amount), 0) from public.customer_ledger where customer_id = p_customer
$$;
create or replace function private.customer_held(p_customer uuid) returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce(sum(price_amount), 0) from public.bookings
   where customer_id = p_customer and payment_method = 'balance' and payment_status = 'pending'
     and status in ('confirmed','assigned','on_the_way','in_progress')
$$;

-- charge the balance automatically when a balance ride is completed (or a no-show, if the contract says so)
create or replace function private.balance_charge_before() returns trigger language plpgsql security definer set search_path = '' as $$
declare charge_ns boolean;
begin
  if new.payment_method = 'balance' and new.payment_status = 'pending' and new.status is distinct from old.status then
    if new.status = 'completed' then
      new.payment_status := 'paid'; new.paid_at := now();
    elsif new.status = 'no_show' then
      select coalesce(c.charge_no_show, true) into charge_ns from public.ride_contracts c where c.id = new.contract_id;
      if coalesce(charge_ns, true) then new.payment_status := 'paid'; new.paid_at := now(); end if;
    end if;
  end if;
  return new;
end $$;
create or replace function private.balance_charge_after() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.payment_method = 'balance' and new.payment_status = 'paid' and old.payment_status = 'pending'
     and new.status in ('completed','no_show') and new.customer_id is not null then
    insert into public.customer_ledger(customer_id, contract_id, booking_id, kind, amount, note, created_by)
    values (new.customer_id, new.contract_id, new.id,
            case when new.status = 'no_show' then 'no_show' when new.contract_id is not null then 'ride' else 'extra_ride' end,
            -new.price_amount, 'Ride ' || new.booking_reference, auth.uid())
    on conflict do nothing;
  end if;
  return new;
end $$;
drop trigger if exists bookings_balance_before on public.bookings;
create trigger bookings_balance_before before update of status on public.bookings for each row execute function private.balance_charge_before();
drop trigger if exists bookings_balance_after on public.bookings;
create trigger bookings_balance_after after update on public.bookings for each row execute function private.balance_charge_after();

-- admin: money received / refunded (also booked in Finance)
create or replace function public.admin_record_deposit(p_customer_id uuid, p_amount numeric, p_method text default 'bank_transfer',
  p_reference text default null, p_contract_id uuid default null, p_date date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l public.customer_ledger; c public.customers;
begin
  if not private.has_role(array['owner','admin','accountant']) then raise exception 'Not allowed.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be positive.'; end if;
  select * into c from public.customers where id = p_customer_id;
  if c.id is null then raise exception 'Customer not found.'; end if;
  insert into public.customer_ledger(customer_id, contract_id, kind, amount, method, reference, note)
  values (c.id, p_contract_id, 'deposit', round(p_amount, 2), coalesce(p_method, 'bank_transfer'), p_reference, 'Deposit received') returning * into l;
  insert into public.finance_entries(entry_date, kind, category_code, description, vendor, invoice_number, payment_method, gross_amount, vat_rate, receipt_status)
  values (coalesce(p_date, (now() at time zone 'Europe/Berlin')::date), 'income', 'income_prepaid',
          'Deposit ' || coalesce(c.first_name || ' ' || c.last_name, c.email, '') || coalesce(' – ' || (select reference from public.ride_contracts where id = p_contract_id), ''),
          trim(coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,'')), p_reference,
          case when p_method in ('bank_transfer','cash','card','paypal') then p_method else 'other' end, round(p_amount, 2), 19, 'not_required');
  return jsonb_build_object('entry', to_jsonb(l), 'balance', private.customer_balance(c.id), 'available', private.customer_balance(c.id) - private.customer_held(c.id));
end $$;

create or replace function public.admin_refund_balance(p_customer_id uuid, p_amount numeric, p_method text default 'bank_transfer', p_reference text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l public.customer_ledger; avail numeric;
begin
  if not private.has_role(array['owner','admin','accountant']) then raise exception 'Not allowed.'; end if;
  avail := private.customer_balance(p_customer_id) - private.customer_held(p_customer_id);
  if p_amount is null or p_amount <= 0 or p_amount > avail then raise exception 'You can refund at most % EUR.', avail; end if;
  insert into public.customer_ledger(customer_id, kind, amount, method, reference, note)
  values (p_customer_id, 'refund', -round(p_amount, 2), p_method, p_reference, coalesce(p_note, 'Refund')) returning * into l;
  insert into public.finance_entries(entry_date, kind, category_code, description, payment_method, gross_amount, vat_rate, receipt_status, invoice_number)
  values ((now() at time zone 'Europe/Berlin')::date, 'expense', 'refund', 'Balance refund to customer', coalesce(p_method, 'bank_transfer'), round(p_amount, 2), 19, 'not_required', p_reference);
  return jsonb_build_object('entry', to_jsonb(l), 'balance', private.customer_balance(p_customer_id));
end $$;

create or replace function public.admin_customer_balance(p_customer_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when private.is_admin() then jsonb_build_object('balance', private.customer_balance(p_customer_id),
    'held', private.customer_held(p_customer_id), 'available', private.customer_balance(p_customer_id) - private.customer_held(p_customer_id)) end
$$;
revoke execute on function public.admin_record_deposit(uuid, numeric, text, text, uuid, date) from anon;
revoke execute on function public.admin_refund_balance(uuid, numeric, text, text, text) from anon;
revoke execute on function public.admin_customer_balance(uuid) from anon;

-- ---------- customer RLS (read-only on their own data) ----------
create policy "Customers read own profile" on public.customers for select using (auth_user_id = (select auth.uid()));
create policy "Customers read own bookings" on public.bookings for select using (customer_id is not null and customer_id = (select private.current_customer_id()));
create policy "Customers read own ledger" on public.customer_ledger for select using (customer_id = (select private.current_customer_id()));
create policy "Customers read own contracts" on public.ride_contracts for select using (customer_id = (select private.current_customer_id()));
create policy "Customers read own pickups" on public.ride_contract_pickups for select using (exists (select 1 from public.ride_contracts c where c.id = contract_id and c.customer_id = (select private.current_customer_id())));
create policy "Customers read own offers" on public.ride_contract_offers for select using (exists (select 1 from public.ride_contracts c where c.id = contract_id and c.customer_id = (select private.current_customer_id())));

-- chat: customer / driver of that booking
create policy "Customers read own messages" on public.ride_messages for select using (exists (select 1 from public.bookings b where b.id = booking_id and b.customer_id = (select private.current_customer_id())));
create policy "Drivers read own messages" on public.ride_messages for select using (exists (select 1 from public.bookings b where b.id = booking_id and b.driver_id = (select private.current_driver_id())));

-- ---------- "My Day Drive" ----------
create or replace function private.booking_json(b public.bookings) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', b.id, 'reference', b.booking_reference, 'status', b.status, 'payment_status', b.payment_status,
    'payment_method', b.payment_method, 'start', b.booking_start, 'end', b.booking_end, 'pickup', b.pickup_address,
    'destination', b.destination_address, 'stops', b.stops, 'vehicle', b.vehicle_name, 'price', b.price_amount, 'currency', b.currency,
    'passengers', b.passengers, 'distance_km', b.distance_km, 'ride_code', case when b.status in ('confirmed','assigned','on_the_way') then b.ride_code end,
    'driver_first_name', (select first_name from public.drivers where id = b.driver_id),
    'plate', (select plate_number from public.vehicles where id = b.vehicle_id),
    'contract_id', b.contract_id, 'contract_leg', b.contract_leg, 'cancel_reason', b.cancel_reason, 'completed_at', b.completed_at,
    'paid_at', b.paid_at, 'client_token', b.client_token,
    'can_cancel', b.status in ('pending_payment','confirmed','assigned') and b.booking_start > now(),
    'unread', (select count(*) from public.ride_messages m where m.booking_id = b.id and m.sender_type <> 'customer' and m.read_by_customer_at is null))
$$;

create or replace function public.customer_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c public.customers; cid uuid := private.current_customer_id();
begin
  if cid is null then raise exception 'Please log in.'; end if;
  select * into c from public.customers where id = cid;
  return jsonb_build_object(
    'customer', jsonb_build_object('id', c.id, 'first_name', c.first_name, 'last_name', c.last_name, 'email', c.email, 'phone', c.phone, 'language', c.language),
    'balance', private.customer_balance(cid), 'held', private.customer_held(cid), 'available', private.customer_balance(cid) - private.customer_held(cid),
    'next_ride', (select private.booking_json(b) from public.bookings b where b.customer_id = cid and b.status in ('confirmed','assigned','on_the_way','in_progress') and b.booking_end > now() order by b.booking_start limit 1),
    'counts', jsonb_build_object(
      'pending', (select count(*) from public.bookings b where b.customer_id = cid and b.status = 'pending_payment' and coalesce(b.payment_expires_at, now()) >= now())
               + (select count(*) from public.ride_contracts r where r.customer_id = cid and r.status in ('request','negotiating','approved')),
      'upcoming', (select count(*) from public.bookings b where b.customer_id = cid and b.status in ('confirmed','assigned','on_the_way','in_progress') and b.booking_end > now()),
      'unpaid', (select count(*) from public.bookings b where b.customer_id = cid and b.status in ('completed','no_show') and b.payment_status in ('pending','invoice','cash_on_ride','failed') and coalesce(b.payment_method,'') <> 'balance'),
      'history', (select count(*) from public.bookings b where b.customer_id = cid and (b.status in ('completed','cancelled','expired','no_show')))),
    'unpaid_total', (select coalesce(sum(price_amount),0) from public.bookings b where b.customer_id = cid and b.status in ('completed','no_show') and b.payment_status in ('pending','invoice','cash_on_ride','failed') and coalesce(b.payment_method,'') <> 'balance'),
    'contracts', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'reference', r.reference, 'status', r.status, 'start_date', r.start_date, 'end_date', r.end_date,
                    'destination', coalesce(r.destination_name, r.destination_address), 'price_per_ride', coalesce(r.agreed_price_per_ride, r.initial_price_per_ride)) order by r.created_at desc), '[]')
                  from public.ride_contracts r where r.customer_id = cid and r.status not in ('withdrawn','declined')));
end $$;

create or replace function public.customer_bookings(p_tab text, p_limit int default 50, p_offset int default 0)
returns setof jsonb language sql stable security definer set search_path = '' as $$
  select private.booking_json(b) from public.bookings b
  where b.customer_id = private.current_customer_id() and private.current_customer_id() is not null
    and case p_tab
      when 'pending'  then b.status = 'pending_payment' and coalesce(b.payment_expires_at, now()) >= now()
      when 'upcoming' then b.status in ('confirmed','assigned','on_the_way','in_progress') and b.booking_end > now()
      when 'unpaid'   then b.status in ('completed','no_show') and b.payment_status in ('pending','invoice','cash_on_ride','failed') and coalesce(b.payment_method,'') <> 'balance'
      when 'history'  then b.status in ('completed','cancelled','expired','no_show')
      else false end
  order by case when p_tab in ('pending','upcoming') then extract(epoch from b.booking_start) else -extract(epoch from b.booking_start) end
  limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0)
$$;

create or replace function public.customer_ledger_list(p_limit int default 100)
returns setof jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', l.id, 'no', l.entry_no, 'date', l.created_at, 'kind', l.kind, 'amount', l.amount, 'method', l.method,
    'reference', l.reference, 'note', l.note, 'booking_reference', b.booking_reference, 'booking_start', b.booking_start,
    'route', case when b.id is not null then b.pickup_address || ' → ' || b.destination_address end, 'contract_id', l.contract_id)
  from public.customer_ledger l left join public.bookings b on b.id = l.booking_id
  where l.customer_id = private.current_customer_id()
  order by l.created_at desc limit least(greatest(p_limit, 1), 500)
$$;

-- free cancellation until the driver sets off
create or replace function public.customer_cancel_booking(p_booking_id uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.bookings; cid uuid := private.current_customer_id();
begin
  if cid is null then raise exception 'Please log in.'; end if;
  select * into b from public.bookings where id = p_booking_id and customer_id = cid for update;
  if b.id is null then raise exception 'Booking not found.'; end if;
  if b.status not in ('pending_payment','confirmed','assigned') then raise exception 'This ride can no longer be cancelled online. Please call us.'; end if;
  if b.booking_start < now() then raise exception 'This ride has already started.'; end if;
  update public.bookings set status = 'cancelled', cancelled_at = now(), cancel_reason = coalesce(nullif(trim(p_reason), ''), 'Cancelled by the customer') where id = b.id;
  if b.contract_id is not null then
    update public.ride_contracts set excluded_dates = array(select distinct unnest(excluded_dates || (b.booking_start at time zone 'Europe/Berlin')::date))
     where id = b.contract_id and not exists (select 1 from public.bookings x where x.contract_id = b.contract_id and x.id <> b.id
        and (x.booking_start at time zone 'Europe/Berlin')::date = (b.booking_start at time zone 'Europe/Berlin')::date and x.status not in ('cancelled'));
  end if;
  insert into public.booking_events(booking_id, event_type, message, created_by) values (b.id, 'customer_cancelled', 'Cancelled by the customer online', auth.uid());
  return jsonb_build_object('ok', true);
end $$;

-- chat from the logged-in customer / driver app
create or replace function public.send_ride_message(p_booking_id uuid, p_body text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.bookings; who text; m public.ride_messages;
begin
  select * into b from public.bookings where id = p_booking_id;
  if b.id is null then raise exception 'Booking not found.'; end if;
  if b.driver_id is not null and b.driver_id = private.current_driver_id() then who := 'driver';
  elsif b.customer_id is not null and b.customer_id = private.current_customer_id() then who := 'customer';
  elsif private.has_role(array['owner','admin','dispatcher']) then who := 'office';
  else raise exception 'Not allowed.'; end if;
  if b.status in ('cancelled','expired') or b.booking_end < now() - interval '2 hours' then raise exception 'The chat for this ride is closed.'; end if;
  insert into public.ride_messages(booking_id, sender_type, sender_user, body) values (b.id, who, auth.uid(), left(trim(p_body), 1000)) returning * into m;
  return to_jsonb(m);
end $$;
create or replace function public.mark_ride_messages_read(p_booking_id uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare b public.bookings; n int;
begin
  select * into b from public.bookings where id = p_booking_id;
  if b.driver_id is not null and b.driver_id = private.current_driver_id() then
    update public.ride_messages set read_by_driver_at = now() where booking_id = b.id and sender_type <> 'driver' and read_by_driver_at is null;
  elsif b.customer_id is not null and b.customer_id = private.current_customer_id() then
    update public.ride_messages set read_by_customer_at = now() where booking_id = b.id and sender_type <> 'customer' and read_by_customer_at is null;
  elsif private.is_admin() then
    update public.ride_messages set read_by_office_at = now() where booking_id = b.id and sender_type in ('customer','driver') and read_by_office_at is null;
  else raise exception 'Not allowed.'; end if;
  get diagnostics n = row_count; return n;
end $$;

-- ---------- "My ride" page without login (link with the booking's secret token) ----------
create or replace function public.ride_page(p_booking_id uuid, p_token uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.bookings; dr record; v record;
begin
  select * into b from public.bookings where id = p_booking_id and client_token = p_token;
  if b.id is null then raise exception 'Link not valid.'; end if;
  select first_name, phone into dr from public.drivers where id = b.driver_id;
  select display_name, plate_number, color into v from public.vehicles where id = b.vehicle_id;
  return jsonb_build_object(
    'booking', private.booking_json(b) - 'client_token',
    'driver', case when b.driver_id is not null then jsonb_build_object('first_name', dr.first_name) end,
    'vehicle', jsonb_build_object('name', coalesce(v.display_name, b.vehicle_name), 'plate', v.plate_number, 'color', v.color),
    'progress', jsonb_build_object('accepted_at', b.driver_accepted_at, 'on_the_way_at', b.on_the_way_at, 'arrived_at', b.arrived_at, 'picked_up_at', b.picked_up_at, 'completed_at', b.completed_at),
    'chat_open', b.status not in ('cancelled','expired') and b.booking_end > now() - interval '2 hours',
    'office_phone', (select phone from public.company_profile where id = 1),
    'messages', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'from', m.sender_type, 'body', m.body, 'at', m.created_at) order by m.created_at), '[]')
                   from public.ride_messages m where m.booking_id = b.id));
end $$;
create or replace function public.ride_page_send(p_booking_id uuid, p_token uuid, p_body text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.bookings; m public.ride_messages; recent int;
begin
  select * into b from public.bookings where id = p_booking_id and client_token = p_token;
  if b.id is null then raise exception 'Link not valid.'; end if;
  if b.status in ('cancelled','expired') or b.booking_end < now() - interval '2 hours' then raise exception 'The chat for this ride is closed.'; end if;
  if char_length(trim(coalesce(p_body,''))) = 0 then raise exception 'Empty message.'; end if;
  select count(*) into recent from public.ride_messages where booking_id = b.id and sender_type = 'customer' and created_at > now() - interval '1 minute';
  if recent >= 10 then raise exception 'Please wait a moment before sending more messages.'; end if;
  insert into public.ride_messages(booking_id, sender_type, body) values (b.id, 'customer', left(trim(p_body), 1000)) returning * into m;
  update public.ride_messages set read_by_customer_at = now() where booking_id = b.id and sender_type <> 'customer' and read_by_customer_at is null;
  return jsonb_build_object('id', m.id, 'from', m.sender_type, 'body', m.body, 'at', m.created_at);
end $$;
grant execute on function public.ride_page(uuid, uuid) to anon, authenticated;
grant execute on function public.ride_page_send(uuid, uuid, text) to anon, authenticated;

revoke execute on function public.customer_overview() from anon;
revoke execute on function public.customer_bookings(text, int, int) from anon;
revoke execute on function public.customer_ledger_list(int) from anon;
revoke execute on function public.customer_cancel_booking(uuid, text) from anon;
revoke execute on function public.send_ride_message(uuid, text) from anon;
revoke execute on function public.mark_ride_messages_read(uuid) from anon;
