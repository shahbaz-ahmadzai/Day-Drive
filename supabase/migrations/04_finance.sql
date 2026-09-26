create table public.finance_settings (
  id smallint primary key default 1 check (id = 1),
  default_vat_rate numeric(5,2) not null default 19.00,
  reduced_vat_rate numeric(5,2) not null default 7.00,
  chart_of_accounts text not null default 'SKR03' check (chart_of_accounts in ('SKR03','SKR04')),
  small_business boolean not null default false,          -- Kleinunternehmerregelung §19 UStG
  fiscal_year_start_month int not null default 1 check (fiscal_year_start_month between 1 and 12),
  updated_at timestamptz not null default now()
);
create trigger finance_settings_updated before update on public.finance_settings for each row execute function private.set_updated_at();

create table public.finance_categories (
  code text primary key,
  kind text not null check (kind in ('income','expense')),
  scope text not null default 'any' check (scope in ('vehicle','company','driver','any')),
  name_en text not null,
  name_de text not null,
  default_vat_rate numeric(5,2) not null default 19.00,
  account_skr03 text,
  tax_deductible boolean not null default true,
  sort_order int not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create sequence public.finance_entry_no_seq;
create table public.finance_entries (
  id uuid primary key default gen_random_uuid(),
  entry_no bigint not null unique default nextval('public.finance_entry_no_seq'),
  entry_date date not null,
  kind text not null check (kind in ('income','expense')),
  category_code text not null references public.finance_categories(code),
  vehicle_id uuid references public.vehicles(id) on delete restrict,
  driver_id uuid references public.drivers(id) on delete restrict,
  booking_id uuid references public.bookings(id) on delete restrict,
  description text not null,
  vendor text,
  invoice_number text,
  payment_method text check (payment_method in ('cash','bank_transfer','card','paypal','direct_debit','fuel_card','other')),
  gross_amount numeric(12,2) not null check (gross_amount > 0),
  vat_rate numeric(5,2) not null default 19.00 check (vat_rate >= 0 and vat_rate < 100),
  net_amount numeric(12,2) generated always as (round(gross_amount / (1 + vat_rate / 100), 2)) stored,
  vat_amount numeric(12,2) generated always as (gross_amount - round(gross_amount / (1 + vat_rate / 100), 2)) stored,
  odometer_km int,
  fuel_liters numeric(8,2),
  receipt_path text,
  receipt_status text not null default 'missing' check (receipt_status in ('attached','missing','not_required')),
  no_receipt_reason text,
  recurring_id uuid,
  status text not null default 'active' check (status in ('active','cancelled')),
  cancelled_reason text,
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index finance_entries_date on public.finance_entries(entry_date);
create index finance_entries_vehicle on public.finance_entries(vehicle_id);
create trigger finance_entries_updated before update on public.finance_entries for each row execute function private.set_updated_at();
create trigger finance_entries_audit after insert or update on public.finance_entries for each row execute function private.write_audit();

create table public.finance_recurring_costs (
  id uuid primary key default gen_random_uuid(),
  category_code text not null references public.finance_categories(code),
  vehicle_id uuid references public.vehicles(id) on delete cascade,
  description text not null,
  vendor text,
  gross_amount numeric(12,2) not null check (gross_amount > 0),
  vat_rate numeric(5,2) not null default 19.00,
  payment_method text,
  day_of_month int not null default 1 check (day_of_month between 1 and 28),
  start_date date not null default current_date,
  end_date date,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger finance_recurring_updated before update on public.finance_recurring_costs for each row execute function private.set_updated_at();
alter table public.finance_entries add constraint finance_entries_recurring_fk foreign key (recurring_id) references public.finance_recurring_costs(id) on delete set null;

create table public.finance_month_locks (
  period date primary key check (period = date_trunc('month', period)::date),
  locked_by uuid references auth.users(id) on delete set null default auth.uid(),
  locked_at timestamptz not null default now()
);

-- GoBD: entries can never be deleted; after saving, only receipt fields and cancellation may change
create or replace function private.finance_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_period date;
begin
  if tg_op = 'DELETE' then
    raise exception 'Finance entries cannot be deleted (GoBD). Cancel the entry with a reason instead.';
  end if;
  v_period := date_trunc('month', new.entry_date)::date;
  if tg_op = 'INSERT' then
    if exists (select 1 from public.finance_month_locks where period = v_period) then
      raise exception 'The month % is closed. No new entries can be added.', to_char(v_period, 'MM/YYYY');
    end if;
    return new;
  end if;
  -- UPDATE: core booking values are frozen
  if (new.entry_date, new.kind, new.category_code, new.gross_amount, new.vat_rate, new.description,
      coalesce(new.vehicle_id::text,''), coalesce(new.driver_id::text,''), coalesce(new.vendor,''), coalesce(new.invoice_number,''))
     is distinct from
     (old.entry_date, old.kind, old.category_code, old.gross_amount, old.vat_rate, old.description,
      coalesce(old.vehicle_id::text,''), coalesce(old.driver_id::text,''), coalesce(old.vendor,''), coalesce(old.invoice_number,'')) then
    raise exception 'Saved finance entries cannot be changed (GoBD). Cancel it and create a new entry.';
  end if;
  if old.status = 'cancelled' and new.status <> 'cancelled' then
    raise exception 'A cancelled entry cannot be reactivated.';
  end if;
  if new.status = 'cancelled' and old.status = 'active' then
    if coalesce(btrim(new.cancelled_reason), '') = '' then
      raise exception 'Please give a reason for the cancellation.';
    end if;
    new.cancelled_at := now();
    new.cancelled_by := auth.uid();
  end if;
  return new;
end $$;
create trigger finance_entries_guard before insert or update or delete on public.finance_entries for each row execute function private.finance_guard();

-- monthly overview used by the Finance page
create or replace function public.finance_month_summary(p_year int, p_month int)
returns table(kind text, category_code text, category_name text, vehicle_id uuid, entries int, gross numeric, net numeric, vat numeric, missing_receipts int)
language sql stable security invoker set search_path = '' as $$
  select e.kind, e.category_code, c.name_en, e.vehicle_id, count(*)::int,
         sum(e.gross_amount), sum(e.net_amount), sum(e.vat_amount),
         count(*) filter (where e.receipt_status = 'missing')::int
    from public.finance_entries e
    join public.finance_categories c on c.code = e.category_code
   where e.status = 'active'
     and e.entry_date >= make_date(p_year, p_month, 1)
     and e.entry_date < (make_date(p_year, p_month, 1) + interval '1 month')
   group by e.kind, e.category_code, c.name_en, e.vehicle_id
$$;

-- create this month's entries from active recurring costs (skips ones already created)
create or replace function public.finance_generate_recurring(p_year int, p_month int)
returns int language plpgsql security invoker set search_path = '' as $$
declare v_start date := make_date(p_year, p_month, 1); n int;
begin
  insert into public.finance_entries (entry_date, kind, category_code, vehicle_id, description, vendor, payment_method, gross_amount, vat_rate, receipt_status, recurring_id)
  select make_date(p_year, p_month, r.day_of_month), 'expense', r.category_code, r.vehicle_id, r.description, r.vendor, r.payment_method,
         r.gross_amount, r.vat_rate, 'missing', r.id
    from public.finance_recurring_costs r
   where r.is_active and r.start_date <= (v_start + interval '1 month - 1 day')::date
     and (r.end_date is null or r.end_date >= v_start)
     and not exists (select 1 from public.finance_entries e where e.recurring_id = r.id
                      and e.entry_date >= v_start and e.entry_date < v_start + interval '1 month');
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------- RLS ----------
alter table public.finance_settings enable row level security;
alter table public.finance_categories enable row level security;
alter table public.finance_entries enable row level security;
alter table public.finance_recurring_costs enable row level security;
alter table public.finance_month_locks enable row level security;

create policy "Finance roles read settings" on public.finance_settings for select to authenticated using ((select private.has_role(array['owner','admin','accountant'])));
create policy "Owners edit finance settings" on public.finance_settings for update to authenticated
  using ((select private.has_role(array['owner','admin']))) with check ((select private.has_role(array['owner','admin'])));

create policy "Admins read categories" on public.finance_categories for select to authenticated using ((select private.is_admin()));
create policy "Finance roles manage categories" on public.finance_categories for all to authenticated
  using ((select private.has_role(array['owner','admin','accountant']))) with check ((select private.has_role(array['owner','admin','accountant'])));

create policy "Finance roles read entries" on public.finance_entries for select to authenticated using ((select private.has_role(array['owner','admin','accountant'])));
create policy "Staff add entries" on public.finance_entries for insert to authenticated with check ((select private.has_role(array['owner','admin','accountant','dispatcher'])));
create policy "Finance roles update entries" on public.finance_entries for update to authenticated
  using ((select private.has_role(array['owner','admin','accountant']))) with check ((select private.has_role(array['owner','admin','accountant'])));

create policy "Finance roles manage recurring" on public.finance_recurring_costs for all to authenticated
  using ((select private.has_role(array['owner','admin','accountant']))) with check ((select private.has_role(array['owner','admin','accountant'])));

create policy "Finance roles read locks" on public.finance_month_locks for select to authenticated using ((select private.has_role(array['owner','admin','accountant'])));
create policy "Owners lock months" on public.finance_month_locks for insert to authenticated with check ((select private.has_role(array['owner','admin'])));
