-- Portföy birleştirme (veri kalitesi, araştırma #8): /app/portfoyler/cift-kayit sihirbazının yazma ucu.
--
-- Aynı mülkün iki kez girilmesi (portal aktarımı + elle giriş, iki danışman) fotoğrafı, portal bağlantılarını, randevu,
-- teklif, sunum ve fiyat geçmişini ikiye böler. merge_properties kopya portföylerdeki TÜM bağlı kayıtları
-- (properties(id)'ye FK veren her tablo — public.merge_fk_refs, 20261018010000) ana portföye taşır:
-- property_media, portal_listings, appointments, offers, deals, contracts, tasks, rentals, property_keys, fiyat/durum
-- geçmişi, EİDS kayıtları ... Benzersiz anahtarlı tablolarda (ör. property_control_state) ana kayıtta aynı anahtar
-- varsa satır kopyada kalır. share_links (entity_type='property') taşınır.
--   Medya: ana portföyün kapak fotoğrafı korunur (taşınan kapaklar düşer), taşınan medya sıralamada sona eklenir.
--   Alan seçimi (p_overrides: title | address_line | assigned_to | branch_id -> kaynak portföy id).
--   Boş alan doldurma (donör: en eski kopya): başlık, adres, ada/parsel, il/ilçe/mahalle, konum (lat/lng), şube,
--   danışman, mülk sahibi müşteri. features jsonb birleşir (ana kayıt anahtarları kazanır).
--   Kopyalar: deleted_at (soft delete). Tek audit kaydı 'property.merge'.
--
-- GÜVENLİK: SECURITY DEFINER + search_path ''. authenticated çağırır; oturum (auth.uid), ofis
-- (p_tenant_id = current_active_tenant_id()) ve properties:delete yetkisi gövdede doğrulanır; kayıt aidiyeti RAISE ile.
-- Fiyat (list_price) BİLEREK seçime ve doldurmaya açık değil: fiyat düşürme onay kapısını (20261007000800) atlamasın.
-- 20261018010000 SONRASI uygulanır (merge_fk_refs). KOD YAYININDAN ÖNCE uygulanır (yeni sayfa bu RPC'yi çağırır).

set local lock_timeout = '5s';

create or replace function public.merge_properties(
  p_tenant_id  uuid,
  p_primary    uuid,
  p_duplicates uuid[],
  p_overrides  jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid         uuid := auth.uid();
  v_primary     public.properties%rowtype;
  v_dup_count   integer;
  v_refs        jsonb;
  v_moved       jsonb;
  v_moved_total integer := 0;
  v_filled      text[] := '{}'::text[];
  v_overridden  text[] := '{}'::text[];
  v_key         text;
  v_val         text;
  v_src         uuid;
  v_col         text;
  v_i           integer;
  v_cnt         integer;
  v_media_ids   uuid[] := '{}'::uuid[];
  v_has_cover   boolean := false;
  v_max_sort    integer := 0;
  v_dups_json   jsonb;
  v_allowed     constant text[] := array['title', 'address_line', 'assigned_to', 'branch_id'];
  v_fill        constant text[][] := array[
    array['title', 'Başlık'], array['address_line', 'Adres'], array['parcel_block', 'Ada'],
    array['parcel_lot', 'Parsel'], array['province_id', 'İl'], array['district_id', 'İlçe'],
    array['neighborhood_id', 'Mahalle'], array['lat', 'Konum'], array['lng', 'Konum'],
    array['branch_id', 'Şube'], array['assigned_to', 'Danışman'], array['owner_customer_id', 'Mülk sahibi']
  ];
begin
  -- ── Kimlik ve yetki (DEFINER → RLS yok, bu kontroller ŞART) ────────
  if v_uid is null then
    raise exception 'Oturum gerekli.' using errcode = '42501';
  end if;
  if p_tenant_id is null or p_tenant_id is distinct from public.current_active_tenant_id() then
    raise exception 'Bu ofiste işlem yetkiniz yok.' using errcode = '42501';
  end if;
  if not public.has_effective_permission('properties', 'delete') then
    raise exception 'Portföy birleştirme yetkiniz yok.' using errcode = '42501';
  end if;

  -- ── Parametre doğrulama ─────────────────────────────────────────────
  if p_primary is null or p_duplicates is null or cardinality(p_duplicates) = 0 then
    raise exception 'Birleştirilecek kayıt seçilmedi.';
  end if;
  if cardinality(p_duplicates) > 10 then
    raise exception 'Tek seferde en fazla 10 kayıt birleştirilebilir.';
  end if;
  if p_primary = any (p_duplicates) then
    raise exception 'Ana kayıt kopya listesinde olamaz.';
  end if;
  if p_overrides is not null and jsonb_typeof(p_overrides) <> 'object' then
    raise exception 'Geçersiz alan seçimi.';
  end if;

  -- ── Aidiyet + kilit ─────────────────────────────────────────────────
  select * into v_primary from public.properties
  where id = p_primary and tenant_id = p_tenant_id and deleted_at is null
  for update;
  if not found then
    raise exception 'Ana portföy bulunamadı, silinmiş veya bu ofise ait değil.';
  end if;
  perform 1 from public.properties
  where id = any (p_duplicates) and tenant_id = p_tenant_id and deleted_at is null
  for update;
  select count(distinct p.id) into v_dup_count from public.properties p
  where p.id = any (p_duplicates) and p.tenant_id = p_tenant_id and p.deleted_at is null;
  if v_dup_count <> (select count(distinct u) from pg_catalog.unnest(p_duplicates) u) then
    raise exception 'Portföylerden bazıları bulunamadı, silinmiş veya bu ofise ait değil.';
  end if;

  select jsonb_agg(jsonb_build_object('id', p.id, 'property_code', p.property_code, 'title', p.title,
                                      'assigned_to', p.assigned_to, 'status', p.status))
    into v_dups_json
  from public.properties p where p.id = any (p_duplicates) and p.tenant_id = p_tenant_id;

  -- Medya: ana portföyün mevcut medyası (kapak + sıralama korunur)
  if pg_catalog.to_regclass('public.property_media') is not null then
    select coalesce(array_agg(m.id), '{}'::uuid[]), coalesce(bool_or(m.is_cover), false), coalesce(max(m.sort_order), 0)
      into v_media_ids, v_has_cover, v_max_sort
    from public.property_media m
    where m.property_id = p_primary and m.tenant_id = p_tenant_id;
  end if;

  -- ── 1) Bağlı kayıtlar: properties(id)'ye FK veren TÜM tablolar + share_links ──
  v_refs := public.merge_fk_refs('properties', p_tenant_id, p_primary, p_duplicates, '{}'::text[], false);
  v_moved := coalesce(v_refs -> 'moved', '{}'::jsonb);
  select coalesce(sum(value::int), 0) into v_moved_total from jsonb_each_text(v_moved);

  if pg_catalog.to_regclass('public.property_media') is not null then
    update public.property_media m set
      is_cover = case when v_has_cover then false else m.is_cover end,
      sort_order = m.sort_order + v_max_sort + 1
    where m.property_id = p_primary and m.tenant_id = p_tenant_id and not (m.id = any (v_media_ids));
    -- Ana kayıtta kapak yoksa taşınanlardan en fazla biri kapak kalır.
    if not v_has_cover then
      update public.property_media m set is_cover = false
      where m.property_id = p_primary and m.tenant_id = p_tenant_id and m.is_cover
        and m.id <> (
          select m2.id from public.property_media m2
          where m2.property_id = p_primary and m2.tenant_id = p_tenant_id and m2.is_cover
          order by m2.sort_order, m2.id limit 1
        );
    end if;
  end if;

  -- ── 2) Alan seçimi ──────────────────────────────────────────────────
  for v_key, v_val in select key, value from jsonb_each_text(coalesce(p_overrides, '{}'::jsonb)) loop
    if not (v_key = any (v_allowed)) then
      raise exception 'Bu alan seçilemez: %', v_key;
    end if;
    begin
      v_src := v_val::uuid;
    exception when others then
      raise exception 'Geçersiz alan seçimi.';
    end;
    if v_src = p_primary then
      continue;
    end if;
    if not (v_src = any (p_duplicates)) then
      raise exception 'Alan seçimi yalnız birleştirilen portföylerden yapılabilir.';
    end if;
    execute pg_catalog.format(
      'update public.properties p set %1$I = s.%1$I from public.properties s '
      'where p.id = $1 and p.tenant_id = $3 and s.id = $2 and s.tenant_id = $3 and p.%1$I is distinct from s.%1$I',
      v_key
    ) using p_primary, v_src, p_tenant_id;
    get diagnostics v_cnt = row_count;
    if v_cnt > 0 then
      v_overridden := v_overridden || v_key;
    end if;
  end loop;

  -- ── 3) Boş alanları doldur (donör: en eski kopya) ──────────────────
  for v_i in 1 .. array_length(v_fill, 1) loop
    v_col := v_fill[v_i][1];
    execute pg_catalog.format(
      'update public.properties p set %1$I = d.v from ('
      '  select c.%1$I as v from public.properties c'
      '  where c.id = any ($2) and c.tenant_id = $3 and coalesce(btrim(c.%1$I::text), '''') <> '''''
      '  order by c.created_at limit 1'
      ') d where p.id = $1 and p.tenant_id = $3 and coalesce(btrim(p.%1$I::text), '''') = ''''',
      v_col
    ) using p_primary, p_duplicates, p_tenant_id;
    get diagnostics v_cnt = row_count;
    if v_cnt > 0 and not (v_fill[v_i][2] = any (v_filled)) then
      v_filled := v_filled || v_fill[v_i][2];
    end if;
  end loop;

  -- features: kopyaların anahtarları eklenir, ana kaydınki kazanır
  update public.properties p set features = merged.f || coalesce(p.features, '{}'::jsonb)
  from (
    select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) as f
    from (
      select distinct on (kv.key) kv.key, kv.value
      from public.properties c
      cross join lateral jsonb_each(case when jsonb_typeof(c.features) = 'object' then c.features else '{}'::jsonb end) kv
      where c.id = any (p_duplicates) and c.tenant_id = p_tenant_id
      order by kv.key, c.created_at
    ) e
  ) merged
  where p.id = p_primary and p.tenant_id = p_tenant_id
    and (merged.f - array(select jsonb_object_keys(coalesce(p.features, '{}'::jsonb)))) <> '{}'::jsonb;
  get diagnostics v_cnt = row_count;
  if v_cnt > 0 then
    v_filled := v_filled || 'Özellikler'::text;
  end if;

  update public.properties set updated_at = now() where id = p_primary and tenant_id = p_tenant_id;

  -- ── 4) Kopyalar: soft delete ───────────────────────────────────────
  update public.properties set deleted_at = now(), updated_at = now()
  where id = any (p_duplicates) and tenant_id = p_tenant_id;

  -- ── 5) Tek audit kaydı ─────────────────────────────────────────────
  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, old_value, new_value)
  values (
    p_tenant_id, v_uid, 'property.merge', 'property', p_primary,
    jsonb_build_object(
      'primary', jsonb_build_object('property_code', v_primary.property_code, 'title', v_primary.title,
                                    'assigned_to', v_primary.assigned_to),
      'duplicates', coalesce(v_dups_json, '[]'::jsonb)
    ),
    jsonb_build_object(
      'primary_id', p_primary,
      'moved', v_moved,
      'kept', coalesce(v_refs -> 'kept', '{}'::jsonb),
      'moved_total', v_moved_total,
      'filled_fields', to_jsonb(v_filled),
      'overridden', to_jsonb(v_overridden),
      'duplicate_count', v_dup_count
    )
  );

  return jsonb_build_object(
    'ok', true,
    'moved', v_moved,
    'kept', coalesce(v_refs -> 'kept', '{}'::jsonb),
    'moved_total', v_moved_total,
    'deleted_count', v_dup_count,
    'filled_fields', to_jsonb(v_filled),
    'overridden', to_jsonb(v_overridden)
  );
end;
$$;

comment on function public.merge_properties(uuid, uuid, uuid[], jsonb) is
  'Portfoy birlestirme — TUM FK''ler (merge_fk_refs) + share_links, medya kapak/sira, alan secimi, bos alan doldurma, '
  'soft-delete, audit; TEK transaction. Oturum + ofis + properties:delete govdede dogrulanir.';

revoke all on function public.merge_properties(uuid, uuid, uuid[], jsonb) from public, anon;
grant execute on function public.merge_properties(uuid, uuid, uuid[], jsonb) to authenticated, service_role;
