-- MIGRATION 20261020010004_merge_customers_contacts.sql
-- UYGULANMADI: yalniz restore edilebilir yedek dogrulandiktan sonra SAHIBI uygular (`npm run db:migrate`).
-- KOD YAYININDAN ONCE ya da SONRA uygulanabilir (imza ve donus anahtarlari ayni; yalniz ek anahtar 'contacts_added').
-- Geri alma: supabase/rollbacks/20261020010004_merge_customers_contacts.rollback.sql (v2 govdesi aynen geri kurulur).
-- BAGIMLILIK: 20261018010000 (merge_fk_refs, merge_customers v2), 20261020010000 (customer_contacts),
--   20261020010001 (customer_relations). Bu uc dosya AYNI pencerede ve bu sirayla uygulanir.
--
-- NE (CRM-G7/G8 birlestirme entegrasyonu; merge_customers v3, imza AYNI):
--   * Kopyanin/ana kaydin FARKLI telefon ve e-postasi artik nota "[birlestirme] ek telefon" satiri olarak DEGIL, ana
--     kaydin ek iletisim bilgisi (customer_contacts) olarak yazilir: arama, mukerrer kontrolu ve Ara/WhatsApp secicisi
--     bu numaralari gorur. Kopyanin kendi ek numaralari merge_fk_refs ile tasinir (cakisan deger kopyada kalir);
--     ana kaydin birincil degeriyle ayni olan ek kayit silinir.
--   * Iliskili kisiler: sirasiz cift benzersizligi ifade indeksi oldugu icin merge_fk_refs yerine satir satir tasinir;
--     birlesen kayitlarin kendi aralarindaki iliski ve ana kayitta zaten olan cift silinir.
--   * Kopya notlari, alan secimi, bos alan doldurma, soft-delete ve audit v2 ile ayni.
-- GUVENLIK: SECURITY DEFINER + search_path '' ; YALNIZ service_role (yetki kapisi server action'da), tenant aidiyeti
--   govdede RAISE ile (v2 ile ayni).
set local lock_timeout = '5s';

create or replace function public.merge_customers(
  p_tenant_id  uuid,
  p_primary    uuid,
  p_duplicates uuid[],
  p_actor      uuid,
  p_overrides  jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_primary     public.customers%rowtype;
  v_final       public.customers%rowtype;
  v_dup_count   integer;
  v_refs        jsonb;
  v_moved       jsonb;
  v_moved_total integer := 0;
  v_filled      text[] := '{}'::text[];
  v_overridden  text[] := '{}'::text[];
  v_key         text;
  v_src         uuid;
  v_col         text;
  v_label       text;
  v_n           integer;
  v_cnt         integer;
  v_types       text[];
  v_tags        text[];
  v_lines       text[] := '{}'::text[];
  v_stamp       text := to_char(now() at time zone 'Europe/Istanbul', 'DD.MM.YYYY');
  v_trail       text;
  v_dups_json   jsonb;
  d             record;
  r             record;
  v_rel_moved   integer := 0;
  v_rel_dropped integer := 0;
  v_contacts    integer := 0;
  v_allowed     constant text[] := array['full_name', 'phone', 'email', 'assigned_to', 'branch_id'];
  v_fill        constant text[][] := array[
    array['phone', 'Telefon'], array['email', 'E-posta'], array['source', 'Kaynak'],
    array['birth_date', 'Doğum tarihi'], array['anniversary_date', 'Yıldönümü'],
    array['anniversary_note', 'Yıldönümü notu'], array['province_id', 'İl bilgisi'],
    array['district_id', 'İlçe bilgisi'], array['branch_id', 'Şube bilgisi'], array['assigned_to', 'Danışman']
  ];
begin
  -- ── Parametre doğrulama ─────────────────────────────────────────────
  if p_tenant_id is null or p_primary is null then
    raise exception 'Eksik parametre.';
  end if;
  if p_duplicates is null or cardinality(p_duplicates) = 0 then
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

  -- ── Aidiyet doğrulama + kilit (SECURITY DEFINER → RLS yok, bu kontrol ŞART) ──
  select * into v_primary
  from public.customers
  where id = p_primary and tenant_id = p_tenant_id and deleted_at is null
  for update;
  if not found then
    raise exception 'Ana kayıt bulunamadı, silinmiş veya bu ofise ait değil.';
  end if;

  perform 1 from public.customers
  where id = any (p_duplicates) and tenant_id = p_tenant_id and deleted_at is null
  for update;
  select count(distinct c.id) into v_dup_count
  from public.customers c
  where c.id = any (p_duplicates) and c.tenant_id = p_tenant_id and c.deleted_at is null;
  if v_dup_count <> (select count(distinct u) from pg_catalog.unnest(p_duplicates) u) then
    raise exception 'Kayıtlardan bazıları bulunamadı, silinmiş veya bu ofise ait değil.';
  end if;

  -- Audit için kopyaların fotoğrafı (soft delete'ten ÖNCE)
  select jsonb_agg(jsonb_build_object(
           'id', c.id, 'full_name', c.full_name, 'phone', c.phone, 'email', c.email,
           'assigned_to', c.assigned_to, 'notes', c.notes))
    into v_dups_json
  from public.customers c
  where c.id = any (p_duplicates) and c.tenant_id = p_tenant_id;

  -- ── 0) İlişkili kişiler (CRM-G8): sırasız çift benzersizliği ifade indeksidir (merge_fk_refs göremez) → burada satır
  --       satır taşınır. Birleşen kayıtların KENDİ aralarındaki ilişki (kendine ilişki olurdu) ve ana kayıtta zaten olan
  --       çift silinir; diğerleri ana kayda geçer.
  for r in
    select cr.id from public.customer_relations cr
    where cr.tenant_id = p_tenant_id
      and (cr.customer_id = any (p_duplicates) or cr.related_customer_id = any (p_duplicates))
    order by cr.created_at, cr.id
  loop
    begin
      update public.customer_relations set
        customer_id = case when customer_id = any (p_duplicates) then p_primary else customer_id end,
        related_customer_id = case when related_customer_id = any (p_duplicates) then p_primary else related_customer_id end
      where id = r.id;
      v_rel_moved := v_rel_moved + 1;
    exception when unique_violation or check_violation then
      delete from public.customer_relations where id = r.id;
      v_rel_dropped := v_rel_dropped + 1;
    end;
  end loop;

  -- ── 1) Bağlı kayıtlar: customers(id)'ye FK veren TÜM tablolar + share_links ──
  --       (customer_contacts benzersiz anahtarlı: ana kayıtta aynı değer varsa kopyada kalır)
  v_refs := public.merge_fk_refs('customers', p_tenant_id, p_primary, p_duplicates, '{}'::text[], false);
  v_moved := coalesce(v_refs -> 'moved', '{}'::jsonb);
  if v_rel_moved > 0 then
    v_moved := v_moved || jsonb_build_object('customer_relations.customer_id', v_rel_moved);
  end if;
  select coalesce(sum(value::int), 0) into v_moved_total from jsonb_each_text(v_moved);

  -- ── 2) Alan seçimi (p_overrides: alan -> kaynak kayıt id) ───────────
  for v_key, v_label in select key, value from jsonb_each_text(coalesce(p_overrides, '{}'::jsonb)) loop
    if not (v_key = any (v_allowed)) then
      raise exception 'Bu alan seçilemez: %', v_key;
    end if;
    begin
      v_src := v_label::uuid;
    exception when others then
      raise exception 'Geçersiz alan seçimi.';
    end;
    if v_src = p_primary then
      continue;
    end if;
    if not (v_src = any (p_duplicates)) then
      raise exception 'Alan seçimi yalnız birleştirilen kayıtlardan yapılabilir.';
    end if;
    execute pg_catalog.format(
      'update public.customers p set %1$I = s.%1$I from public.customers s '
      'where p.id = $1 and p.tenant_id = $3 and s.id = $2 and s.tenant_id = $3 and p.%1$I is distinct from s.%1$I',
      v_key
    ) using p_primary, v_src, p_tenant_id;
    get diagnostics v_n = row_count;
    if v_n > 0 then
      v_overridden := v_overridden || v_key;
    end if;
  end loop;

  -- ── 3) Ana kayıtta boş alanları doldur (donör: en eski kopya) ──────
  for v_n in 1 .. array_length(v_fill, 1) loop
    v_col := v_fill[v_n][1];
    execute pg_catalog.format(
      'update public.customers p set %1$I = d.v from ('
      '  select c.%1$I as v from public.customers c'
      '  where c.id = any ($2) and c.tenant_id = $3 and coalesce(btrim(c.%1$I::text), '''') <> '''''
      '  order by c.created_at limit 1'
      ') d where p.id = $1 and p.tenant_id = $3 and coalesce(btrim(p.%1$I::text), '''') = ''''',
      v_col
    ) using p_primary, p_duplicates, p_tenant_id;
    get diagnostics v_cnt = row_count;
    if v_cnt > 0 then
      v_filled := v_filled || v_fill[v_n][2];
    end if;
  end loop;

  -- customer_types / tags birleşimi (distinct)
  select coalesce(array_agg(distinct t.val order by t.val), '{}'::text[]) into v_types
  from (
    select pg_catalog.unnest(coalesce(v_primary.customer_types, '{}'::text[])) as val
    union
    select pg_catalog.unnest(c.customer_types) from public.customers c
    where c.id = any (p_duplicates) and c.tenant_id = p_tenant_id
  ) t;
  if cardinality(v_types) > cardinality(coalesce(v_primary.customer_types, '{}'::text[])) then
    update public.customers set customer_types = v_types where id = p_primary and tenant_id = p_tenant_id;
    v_filled := array_append(v_filled, 'Müşteri tipi'::text);
  end if;

  select coalesce(array_agg(distinct t.val order by t.val), '{}'::text[]) into v_tags
  from (
    select pg_catalog.unnest(coalesce(v_primary.tags, '{}'::text[])) as val
    union
    select pg_catalog.unnest(c.tags) from public.customers c
    where c.id = any (p_duplicates) and c.tenant_id = p_tenant_id
  ) t;
  if cardinality(v_tags) > cardinality(coalesce(v_primary.tags, '{}'::text[])) then
    update public.customers set tags = v_tags where id = p_primary and tenant_id = p_tenant_id;
    v_filled := array_append(v_filled, 'Etiketler'::text);
  end if;

  -- ── 4) Kaybolmasın (CRM-G7): farklı telefon/e-posta ana kaydın EK İLETİŞİM bilgisi olur (nota yazılmaz);
  --       kopya notları ana kaydın notuna eklenir.
  select * into v_final from public.customers where id = p_primary and tenant_id = p_tenant_id;

  for d in
    select distinct x.v from (
      select btrim(v_primary.phone) as v
      union all
      select btrim(c.phone) from public.customers c where c.id = any (p_duplicates) and c.tenant_id = p_tenant_id
    ) x
    where coalesce(x.v, '') <> '' and x.v is distinct from btrim(coalesce(v_final.phone, ''))
  loop
    insert into public.customer_contacts (tenant_id, customer_id, kind, value, label, created_by)
    values (p_tenant_id, p_primary, 'phone', d.v, case when d.v like '05%' then 'cep' else 'diger' end, p_actor)
    on conflict do nothing;
    get diagnostics v_n = row_count;
    v_contacts := v_contacts + v_n;
  end loop;

  for d in
    select distinct lower(x.v) as v from (
      select btrim(v_primary.email) as v
      union all
      select btrim(c.email) from public.customers c where c.id = any (p_duplicates) and c.tenant_id = p_tenant_id
    ) x
    where coalesce(x.v, '') <> '' and lower(x.v) is distinct from lower(btrim(coalesce(v_final.email, '')))
  loop
    insert into public.customer_contacts (tenant_id, customer_id, kind, value, label, created_by)
    values (p_tenant_id, p_primary, 'email', d.v, 'diger', p_actor)
    on conflict do nothing;
    get diagnostics v_n = row_count;
    v_contacts := v_contacts + v_n;
  end loop;

  -- Kopyadan taşınan ek bilgi ana kaydın birincil değeriyle aynıysa tekrar etmesin.
  delete from public.customer_contacts cc
  where cc.customer_id = p_primary and cc.tenant_id = p_tenant_id
    and (
      (cc.kind = 'phone' and cc.value = btrim(coalesce(v_final.phone, '')))
      or (cc.kind = 'email' and cc.value = lower(btrim(coalesce(v_final.email, ''))))
    );

  if v_contacts > 0 then
    v_filled := array_append(v_filled, 'Ek iletişim bilgisi'::text);
  end if;

  for d in
    select c.full_name, btrim(c.notes) as notes from public.customers c
    where c.id = any (p_duplicates) and c.tenant_id = p_tenant_id
      and coalesce(btrim(c.notes), '') <> ''
      and pg_catalog.strpos(coalesce(v_final.notes, ''), btrim(c.notes)) = 0
    order by c.created_at
  loop
    v_lines := v_lines || ('[birleştirme ' || v_stamp || ' — ' || coalesce(nullif(btrim(d.full_name), ''), 'kopya kayıt')
                           || '] ' || d.notes);
  end loop;

  if cardinality(v_lines) > 0 then
    update public.customers set
      notes = case
        when coalesce(btrim(notes), '') = '' then array_to_string(v_lines, E'\n')
        else notes || E'\n\n' || array_to_string(v_lines, E'\n')
      end
    where id = p_primary and tenant_id = p_tenant_id;
    v_filled := array_append(v_filled, 'Notlar'::text);
  end if;

  update public.customers set updated_at = now() where id = p_primary and tenant_id = p_tenant_id;

  -- ── 5) Kopyaları soft delete + not izi ─────────────────────────────
  select * into v_final from public.customers where id = p_primary and tenant_id = p_tenant_id;
  v_label := coalesce(nullif(btrim(coalesce(v_final.full_name, '')), ''), p_primary::text);
  v_trail := '→ ' || v_label || ' (' || p_primary::text || ') ile birleştirildi — ' || v_stamp;
  update public.customers set
    deleted_at = now(),
    notes = case
      when coalesce(btrim(notes), '') = '' then v_trail
      else notes || E'\n\n' || v_trail
    end,
    updated_at = now()
  where id = any (p_duplicates) and tenant_id = p_tenant_id;

  -- ── 6) Tek audit kaydı ─────────────────────────────────────────────
  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, old_value, new_value)
  values (
    p_tenant_id, p_actor, 'customer.merge', 'customer', p_primary,
    jsonb_build_object(
      'primary', jsonb_build_object('full_name', v_primary.full_name, 'phone', v_primary.phone,
                                    'email', v_primary.email, 'assigned_to', v_primary.assigned_to),
      'duplicates', coalesce(v_dups_json, '[]'::jsonb)
    ),
    jsonb_build_object(
      'primary_id',      p_primary,
      'primary_name',    v_label,
      'moved',           v_moved,
      'kept',            coalesce(v_refs -> 'kept', '{}'::jsonb),
      'moved_total',     v_moved_total,
      'filled_fields',   to_jsonb(v_filled),
      'overridden',      to_jsonb(v_overridden),
      'duplicate_count', v_dup_count,
      'contacts_added',  v_contacts,
      'relations',       jsonb_build_object('moved', v_rel_moved, 'dropped', v_rel_dropped),
      'via',             'rpc-v3'
    )
  );

  return jsonb_build_object(
    'ok', true,
    'moved', v_moved,
    'kept', coalesce(v_refs -> 'kept', '{}'::jsonb),
    'moved_total', v_moved_total,
    'deleted_count', v_dup_count,
    'filled_fields', to_jsonb(v_filled),
    'overridden', to_jsonb(v_overridden),
    'contacts_added', v_contacts
  );
end;
$$;

comment on function public.merge_customers(uuid, uuid, uuid[], uuid, jsonb) is
  'Musteri birlestirme v3 — TUM FK''ler (merge_fk_refs) + share_links + iliskili kisiler, alan secimi (p_overrides), farkli '
  'telefon/e-posta ana kaydin ek iletisim bilgisine (customer_contacts), kopya notlari ana kaydin notuna, soft-delete, audit; '
  'TEK transaction. YALNIZ service_role; tenant aidiyeti govdede.';

revoke all on function public.merge_customers(uuid, uuid, uuid[], uuid, jsonb) from public, anon, authenticated;
grant execute on function public.merge_customers(uuid, uuid, uuid[], uuid, jsonb) to service_role;
