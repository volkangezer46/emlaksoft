-- TCMB günlük döviz kuru arşivi
--
-- Neden: Türkiye emlak piyasası fiilen dolarize. "Fiyat 6.750.000 ₺'den
-- 7.200.000 ₺'ye çıktı" cümlesi tek başına yanıltıcı — aynı dönemde kur
-- %10 arttıysa döviz bazında FİYAT DÜŞMÜŞ olabilir. Danışmanın müşteriye
-- doğru anlatabilmesi için her fiyat kaydının O GÜNKÜ resmî kurla döviz
-- karşılığı gerekiyor.
--
-- Kaynak: TCMB resmî günlük kur (açık veri, herkese açık). Üçüncü taraf
-- sitelerden veri kazınmıyor — kaynak devletin kendi yayınıdır.
--
-- Tasarım kararları:
--  * Tenant'a bağlı DEĞİL: kur global referans veri. Tüm ofisler aynı satırı
--    okur, yazma yalnızca service_role (cron).
--  * Alış ve satış ayrı tutuluyor. Emlak değerlemesinde konvansiyon "döviz
--    satış" (forex selling); alış da saklanıyor çünkü raporlamada istenebilir.
--  * TCMB hafta sonu/tatil yayın yapmaz. `tcmb_rate_on()` fonksiyonu en yakın
--    ÖNCEKİ iş günü kuruna düşer — bu, finansal raporlamanın standart davranışı.
--  * rate_date primary key: aynı gün iki kez çekilirse upsert eder.

create table if not exists public.tcmb_rates (
  rate_date    date        primary key,
  usd_buying   numeric(18, 6),
  usd_selling  numeric(18, 6),
  eur_buying   numeric(18, 6),
  eur_selling  numeric(18, 6),
  source       text        not null default 'tcmb',
  fetched_at   timestamptz not null default now()
);

comment on table  public.tcmb_rates             is 'TCMB resmî günlük döviz kuru arşivi — global referans veri, tenant bağımsız';
comment on column public.tcmb_rates.rate_date   is 'Kurun geçerli olduğu tarih (TCMB yayın tarihi)';
comment on column public.tcmb_rates.usd_selling is 'Döviz satış — değerleme/raporlamada kullanılan konvansiyon';

-- Tarihe göre geriye doğru arama en sık sorgu (en yakın önceki iş günü)
create index if not exists idx_tcmb_rates_date_desc
  on public.tcmb_rates (rate_date desc);

-- ============================================================
-- RLS — okuma herkese (giriş yapmış), yazma yalnızca service_role
-- ============================================================
alter table public.tcmb_rates enable row level security;

drop policy if exists tcmb_rates_read  on public.tcmb_rates;
drop policy if exists tcmb_rates_write on public.tcmb_rates;

-- Global referans veri: tenant filtresi YOK, bilinçli.
create policy tcmb_rates_read on public.tcmb_rates
  for select using (auth.role() = 'authenticated' or auth.role() = 'service_role');

create policy tcmb_rates_write on public.tcmb_rates
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

grant select on public.tcmb_rates to authenticated;
grant all    on public.tcmb_rates to service_role;

-- ============================================================
-- Etkin kur: verilen tarihte yayın yoksa en yakın ÖNCEKİ iş gününe düş
-- ============================================================
create or replace function public.tcmb_rate_on(p_date date)
returns table (
  rate_date   date,
  usd_selling numeric,
  eur_selling numeric,
  usd_buying  numeric,
  eur_buying  numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select r.rate_date, r.usd_selling, r.eur_selling, r.usd_buying, r.eur_buying
  from public.tcmb_rates r
  where r.rate_date <= p_date
  order by r.rate_date desc
  limit 1;
$$;

comment on function public.tcmb_rate_on(date) is
  'Verilen tarihte geçerli kur. TCMB hafta sonu/tatil yayın yapmadığı için en yakın önceki iş gününe düşer.';

grant execute on function public.tcmb_rate_on(date) to authenticated, service_role;

-- ============================================================
-- Fiyat geçmişini kurla zenginleştiren görünüm
-- Her fiyat kaydının o günkü resmî kurla döviz karşılığı.
-- RLS: property_price_history'nin politikası geçerli (view sahibi devralır).
-- ============================================================
create or replace view public.property_price_history_fx
with (security_invoker = true)
as
select
  h.id,
  h.property_id,
  h.tenant_id,
  h.price_field,
  h.old_price,
  h.new_price,
  h.change_pct,
  h.reason,
  h.changed_by,
  h.created_at,
  fx.rate_date                                              as fx_date,
  fx.usd_selling                                            as usd_rate,
  fx.eur_selling                                            as eur_rate,
  round(h.new_price / nullif(fx.usd_selling, 0), 2)         as new_price_usd,
  round(h.new_price / nullif(fx.eur_selling, 0), 2)         as new_price_eur,
  round(h.old_price / nullif(fx.usd_selling, 0), 2)         as old_price_usd,
  round(h.old_price / nullif(fx.eur_selling, 0), 2)         as old_price_eur
from public.property_price_history h
left join lateral public.tcmb_rate_on(h.created_at::date) fx on true;

comment on view public.property_price_history_fx is
  'Fiyat geçmişi + o günkü TCMB kuruyla USD/EUR karşılığı. security_invoker: çağıranın RLS''i uygulanır.';

grant select on public.property_price_history_fx to authenticated, service_role;
