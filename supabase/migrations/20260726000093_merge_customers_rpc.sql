-- Müşteri birleştirme — TEK TRANSACTION (X6 çift kayıt sihirbazı, RPC)
--
-- Önceki durum: mergeCustomers server action'ı taşımaları JS'ten tek tek
-- yapıyordu ("önce taşı, hata varsa silme" sırası riski azaltıyor ama atomik
-- değil — yarıda kalırsa alt kayıtlar iki müşteri arasında bölünmüş kalır).
-- Bu fonksiyon aynı akışın TAMAMINI tek plpgsql gövdesinde (dolayısıyla tek
-- transaction'da) yapar: ya hepsi ya hiçbiri.
--
-- Kapsam (src/app/actions/customers.ts'teki listeyle birebir):
--   Düz taşıma (customer_id → primary): customer_demands, calls, appointments,
--     offers, contracts, deals, tasks, communications, customer_files,
--     payment_links, customer_portal_tokens
--   Benzersiz kısıtlılar (çakışmayanları taşı, çakışan soft-delete'li
--     duplicate üzerinde kalır):
--     iys_consents          unique(tenant_id, customer_id, channel)
--     portal_match_feedback unique(customer_id, property_id)
--     lost_sale_dismissals  unique(tenant_id, customer_id)
--   share_links: entity_type='customer' satırlarında entity_id → primary
--   Ana kayıtta boş alan doldurma (ana doluysa dokunulmaz; donör = en eski
--     duplicate): phone, email, notes, source, birth_date, anniversary_date,
--     anniversary_note, province_id, district_id, branch_id;
--     customer_types/tags birleşimi (distinct).
--   Duplicate'ler: deleted_at + notlara birleştirme izi.
--   audit_logs: tek 'customer.merge' kaydı.
--
-- Bilinçli olarak taşınmayanlar (JS ile aynı gerekçe):
--   kvkk_erasure_log (tarihsel denetim, FK'sız) ve
--   open_house_visitors.created_customer_id (kaynak istatistiği bağı).
--
-- GÜVENLİK: SECURITY DEFINER + RLS yok → tenant parametresi fonksiyon içinde
-- her kaydın aidiyetiyle doğrulanır (değilse RAISE). Çağırma hakkı YALNIZ
-- service_role: authenticated'a açılırsa herhangi bir kullanıcı p_tenant_id
-- uydurarak başka ofisin verisini birleştirebilirdi. Yetki kapısı
-- (requirePermission) server action'da kalır.

create or replace function public.merge_customers(
  p_tenant_id  uuid,
  p_primary    uuid,
  p_duplicates uuid[],
  p_actor      uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare
  v_primary     public.customers%rowtype;
  v_dup_count   integer;
  v_table       text;
  v_n           integer;
  v_moved       jsonb := '{}'::jsonb;
  v_moved_total integer := 0;
  v_filled      text[] := '{}'::text[];
  v_txt         text;
  v_date        date;
  v_uuid        uuid;
  v_types       text[];
  v_tags        text[];
  v_label       text;
  v_trail       text;
  v_dups_json   jsonb;
begin
  -- ── Parametre doğrulama ───────────────────────────────────────────────
  if p_tenant_id is null or p_primary is null then
    raise exception 'Eksik parametre.';
  end if;
  if p_duplicates is null or cardinality(p_duplicates) = 0 then
    raise exception 'Birleştirilecek kayıt seçilmedi.';
  end if;
  if cardinality(p_duplicates) > 10 then
    raise exception 'Tek seferde en fazla 10 kayıt birleştirilebilir.';
  end if;
  if p_primary = any(p_duplicates) then
    raise exception 'Ana kayıt duplicate listesinde olamaz.';
  end if;

  -- ── Aidiyet doğrulama (SECURITY DEFINER → RLS yok, bu kontrol ŞART) ──
  select * into v_primary
  from public.customers
  where id = p_primary and tenant_id = p_tenant_id and deleted_at is null;
  if not found then
    raise exception 'Ana kayıt bulunamadı, silinmiş veya bu ofise ait değil.';
  end if;

  select count(distinct d.id) into v_dup_count
  from public.customers d
  where d.id = any(p_duplicates) and d.tenant_id = p_tenant_id and d.deleted_at is null;
  if v_dup_count <> (select count(distinct u) from unnest(p_duplicates) u) then
    raise exception 'Kayıtlardan bazıları bulunamadı, silinmiş veya bu ofise ait değil.';
  end if;

  -- Audit için duplicate kimlikleri (soft delete'ten ÖNCE fotoğrafla)
  select jsonb_agg(jsonb_build_object(
           'id', d.id, 'full_name', d.full_name, 'phone', d.phone, 'email', d.email))
    into v_dups_json
  from public.customers d
  where d.id = any(p_duplicates) and d.tenant_id = p_tenant_id;

  -- ── 1) Düz taşıma: customer_id → primary ─────────────────────────────
  foreach v_table in array array[
    'customer_demands', 'calls', 'appointments', 'offers', 'contracts',
    'deals', 'tasks', 'communications', 'customer_files', 'payment_links',
    'customer_portal_tokens'
  ] loop
    execute format(
      'update public.%I set customer_id = $1 where customer_id = any($2) and tenant_id = $3',
      v_table
    ) using p_primary, p_duplicates, p_tenant_id;
    get diagnostics v_n = row_count;
    if v_n > 0 then
      v_moved := v_moved || jsonb_build_object(v_table, v_n);
      v_moved_total := v_moved_total + v_n;
    end if;
  end loop;

  -- ── 2) Benzersiz kısıtlılar: çakışmayanları taşı ─────────────────────
  -- iys_consents — unique(tenant_id, customer_id, channel). Kanal başına tek
  -- satır taşınır (duplicate'ler arasında da tekilleştir), ana kayıtta o
  -- kanal zaten varsa satır duplicate üzerinde kalır.
  update public.iys_consents s
  set customer_id = p_primary
  where s.id in (
    select distinct on (d.channel) d.id
    from public.iys_consents d
    where d.customer_id = any(p_duplicates)
      and d.tenant_id = p_tenant_id
      and not exists (
        select 1 from public.iys_consents p
        where p.tenant_id = p_tenant_id
          and p.customer_id = p_primary
          and p.channel = d.channel
      )
    order by d.channel, d.id
  );
  get diagnostics v_n = row_count;
  if v_n > 0 then
    v_moved := v_moved || jsonb_build_object('iys_consents', v_n);
    v_moved_total := v_moved_total + v_n;
  end if;

  -- portal_match_feedback — unique(customer_id, property_id)
  update public.portal_match_feedback s
  set customer_id = p_primary
  where s.id in (
    select distinct on (d.property_id) d.id
    from public.portal_match_feedback d
    where d.customer_id = any(p_duplicates)
      and d.tenant_id = p_tenant_id
      and not exists (
        select 1 from public.portal_match_feedback p
        where p.tenant_id = p_tenant_id
          and p.customer_id = p_primary
          and p.property_id = d.property_id
      )
    order by d.property_id, d.id
  );
  get diagnostics v_n = row_count;
  if v_n > 0 then
    v_moved := v_moved || jsonb_build_object('portal_match_feedback', v_n);
    v_moved_total := v_moved_total + v_n;
  end if;

  -- lost_sale_dismissals — unique(tenant_id, customer_id): en fazla 1 satır,
  -- o da ancak ana kayıtta hiç yoksa.
  update public.lost_sale_dismissals s
  set customer_id = p_primary
  where s.id = (
    select d.id
    from public.lost_sale_dismissals d
    where d.customer_id = any(p_duplicates)
      and d.tenant_id = p_tenant_id
      and not exists (
        select 1 from public.lost_sale_dismissals p
        where p.tenant_id = p_tenant_id and p.customer_id = p_primary
      )
    order by d.id
    limit 1
  );
  get diagnostics v_n = row_count;
  if v_n > 0 then
    v_moved := v_moved || jsonb_build_object('lost_sale_dismissals', v_n);
    v_moved_total := v_moved_total + v_n;
  end if;

  -- ── 3) share_links: müşteri tipli paylaşımlar entity_id ile bağlı ────
  update public.share_links
  set entity_id = p_primary
  where entity_type = 'customer'
    and entity_id = any(p_duplicates)
    and tenant_id = p_tenant_id;
  get diagnostics v_n = row_count;
  if v_n > 0 then
    v_moved := v_moved || jsonb_build_object('share_links', v_n);
    v_moved_total := v_moved_total + v_n;
  end if;

  -- ── 4) Ana kayıtta boş alanları doldur (donör: en eski duplicate) ────
  -- Metin alanları: JS'teki truthy kontrolüyle aynı — boş string de "boş".
  if nullif(btrim(coalesce(v_primary.phone, '')), '') is null then
    select d.phone into v_txt from public.customers d
    where d.id = any(p_duplicates) and d.tenant_id = p_tenant_id
      and nullif(btrim(coalesce(d.phone, '')), '') is not null
    order by d.created_at limit 1;
    if found then v_primary.phone := v_txt; v_filled := v_filled || 'Telefon'; end if;
  end if;

  if nullif(btrim(coalesce(v_primary.email, '')), '') is null then
    select d.email into v_txt from public.customers d
    where d.id = any(p_duplicates) and d.tenant_id = p_tenant_id
      and nullif(btrim(coalesce(d.email, '')), '') is not null
    order by d.created_at limit 1;
    if found then v_primary.email := v_txt; v_filled := v_filled || 'E-posta'; end if;
  end if;

  if nullif(btrim(coalesce(v_primary.notes, '')), '') is null then
    select d.notes into v_txt from public.customers d
    where d.id = any(p_duplicates) and d.tenant_id = p_tenant_id
      and nullif(btrim(coalesce(d.notes, '')), '') is not null
    order by d.created_at limit 1;
    if found then v_primary.notes := v_txt; v_filled := v_filled || 'Notlar'; end if;
  end if;

  if nullif(btrim(coalesce(v_primary.source, '')), '') is null then
    select d.source into v_txt from public.customers d
    where d.id = any(p_duplicates) and d.tenant_id = p_tenant_id
      and nullif(btrim(coalesce(d.source, '')), '') is not null
    order by d.created_at limit 1;
    if found then v_primary.source := v_txt; v_filled := v_filled || 'Kaynak'; end if;
  end if;

  if v_primary.birth_date is null then
    select d.birth_date into v_date from public.customers d
    where d.id = any(p_duplicates) and d.tenant_id = p_tenant_id and d.birth_date is not null
    order by d.created_at limit 1;
    if found then v_primary.birth_date := v_date; v_filled := v_filled || 'Doğum tarihi'; end if;
  end if;

  if v_primary.anniversary_date is null then
    select d.anniversary_date into v_date from public.customers d
    where d.id = any(p_duplicates) and d.tenant_id = p_tenant_id and d.anniversary_date is not null
    order by d.created_at limit 1;
    if found then v_primary.anniversary_date := v_date; v_filled := v_filled || 'Yıldönümü'; end if;
  end if;

  if nullif(btrim(coalesce(v_primary.anniversary_note, '')), '') is null then
    select d.anniversary_note into v_txt from public.customers d
    where d.id = any(p_duplicates) and d.tenant_id = p_tenant_id
      and nullif(btrim(coalesce(d.anniversary_note, '')), '') is not null
    order by d.created_at limit 1;
    if found then v_primary.anniversary_note := v_txt; v_filled := v_filled || 'Yıldönümü notu'; end if;
  end if;

  if v_primary.province_id is null then
    select d.province_id into v_uuid from public.customers d
    where d.id = any(p_duplicates) and d.tenant_id = p_tenant_id and d.province_id is not null
    order by d.created_at limit 1;
    if found then v_primary.province_id := v_uuid; v_filled := v_filled || 'İl bilgisi'; end if;
  end if;

  if v_primary.district_id is null then
    select d.district_id into v_uuid from public.customers d
    where d.id = any(p_duplicates) and d.tenant_id = p_tenant_id and d.district_id is not null
    order by d.created_at limit 1;
    if found then v_primary.district_id := v_uuid; v_filled := v_filled || 'İlçe bilgisi'; end if;
  end if;

  if v_primary.branch_id is null then
    select d.branch_id into v_uuid from public.customers d
    where d.id = any(p_duplicates) and d.tenant_id = p_tenant_id and d.branch_id is not null
    order by d.created_at limit 1;
    if found then v_primary.branch_id := v_uuid; v_filled := v_filled || 'Şube bilgisi'; end if;
  end if;

  -- customer_types / tags birleşimi (distinct)
  select coalesce(array_agg(distinct t.val), '{}'::text[]) into v_types
  from (
    select unnest(coalesce(v_primary.customer_types, '{}'::text[])) as val
    union
    select unnest(d.customer_types)
    from public.customers d
    where d.id = any(p_duplicates) and d.tenant_id = p_tenant_id
  ) t;
  if cardinality(v_types) > cardinality(coalesce(v_primary.customer_types, '{}'::text[])) then
    v_primary.customer_types := v_types;
    v_filled := v_filled || 'Müşteri tipi';
  end if;

  select coalesce(array_agg(distinct t.val), '{}'::text[]) into v_tags
  from (
    select unnest(coalesce(v_primary.tags, '{}'::text[])) as val
    union
    select unnest(d.tags)
    from public.customers d
    where d.id = any(p_duplicates) and d.tenant_id = p_tenant_id
  ) t;
  if cardinality(v_tags) > cardinality(coalesce(v_primary.tags, '{}'::text[])) then
    v_primary.tags := v_tags;
    v_filled := v_filled || 'Etiketler';
  end if;

  update public.customers set
    phone            = v_primary.phone,
    email            = v_primary.email,
    notes            = v_primary.notes,
    source           = v_primary.source,
    birth_date       = v_primary.birth_date,
    anniversary_date = v_primary.anniversary_date,
    anniversary_note = v_primary.anniversary_note,
    province_id      = v_primary.province_id,
    district_id      = v_primary.district_id,
    branch_id        = v_primary.branch_id,
    customer_types   = v_primary.customer_types,
    tags             = v_primary.tags,
    updated_at       = now()
  where id = p_primary and tenant_id = p_tenant_id;

  -- ── 5) Duplicate'leri soft delete + not izi ──────────────────────────
  v_label := coalesce(nullif(btrim(coalesce(v_primary.full_name, '')), ''), p_primary::text);
  v_trail := '→ ' || v_label || ' (' || p_primary::text || ') ile birleştirildi — '
             || to_char(now(), 'DD.MM.YYYY');
  update public.customers set
    deleted_at = now(),
    notes = case
      when nullif(btrim(coalesce(notes, '')), '') is null then v_trail
      else notes || E'\n\n' || v_trail
    end,
    updated_at = now()
  where id = any(p_duplicates) and tenant_id = p_tenant_id;

  -- ── 6) Tek audit kaydı ───────────────────────────────────────────────
  insert into public.audit_logs
    (tenant_id, actor_id, action, entity_type, entity_id, old_value, new_value)
  values (
    p_tenant_id, p_actor, 'customer.merge', 'customer', p_primary,
    jsonb_build_object('duplicates', coalesce(v_dups_json, '[]'::jsonb)),
    jsonb_build_object(
      'primary_id',      p_primary,
      'primary_name',    v_label,
      'moved',           v_moved,
      'moved_total',     v_moved_total,
      'filled_fields',   to_jsonb(v_filled),
      'duplicate_count', v_dup_count,
      'via',             'rpc'
    )
  );

  return jsonb_build_object(
    'ok', true,
    'moved', v_moved,
    'moved_total', v_moved_total,
    'deleted_count', v_dup_count,
    'filled_fields', to_jsonb(v_filled)
  );
end;
$$;

comment on function public.merge_customers(uuid, uuid, uuid[], uuid) is
  'Musteri birlestirme — tum tasima/doldurma/soft-delete/audit TEK transaction. '
  'SECURITY DEFINER + RLS yok: tenant aidiyeti govdede dogrulanir, cagirma hakki YALNIZ service_role.';

-- RLS'siz DEFINER fonksiyonu: authenticated/anon KESİNLİKLE çağıramaz.
revoke all on function public.merge_customers(uuid, uuid, uuid[], uuid) from public;
revoke all on function public.merge_customers(uuid, uuid, uuid[], uuid) from anon;
revoke all on function public.merge_customers(uuid, uuid, uuid[], uuid) from authenticated;
grant execute on function public.merge_customers(uuid, uuid, uuid[], uuid) to service_role;
