-- Bölge (ilçe) analitiği
--
-- NE İŞE YARAR: Ofisin kendi portföy ve anlaşma verisinden ilçe bazlı piyasa
-- görünümü çıkarır — aktif portföy, medyan m² fiyatı, listede kalma süresi,
-- kapanan işlem sayısı ve fiyat değişim eğilimi.
--
-- NEDEN DIŞ VERİ YOK: Endeksa/Tapusor gibi kaynaklar sözleşmeli API'ler.
-- Anahtar tanımlıysa değerleme akışında zaten kullanılıyor. Burası tamamen
-- kiracının kendi verisi; hiçbir dış siteden veri kazınmıyor.
--
-- NEDEN FONKSİYON, NEDEN VIEW DEĞİL: Kiracı kimliği parametre olarak alınıyor
-- ve `security invoker` ile çağıranın RLS'i korunuyor. Görünüm olsaydı her
-- sorguda tüm kiracıların satırları taranıp sonra elenirdi.

create or replace function public.region_stats(
  p_tenant_id       uuid,
  p_transaction_type text default null,
  p_months_back     integer default 12
)
returns table (
  district_id       uuid,
  district_name     text,
  province_name     text,
  active_count      integer,
  total_count       integer,
  median_sqm_price  numeric,
  min_sqm_price     numeric,
  max_sqm_price     numeric,
  avg_days_listed   numeric,
  closed_count      integer,
  closed_value      numeric,
  price_change_pct  numeric
)
language sql
stable
security invoker
set search_path to 'public'
as $$
  with base as (
    select
      p.id,
      p.district_id,
      p.status,
      p.created_at,
      p.list_price,
      -- m² `features` JSONB içinde tutuluyor; sayıya çevrilemeyen değerler
      -- NULL olsun diye önce metne, sonra numeric'e güvenli dönüşüm.
      nullif(regexp_replace(coalesce(p.features->>'sqm', ''), '[^0-9.]', '', 'g'), '')::numeric as sqm
    from public.properties p
    where p.tenant_id = p_tenant_id
      and p.deleted_at is null
      and p.district_id is not null
      and (p_transaction_type is null or p.transaction_type = p_transaction_type)
  ),
  priced as (
    select
      b.*,
      -- Sıfır ya da negatif m² bölme hatası doğurur; nullif ile eleniyor.
      case when b.list_price > 0 and nullif(b.sqm, 0) > 0
           then b.list_price / b.sqm end as price_per_sqm
    from base b
  ),
  agg as (
    select
      pr.district_id,
      count(*) filter (
        where pr.status in ('live', 'reserved', 'Yayında')
      )::int as active_count,
      count(*)::int as total_count,
      (percentile_cont(0.5) within group (order by pr.price_per_sqm)
        filter (where pr.price_per_sqm is not null))::numeric as median_sqm_price,
      min(pr.price_per_sqm)::numeric as min_sqm_price,
      max(pr.price_per_sqm)::numeric as max_sqm_price,
      -- Satılmış/kiralanmışlar için "listede kalma" anlamsız; yalnız aktifler.
      avg(
        case when pr.status in ('live', 'reserved', 'Yayında')
             then extract(epoch from (now() - pr.created_at)) / 86400 end
      )::numeric as avg_days_listed
    from priced pr
    group by pr.district_id
  ),
  closed as (
    -- Kapanan işlem: kazanılmış anlaşmayı portföyün ilçesine bağla.
    select
      p.district_id,
      count(*)::int as closed_count,
      coalesce(sum(d.deal_value), 0)::numeric as closed_value
    from public.deals d
    join public.properties p on p.id = d.property_id
    where d.tenant_id = p_tenant_id
      and d.stage = 'won'
      and p.district_id is not null
      and d.updated_at >= now() - make_interval(months => p_months_back)
    group by p.district_id
  ),
  moves as (
    -- Fiyat eğilimi: seçilen dönemdeki ortalama yüzde değişim.
    select
      p.district_id,
      round(avg(h.change_pct)::numeric, 1) as price_change_pct
    from public.property_price_history h
    join public.properties p on p.id = h.property_id
    where h.tenant_id = p_tenant_id
      and p.district_id is not null
      and h.change_pct is not null
      and h.created_at >= now() - make_interval(months => p_months_back)
    group by p.district_id
  )
  select
    a.district_id,
    gd.name                                   as district_name,
    gp.name                                   as province_name,
    a.active_count,
    a.total_count,
    round(a.median_sqm_price, 0)              as median_sqm_price,
    round(a.min_sqm_price, 0)                 as min_sqm_price,
    round(a.max_sqm_price, 0)                 as max_sqm_price,
    round(a.avg_days_listed, 0)               as avg_days_listed,
    coalesce(c.closed_count, 0)               as closed_count,
    coalesce(c.closed_value, 0)               as closed_value,
    m.price_change_pct
  from agg a
  join public.geo_districts gd on gd.id = a.district_id
  join public.geo_provinces gp on gp.id = gd.province_id
  left join closed c on c.district_id = a.district_id
  left join moves  m on m.district_id = a.district_id
  order by a.active_count desc, a.total_count desc;
$$;

comment on function public.region_stats(uuid, text, integer) is
  'Kiracının kendi portföy/anlaşma verisinden ilçe bazlı piyasa özeti. Dış veri kaynağı kullanmaz.';

-- Bu fonksiyonun taradığı yollar için indeks: ilçe bazlı gruplama sık olacak.
create index if not exists idx_properties_tenant_district
  on public.properties (tenant_id, district_id)
  where deleted_at is null;

create index if not exists idx_price_history_tenant_created
  on public.property_price_history (tenant_id, created_at desc);
