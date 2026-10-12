-- Piyasa oranlari (TCMB EVDS): konut kredisi agirlikli ortalama faiz gibi tekil, otomatik cekilen degerler.
-- Yeni tablo; mevcut tablo/politika/yetkilere dokunmaz. Okuma: giris yapmis kullanici (hesaplayici varsayilani).
-- Yazma: yalniz service_role (tcmb-kur cron'u, ayri EVDS adimi).
create table if not exists public.market_rates (
  key text primary key,
  value numeric,
  as_of date,
  source text,
  fetched_at timestamptz not null default now()
);

alter table public.market_rates enable row level security;
alter table public.market_rates force row level security;

drop policy if exists market_rates_select on public.market_rates;
create policy market_rates_select on public.market_rates
  for select to authenticated
  using (true);

revoke all privileges on table public.market_rates from public, anon, authenticated, service_role;
grant select on table public.market_rates to authenticated;
grant select, insert, update on table public.market_rates to service_role;

notify pgrst, 'reload schema';
