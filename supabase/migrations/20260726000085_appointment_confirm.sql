-- Randevu müşteri teyidi (/randevu-teyit/[token] public sayfası).
-- confirm_token     : randevu oluşturulunca otomatik üretilir; token'ı bilen müşteri
--                     randevuyu görüp yanıtlayabilir (service role okur, RLS değişmez —
--                     anon'a appointments üzerinde hak verilmez; valuation share_token deseni).
-- customer_response : null = henüz yanıt yok; 'coming' = müşteri geleceğini onayladı,
--                     'cancelled' = katılamayacağını bildirdi (randevu durumu da iptale çekilir).
-- responded_at      : müşterinin yanıt verdiği an.
alter table public.appointments
  add column if not exists confirm_token uuid not null default gen_random_uuid(),
  add column if not exists customer_response text
    check (customer_response in ('coming','cancelled')),
  add column if not exists responded_at timestamptz;

-- Public sayfanın tek sorgusu token üzerinden — unique index hem çakışmayı
-- engeller hem aramayı indeksler.
create unique index if not exists idx_appointments_confirm_token
  on public.appointments(confirm_token);
