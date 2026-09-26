-- after the office adds holidays: cancel already planned contract rides on those days
-- (only contracts that skip that kind of holiday); returns how many rides were cancelled
create or replace function public.admin_apply_holidays(p_from date, p_to date)
returns integer language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if not private.has_role(array['owner','admin','dispatcher']) then raise exception 'Not allowed.'; end if;
  update public.bookings b set status = 'cancelled', cancelled_at = now(), cancel_reason = 'Holiday'
   from public.ride_contracts c
   where b.contract_id = c.id and b.status in ('confirmed','assigned') and b.booking_start > now()
     and (b.booking_start at time zone 'Europe/Berlin')::date between p_from and p_to
     and exists (select 1 from public.holidays hd where hd.day = (b.booking_start at time zone 'Europe/Berlin')::date and hd.region = 'HE'
                 and ((hd.kind = 'public' and c.skip_public_holidays) or (hd.kind = 'school' and c.skip_school_holidays)));
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.admin_apply_holidays(date, date) from public, anon;
grant execute on function public.admin_apply_holidays(date, date) to authenticated;
