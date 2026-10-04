-- Rollback: 20260817000220_trial_days_setting_and_price_lock
-- provision_registration / convert_demo_request_to_tenant eski (sabit 14 gün) gövdeye dönmek için
-- 20260731000140 ve 20260802000400 dosyalarındaki create or replace function bloklarını yeniden çalıştırın.
-- Bu dosya yalnız eklenen nesneleri kaldırır; fonksiyonlar billing_trial_days'e bağlıyken önce onlar geri alınmalıdır.
drop index if exists public.idx_subscriptions_price_lock_campaign;
alter table public.subscriptions drop column if exists price_lock_campaign;
alter table public.subscriptions drop column if exists price_lock_try;
-- billing_trial_days() fonksiyonu, yukarıdaki fonksiyonlar eski gövdeye döndürüldükten SONRA silinmelidir:
-- drop function if exists public.billing_trial_days();
