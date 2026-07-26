-- Eşleştirme motoru v2 — ofise özel kriter ağırlıkları
--
-- tenants.matching_weights (jsonb, null): 5 kriterin göreli ağırlığı, örn.
--   {"budget":30,"location":25,"rooms":15,"type":20,"sqm":10}
-- NULL = varsayılan ağırlıklar (kod içindeki sabit puan seti) — geriye uyumlu.
-- Toplamın 100 olması zorunlu değil; skorlama sırasında normalize edilir.
-- Yazma: settings.edit izinli server action (updateMatchingWeights) mevcut
-- tenants update yolunu (RLS'li authenticated client) kullanır.

alter table public.tenants
  add column if not exists matching_weights jsonb;

comment on column public.tenants.matching_weights is
  'Eşleştirme kriter ağırlıkları {budget,location,rooms,type,sqm}; null = varsayılan set';
