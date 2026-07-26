-- Değerleme raporu paylaşım linki (/degerleme-raporu/[token] public sayfası).
-- share_token : null = rapor paylaşılmamış; doluysa token'ı bilen herkes
--               raporun salt okunur sürümünü görebilir (service role route'u okur,
--               RLS değişmez — anon'a valuations üzerinde hak verilmez).
-- shared_at   : linkin ilk üretildiği an ("X tarihinde paylaşıldı" bilgisi).
alter table public.valuations
  add column if not exists share_token uuid,
  add column if not exists shared_at   timestamptz;

-- Token'ı bilen tek kaydı bulmak public sayfanın tek sorgusu — unique index
-- hem çakışmayı engeller hem aramayı indeksler.
create unique index if not exists idx_valuations_share_token
  on public.valuations(share_token)
  where share_token is not null;
