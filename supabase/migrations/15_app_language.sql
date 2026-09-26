-- the driver app / customer area remember the chosen language (push texts use it)
create or replace function public.driver_set_language(p_lang text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if private.current_driver_id() is null then raise exception 'Not a driver login.'; end if;
  if p_lang not in ('en','de','ar','ps','fa') then raise exception 'Unknown language.'; end if;
  update public.drivers set app_language = p_lang where id = private.current_driver_id();
end $$;
create or replace function public.customer_set_language(p_lang text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if private.current_customer_id() is null then raise exception 'Please log in.'; end if;
  if p_lang not in ('en','de','ar','ps','fa') then raise exception 'Unknown language.'; end if;
  update public.customers set language = p_lang where id = private.current_customer_id();
end $$;
revoke execute on function public.driver_set_language(text) from public, anon;
revoke execute on function public.customer_set_language(text) from public, anon;
grant execute on function public.driver_set_language(text) to authenticated;
grant execute on function public.customer_set_language(text) to authenticated;
