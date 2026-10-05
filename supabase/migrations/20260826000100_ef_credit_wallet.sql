-- MIGRATION 20260826000100_ef_credit_wallet.sql
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20260826000100_ef_credit_wallet.sql` ile uygular (YAYIN_PENCERESI_2.md §7).
-- Geri alma: supabase/rollbacks/20260826000100_ef_credit_wallet.rollback.sql (once 000300 ve 000200 rollback'leri).
--
-- EmlakFiyati KONTOR cuzdani (birim `ef`). TEK defter: public.account_credit_ledger (20260825000800 kurdu,
-- 20260825001000 genisletti; append-only, tenant select RLS). Kontor YALNIZ Emlaksoft'ta tutulur/dusulur
-- (docs/integrations/EMLAKFIYATI_ORTAK_API_V1.md §7). RPC sozlesmesi: src/lib/ef-credits/config.ts
-- (EF_RPC, EfBalance, EfReserveResult, EfSettleResult, EfGrantResult) — ad, parametre adi/sirasi ve donus JSON
-- anahtarlari BIREBIR. docs/design/EMLAKFIYATI_KONTOR_MIMARISI.md tarihseldir (imza basliklari GECERSIZ).
--
-- NE DEGISIR
--   1. account_credit_ledger: unit CHECK'e 'ef' eklenir ('try','ai','valuation' KORUNUR); source CHECK'e
--      'purchase','bonus','refund' eklenir (mevcutlar korunur); yeni CHECK `account_credit_ledger_ef_entry_check`:
--      ef satiri yalniz grant (+tamsayi) ya da spend (-tamsayi); yeni nullable `meta jsonb` (yalniz teknik alan,
--      KISISEL VERI YOK; ef grant'in p_meta'si buraya yazilir). Mevcut satirlar ve AI/degerleme/growth davranisi
--      DEGISMEZ (ai_credit_charge unit filtresiyle calisir; 'ef' satirlarini gormez).
--   2. YENI tablo public.ef_credit_reservations (rezerv -> kesinlestir | serbest birak). Yazma YALNIZ asagidaki
--      service_role RPC'leri; durum gecisi tek yonlu (guard tetikleyicisi), silme yok.
--   3. YENI RPC'ler (service_role-only, SECURITY DEFINER, search_path=''): ef_credit_balance, ef_credit_reserve,
--      ef_credit_commit, ef_credit_release, ef_credit_grant, ef_credit_sweep, ef_credit_ready.
--
-- BAKIYE MODELI
--   available = SUM(grant) - SUM(kesinlesen spend) - SUM(acik rezerv). Defterde yalniz grant (+units) ve
--   kesinlestirme (spend, -units) satiri olur; rezerv defterde DEGIL ef_credit_reservations'tadir (state reserved).
--   Her yazan RPC tenant basina pg_advisory_xact_lock('ef-credit:<tenant>') alir; bakiye tek SELECT ile (tek
--   anlik goruntu) okunur. NEGATIF BAKIYE YOK: rezerv yalniz available >= units iken acilir; kesinlestirme
--   rezerve edilmis birimi donusturur (available degismez). account_credit_balances gorunumu 'ef' icin
--   grant - kesinlesen (acik rezervleri DUSMEZ); gercek kullanilabilir bakiye icin ef_credit_balance kullanilir.
--   SURESIZ KONTOR (v1 karari): grant satirinda expires_at YAZILMAZ; paket suresi/FIFO tuketimi yok.
--
-- TASARIM KARARLARI
--   * 0 KONTORLUK ISLEM (ucretsiz akis: report_detail ya da tarifede 0'a cekilmis kalem): ef_credit_reserve
--     p_units = 0 ile cagrilir; ACIK REZERV olusturulmaz, defter satiri yazilmaz (amount <> 0 CHECK'i), ama
--     ef_credit_reservations'a units=0, state='committed', reason='free', settled_at=now() kaydi YAZILIR ve
--     {ok:true, code:'ok', state:'committed', reservation_id, available} doner. Boylece ucretsiz akis da kayit
--     (kim, ne, ne zaman, idempotency) ve ef_reports.reservation_id baglantisi kazanir. Bu kayda sonradan
--     ef_credit_commit cagrilirsa {ok:true, state:'committed', already:true} (ref bossa p_ref yazilir);
--     ef_credit_release {ok:false, state:'committed', already:false}.
--   * IDEMPOTENCY: (tenant, p_idem) tekil. Ayni anahtar + ayni (units, item) = ayni rezerv (code 'duplicate', o
--     anki state ile). Ayni anahtar FARKLI units/item ile = 22023 (yanlis yeniden kullanim; sessizce yutulmaz).
--     Yetersiz bakiyede satir yazilmaz; ayni anahtarla sonra yeniden denenebilir. p_idem biçimi EmlakFiyati
--     Idempotency-Key ile ayni sinif: ^[A-Za-z0-9_.:-]{8,128}$. Grant: defter idempotency_key =
--     'ef:grant:<tenant>:<p_idem>' (defter anahtari kuresel tekil oldugu icin tenant onekli); ayni anahtar farkli
--     units/kind ile = 22023.
--   * p_units >= 0 (ust sinir yok; tarife sinirini TS dogrular). Grant p_units 1..1000000.
--   * SUPURME: ef_credit_sweep(p_older_than default 15 dk, en az 1 dk) eski 'reserved' kayitlari 'released'
--     (reason 'sweep') yapar, kac satir dondurur; tek seferde en cok 5000; es zamanli ikinci supurme 0 doner.
--     Supurulmus rezerve sonradan kesinlestirme {ok:false, state:'released'} alir (musteri lehine; mutabakat yakalar).
--   * ef_credit_ready(): cuzdan RPC'leri + 'ef' birimi + rezerv tablosu + fulfill_billing_payment (10 arg) ve
--     fulfill_billing_payment_v2 govdelerinde 'credit-pack:v1' isareti (20260826000300) varsa TRUE. Hata
--     FIRLATMAZ (false). YALNIZ service_role kimliginde true doner: SQL editorunde (auth.role() service_role degil)
--     FALSE donmesi BEKLENIR, hata degildir. ef_reports'u (20260826000200) KONTROL ETMEZ: paket satisi ona bagli degil.
--   * Gorunurluk: ef_credit_reservations SELECT = ayni ofis VE (kendi kaydi ya da owner/gm). Defter (tenant geneli
--     select, mevcut politika) ref/rapor kimligi TASIMAZ: kesinlestirme satirina yalniz source_id = rezerv id,
--     feature = kalem yazilir.
--
-- BAGIMLILIK: 20260825000800 + 20260825001000 (defter, feature sutunu, CHECK adlari) canlida; ilk DO blogu
--   eksikse HICBIR sey yazmadan durur.
-- KILIT: account_credit_ledger uzerinde kisa ACCESS EXCLUSIVE (CHECK degisimi + dogrulama taramasi; tablo kucuk).
--   lock_timeout 5 sn: AI olcum trafigi kilidi tutuyorsa dosya durur (tamamı geri alinir), daha sakin anda tekrar.
-- KOD: TS cagrilari (src/lib/ef-credits/) henuz YOK; kod ef_credit_ready() true olmadan kontor akisini acmamali.
-- Yeni modul DEGIL: permission_defaults seed'i gerekmez (EmlakFiyati degerleme mevcut modulun parcasi olacak).
--
-- SALT-OKUNUR DOGRULAMA (uygulamadan SONRA; YAYIN_PENCERESI_2.md §7.1):
-- select (select pg_get_constraintdef(oid) like '%''ef''%' from pg_constraint where conname='account_credit_ledger_unit_check' and conrelid='public.account_credit_ledger'::regclass) as unit_ef,
--        (select count(*) from pg_constraint where conname='account_credit_ledger_ef_entry_check') as ef_chk,
--        to_regclass('public.ef_credit_reservations') is not null as tablo,
--        (select relrowsecurity from pg_class where oid='public.ef_credit_reservations'::regclass) as rls,
--        (select count(*) from pg_policies where schemaname='public' and tablename='ef_credit_reservations') as pol,
--        (select count(*) from pg_proc where pronamespace='public'::regnamespace and prosecdef and proname in
--          ('ef_credit_balance','ef_credit_reserve','ef_credit_commit','ef_credit_release','ef_credit_grant','ef_credit_sweep','ef_credit_ready')) as fn,
--        has_function_privilege('authenticated','public.ef_credit_reserve(uuid,uuid,integer,text,text)','execute') as auth_exec,
--        (select count(*) from public.account_credit_ledger where unit='ef') as ef_satir;
-- BEKLENEN: t | 1 | t | t | 1 | 7 | f | 0

-- ---------------------------------------------------------------------------
-- 0. On-kosul (eksik bagimlilikta hicbir sey yazmadan durur; runner dosyayi tek transaction'da calistirir)
-- ---------------------------------------------------------------------------
set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.account_credit_ledger') is null then
    raise exception '20260826000100: public.account_credit_ledger yok; once 20260825000800 / 20260825001000 uygulanmali.';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_attribute a
    where a.attrelid = 'public.account_credit_ledger'::regclass and a.attname = 'feature'
      and a.attnum > 0 and not a.attisdropped
  ) then
    raise exception '20260826000100: account_credit_ledger.feature yok; once 20260825001000 uygulanmali.';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint c
    where c.conrelid = 'public.account_credit_ledger'::regclass and c.conname = 'account_credit_ledger_unit_check'
  ) then
    raise exception '20260826000100: account_credit_ledger_unit_check yok; 20260825001000 durumu beklenenden farkli.';
  end if;
  if pg_catalog.to_regclass('public.tenants') is null or pg_catalog.to_regclass('public.profiles') is null then
    raise exception '20260826000100: tenants/profiles yok.';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. Defter: 'ef' birimi, kaynak turleri, ef satir bicimi, meta
-- ---------------------------------------------------------------------------
alter table public.account_credit_ledger add column if not exists meta jsonb;

alter table public.account_credit_ledger drop constraint if exists account_credit_ledger_unit_check;
alter table public.account_credit_ledger add constraint account_credit_ledger_unit_check
  check (unit in ('try', 'ai', 'valuation', 'ef'));

alter table public.account_credit_ledger drop constraint if exists account_credit_ledger_source_check;
alter table public.account_credit_ledger add constraint account_credit_ledger_source_check
  check (source in ('referral', 'partner', 'campaign', 'manual', 'usage', 'plan', 'purchase', 'bonus', 'refund'));

alter table public.account_credit_ledger drop constraint if exists account_credit_ledger_ef_entry_check;
alter table public.account_credit_ledger add constraint account_credit_ledger_ef_entry_check
  check (
    unit <> 'ef'
    or (entry_type = 'grant' and amount > 0 and amount = trunc(amount) and expires_at is null)
    or (entry_type = 'spend' and amount < 0 and amount = trunc(amount))
  );

alter table public.account_credit_ledger drop constraint if exists account_credit_ledger_meta_check;
alter table public.account_credit_ledger add constraint account_credit_ledger_meta_check
  check (meta is null or (jsonb_typeof(meta) = 'object' and octet_length(meta::text) <= 4000));

comment on column public.account_credit_ledger.meta is
  'Yalniz teknik alanlar (fatura/paket kimligi vb.). KISISEL VERI YAZILMAZ. ef grant p_meta buraya yazilir.';

-- ---------------------------------------------------------------------------
-- 2. Rezerv tablosu
-- ---------------------------------------------------------------------------
create table if not exists public.ef_credit_reservations (
  id              uuid not null default gen_random_uuid(),
  tenant_id       uuid not null,
  user_id         uuid,
  units           integer not null,
  idempotency_key text not null,
  item            text not null,
  state           text not null default 'reserved',
  ref             jsonb,
  reason          text,
  created_at      timestamptz not null default now(),
  settled_at      timestamptz,
  constraint ef_credit_reservations_pkey primary key (id),
  constraint ef_credit_reservations_tenant_id_fkey foreign key (tenant_id)
    references public.tenants(id) on delete cascade,
  constraint ef_credit_reservations_user_id_fkey foreign key (user_id)
    references public.profiles(id) on delete set null,
  constraint ef_credit_reservations_tenant_idem_key unique (tenant_id, idempotency_key),
  constraint ef_credit_reservations_tenant_id_id_key unique (tenant_id, id),
  constraint ef_credit_reservations_units_check check (units >= 0),
  constraint ef_credit_reservations_state_check check (state in ('reserved', 'committed', 'released')),
  constraint ef_credit_reservations_idem_check check (idempotency_key ~ '^[A-Za-z0-9_.:-]{8,128}$'),
  constraint ef_credit_reservations_item_check check (item ~ '^[a-z][a-z0-9_]{1,39}$'),
  constraint ef_credit_reservations_ref_check
    check (ref is null or (jsonb_typeof(ref) = 'object' and octet_length(ref::text) <= 4000)),
  constraint ef_credit_reservations_reason_check check (reason is null or char_length(reason) between 1 and 200),
  constraint ef_credit_reservations_settled_check check ((state = 'reserved') = (settled_at is null)),
  constraint ef_credit_reservations_free_check check (units > 0 or state = 'committed')
);

comment on table public.ef_credit_reservations is
  'EmlakFiyati kontor rezervleri (reserved -> committed | released). Yazma yalniz service_role ef_credit_* RPC''leri. Kisisel veri yok; ref yalniz teknik (rapor kimligi vb.).';

create index if not exists idx_ef_credit_reservations_open
  on public.ef_credit_reservations (tenant_id) include (units)
  where state = 'reserved';
create index if not exists idx_ef_credit_reservations_sweep
  on public.ef_credit_reservations (created_at)
  where state = 'reserved';
create index if not exists idx_ef_credit_reservations_user
  on public.ef_credit_reservations (tenant_id, user_id, created_at desc);
create index if not exists idx_ef_credit_reservations_user_fk
  on public.ef_credit_reservations (user_id)
  where user_id is not null;

-- Durum gecisi tek yonlu; kimlik/birim/anahtar/kalem/zaman degismez; silme yok (denetim kaydi).
-- user_id yalniz NULL'a inebilir (profiles silinirse FK on delete set null).
create or replace function public.ef_credit_reservations_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'ef_credit_reservations: kayit silinemez.' using errcode = '42501';
  end if;
  if new.id is distinct from old.id
    or new.tenant_id is distinct from old.tenant_id
    or new.units is distinct from old.units
    or new.idempotency_key is distinct from old.idempotency_key
    or new.item is distinct from old.item
    or new.created_at is distinct from old.created_at
    or (new.user_id is distinct from old.user_id and new.user_id is not null) then
    raise exception 'ef_credit_reservations: degismez alan guncellenemez.' using errcode = '42501';
  end if;
  if old.state <> 'reserved' and new.state is distinct from old.state then
    raise exception 'ef_credit_reservations: sonuclanmis rezervin durumu degisemez.' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.ef_credit_reservations_guard() from public, anon, authenticated;

drop trigger if exists trg_ef_credit_reservations_guard on public.ef_credit_reservations;
create trigger trg_ef_credit_reservations_guard
  before update or delete on public.ef_credit_reservations
  for each row execute function public.ef_credit_reservations_guard();

alter table public.ef_credit_reservations enable row level security;
drop policy if exists ef_credit_reservations_select on public.ef_credit_reservations;
create policy ef_credit_reservations_select on public.ef_credit_reservations
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (
      user_id = (select auth.uid())
      or (select public.current_profile_role()) in ('owner', 'gm')
    )
  );
-- Supabase varsayilan ayricaliklari authenticated'a yazma + TRUNCATE verir (RLS TRUNCATE'i durdurmaz): temizlenir.
revoke all privileges on table public.ef_credit_reservations from public, anon, authenticated;
grant select on table public.ef_credit_reservations to authenticated;
grant all privileges on table public.ef_credit_reservations to service_role;

-- ---------------------------------------------------------------------------
-- 3. RPC'ler (service_role-only). Sozlesme: src/lib/ef-credits/config.ts EF_RPC
-- ---------------------------------------------------------------------------

-- ef_credit_balance(p_tenant uuid) -> jsonb EfBalance {available, reserved, granted_total, committed_total}
create or replace function public.ef_credit_balance(p_tenant uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_granted bigint;
  v_spent bigint;
  v_reserved bigint;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if p_tenant is null then
    raise exception 'Tenant is required.' using errcode = '22023';
  end if;

  -- Tek SELECT = tek anlik goruntu: kesinlestirme (spend satiri + state degisimi) yarim gorulmez.
  select
    coalesce((
      select sum(l.amount) from public.account_credit_ledger l
      where l.tenant_id = p_tenant and l.unit = 'ef' and l.entry_type = 'grant'
    ), 0)::bigint,
    coalesce((
      select -sum(l.amount) from public.account_credit_ledger l
      where l.tenant_id = p_tenant and l.unit = 'ef' and l.entry_type = 'spend'
    ), 0)::bigint,
    coalesce((
      select sum(r.units) from public.ef_credit_reservations r
      where r.tenant_id = p_tenant and r.state = 'reserved'
    ), 0)::bigint
  into v_granted, v_spent, v_reserved;

  return jsonb_build_object(
    'available', v_granted - v_spent - v_reserved,
    'reserved', v_reserved,
    'granted_total', v_granted,
    'committed_total', v_spent
  );
end;
$$;

revoke all on function public.ef_credit_balance(uuid) from public, anon, authenticated;
grant execute on function public.ef_credit_balance(uuid) to service_role;
comment on function public.ef_credit_balance(uuid) is
  'EF kontor bakiyesi: available = grant - kesinlesen - acik rezerv. Service-role-only.';

-- ef_credit_reserve(p_tenant, p_user, p_units, p_idem, p_item) -> jsonb EfReserveResult
create or replace function public.ef_credit_reserve(
  p_tenant uuid,
  p_user uuid,
  p_units integer,
  p_idem text,
  p_item text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_existing public.ef_credit_reservations%rowtype;
  v_available bigint;
  v_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if p_tenant is null then
    raise exception 'Tenant is required.' using errcode = '22023';
  end if;
  if p_units is null or p_units < 0 then
    raise exception 'Invalid units.' using errcode = '22023';
  end if;
  if p_idem is null or p_idem !~ '^[A-Za-z0-9_.:-]{8,128}$' then
    raise exception 'Invalid idempotency key.' using errcode = '22023';
  end if;
  if p_item is null or p_item !~ '^[a-z][a-z0-9_]{1,39}$' then
    raise exception 'Invalid item.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.tenants t where t.id = p_tenant) then
    raise exception 'Tenant not found.' using errcode = '22023';
  end if;
  if p_user is not null and not exists (
    select 1 from public.profiles p where p.id = p_user and p.tenant_id = p_tenant
  ) then
    raise exception 'User does not belong to tenant.' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ef-credit:' || p_tenant::text, 0));

  select r.* into v_existing
  from public.ef_credit_reservations r
  where r.tenant_id = p_tenant and r.idempotency_key = p_idem;

  if found then
    if v_existing.units <> p_units or v_existing.item <> p_item then
      raise exception 'Idempotency key reused with a different request.' using errcode = '22023';
    end if;
    v_available := (public.ef_credit_balance(p_tenant) ->> 'available')::bigint;
    return jsonb_build_object(
      'ok', true,
      'code', 'duplicate',
      'reservation_id', v_existing.id::text,
      'state', v_existing.state,
      'available', v_available
    );
  end if;

  -- Ucretsiz akis: acik rezerv yok, defter satiri yok; kayit dogrudan 'committed'.
  if p_units = 0 then
    insert into public.ef_credit_reservations (tenant_id, user_id, units, idempotency_key, item, state, reason, settled_at)
    values (p_tenant, p_user, 0, p_idem, p_item, 'committed', 'free', now())
    returning id into v_id;
    v_available := (public.ef_credit_balance(p_tenant) ->> 'available')::bigint;
    return jsonb_build_object(
      'ok', true,
      'code', 'ok',
      'reservation_id', v_id::text,
      'state', 'committed',
      'available', v_available
    );
  end if;

  v_available := (public.ef_credit_balance(p_tenant) ->> 'available')::bigint;
  if v_available < p_units then
    return jsonb_build_object('ok', false, 'code', 'insufficient', 'available', greatest(v_available, 0));
  end if;

  insert into public.ef_credit_reservations (tenant_id, user_id, units, idempotency_key, item, state)
  values (p_tenant, p_user, p_units, p_idem, p_item, 'reserved')
  returning id into v_id;

  return jsonb_build_object(
    'ok', true,
    'code', 'ok',
    'reservation_id', v_id::text,
    'state', 'reserved',
    'available', v_available - p_units
  );
end;
$$;

revoke all on function public.ef_credit_reserve(uuid, uuid, integer, text, text) from public, anon, authenticated;
grant execute on function public.ef_credit_reserve(uuid, uuid, integer, text, text) to service_role;
comment on function public.ef_credit_reserve(uuid, uuid, integer, text, text) is
  'EF kontor rezervi: (tenant,p_idem) tekil; yetersizse ok=false/insufficient; p_units=0 dogrudan committed kayit (ucretsiz akis). Service-role-only.';

-- ef_credit_commit(p_tenant, p_reservation, p_ref) -> jsonb EfSettleResult; yalniz reserved -> committed
create or replace function public.ef_credit_commit(
  p_tenant uuid,
  p_reservation uuid,
  p_ref jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.ef_credit_reservations%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if p_tenant is null or p_reservation is null then
    raise exception 'Tenant and reservation are required.' using errcode = '22023';
  end if;
  if p_ref is not null and (jsonb_typeof(p_ref) <> 'object' or octet_length(p_ref::text) > 4000) then
    raise exception 'Invalid ref.' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ef-credit:' || p_tenant::text, 0));

  select r.* into v_row
  from public.ef_credit_reservations r
  where r.tenant_id = p_tenant and r.id = p_reservation
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'state', 'unknown', 'already', false);
  end if;

  if v_row.state = 'committed' then
    if v_row.ref is null and p_ref is not null then
      update public.ef_credit_reservations r set ref = p_ref where r.id = v_row.id;
    end if;
    return jsonb_build_object('ok', true, 'state', 'committed', 'already', true);
  end if;

  if v_row.state = 'released' then
    return jsonb_build_object('ok', false, 'state', 'released', 'already', false);
  end if;

  -- reserved -> committed: defter spend satiri (rezerv kimligiyle tekil) + durum. available DEGISMEZ.
  insert into public.account_credit_ledger
    (tenant_id, unit, entry_type, amount, source, source_id, idempotency_key, created_by, feature)
  values
    (p_tenant, 'ef', 'spend', -v_row.units, 'usage', v_row.id, 'ef:spend:' || v_row.id::text, v_row.user_id, v_row.item);

  update public.ef_credit_reservations r
  set state = 'committed', settled_at = now(), ref = coalesce(p_ref, r.ref)
  where r.id = v_row.id;

  return jsonb_build_object('ok', true, 'state', 'committed', 'already', false);
end;
$$;

revoke all on function public.ef_credit_commit(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.ef_credit_commit(uuid, uuid, jsonb) to service_role;
comment on function public.ef_credit_commit(uuid, uuid, jsonb) is
  'EF kontor kesinlestirme: yalniz reserved -> committed (defter spend satiri); idempotent (already=true). Service-role-only.';

-- ef_credit_release(p_tenant, p_reservation, p_reason) -> jsonb EfSettleResult; yalniz reserved -> released
create or replace function public.ef_credit_release(
  p_tenant uuid,
  p_reservation uuid,
  p_reason text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.ef_credit_reservations%rowtype;
  v_reason text := left(nullif(btrim(coalesce(p_reason, '')), ''), 200);
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if p_tenant is null or p_reservation is null then
    raise exception 'Tenant and reservation are required.' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ef-credit:' || p_tenant::text, 0));

  select r.* into v_row
  from public.ef_credit_reservations r
  where r.tenant_id = p_tenant and r.id = p_reservation
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'state', 'unknown', 'already', false);
  end if;

  if v_row.state = 'released' then
    return jsonb_build_object('ok', true, 'state', 'released', 'already', true);
  end if;

  if v_row.state = 'committed' then
    return jsonb_build_object('ok', false, 'state', 'committed', 'already', false);
  end if;

  update public.ef_credit_reservations r
  set state = 'released', settled_at = now(), reason = coalesce(v_reason, 'released')
  where r.id = v_row.id;

  return jsonb_build_object('ok', true, 'state', 'released', 'already', false);
end;
$$;

revoke all on function public.ef_credit_release(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.ef_credit_release(uuid, uuid, text) to service_role;
comment on function public.ef_credit_release(uuid, uuid, text) is
  'EF kontor serbest birakma (iade): yalniz reserved -> released; idempotent (already=true). Service-role-only.';

-- ef_credit_grant(p_tenant, p_units, p_kind, p_idem, p_meta) -> jsonb EfGrantResult; (tenant,p_idem) tekil
create or replace function public.ef_credit_grant(
  p_tenant uuid,
  p_units integer,
  p_kind text,
  p_idem text,
  p_meta jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_source text;
  v_key text;
  v_existing_amount numeric;
  v_existing_feature text;
  v_available bigint;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if p_tenant is null then
    raise exception 'Tenant is required.' using errcode = '22023';
  end if;
  if p_units is null or p_units < 1 or p_units > 1000000 then
    raise exception 'Invalid units.' using errcode = '22023';
  end if;
  -- config.ts EF_GRANT_KINDS -> defter source (CHECK listesinde)
  v_source := case p_kind
    when 'purchase' then 'purchase'
    when 'plan_monthly' then 'plan'
    when 'bonus' then 'bonus'
    when 'admin' then 'manual'
    when 'refund' then 'refund'
  end;
  if v_source is null then
    raise exception 'Invalid grant kind.' using errcode = '22023';
  end if;
  if p_idem is null or p_idem !~ '^[A-Za-z0-9_.:-]{8,128}$' then
    raise exception 'Invalid idempotency key.' using errcode = '22023';
  end if;
  if p_meta is not null and (jsonb_typeof(p_meta) <> 'object' or octet_length(p_meta::text) > 4000) then
    raise exception 'Invalid meta.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.tenants t where t.id = p_tenant) then
    raise exception 'Tenant not found.' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ef-credit:' || p_tenant::text, 0));

  v_key := 'ef:grant:' || p_tenant::text || ':' || p_idem;

  select l.amount, l.feature into v_existing_amount, v_existing_feature
  from public.account_credit_ledger l
  where l.idempotency_key = v_key;

  if found then
    if v_existing_amount <> p_units or v_existing_feature is distinct from ('ef_grant:' || p_kind) then
      raise exception 'Idempotency key reused with a different grant.' using errcode = '22023';
    end if;
    v_available := (public.ef_credit_balance(p_tenant) ->> 'available')::bigint;
    return jsonb_build_object('ok', true, 'already', true, 'available', v_available);
  end if;

  -- Suresiz kontor (v1): expires_at yazilmaz.
  insert into public.account_credit_ledger
    (tenant_id, unit, entry_type, amount, source, idempotency_key, feature, meta)
  values
    (p_tenant, 'ef', 'grant', p_units, v_source, v_key, 'ef_grant:' || p_kind, p_meta);

  v_available := (public.ef_credit_balance(p_tenant) ->> 'available')::bigint;
  return jsonb_build_object('ok', true, 'already', false, 'available', v_available);
end;
$$;

revoke all on function public.ef_credit_grant(uuid, integer, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.ef_credit_grant(uuid, integer, text, text, jsonb) to service_role;
comment on function public.ef_credit_grant(uuid, integer, text, text, jsonb) is
  'EF kontor yukleme (purchase|plan_monthly|bonus|admin|refund); (tenant,p_idem) tekil; suresiz. Service-role-only.';

-- ef_credit_sweep(p_older_than interval default '15 minutes') -> int
create or replace function public.ef_credit_sweep(p_older_than interval default interval '15 minutes')
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_count integer := 0;
  v_cutoff timestamptz;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if p_older_than is null or p_older_than < interval '1 minute' then
    raise exception 'Invalid sweep age.' using errcode = '22023';
  end if;

  -- Es zamanli ikinci supurme beklemez, 0 doner.
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('ef-credit:sweep', 0)) then
    return 0;
  end if;

  v_cutoff := now() - p_older_than;

  -- Kilit sirasi: tenant kilidi -> satir (reserve/commit/release ile ayni); tenant sirasiyla, cikmaz yok.
  for v_row in
    select r.id, r.tenant_id
    from public.ef_credit_reservations r
    where r.state = 'reserved' and r.created_at < v_cutoff
    order by r.tenant_id, r.created_at, r.id
    limit 5000
  loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ef-credit:' || v_row.tenant_id::text, 0));
    update public.ef_credit_reservations r
    set state = 'released', reason = 'sweep', settled_at = now()
    where r.id = v_row.id and r.state = 'reserved';
    if found then
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.ef_credit_sweep(interval) from public, anon, authenticated;
grant execute on function public.ef_credit_sweep(interval) to service_role;
comment on function public.ef_credit_sweep(interval) is
  'Eski acik EF rezervlerini serbest birakir (reason sweep); en az 1 dk, tek seferde en cok 5000. Service-role-only.';

-- ef_credit_ready() -> boolean (hata firlatmaz)
create or replace function public.ef_credit_ready()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- SQL editorunde auth.role() service_role degildir: FALSE beklenir, hata degildir.
  if auth.role() is distinct from 'service_role' then
    return false;
  end if;

  if pg_catalog.to_regclass('public.ef_credit_reservations') is null then
    return false;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint c
    where c.conrelid = pg_catalog.to_regclass('public.account_credit_ledger')
      and c.conname = 'account_credit_ledger_unit_check'
      and position('''ef''' in pg_catalog.pg_get_constraintdef(c.oid)) > 0
  ) then
    return false;
  end if;

  if pg_catalog.to_regprocedure('public.ef_credit_balance(uuid)') is null
    or pg_catalog.to_regprocedure('public.ef_credit_reserve(uuid, uuid, integer, text, text)') is null
    or pg_catalog.to_regprocedure('public.ef_credit_commit(uuid, uuid, jsonb)') is null
    or pg_catalog.to_regprocedure('public.ef_credit_release(uuid, uuid, text)') is null
    or pg_catalog.to_regprocedure('public.ef_credit_grant(uuid, integer, text, text, jsonb)') is null
    or pg_catalog.to_regprocedure('public.ef_credit_sweep(interval)') is null then
    return false;
  end if;

  -- Kontor paketi faturasi (20260826000300) iki fatura govdesinde de islenmeli.
  if not exists (
    select 1 from pg_catalog.pg_proc p
    where p.oid = pg_catalog.to_regprocedure('public.fulfill_billing_payment(text, text, text, text, text, uuid, text, text, numeric, text)')
      and position('credit-pack:v1' in p.prosrc) > 0
  ) or not exists (
    select 1 from pg_catalog.pg_proc p
    where p.oid = pg_catalog.to_regprocedure('public.fulfill_billing_payment_v2(text, text, text, text, text, uuid, text, text, numeric, text)')
      and position('credit-pack:v1' in p.prosrc) > 0
  ) then
    return false;
  end if;

  return true;
exception when others then
  return false;
end;
$$;

revoke all on function public.ef_credit_ready() from public, anon, authenticated;
grant execute on function public.ef_credit_ready() to service_role;
comment on function public.ef_credit_ready() is
  'EF kontor hazir mi: cuzdan RPC''leri + ef birimi + rezerv tablosu + fulfill/v2 credit-pack:v1. Hata firlatmaz; yalniz service_role kimliginde true.';

notify pgrst, 'reload schema';
