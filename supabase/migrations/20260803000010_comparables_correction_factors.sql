-- D1/D3 boşluğu: emsal motoru hedef portföyün kat/yaş/ısıtma/cephe
-- özelliklerine göre HİÇ düzeltme yapmıyordu — ham medyan ₺/m² doğrudan
-- kullanılıyordu. Asansör ve otopark bu kapsamın dışında bırakıldı: bu iki
-- özellik `properties.features` şemasında hiç yakalanmıyor (form alanı yok,
-- kodda sıfır referans) — eklemek ayrı bir form/şema değişikliği ister.
--
-- Yöntem: her özellik için küçük, savunulabilir bir "istenirlik" puanı
-- (yüzde olarak) tanımlanır. Bir emsalin düzeltilmiş ₺/m²'si:
--   ham_fiyat × (1 + hedef_istenirlik − emsal_istenirlik)
-- Yani hedef, emsalden DAHA İYİ özelliklere sahipse emsalin ima ettiği fiyat
-- yukarı çekilir (hedef o emsalden daha değerli olmalı); tersi de simetrik.
-- Toplam düzeltme ±%15 ile sınırlanır — seyrek/eksik veriyle aşırı
-- düzeltmeden kaçınmak için (birçok portföyde bu alanlar boş kalabiliyor,
-- eksik veri nötr [0] sayılır, cezalandırılmaz).

create or replace function public.comparable_feature_desirability(
  p_floor         int,
  p_building_age  int,
  p_heating       text,
  p_facade        text
)
returns numeric
language sql
immutable
as $$
  select
    -- Kat: zemin/bodrum daha az istenir, çok yüksek kat hafif ihtiyatlı.
    coalesce(
      case
        when p_floor is null then 0
        when p_floor <= 0 then -0.03
        when p_floor between 1 and 4 then 0
        else -0.01
      end, 0)
    +
    -- Bina yaşı: yeni bina primi, eski bina iskontosu.
    coalesce(
      case
        when p_building_age is null then 0
        when p_building_age <= 5 then 0.02
        when p_building_age <= 15 then 0
        when p_building_age <= 25 then -0.03
        else -0.06
      end, 0)
    +
    -- Isınma türü: yerden ısıtma en değerli, soba/yok en az.
    coalesce(
      case p_heating
        when 'Yerden ısıtma' then 0.02
        when 'Merkezi (Pay ölçer)' then 0.01
        when 'Merkezi' then 0
        when 'Kombi (Doğalgaz)' then 0
        when 'Klima' then -0.02
        when 'Soba' then -0.04
        when 'Yok' then -0.05
        else 0
      end, 0)
    +
    -- Cephe: güney/güneydoğu/güneybatı (güneşli) primi, kuzey iskontosu.
    coalesce(
      case p_facade
        when 'Güney' then 0.02
        when 'Güneydoğu' then 0.015
        when 'Güneybatı' then 0.015
        when 'Doğu' then 0
        when 'Batı' then 0
        when 'Kuzeydoğu' then -0.01
        when 'Kuzeybatı' then -0.01
        when 'Kuzey' then -0.02
        else 0
      end, 0);
$$;

comment on function public.comparable_feature_desirability is
  'Kat+yaş+ısıtma+cephe için tek bir istenirlik puanı (oran). Asansör/otopark şemada yakalanmadığı için kapsam dışı.';

drop function if exists public.find_comparables(uuid, uuid, text, text, numeric, uuid, int, int);

