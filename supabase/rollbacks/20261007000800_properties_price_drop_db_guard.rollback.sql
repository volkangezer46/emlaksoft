-- Rollback: 20261007000800_properties_price_drop_db_guard
-- Fiyat dusurme tetikleyicisi/fonksiyonu duser (onay kapisi yeniden yalniz uygulama katmanina doner) ve
-- property_price_history eski politikalarina (pph_tenant ALL + pph_tenant_insert) ve yazma yetkisine doner.
-- UYARI: geri alma, danisman dogrudan PostgREST ile fiyat dusurme ve fiyat izini silme acigini YENIDEN acar.

set local lock_timeout = '5s';

drop trigger if exists trg_properties_price_drop_guard on public.properties;
drop function if exists public.guard_property_list_price_drop();

drop policy if exists pph_select on public.property_price_history;
drop policy if exists pph_tenant on public.property_price_history;
drop policy if exists pph_tenant_insert on public.property_price_history;

create policy pph_tenant on public.property_price_history
  using (tenant_id = (select public.current_tenant_id()));

create policy pph_tenant_insert on public.property_price_history for insert
  with check (tenant_id = (select public.current_tenant_id()));

grant all on public.property_price_history to authenticated;

notify pgrst, 'reload schema';
