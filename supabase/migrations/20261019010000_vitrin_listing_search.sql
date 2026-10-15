-- MIGRATION 20261019010000_vitrin_listing_search.sql
-- UYGULANMADI: yalniz restore edilebilir yedek dogrulandiktan sonra SAHIBI uygular (`npm run db:migrate`).
-- Geri alma: supabase/rollbacks/20261019010000_vitrin_listing_search.rollback.sql (3 fonksiyon duser; kod RPC yokken
--   vitrin listesi eski PostgREST sorgusuna duser: islem/fiyat/oda/tur/konum suzgeci + sayfalama calisir, m2/yas/kat
--   suzgecleri ve m2 fiyati siralamasi devre disi kalir).
-- BAGIMLILIK: yok (properties, property_media, geo_* init semasi).
--
-- NE (PUB-1 / PUB-2, herkese acik vitrin):
--   - vitrin_json_number(jsonb): features icindeki sayi ya da sayisal metni guvenle numeric'e cevirir (yoksa null).
--   - vitrin_listing_search(tenant, filtreler, limit, offset): yayindaki (live, silinmemis, ornek olmayan, kapali
--     portfoy olmayan) ilanlardan filtreye uyanlarin id'si + toplam sayi (count(*) over ()). Islem turu (satilik/kiralik)
--     artik SORGUDA suzulur (eskiden 60 satir limitinden SONRA bellekte); m2 (brut, yoksa sqm), bina yasi, kat, esyali,
--     site ici, krediye uygun ve il/ilce/mahalle suzgecleri; siralama: onerilen (fotografli + en yeni), fiyat artan/azalan,
--     m2 fiyati artan. Sayfa en cok 60 satir.
--   - vitrin_listing_facets(tenant): yayindaki ilanlardan tureyen secenekler (oda, tur, il/ilce/mahalle + sayilar);
--     eski "ilk 200 satirdan tret" yaklasimi yerine tam kume.
-- GUVENLIK: SECURITY INVOKER + search_path '' + EXECUTE yalniz service_role (vitrin sunucusu admin istemcisiyle cagirir;
--   anon/authenticated cagiramaz). Fonksiyonlar salt okurdur ve yalniz verilen kiracinin satirlarini doner.
set local lock_timeout = '5s';