create or replace function public.find_comparables(
  p_tenant_id        uuid,
  p_district_id      uuid,
  p_property_type    text,
  p_transaction_type text,
  p_sqm              numeric,
  p_exclude_property uuid default null,
  p_months_back      int  default 18,
  p_limit            int  default 40,
  p_target_floor         int  default null,
  p_target_building_age  int  default null,
  p_target_heating       text default null,
  p_target_facade        text default null
)
returns table (
  source        text,
  property_id   uuid,
  title         text,
  price         numeric,
  sqm           numeric,
  price_per_sqm numeric,
  -- Hedefin kat/yaş/ısıtma/cephe özelliklerine göre düzeltilmiş ₺/m² —
  -- düzeltme parametreleri verilmediyse (null) ham değerle aynıdır.
  adjusted_price_per_sqm numeric,
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
      now() - make_interval(months => p_months_back) as since,
      public.comparable_feature_desirability(
        p_target_floor, p_target_building_age, p_target_heating, p_target_facade
      ) as target_desirability
  ),
  won as (
    select
      'won_deal'::text                       as source,
      p.id                                   as property_id,
      p.title,
      d.deal_value                           as price,
      (p.features->>'sqm')::numeric          as sqm,
      round(d.deal_value / nullif((p.features->>'sqm')::numeric, 0), 0) as price_per_sqm,
      (p.features->>'floor')::int            as floor,
      (p.features->>'building_age')::int     as building_age,
      p.features->>'heating'                 as heating,
      p.features->>'facade'                  as facade,
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
      (p.features->>'floor')::int            as floor,
      (p.features->>'building_age')::int     as building_age,
      p.features->>'heating'                 as heating,
      p.features->>'facade'                  as facade,
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
  ),
  combined as (
    select * from won
    union all
    select * from active
  )
  select
    c.source,
    c.property_id,
    c.title,
    c.price,
    c.sqm,
    c.price_per_sqm,
    case
      when c.price_per_sqm is null then null
      else round(
        c.price_per_sqm * (
          1 + greatest(least(
            params.target_desirability
              - public.comparable_feature_desirability(c.floor, c.building_age, c.heating, c.facade),
            0.15), -0.15)
        ), 0
      )
    end as adjusted_price_per_sqm,
    c.rooms,
    c.happened_at
  from combined c
  cross join params
  order by c.source desc, c.happened_at desc  -- won_deal önce ('w' > 'a')
  limit p_limit;
$$;

comment on function public.find_comparables is
  'Emsal kayıtlar: kazanılmış anlaşmalar (öncelikli) + aktif portföy. m² bandı ±%30, varsayılan 18 ay. adjusted_price_per_sqm hedef kat/yaş/ısıtma/cepheye göre düzeltilmiştir.';

drop function if exists public.estimate_property_value(uuid, uuid, text, text, numeric, uuid);

create or replace function public.estimate_property_value(
  p_tenant_id        uuid,
  p_district_id      uuid,
  p_property_type    text,
  p_transaction_type text,
  p_sqm              numeric,
  p_exclude_property uuid default null,
  p_target_floor         int  default null,
  p_target_building_age  int  default null,
  p_target_heating       text default null,
  p_target_facade        text default null
)
returns table (
  estimated_value   numeric,   -- düzeltilmiş medyan ₺/m² × hedef m²
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
      p_tenant_id        := p_tenant_id,
      p_district_id      := p_district_id,
      p_property_type    := p_property_type,
      p_transaction_type := p_transaction_type,
      p_sqm              := p_sqm,
      p_exclude_property := p_exclude_property,
      p_target_floor         := p_target_floor,
      p_target_building_age  := p_target_building_age,
      p_target_heating       := p_target_heating,
      p_target_facade        := p_target_facade
    )
    where adjusted_price_per_sqm is not null and adjusted_price_per_sqm > 0
  ),
  -- Kazanılmış anlaşma gerçekleşen fiyattır: iki kez sayarak ağırlıklandır.
  -- (SQL'de ağırlıklı percentile yok; satır çoğaltma basit ve yeterli.)
  weighted as (
    select adjusted_price_per_sqm as price_per_sqm from comps
    union all
    select adjusted_price_per_sqm as price_per_sqm from comps where source = 'won_deal'
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
  'Yerli değerleme: DÜZELTİLMİŞ emsal medyanı (kat/yaş/ısıtma/cephe) × m². Güven skoru emsal sayısı + yayılımdan; az veriyle "emin" görünmez.';

grant execute on function public.comparable_feature_desirability to authenticated, service_role;
grant execute on function public.find_comparables(
  uuid, uuid, text, text, numeric, uuid, int, int, int, int, text, text
) to authenticated, service_role;
grant execute on function public.estimate_property_value(
  uuid, uuid, text, text, numeric, uuid, int, int, text, text
) to authenticated, service_role;
