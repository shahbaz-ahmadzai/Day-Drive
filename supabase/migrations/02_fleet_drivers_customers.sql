-- ---------- vehicles ----------
create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  fleet_number text unique,
  brand text not null,
  model text not null,
  display_name text generated always as (btrim(brand || ' ' || model)) stored,
  year int check (year between 1990 and 2100),
  color text,
  plate_number text unique,
  vin text,
  fuel_type text check (fuel_type in ('petrol','diesel','hybrid','plugin_hybrid','electric','other')),
  transmission text check (transmission in ('automatic','manual')),
  category text not null default 'business' check (category in ('vip','business','comfort','family','van','other')),
  category_label text,                     -- shown to customers, e.g. "VIP · Executive · Business"
  seats int not null default 4 check (seats between 1 and 20),
  luggage_large int not null default 2 check (luggage_large >= 0),
  luggage_small int not null default 0 check (luggage_small >= 0),
  doors int,
  air_conditioning boolean not null default true,
  child_seat_available boolean not null default false,
  wheelchair_accessible boolean not null default false,
  wifi boolean not null default false,
  -- pricing (used by the website price calculation)
  price_per_km numeric(8,2) not null default 2.00 check (price_per_km >= 0),
  minimum_fare numeric(8,2) not null default 35.00 check (minimum_fare >= 0),
  airport_fee numeric(8,2) not null default 0 check (airport_fee >= 0),
  night_surcharge_pct numeric(5,2) not null default 0 check (night_surcharge_pct >= 0),
  -- status
  status text not null default 'active' check (status in ('active','maintenance','inactive')),
  online_booking boolean not null default true,
  sort_order int not null default 0,
  -- documents / maintenance
  ownership_type text check (ownership_type in ('owned','leased','financed','rented')),
  registration_expiry date,
  insurance_company text,
  insurance_number text,
  insurance_expiry date,
  tuv_expiry date,
  odometer_km int,
  last_service_date date,
  last_service_km int,
  service_interval_km int,
  next_service_date date,
  -- presentation
  image_path text,
  description_en text,
  description_de text,
  internal_notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger vehicles_updated before update on public.vehicles for each row execute function private.set_updated_at();
create trigger vehicles_audit after insert or update or delete on public.vehicles for each row execute function private.write_audit();

-- ---------- drivers ----------
create sequence public.driver_number_seq;
create table public.drivers (
  id uuid primary key default gen_random_uuid(),
  employee_number text unique,
  auth_user_id uuid unique references auth.users(id) on delete set null,   -- for a future driver app
  first_name text not null,
  last_name text not null,
  display_name text generated always as (btrim(first_name || ' ' || last_name)) stored,
  date_of_birth date,
  nationality text,
  languages text[] not null default '{}',
  phone text,
  email text,
  street text, postal_code text, city text, country text default 'Germany',
  emergency_contact_name text,
  emergency_contact_phone text,
  employment_type text check (employment_type in ('full_time','part_time','mini_job','freelance','other')),
  employment_start date,
  employment_end date,
  status text not null default 'active' check (status in ('active','on_leave','inactive')),
  licence_number text,
  licence_classes text[] not null default '{}',
  licence_expiry date,
  passenger_permit_number text,        -- P-Schein
  passenger_permit_expiry date,
  medical_check_expiry date,
  tax_id text,
  social_security_number text,
  iban text,
  photo_path text,
  internal_notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create or replace function private.assign_driver_number()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.employee_number is null or btrim(new.employee_number) = '' then
    new.employee_number := 'DD-D-' || lpad(nextval('public.driver_number_seq')::text, 4, '0');
  end if;
  return new;
end $$;
create trigger drivers_number before insert on public.drivers for each row execute function private.assign_driver_number();
create trigger drivers_updated before update on public.drivers for each row execute function private.set_updated_at();
create trigger drivers_audit after insert or update or delete on public.drivers for each row execute function private.write_audit();

create table public.driver_documents (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.drivers(id) on delete cascade,
  document_type text not null check (document_type in ('driving_licence','passenger_permit','id_card','medical','contract','training','other')),
  document_number text,
  issue_date date,
  expiry_date date,
  storage_path text,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index driver_documents_driver on public.driver_documents(driver_id);
create trigger driver_documents_updated before update on public.driver_documents for each row execute function private.set_updated_at();

create table public.vehicle_assignments (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  driver_id uuid not null references public.drivers(id) on delete cascade,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  start_odometer_km int,
  end_odometer_km int,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);
create index vehicle_assignments_vehicle on public.vehicle_assignments(vehicle_id);
create index vehicle_assignments_driver on public.vehicle_assignments(driver_id);
-- one open assignment per vehicle and per driver
create unique index vehicle_assignments_open_vehicle on public.vehicle_assignments(vehicle_id) where ends_at is null;
create unique index vehicle_assignments_open_driver on public.vehicle_assignments(driver_id) where ends_at is null;

-- ---------- customers ----------
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  first_name text,
  last_name text,
  email text unique check (email is null or email = lower(email)),
  phone text,
  company_name text,
  language text default 'de' check (language in ('en','de')),
  marketing_consent boolean not null default false,
  marketing_consent_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger customers_updated before update on public.customers for each row execute function private.set_updated_at();

-- ---------- RLS ----------
alter table public.vehicles enable row level security;
alter table public.drivers enable row level security;
alter table public.driver_documents enable row level security;
alter table public.vehicle_assignments enable row level security;
alter table public.customers enable row level security;

create policy "Admins read vehicles" on public.vehicles for select to authenticated using ((select private.is_admin()));
create policy "Managers edit vehicles" on public.vehicles for all to authenticated
  using ((select private.has_role(array['owner','admin','dispatcher']))) with check ((select private.has_role(array['owner','admin','dispatcher'])));

create policy "Admins read drivers" on public.drivers for select to authenticated using ((select private.is_admin()));
create policy "Managers edit drivers" on public.drivers for all to authenticated
  using ((select private.has_role(array['owner','admin','dispatcher']))) with check ((select private.has_role(array['owner','admin','dispatcher'])));

create policy "Admins read driver documents" on public.driver_documents for select to authenticated using ((select private.is_admin()));
create policy "Managers edit driver documents" on public.driver_documents for all to authenticated
  using ((select private.has_role(array['owner','admin','dispatcher']))) with check ((select private.has_role(array['owner','admin','dispatcher'])));

create policy "Admins read assignments" on public.vehicle_assignments for select to authenticated using ((select private.is_admin()));
create policy "Managers edit assignments" on public.vehicle_assignments for all to authenticated
  using ((select private.has_role(array['owner','admin','dispatcher']))) with check ((select private.has_role(array['owner','admin','dispatcher'])));

create policy "Admins read customers" on public.customers for select to authenticated using ((select private.is_admin()));
create policy "Managers edit customers" on public.customers for all to authenticated
  using ((select private.has_role(array['owner','admin','dispatcher']))) with check ((select private.has_role(array['owner','admin','dispatcher'])));
