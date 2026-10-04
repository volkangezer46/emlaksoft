-- K2: Founders kilitli fiyat (forward-only).
-- Abonelik kaydına kampanya fiyatı yazılabilsin diye iki sütun eklenir.
-- NOT: Deneme süresi bu dosyada YOK. Tek kaynak K1'in 20260816010100_default_trial_days_setting.sql
-- dosyasındaki platform_default_trial_days() yardımcısıdır; kayıt ve demo dönüşümü
-- fonksiyonlarına bu dosya DOKUNMAZ.

alter table public.subscriptions
  add column if not exists price_lock_try numeric
    check (price_lock_try is null or price_lock_try > 0),
  add column if not exists price_lock_campaign text;

create index if not exists idx_subscriptions_price_lock_campaign
  on public.subscriptions (price_lock_campaign)
  where price_lock_campaign is not null;

comment on column public.subscriptions.price_lock_try is
  'Kampanya (Founders) aylık fiyatı; abonelik sürdükçe korunur. Null = liste fiyatı.';

notify pgrst, 'reload schema';
