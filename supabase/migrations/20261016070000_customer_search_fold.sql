-- SK7 (B059 + B060): Müşteri arama çekirdeği — Türkçe katlamalı arama sütunu, rakam-yalnız telefon sütunu,
-- trigram indeksleri ve kapsam dışı tam telefon eşleşmesi için maskeli arayan tanıma RPC'si.
--
-- NEDEN: Aramalar ham ilike ile yapılıyordu. Veritabanı collation'ı en_US.UTF-8 olduğu için lower('I')='i' ve
-- lower('İ')='i̇' (birleşen nokta); 'Kemal Işık' kaydı 'kemal isik', 'IŞIK' ya da 'kemal ışık' ile bulunamıyordu.
-- '+90 532…' biçimli telefon da saklanan '05…' ile eşleşmiyordu.
--
-- NE YAPAR (yalnız ekler; mevcut veri/davranış değişmez):
--   1) customers.search_fold  = fold_tr(ad + ' ' + e-posta)   (GENERATED STORED; fold_tr 20260725000056'da tanımlı, IMMUTABLE)
--   2) customers.phone_digits = telefonun yalnız rakamları    (GENERATED STORED)
--   3) pg_trgm GIN indeksleri (ilike '%…%' için) + (tenant_id, phone_digits) btree (tam eşleşme için)
--   4) lookup_customer_by_phone(p_phone, p_exclude): SECURITY DEFINER, oturumun kiracısıyla sınırlı ve customers:view
--      şartlı. Yalnız ad, maskeli telefon ve danışman adını döner (kimlik, e-posta, not DÖNMEZ). Kapsam dışı kaydı
--      "Bu numara X danışmanının müşterisi" diye göstermek içindir; p_exclude ile çağıranın zaten gördüğü kayıtlar elenir.
--
-- Kod sözleşmesi: src/lib/pgrst.ts `foldTrSql` fold_tr ile AYNI kuralı uygular (searchTermFilter bu sütunda arar).
-- KOD YAYININDAN ÖNCE uygulanır (arama kodu bu sütunları okur). Idempotent: tekrar koşulursa hiçbir şey değişmez.
-- Mükerrer müşteri grupları BİRLEŞTİRİLMEZ (yalnız find_duplicate_customers ile salt-okunur rapor).

create extension if not exists pg_trgm with schema public;

alter table public.customers
  add column if not exists search_fold text
  generated always as (public.fold_tr(coalesce(full_name, '') || ' ' || coalesce(email, ''))) stored;

alter table public.customers
  add column if not exists phone_digits text
  generated always as (regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')) stored;

comment on column public.customers.search_fold is
  'Türkçe katlamalı arama metni (ad + e-posta; fold_tr). Yazılmaz, üretilir. Arama: src/lib/pgrst.ts searchTermFilter.';
comment on column public.customers.phone_digits is
  'Telefonun yalnız rakamları (biçimden bağımsız arama ve tam eşleşme). Yazılmaz, üretilir.';

create index if not exists idx_customers_search_fold_trgm
  on public.customers using gin (search_fold public.gin_trgm_ops);
create index if not exists idx_customers_phone_digits_trgm
  on public.customers using gin (phone_digits public.gin_trgm_ops);
create index if not exists idx_customers_tenant_phone_digits
  on public.customers (tenant_id, phone_digits)
  where deleted_at is null;

-- ---------------------------------------------------------------------------
-- Arayan tanıma: kapsam dışı tam telefon eşleşmesi (maskeli)
-- ---------------------------------------------------------------------------
create or replace function public.lookup_customer_by_phone(p_phone text, p_exclude uuid[] default '{}'::uuid[])
returns table (full_name text, phone_masked text, advisor_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_digits text;
begin
  v_tenant := public.current_active_tenant_id();
  if v_tenant is null or not public.has_effective_permission('customers', 'view') then
    return;
  end if;

  -- Saklama biçimine indir: TR '05XXXXXXXXX' (rakamlar '05…'), yabancı '+<E.164>' (rakamlar ülke koduyla).
  v_digits := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  if length(v_digits) = 14 and left(v_digits, 4) = '0090' then
    v_digits := '0' || substr(v_digits, 5);
  elsif length(v_digits) = 12 and left(v_digits, 2) = '90' then
    v_digits := '0' || substr(v_digits, 3);
  elsif length(v_digits) = 10 and left(v_digits, 1) <> '0' then
    v_digits := '0' || v_digits;
  end if;
  if length(v_digits) < 7 then
    return;
  end if;

  return query
    select
      c.full_name,
      case
        when length(c.phone) >= 7 then left(c.phone, 4) || ' *** ** ' || right(c.phone, 2)
        else '***'
      end,
      p.full_name
    from public.customers c
    left join public.profiles p on p.id = c.assigned_to and p.tenant_id = c.tenant_id
    where c.tenant_id = v_tenant
      and c.deleted_at is null
      and c.phone_digits = v_digits
      and not (c.id = any(coalesce(p_exclude, '{}'::uuid[])))
    order by c.created_at desc
    limit 5;
end;
$$;

comment on function public.lookup_customer_by_phone(text, uuid[]) is
  'SK7/B059: kapsam dışı tam telefon eşleşmesi — yalnız ad, maskeli telefon, danışman adı. Kiracı + customers:view şartlı.';

revoke all on function public.lookup_customer_by_phone(text, uuid[]) from public, anon;
grant execute on function public.lookup_customer_by_phone(text, uuid[]) to authenticated;
grant execute on function public.lookup_customer_by_phone(text, uuid[]) to service_role;
