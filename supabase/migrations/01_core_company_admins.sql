-- =========================================================
-- Day Drive Service – core: helpers, company, admins, settings
-- =========================================================
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

-- updated_at helper
create or replace function private.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;

-- ---------- admin users ----------
create table public.admin_users (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username = lower(username) and username ~ '^[a-z0-9._-]{3,40}$'),
  first_name text,
  last_name text,
  email text,
  phone text,
  role text not null default 'admin' check (role in ('owner','admin','dispatcher','accountant')),
  is_active boolean not null default true,
  must_change_password boolean not null default false,
  language text not null default 'en' check (language in ('en','de')),
  avatar_path text,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.admin_users is 'People who can log in to the admin panel. id = auth.users.id';
create trigger admin_users_updated before update on public.admin_users for each row execute function private.set_updated_at();

-- role helpers (security definer, used by RLS)
create or replace function private.admin_role()
returns text language sql stable security definer set search_path = '' as $$
  select role from public.admin_users where id = auth.uid() and is_active limit 1
$$;
create or replace function private.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admin_users where id = auth.uid() and is_active)
$$;
create or replace function private.has_role(roles text[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admin_users where id = auth.uid() and is_active and role = any(roles))
$$;
grant execute on function private.admin_role(), private.is_admin(), private.has_role(text[]) to authenticated;

-- ---------- company profile (one row) ----------
create table public.company_profile (
  id smallint primary key default 1 check (id = 1),
  name text not null default 'Day Drive Service',
  legal_name text,
  managing_director text,
  street text, house_number text, postal_code text, city text default 'Frankfurt am Main', country text default 'Germany',
  phone text, second_phone text, email text, website text,
  tax_number text, vat_id text, commercial_register text,
  bank_name text, iban text, bic text,
  timezone text not null default 'Europe/Berlin',
  currency text not null default 'EUR',
  booking_enabled boolean not null default true,
  logo_path text,
  updated_at timestamptz not null default now()
);
create trigger company_profile_updated before update on public.company_profile for each row execute function private.set_updated_at();

-- ---------- service areas ----------
create table public.service_areas (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  latitude numeric(9,6) not null,
  longitude numeric(9,6) not null,
  pickup_radius_km numeric(6,1) not null check (pickup_radius_km > 0),
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger service_areas_updated before update on public.service_areas for each row execute function private.set_updated_at();

-- ---------- app settings (key/value, e.g. booking rules) ----------
create table public.app_settings (
  key text primary key,
  value jsonb not null,
  description text,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
create trigger app_settings_updated before update on public.app_settings for each row execute function private.set_updated_at();

-- ---------- integrations (public settings + status; secrets live in Vault) ----------
create table public.integrations (
  provider text primary key,            -- paypal, twilio, resend, google_maps …
  category text not null,               -- payment, sms, email, maps
  display_name text not null,
  enabled boolean not null default false,
  environment text not null default 'live' check (environment in ('sandbox','live')),
  public_config jsonb not null default '{}'::jsonb,
  status text not null default 'not_configured' check (status in ('not_configured','configured','connected','error')),
  last_tested_at timestamptz,
  last_error text,
  notes text,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
create trigger integrations_updated before update on public.integrations for each row execute function private.set_updated_at();

-- ---------- audit log ----------
create table public.audit_log (
  id bigint generated always as identity primary key,
  table_name text not null,
  record_id text,
  action text not null,
  old_data jsonb,
  new_data jsonb,
  changed_by uuid,
  changed_at timestamptz not null default now()
);
create index audit_log_table_record on public.audit_log(table_name, record_id);

create or replace function private.write_audit()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_log(table_name, record_id, action, old_data, new_data, changed_by)
  values (tg_table_name,
          coalesce(to_jsonb(new)->>'id', to_jsonb(old)->>'id'),
          lower(tg_op),
          case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end,
          auth.uid());
  return coalesce(new, old);
end $$;

-- ---------- RLS ----------
alter table public.admin_users enable row level security;
alter table public.company_profile enable row level security;
alter table public.service_areas enable row level security;
alter table public.app_settings enable row level security;
alter table public.integrations enable row level security;
alter table public.audit_log enable row level security;

create policy "Admins read admins" on public.admin_users for select to authenticated using ((select private.is_admin()));
create policy "Admin updates own profile" on public.admin_users for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy "Owners manage admins" on public.admin_users for all to authenticated
  using ((select private.has_role(array['owner']))) with check ((select private.has_role(array['owner'])));

create policy "Admins read company" on public.company_profile for select to authenticated using ((select private.is_admin()));
create policy "Owners/admins edit company" on public.company_profile for update to authenticated
  using ((select private.has_role(array['owner','admin']))) with check ((select private.has_role(array['owner','admin'])));

create policy "Admins read service areas" on public.service_areas for select to authenticated using ((select private.is_admin()));
create policy "Owners/admins manage service areas" on public.service_areas for all to authenticated
  using ((select private.has_role(array['owner','admin']))) with check ((select private.has_role(array['owner','admin'])));

create policy "Admins read settings" on public.app_settings for select to authenticated using ((select private.is_admin()));
create policy "Owners/admins manage settings" on public.app_settings for all to authenticated
  using ((select private.has_role(array['owner','admin']))) with check ((select private.has_role(array['owner','admin'])));

create policy "Admins read integrations" on public.integrations for select to authenticated using ((select private.is_admin()));
create policy "Owners/admins manage integrations" on public.integrations for update to authenticated
  using ((select private.has_role(array['owner','admin']))) with check ((select private.has_role(array['owner','admin'])));

create policy "Owners/admins read audit log" on public.audit_log for select to authenticated using ((select private.has_role(array['owner','admin'])));

-- prevent admins (non-owners) from changing their own role / active flag
create or replace function private.protect_admin_fields()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and not exists (select 1 from public.admin_users where id = auth.uid() and role = 'owner' and is_active) then
    new.role := old.role; new.is_active := old.is_active; new.username := old.username;
  end if;
  return new;
end $$;
create trigger admin_users_protect before update on public.admin_users for each row execute function private.protect_admin_fields();
