create or replace function public.customer_extra_balance(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c record;
begin
  select id, first_name, last_name, email, phone into c from public.customers where auth_user_id = p_user;
  if c.id is null then return jsonb_build_object('customer_id', null); end if;
  return jsonb_build_object('customer_id', c.id, 'first_name', c.first_name, 'last_name', c.last_name, 'email', c.email, 'phone', c.phone,
    'available', private.balance_available_for_extra(c.id),
    'discount_pct', (select coalesce(max(extra_ride_discount_pct), 0) from public.ride_contracts where customer_id = c.id and status = 'active'));
end $$;
revoke all on function public.customer_extra_balance(uuid) from public, anon, authenticated;
grant execute on function public.customer_extra_balance(uuid) to service_role;
