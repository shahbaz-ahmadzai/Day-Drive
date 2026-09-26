insert into public.app_settings (key, value, description) values
 ('booking.payment_mode', '"pay_on_ride"', 'pay_on_ride = website bookings are confirmed immediately and paid to the driver; online = customer pays online (PayPal) before the booking is confirmed'),
 ('notifications.auto_sms_website', 'true', 'Send the SMS confirmation automatically when a website booking is confirmed')
on conflict (key) do nothing;

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='bookings') then
    alter publication supabase_realtime add table public.bookings;
  end if;
end $$;
