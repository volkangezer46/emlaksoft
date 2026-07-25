-- Emsal (comparable) motoru — dış API'siz yerli değerleme
--
-- Neden: Endeksa sınıfı "bu daire ne eder?" sorusuna dış servise bağımlı
-- olmadan cevap. Kaynaklar güvenilirlik sırasıyla:
--   1) KAZANILMIŞ ANLAŞMALAR (deals.stage='won' + deal_value) — gerçekleşen
--      fiyat. En değerli sinyal: liste fiyatı pazarlık payı içerir,
--      kapanış fiyatı içermez.
--   2) AKTİF/YAYINDAKİ PORTFÖY liste fiyatları — arz tarafı, ikincil sinyal.
--
-- Tasarım kararları:
--  * m² bandı: hedefin ±%30'u. Dar bant az emsal bulur, geniş bant elmayla
--    armudu karıştırır; %30 emlak pratiğinde yaygın orta yol.
--  * Zaman penceresi: son 18 ay. Türkiye enflasyon ortamında daha eskisi
--    yanıltıcı; kapanış fiyatları TÜFE ile bugüne çekilmez (bu bir MVP
--    kararı — D2'de bölge trendiyle düzeltme eklenecek).
--  * Medyan, ortalama değil: tek bir uç fiyat ortalamayı bozar, medyanı bozmaz.
--  * Güven skoru emsal SAYISI + YAYILIM'dan türetilir. 3 emsalle "kesin değer"
--    iddia etmek yalancılıktır; skor bunu açıkça söyler.
--  * SECURITY INVOKER: çağıranın RLS'i geçerli — fonksiyon tenant sınırını
--    kendisi de parametreyle çizer (savunma katmanı iki kat).

-- ============================================================
-- Emsal listesi: hedef kriterlere uyan kayıtlar
-- ============================================================
create or replace function public.find_comparables(
  p_tenant_id        uuid,
  p_district_id      uuid,
  p_property_type    text,
  p_transaction_type text,
  p_sqm              numeric,
  p_exclude_property uuid default null,
  p_months_back      int  default 18,
  p_limit            int  default 40
)
returns table (
  source        text,          -- 'won_deal' | 'active_listing'
  property_id   uuid,
  title         text,
  price         numeric,       -- won: kapanış fiyatı, active: liste fiyatı
  sqm           numeric,
  price_per_sqm numeric,
  rooms         text,
  happened_at   timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  with params as (
    select
      greatest(p_sqm * 0.7, 1)  as sqm_min,
      p_sqm * 1.3               as sqm_max,
      now() - make_interval(months => p_months_back) as since
  ),
  won as (
    select
      'won_deal'::text                       as source,
      p.id                                   as property_id,
      p.title,
      d.deal_value                           as price,
      (p.features->>'sqm')::numeric          as sqm,
      round(d.deal_value / nullif((p.features->>'sqm')::numeric, 0), 0) as price_per_sqm,
      p.features->>'rooms'                   as rooms,
      d.updated_at                           as happened_at
    from public.deals d
    join public.properties p on p.id = d.property_id
    cross join params
    where d.tenant_id = p_tenant_id
      and d.stage = 'won'
      and d.deal_value is not null and d.deal_value > 0
      and p.district_id = p_district_id
      and p.property_type = p_property_type
      and p.transaction_type = p_transaction_type
      and (p.features->>'sqm')::numeric between params.sqm_min and params.sqm_max
      and d.updated_at >= params.since
      and (p_exclude_property is null or p.id <> p_exclude_property)
  ),
  active as (
    select
      'active_listing'::text                 as source,
      p.id                                   as property_id,
      p.title,
      p.list_price                           as price,
      (p.features->>'sqm')::numeric          as sqm,
      round(p.list_price / nullif((p.features->>'sqm')::numeric, 0), 0) as price_per_sqm,
      p.features->>'rooms'                   as rooms,
      p.created_at                           as happened_at
    from public.properties p
    cross join params
    where p.tenant_id = p_tenant_id
      and p.deleted_at is null
      and p.status in ('live', 'reserved')
      and p.list_price is not null and p.list_price > 0
      and p.district_id = p_district_id
      and p.property_type = p_property_type
      and p.transaction_type = p_transaction_type
      and (p.features->>'sqm')::numeric between params.sqm_min and params.sqm_max
      and (p_exclude_property is null or p.id <> p_exclude_property)
  )
  select * from won
  union all
  select * from active
  order by source desc, happened_at desc  -- won_deal önce ('w' > 'a')
  limit p_limit;
$$;

comment on function public.find_comparables is
  'Emsal kayıtlar: kazanılmış anlaşmalar (öncelikli) + aktif portföy. m² bandı ±%30, varsayılan 18 ay.';

-- ============================================================
-- Değerleme özeti: medyan/çeyrekler + güven skoru
-- ============================================================
create or replace function public.estimate_property_value(
  p_tenant_id        uuid,
  p_district_id      uuid,
  p_property_type    text,
  p_transaction_type text,
  p_sqm              numeric,
  p_exclude_property uuid default null
)
returns table (
  estimated_value   numeric,   -- medyan ₺/m² × hedef m²
  low_value         numeric,   -- 1. çeyrek bazlı
  high_value        numeric,   -- 3. çeyrek bazlı
  median_sqm_price  numeric,
  comp_count        int,
  won_count         int,
  active_count      int,
  confidence        text,      -- 'yüksek' | 'orta' | 'düşük' | 'yetersiz'
  spread_pct        numeric    -- (q3-q1)/medyan — yayılım göstergesi
)
language sql
stable
security invoker
set search_path = public
as $$
  with comps as (
    select * from public.find_comparables(
      p_tenant_id, p_district_id, p_property_type, p_transaction_type,
      p_sqm, p_exclude_property
    )
    where price_per_sqm is not null and price_per_sqm > 0
  ),
  -- Kazanılmış anlaşma gerçekleşen fiyattır: iki kez sayarak ağırlıklandır.
  -- (SQL'de ağırlıklı percentile yok; satır çoğaltma basit ve yeterli.)
  weighted as (
    select price_per_sqm from comps
    union all
    select price_per_sqm from comps where source = 'won_deal'
  ),
  stats as (
    -- percentile_cont double döndürür; round(double, int) Postgres'te yok —
    -- numeric'e cast şart.
    select
      (percentile_cont(0.5)  within group (order by price_per_sqm))::numeric as med,
      (percentile_cont(0.25) within group (order by price_per_sqm))::numeric as q1,
      (percentile_cont(0.75) within group (order by price_per_sqm))::numeric as q3
    from weighted
  ),
  counts as (
    select
      count(*)::int                                  as total,
      count(*) filter (where source = 'won_deal')::int    as won,
      count(*) filter (where source = 'active_listing')::int as act
    from comps
  )
  select
    round(s.med * p_sqm, 0)                    as estimated_value,
    round(s.q1  * p_sqm, 0)                    as low_value,
    round(s.q3  * p_sqm, 0)                    as high_value,
    round(s.med, 0)                            as median_sqm_price,
    c.total                                    as comp_count,
    c.won                                      as won_count,
    c.act                                      as active_count,
    case
      when c.total = 0 then 'yetersiz'
      when c.total >= 8 and c.won >= 2
           and s.med > 0 and (s.q3 - s.q1) / s.med <= 0.35 then 'yüksek'
      when c.total >= 4 then 'orta'
      else 'düşük'
    end                                        as confidence,
    case when s.med > 0
         then round((s.q3 - s.q1) / s.med * 100, 1)
         else null end                         as spread_pct
  from stats s, counts c;
$$;

comment on function public.estimate_property_value is
  'Yerli değerleme: emsal medyanı × m². Güven skoru emsal sayısı + yayılımdan; az veriyle "emin" görünmez.';

grant execute on function public.find_comparables       to authenticated, service_role;
grant execute on function public.estimate_property_value to authenticated, service_role;

-- Emsal aramasının ana filtre yolu için index
create index if not exists idx_properties_comps
  on public.properties (tenant_id, district_id, property_type, transaction_type)
  where deleted_at is null;

create index if not exists idx_deals_won_property
  on public.deals (tenant_id, stage, property_id)
  where stage = 'won';