create or replace function public.vitrin_json_number(p jsonb)
returns numeric
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when p is null then null
    when jsonb_typeof(p) = 'number' then (p #>> '{}')::numeric
    when jsonb_typeof(p) = 'string' and (p #>> '{}') ~ '^\s*[0-9]{1,9}([.,][0-9]{1,4})?\s*$'
      then replace(btrim(p #>> '{}'), ',', '.')::numeric
    else null
  end
$$;

create or replace function public.vitrin_listing_search(
  p_tenant_id uuid,
  p_filters jsonb,
  p_limit integer default 24,
  p_offset integer default 0
)
returns table (id uuid, total bigint)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  f jsonb := coalesce(p_filters, '{}'::jsonb);
  v_tx text := nullif(f ->> 'tx', '');
  v_q text := nullif(left(btrim(coalesce(f ->> 'q', '')), 80), '');
  v_like text;
  v_min numeric := public.vitrin_json_number(f -> 'min');
  v_max numeric := public.vitrin_json_number(f -> 'max');
  v_rooms text := nullif(left(coalesce(f ->> 'rooms', ''), 20), '');
  v_type text := nullif(left(coalesce(f ->> 'type', ''), 40), '');
  v_sqm_min numeric := public.vitrin_json_number(f -> 'sqm_min');
  v_sqm_max numeric := public.vitrin_json_number(f -> 'sqm_max');
  v_age_max numeric := public.vitrin_json_number(f -> 'age_max');
  v_floor text := nullif(f ->> 'floor', '');
  v_furnished boolean := coalesce((f ->> 'furnished') = 'true', false);
  v_in_site boolean := coalesce((f ->> 'in_site') = 'true', false);
  v_credit boolean := coalesce((f ->> 'credit') = 'true', false);
  v_sort text := coalesce(f ->> 'sort', '');
  v_province uuid;
  v_district uuid;
  v_neighborhood uuid;
  v_limit integer := least(greatest(coalesce(p_limit, 24), 1), 60);
  v_offset integer := least(greatest(coalesce(p_offset, 0), 0), 10000);
begin
  if p_tenant_id is null then
    return;
  end if;
  begin
    v_province := nullif(f ->> 'province', '')::uuid;
  exception when invalid_text_representation then
    v_province := null;
  end;
  begin
    v_district := nullif(f ->> 'district', '')::uuid;
  exception when invalid_text_representation then
    v_district := null;
  end;
  begin
    v_neighborhood := nullif(f ->> 'neighborhood', '')::uuid;
  exception when invalid_text_representation then
    v_neighborhood := null;
  end;
  if v_q is not null then
    v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  return query
  with base as (
    select
      p.id,
      p.list_price,
      coalesce(p.published_at, p.created_at) as fresh_at,
      coalesce(public.vitrin_json_number(p.features -> 'gross_sqm'), public.vitrin_json_number(p.features -> 'sqm')) as sqm,
      public.vitrin_json_number(p.features -> 'floor') as floor_no,
      public.vitrin_json_number(p.features -> 'total_floors') as total_floors,
      public.vitrin_json_number(p.features -> 'building_age') as building_age,
      exists (select 1 from public.property_media m where m.property_id = p.id and m.kind = 'image') as has_cover,
      p.features
    from public.properties p
    where p.tenant_id = p_tenant_id
      and p.status = 'live'
      and p.deleted_at is null
      and p.is_sample = false
      and coalesce(p.features ->> 'closed_listing', '') <> 'true'
      and (
        v_tx is null
        or (v_tx = 'kiralik') = (
          lower(coalesce(p.transaction_type, '')) like '%kira%' or lower(coalesce(p.transaction_type, '')) = 'rent'
        )
      )
      and (v_min is null or p.list_price >= v_min)
      and (v_max is null or p.list_price <= v_max)
      and (v_rooms is null or p.features ->> 'rooms' = v_rooms)
      and (v_type is null or p.property_type = v_type)
      and (v_province is null or p.province_id = v_province)
      and (v_district is null or p.district_id = v_district)
      and (v_neighborhood is null or p.neighborhood_id = v_neighborhood)
      and (not v_furnished or p.features ->> 'furnished' = 'Eşyalı')
      and (not v_in_site or p.features ->> 'in_site' in ('true', 'yes', 'Evet'))
      and (not v_credit or p.features ->> 'credit_eligible' in ('true', 'yes', 'Evet'))
      and (
        v_like is null
        or p.title ilike v_like
        or p.property_code ilike v_like
        or exists (select 1 from public.geo_districts d where d.id = p.district_id and d.name ilike v_like)
        or exists (select 1 from public.geo_neighborhoods n where n.id = p.neighborhood_id and n.name ilike v_like)
      )
  ),
  filtered as (
    select b.*
    from base b
    where (v_sqm_min is null or b.sqm >= v_sqm_min)
      and (v_sqm_max is null or b.sqm <= v_sqm_max)
      and (v_age_max is null or b.building_age <= v_age_max)
      and (
        v_floor is null
        or (v_floor = 'giris' and b.floor_no = 0)
        or (v_floor = 'zemin-ustu' and b.floor_no >= 1)
        or (v_floor = 'ara' and b.floor_no >= 1 and (b.total_floors is null or b.floor_no < b.total_floors))
        or (v_floor = 'en-ust' and b.floor_no >= 1 and b.total_floors is not null and b.floor_no >= b.total_floors)
      )
  )
  select x.id, count(*) over () as total
  from filtered x
  order by
    case when v_sort = 'fiyat-artan' then x.list_price end asc nulls last,
    case when v_sort = 'fiyat-azalan' then x.list_price end desc nulls last,
    case when v_sort = 'm2-fiyat' then x.list_price / nullif(x.sqm, 0) end asc nulls last,
    case when v_sort = '' then x.has_cover end desc,
    x.fresh_at desc,
    x.id
  limit v_limit
  offset v_offset;
end;
$$;

create or replace function public.vitrin_listing_facets(p_tenant_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with live as (
    select p.features, p.property_type, p.province_id, p.district_id, p.neighborhood_id
    from public.properties p
    where p.tenant_id = p_tenant_id
      and p.status = 'live'
      and p.deleted_at is null
      and p.is_sample = false
      and coalesce(p.features ->> 'closed_listing', '') <> 'true'
  )
  select jsonb_build_object(
    'rooms', coalesce((
      select jsonb_agg(r.v order by r.v)
      from (select distinct l.features ->> 'rooms' as v from live l where nullif(l.features ->> 'rooms', '') is not null) r
    ), '[]'::jsonb),
    'types', coalesce((
      select jsonb_agg(t.v order by t.v)
      from (select distinct l.property_type as v from live l where nullif(l.property_type, '') is not null) t
    ), '[]'::jsonb),
    'provinces', coalesce((
      select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'count', c.n) order by g.name)
      from (select l.province_id, count(*) as n from live l where l.province_id is not null group by l.province_id) c
      join public.geo_provinces g on g.id = c.province_id
    ), '[]'::jsonb),
    'districts', coalesce((
      select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'provinceId', g.province_id, 'count', c.n) order by g.name)
      from (select l.district_id, count(*) as n from live l where l.district_id is not null group by l.district_id) c
      join public.geo_districts g on g.id = c.district_id
    ), '[]'::jsonb),
    'neighborhoods', coalesce((
      select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'districtId', g.district_id, 'count', c.n) order by g.name)
      from (select l.neighborhood_id, count(*) as n from live l where l.neighborhood_id is not null group by l.neighborhood_id) c
      join public.geo_neighborhoods g on g.id = c.neighborhood_id
    ), '[]'::jsonb)
  )
$$;

revoke all on function public.vitrin_json_number(jsonb) from public, anon, authenticated;
revoke all on function public.vitrin_listing_search(uuid, jsonb, integer, integer) from public, anon, authenticated;
revoke all on function public.vitrin_listing_facets(uuid) from public, anon, authenticated;
grant execute on function public.vitrin_json_number(jsonb) to service_role;
grant execute on function public.vitrin_listing_search(uuid, jsonb, integer, integer) to service_role;
grant execute on function public.vitrin_listing_facets(uuid) to service_role;

comment on function public.vitrin_listing_search(uuid, jsonb, integer, integer) is
  'PUB-1/PUB-2: herkese acik vitrin listesi (sunucu suzgeci + gercek sayfalama). Yalniz service_role.';
comment on function public.vitrin_listing_facets(uuid) is
  'PUB-2: vitrin suzgec secenekleri (oda, tur, il/ilce/mahalle) yayindaki ilanlarin tam kumesinden. Yalniz service_role.';
