-- ============================================================
-- Açık ev self check-in (QR/kiosk): public kayıt token'ı
-- ============================================================
-- /acik-ev-kayit/[token] public sayfası bu token ile etkinliği bulur
-- (randevu-teyit confirm_token deseni). Token uuid → tahmin edilemez,
-- unique index ile tek kaydı bulur.

alter table public.open_houses
  add column if not exists public_token uuid not null default gen_random_uuid();

create unique index if not exists idx_open_houses_public_token
  on public.open_houses(public_token);

comment on column public.open_houses.public_token is
  'Self check-in public sayfası (/acik-ev-kayit/[token]) için tahmin edilemez token. QR olarak kapıya asılır.';

-- Mükerrer kayıt kontrolü (aynı etkinlik + aynı telefon) action tarafında
-- select ile yapılır; bu indeks o sorguyu hızlandırır. UNIQUE değil:
-- kapıdaki danışman formu telefonsuz/tekrarlı kayıt açabiliyor, onu kırmayalım.
create index if not exists idx_open_house_visitors_event_phone
  on public.open_house_visitors(open_house_id, phone);
