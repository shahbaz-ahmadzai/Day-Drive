do $$
declare src text;
begin
  src := pg_get_functiondef('private.contract_generate'::regproc);
  src := replace(src, 'stops_out - 0 - 0 #- ''{0}''', 'stops_out');
  execute src;
end $$;
