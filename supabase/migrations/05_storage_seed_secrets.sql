-- ---------- storage buckets ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('vehicle-images', 'vehicle-images', true, 5242880, array['image/jpeg','image/png','image/webp']),
  ('driver-documents', 'driver-documents', false, 10485760, array['image/jpeg','image/png','image/webp','application/pdf']),
  ('receipts', 'receipts', false, 10485760, array['image/jpeg','image/png','image/webp','application/pdf']),
  ('admin-avatars', 'admin-avatars', true, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

create policy "Admins read private files" on storage.objects for select to authenticated
  using (bucket_id in ('driver-documents','receipts','vehicle-images','admin-avatars') and (select private.is_admin()));
create policy "Admins upload files" on storage.objects for insert to authenticated
  with check (bucket_id in ('driver-documents','receipts','vehicle-images','admin-avatars') and (select private.is_admin()));
create policy "Admins replace files" on storage.objects for update to authenticated
  using (bucket_id in ('driver-documents','vehicle-images','admin-avatars') and (select private.is_admin()));
create policy "Managers delete images and documents" on storage.objects for delete to authenticated
  using (bucket_id in ('driver-documents','vehicle-images','admin-avatars') and (select private.has_role(array['owner','admin','dispatcher'])));
-- receipts can't be deleted (GoBD)

-- ---------- seed: company, area, settings ----------
insert into public.company_profile (id, name, phone, second_phone, email, city, country)
values (1, 'Day Drive Service', '0176 43241205', '01575 1235 215', 'info.daydriveservice@gmail.com', 'Frankfurt am Main', 'Germany')
on conflict (id) do nothing;

insert into public.service_areas (name, latitude, longitude, pickup_radius_km)
values ('Frankfurt am Main', 50.110900, 8.682100, 60);

insert into public.app_settings (key, value, description) values
  ('booking.min_notice_minutes', '60', 'Earliest pickup = now + this many minutes'),
  ('booking.payment_hold_minutes', '15', 'How long a vehicle stays reserved while the customer pays'),
  ('booking.buffer_minutes', '60', 'Free time kept before and after every booking of the same vehicle'),
  ('booking.max_stops', '5', 'Maximum stops per booking'),
  ('booking.wait_rate_per_minute', '0.25', 'Waiting fee in EUR per minute at stops'),
  ('booking.long_trip_km', '80', 'Trips longer than this get the long-trip multiplier'),
  ('booking.long_trip_multiplier', '1.5', 'Price multiplier for long trips'),
  ('booking.night_hours', '{"from":"22:00","to":"06:00"}', 'Night surcharge period'),
  ('notifications.sms_on_confirmation', 'true', 'Send an SMS when a booking is confirmed'),
  ('notifications.sms_sender', '"DayDrive"', 'SMS sender name (max. 11 letters) – falls back to the Twilio number')
on conflict (key) do nothing;

insert into public.integrations (provider, category, display_name, enabled, status, public_config, notes) values
  ('google_maps', 'maps', 'Google Maps', true, 'connected', '{"apis":["Maps JavaScript API","Places API (New)","Routes API"]}', 'Key is in js/dd-booking-api.js – restrict it to your website in Google Cloud.'),
  ('twilio', 'sms', 'Twilio SMS', true, 'configured', '{"from_number":"+14632752756","sender_name":"DayDrive","default_country_code":"+49"}', 'Account SID and Auth Token are stored encrypted in Supabase Vault.'),
  ('resend', 'email', 'Resend E-mail', false, 'not_configured', '{}', 'Set up after the domain is registered (sending, inbox and booking e-mails).'),
  ('paypal', 'payment', 'PayPal (PayPal, Apple Pay, cards)', false, 'not_configured', '{"currency":"EUR"}', 'Needs Day Drive''s own PayPal business account (Client ID + Secret).')
on conflict (provider) do nothing;

insert into public.finance_settings (id) values (1) on conflict do nothing;

insert into public.finance_categories (code, kind, scope, name_en, name_de, default_vat_rate, account_skr03, tax_deductible, sort_order) values
  ('income_online',   'income',  'vehicle', 'Online bookings (website)', 'Online-Buchungen (Website)', 7, '8300', true, 10),
  ('income_cash',     'income',  'vehicle', 'Cash rides',                'Barzahlung Fahrten',          7, '8300', true, 20),
  ('income_card',     'income',  'vehicle', 'Card terminal rides',       'Kartenzahlung Fahrten',       7, '8300', true, 30),
  ('income_invoice',  'income',  'any',     'Invoice / company clients', 'Rechnung / Firmenkunden',     19, '8400', true, 40),
  ('income_partner',  'income',  'vehicle', 'Partner platforms',         'Partner-Plattformen',         19, '8400', true, 50),
  ('income_other',    'income',  'any',     'Other income',              'Sonstige Einnahmen',          19, '8400', true, 60),
  ('fuel',            'expense', 'vehicle', 'Fuel / charging',           'Kraftstoff / Laden',          19, '4530', true, 110),
  ('insurance',       'expense', 'vehicle', 'Insurance',                 'Versicherung',                0,  '4520', true, 120),
  ('vehicle_loan',    'expense', 'vehicle', 'Vehicle loan / leasing',    'Kreditrate / Leasing',        19, '4570', true, 130),
  ('parking',         'expense', 'vehicle', 'Parking',                   'Parken / Stellplatz',         19, '4550', true, 140),
  ('service',         'expense', 'vehicle', 'Service / maintenance / TÜV','Service / Wartung / TÜV',    19, '4540', true, 150),
  ('parts',           'expense', 'vehicle', 'Parts / tyres',             'Ersatzteile / Reifen',        19, '4540', true, 160),
  ('repair_other',    'expense', 'vehicle', 'Breakdown, towing & other', 'Panne, Abschleppen & Sonstiges', 19, '4580', true, 170),
  ('car_wash',        'expense', 'vehicle', 'Car wash / cleaning',       'Autowäsche / Pflege',         19, '4530', true, 180),
  ('vehicle_tax',     'expense', 'vehicle', 'Vehicle tax',               'Kfz-Steuer',                  0,  '4510', true, 190),
  ('tolls',           'expense', 'vehicle', 'Tolls / vignettes',         'Maut / Vignetten',            19, '4580', true, 200),
  ('fines',           'expense', 'vehicle', 'Fines',                     'Bußgelder',                   0,  null,   false, 210),
  ('wages',           'expense', 'driver',  'Wages / salaries',          'Löhne / Gehälter',            0,  '4120', true, 250),
  ('commission',      'expense', 'any',     'Commissions / agency fees', 'Provisionen / Vermittlung',   19, '4760', true, 260),
  ('payment_fees',    'expense', 'company', 'Payment fees (PayPal etc.)','Zahlungsgebühren (PayPal etc.)', 0, '4970', true, 270),
  ('office_rent',     'expense', 'company', 'Office rent',               'Büromiete',                   19, '4210', true, 310),
  ('utilities',       'expense', 'company', 'Utilities',                 'Strom / Nebenkosten',         19, '4240', true, 320),
  ('phone_internet',  'expense', 'company', 'Phone / internet / SMS',    'Telefon / Internet / SMS',    19, '4920', true, 330),
  ('software',        'expense', 'company', 'Software / apps / website', 'Software / Apps / Website',   19, '4964', true, 340),
  ('accounting',      'expense', 'company', 'Tax advisor / accounting',  'Steuerberater / Buchhaltung', 19, '4955', true, 350),
  ('advertising',     'expense', 'company', 'Advertising',               'Werbung',                     19, '4600', true, 360),
  ('office_supplies', 'expense', 'company', 'Office supplies',           'Bürobedarf',                  19, '4930', true, 370),
  ('bank_fees',       'expense', 'company', 'Bank fees',                 'Bankgebühren',                0,  '4970', true, 380),
  ('company_other',   'expense', 'company', 'Other business expenses',   'Sonstige Betriebsausgaben',   19, '4900', true, 390)
on conflict (code) do nothing;

-- ---------- fleet (sample prices – edit in the admin panel) ----------
insert into public.vehicles (brand, model, year, category, category_label, seats, luggage_large, price_per_km, minimum_fare, sort_order, image_path, description_en, description_de) values
  ('Mercedes-Benz', 'E-Class', null, 'vip', 'VIP · Executive · Business', 3, 2, 2.80, 55, 10, 'site:assets/images/fleet-e-class.webp',
   'Elegance, comfort and discretion – ideal for VIP guests, business trips, airport transfers and weddings.',
   'Eleganz, Komfort und Diskretion – ideal für VIP-Gäste, Geschäftsreisen, Flughafentransfers und Hochzeiten.'),
  ('VW', 'Touran', 2026, 'family', 'Family · Groups', 6, 4, 2.40, 45, 20, null,
   'Plenty of space for families, groups and regular school runs.',
   'Viel Platz für Familien, Gruppen und regelmäßige Schülerfahrten.'),
  ('Toyota', 'Proace City', 2026, 'van', 'Spacious · Versatile', 4, 5, 2.30, 45, 30, null,
   'Extra space for groups, families and transfers with luggage.',
   'Zusätzlicher Platz für Gruppen, Familien und Transfers mit Gepäck.'),
  ('Toyota', 'Corolla', 2026, 'comfort', 'Comfortable · Modern', 4, 3, 2.00, 35, 40, null,
   'Comfortable and practical for daily rides, business trips and airport transfers.',
   'Komfortabel und praktisch für tägliche Fahrten, Businessfahrten und Flughafentransfers.'),
  ('Toyota', 'C-HR', null, 'comfort', 'Modern · Stylish', 4, 2, 2.10, 38, 50, null,
   'Modern design with comfort for private rides and everyday transfers.',
   'Modernes Design mit Komfort für private Fahrten und Transfers im Alltag.');

-- ---------- secrets (encrypted in Vault) + reader for Edge Functions only ----------
select vault.create_secret('<TWILIO_ACCOUNT_SID>', 'twilio_account_sid', 'Twilio Account SID');
select vault.create_secret('<TWILIO_AUTH_TOKEN>', 'twilio_auth_token', 'Twilio Auth Token');

create or replace function public.get_secret(p_name text)
returns text language sql stable security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = p_name limit 1
$$;
revoke execute on function public.get_secret(text) from public, anon, authenticated;
grant execute on function public.get_secret(text) to service_role;

-- ---------- expire unpaid bookings every 5 minutes ----------
create extension if not exists pg_cron;
select cron.schedule('expire-pending-bookings', '*/5 * * * *', $$select public.expire_pending_bookings();$$);
