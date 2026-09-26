do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prosecdef
             and p.proname ~ '^(admin_|driver_|customer_(accept|balance_for|bookings|cancel|contract|ledger|overview|pause|withdraw)|send_ride_message|mark_ride_messages_read|push_subscribe)'
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
  end loop;
end $$;
drop index if exists public.bookings_driver_time;
create index if not exists bookings_shift_id on public.bookings(shift_id);
create index if not exists bookings_service_area_id on public.bookings(service_area_id);
create index if not exists finance_entries_booking_id on public.finance_entries(booking_id);
create index if not exists finance_entries_driver_id on public.finance_entries(driver_id);
create index if not exists customer_ledger_contract_id on public.customer_ledger(contract_id);
create index if not exists ride_contracts_driver_id on public.ride_contracts(driver_id);
create index if not exists ride_contracts_vehicle_id on public.ride_contracts(vehicle_id);
create index if not exists vehicle_events_device_id on public.vehicle_events(device_id);
