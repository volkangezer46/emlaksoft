-- 20261009000300 geri alma: onceki yetki durumuna doner.
revoke insert, update, delete on public.deal_process_steps from authenticated, service_role;
revoke insert, update, delete on public.listing_analyses from authenticated, service_role;
grant select, references, trigger, truncate on public.deal_process_steps to anon;
grant select, references, trigger, truncate on public.listing_analyses to anon;
notify pgrst, 'reload schema';
