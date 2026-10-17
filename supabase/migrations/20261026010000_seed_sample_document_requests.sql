-- MIGRATION 20261026010000_seed_sample_document_requests.sql
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI kontrollu `npm run db:migrate` ile uygular.
-- Geri alma: supabase/rollbacks/20261026010000_seed_sample_document_requests.rollback.sql
-- BAGIMLILIK: 20260821000300_document_requests + 20260824001200 (yazma kapsami), 20261024020000 (sample_seed_guard).
--
-- NEDEN: ornek veri tohumu (src/lib/sample-data/records-seed.ts; scripts/seed-demo.ts ve ofis bazli "Demo veriyle basla")
--   service_role ile document_requests'e INSERT yapiyordu; service_role'un bu tabloda INSERT yetkisi BILEREK yok
--   (20261012002100: yalniz UPDATE; oturumlu kullanici RLS kapsamli createDocumentRequest action'i ile ekler) ->
--   "permission denied for table document_requests". Genis INSERT yetkisi VERMEK yerine dar bir tohum fonksiyonu.
--
-- SOZLESME: public.seed_sample_document_requests(p_tenant uuid, p_rows jsonb) returns jsonb
--   - Yalniz service_role (EXECUTE + govdede JWT rolu); digerleri 42501.
--   - Yalniz (a) genel demo ofisi (slug demo-ofis) ya da (b) demo modundaki ofis: sample_seed_guard(p_tenant).allowed
--     (gercek kayit yok + real_use_at bos ya da super admin izni gecerli; kilit kurali TEK yerde). Aksi 42501 sample_seed_locked.
--   - is_sample: demo-ofis'te satirdaki deger (records-seed `sample:false` -> false); diger ofiste HER ZAMAN true.
--   - p_rows: [{customer_id, property_id, title, requested_types[], max_files, status, expires_at, revoked_at, completed_at,
--     last_opened_at, created_by, created_at, is_sample?, files: [{doc_type, file_name, file_size, mime_type, storage_path,
--     created_at, verified_at}]}]. Musteri/portfoy/olusturan bu ofise ait degilse NULL yazilir. file_count = dosya sayisi.
--     Dosya storage_path YALNIZ 'kayit-bilgisi:' (METADATA_ONLY_FILE_PREFIX) ile baslar (depoda nesne yok); dosya durumu verified.
--   - token_hash fonksiyon icinde uretilir (createDocumentRequest gibi: rastgele ham token'in SHA-256 ozeti, hex 64);
--     ham token hicbir yerde saklanmaz/donmez.
--   - IDEMPOTENT: ofiste (demo-ofis disinda is_sample=true) evrak talebi varsa hicbir sey yazmaz {skipped: true}.
--   - Donus: {requests, files, skipped}.
-- ETKI: yalniz yeni fonksiyon; tablo yetkileri DEGISMEZ.

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.document_requests') is null or pg_catalog.to_regclass('public.document_request_files') is null then
    raise exception '20261026010000: document_requests yok; once 20260821000300 uygulanmali.';
  end if;
  if pg_catalog.to_regprocedure('public.sample_seed_guard(uuid)') is null then
    raise exception '20261026010000: sample_seed_guard yok; once 20261024020000 uygulanmali.';
  end if;
end $$;

create or replace function public.seed_sample_document_requests(p_tenant uuid, p_rows jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_slug text;
  v_demo boolean;
  v_guard jsonb;
  v_row jsonb;
  v_file jsonb;
  v_req_id uuid;
  v_sample boolean;
  v_files jsonb;
  v_status text;
  v_customer uuid;
  v_property uuid;
  v_creator uuid;
  v_created timestamptz;
  v_nreq integer := 0;
  v_nfile integer := 0;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'seed_sample_document_requests yalniz service_role' using errcode = '42501';
  end if;
  if p_tenant is null then
    raise exception 'ofis kimligi gerekli' using errcode = '22023';
  end if;
  if p_rows is null or pg_catalog.jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows jsonb dizi olmali' using errcode = '22023';
  end if;

  select t.slug into v_slug from public.tenants t where t.id = p_tenant;
  if not found then
    raise exception 'ofis bulunamadi' using errcode = '22023';
  end if;
  v_demo := v_slug = 'demo-ofis';
  if not v_demo then
    v_guard := public.sample_seed_guard(p_tenant);
    if coalesce((v_guard ->> 'allowed')::boolean, false) is not true then
      raise exception 'sample_seed_locked: %', coalesce(v_guard ->> 'code', 'locked') using errcode = '42501';
    end if;
  end if;

  -- Ayni ofiste es zamanli iki tohum cogaltmasin.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('seed_sample_document_requests:' || p_tenant::text));

  if exists (
    select 1 from public.document_requests d
     where d.tenant_id = p_tenant and (v_demo or d.is_sample)
  ) then
    return pg_catalog.jsonb_build_object('requests', 0, 'files', 0, 'skipped', true);
  end if;

  for v_row in select e from pg_catalog.jsonb_array_elements(p_rows) e loop
    v_sample := case when v_demo then coalesce((v_row ->> 'is_sample')::boolean, false) else true end;
    v_files := case when pg_catalog.jsonb_typeof(v_row -> 'files') = 'array' then v_row -> 'files' else '[]'::jsonb end;
    v_status := coalesce(v_row ->> 'status', 'active');
    v_created := coalesce((v_row ->> 'created_at')::timestamptz, pg_catalog.now());

    select c.id into v_customer from public.customers c where c.tenant_id = p_tenant and c.id = (v_row ->> 'customer_id')::uuid;
    select p.id into v_property from public.properties p where p.tenant_id = p_tenant and p.id = (v_row ->> 'property_id')::uuid;
    select pr.id into v_creator from public.profiles pr where pr.tenant_id = p_tenant and pr.id = (v_row ->> 'created_by')::uuid;

    insert into public.document_requests (
      tenant_id, customer_id, property_id, title, requested_types, token_hash, max_files, file_count, status,
      expires_at, revoked_at, completed_at, last_opened_at, is_sample, created_by, created_at
    ) values (
      p_tenant, v_customer, v_property,
      pg_catalog.left(coalesce(nullif(v_row ->> 'title', ''), 'Evrak talebi'), 160),
      coalesce(array(select pg_catalog.jsonb_array_elements_text(v_row -> 'requested_types')), '{}'::text[]),
      -- createDocumentRequest ile ayni bicim: rastgele ham token'in SHA-256 ozeti (hex); ham token saklanmaz.
      pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
        pg_catalog.gen_random_uuid()::text || pg_catalog.gen_random_uuid()::text || pg_catalog.clock_timestamp()::text, 'UTF8')), 'hex'),
      coalesce((v_row ->> 'max_files')::int, 5),
      pg_catalog.jsonb_array_length(v_files),
      v_status,
      coalesce((v_row ->> 'expires_at')::timestamptz, v_created + interval '7 days'),
      case when v_status = 'revoked' then coalesce((v_row ->> 'revoked_at')::timestamptz, v_created) end,
      case when v_status = 'completed' then coalesce((v_row ->> 'completed_at')::timestamptz, v_created) end,
      (v_row ->> 'last_opened_at')::timestamptz,
      v_sample, v_creator, v_created
    ) returning id into v_req_id;
    v_nreq := v_nreq + 1;

    for v_file in select f from pg_catalog.jsonb_array_elements(v_files) f loop
      if coalesce(v_file ->> 'storage_path', '') not like 'kayit-bilgisi:%' then
        raise exception 'ornek evrak dosyasi yalniz kayit bilgisi olabilir (kayit-bilgisi:)' using errcode = '22023';
      end if;
      insert into public.document_request_files (
        tenant_id, request_id, doc_type, storage_path, file_name, file_size, mime_type, status, is_sample, created_at, verified_at
      ) values (
        p_tenant, v_req_id, coalesce(v_file ->> 'doc_type', 'other'), v_file ->> 'storage_path',
        coalesce(nullif(v_file ->> 'file_name', ''), 'belge'), coalesce((v_file ->> 'file_size')::bigint, 1),
        coalesce(nullif(v_file ->> 'mime_type', ''), 'application/pdf'), 'verified', v_sample,
        coalesce((v_file ->> 'created_at')::timestamptz, v_created),
        coalesce((v_file ->> 'verified_at')::timestamptz, (v_file ->> 'created_at')::timestamptz, v_created)
      );
      v_nfile := v_nfile + 1;
    end loop;
  end loop;

  return pg_catalog.jsonb_build_object('requests', v_nreq, 'files', v_nfile, 'skipped', false);
end;
$$;

comment on function public.seed_sample_document_requests(uuid, jsonb) is
  'Ornek evrak talepleri (+ yalniz kayit bilgisi dosyalari) tohumu: yalniz service_role; yalniz demo-ofis ya da sample_seed_guard izinli ofis; idempotent.';

revoke all on function public.seed_sample_document_requests(uuid, jsonb) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.seed_sample_document_requests(uuid, jsonb) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.seed_sample_document_requests(uuid, jsonb) from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.seed_sample_document_requests(uuid, jsonb) to service_role';
  end if;
end $$;
