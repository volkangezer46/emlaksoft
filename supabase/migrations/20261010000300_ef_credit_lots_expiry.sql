-- MIGRATION 20261010000300_ef_credit_lots_expiry.sql (EmlakFiyati SURELI KONTOR, 2026-10-10)
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20261010000300_ef_credit_lots_expiry.sql` ile uygular.
-- Geri alma: supabase/rollbacks/20261010000300_ef_credit_lots_expiry.rollback.sql
--
-- KARAR (sahip, 2026-10-10): kontor YALNIZ degerleme icin harcanir; kontorler SURESIZ DEGIL: paketler 1/3/6/12 aylik
-- satilir ve kullanilmayan kontor SURE SONUNDA YANAR (devretmez). Harcama en once sona erecek partiden (FIFO by expires_at).
--
-- TASARIM (en sade): defter (account_credit_ledger) append-only KALIR ve degismez; yanma/harcama ONA satir olarak yazilir.
--   Kalan miktar + son kullanma YENI tablo public.ef_credit_lots'tadir (mutable remaining; yazma yalniz service_role RPC).
--   * Her ef grant -> 1 lot (grant_key = defter idempotency_key). Defterde ef grant expires_at NULL kalir (CHECK ve
--     account_credit_balances gorunumu degismez); son kullanma YALNIZ lotta.
--   * available = SUM(lot.remaining, expires_at > now()) - acik rezerv. Sure dolan lot "available"a girmez.
--   * Harcama (ef_credit_commit): sure dolmamis lotlar en yakin son kullanmadan baslayarak azalir; defter spend satiri
--     (source usage, toplam) + meta.lots dagilimi yazilir. Rezerv ile commit arasinda sure dolarsa kalan acik rezerv
--     SURESI DOLMUS ama henuz yanmamis lotlardan karsilanir (yanma 1 saat yumusama payi ile yapilir).
--   * Yanma (ef_credit_burn_expired): lot.remaining > 0 ve expires_at <= now() - 1 saat olanlar icin defter
--     spend (source 'expire', feature 'ef_expire_lot', anahtar 'ef:burn:<lot>') + lot.remaining = 0. Mevcut gunluk
--     cron'a (ef-kontor-hak) ADIM olarak eklenir; yeni cron YOK.
--   * Degismez: SUM(lot.remaining) = SUM(ef defter amount) (tenant basina). Mutabakat sorgusu en altta.
--
-- SURE KURALLARI (ef_credit_grant; TS config.ts ile AYNI: EF_WELCOME_VALID_DAYS=30, EF_DEFAULT_GRANT_VALID_MONTHS=12):
--   plan_monthly -> Istanbul ayinin sonu (devretmez; ay ici yukseltme farki da ayni ay sonu)
--   bonus        -> p_meta.validityMonths yoksa 30 gun (hos geldin)
--   purchase     -> p_meta.validityMonths, yoksa fatura meta.validityMonths (checkout yazar), yoksa 12 ay
--   admin|refund -> p_meta.validityMonths, yoksa 12 ay
--   validityMonths tamsayi 1..24 olmali; aksi 22023.
--
-- FULFILL DEGISMEZ: fulfill_billing_payment/_v2 (credit-pack:v1) AYNEN kalir; sure faturadaki meta.validityMonths'tan
--   ef_credit_grant icinde okunur (grant meta'sindaki invoiceId ile). Boylece 1600 satirlik govde yeniden yazilmaz.
--
-- MEVCUT BAKIYELER: net defter bakiyesi (grant - spend) > 0 olan her ofis icin TEK SEFERLIK 'legacy' lot, 12 ay sureli
--   (yalniz sahibin test ofisleri: volkan-deneme 10, gezertasar 120, demo-ofis 120). Idempotent (grant_key tekil).
--
-- ef_credit_expire_plan (20260826001200, devir tavani) artik gereksiz (aylik hak ay sonunda yanar): govdesi NO-OP olur
--   (imza ayni; {ok,already,expired:0,available}). reserve/release/sweep DEGISMEZ (reserve bakiyeyi ef_credit_balance'tan okur).
--
-- BAGIMLILIK: 20260826000100 (cuzdan) + 20260826001200 (expire_plan, 'expire' kaynagi) canli; eksikse HICBIR sey yazmadan durur.
-- ONERILEN SIRA: 20261008001000 (fiyat/tarife/katalog seed) -> BU DOSYA. Kod, lotlar hazir degilken paket satisini kapali tutar
--   (ef_credit_lots_ready()); bakiye okuma/harcama eski akisla calismaya devam eder.
--
-- SALT-OKUNUR DOGRULAMA (uygulamadan SONRA):
-- select to_regclass('public.ef_credit_lots') is not null as tablo,
--        (select count(*) from public.ef_credit_lots where kind = 'legacy') as legacy_lot,   -- BEKLENEN 3
--        (select coalesce(sum(remaining),0) from public.ef_credit_lots) as lot_toplam,        -- BEKLENEN 250
--        (select coalesce(sum(amount),0) from public.account_credit_ledger where unit = 'ef') as defter_toplam; -- = lot_toplam

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.account_credit_ledger') is null
    or pg_catalog.to_regclass('public.ef_credit_reservations') is null
    or pg_catalog.to_regprocedure('public.ef_credit_balance(uuid)') is null
    or pg_catalog.to_regprocedure('public.ef_credit_commit(uuid, uuid, jsonb)') is null
    or pg_catalog.to_regprocedure('public.ef_credit_grant(uuid, integer, text, text, jsonb)') is null then
    raise exception '20261010000300: once 20260826000100_ef_credit_wallet.sql uygulanmali.';
  end if;
  if pg_catalog.to_regprocedure('public.ef_credit_expire_plan(uuid, integer, text)') is null then
    raise exception '20261010000300: once 20260826001200_ef_plan_credit_expiry.sql uygulanmali.';
  end if;
  if pg_catalog.to_regclass('public.invoices') is null or pg_catalog.to_regclass('public.tenants') is null then
    raise exception '20261010000300: invoices/tenants yok.';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. Kontor partileri (lot) tablosu
-- ---------------------------------------------------------------------------
create table if not exists public.ef_credit_lots (
  id          uuid not null default gen_random_uuid(),
  tenant_id   uuid not null,
  kind        text not null,
  units       integer not null,
  remaining   integer not null,
  expires_at  timestamptz not null,
  grant_key   text not null,
  created_at  timestamptz not null default now(),
  burned_at   timestamptz,
  meta        jsonb,
  constraint ef_credit_lots_pkey primary key (id),
  constraint ef_credit_lots_tenant_id_fkey foreign key (tenant_id)
    references public.tenants(id) on delete cascade,
  constraint ef_credit_lots_grant_key_key unique (grant_key),
  constraint ef_credit_lots_kind_check check (kind in ('purchase', 'plan_monthly', 'bonus', 'admin', 'refund', 'legacy')),
  constraint ef_credit_lots_units_check check (units > 0),
  constraint ef_credit_lots_remaining_check check (remaining >= 0 and remaining <= units),
  constraint ef_credit_lots_burned_check check (burned_at is null or remaining = 0),
  constraint ef_credit_lots_meta_check check (meta is null or (jsonb_typeof(meta) = 'object' and octet_length(meta::text) <= 4000))
);

comment on table public.ef_credit_lots is
  'EmlakFiyati kontor partileri (sureli). remaining yalniz service_role ef_credit_* RPC''leriyle azalir; defter append-only kalir. Kisisel veri yok.';

-- FIFO okuma + bakiye: tenant icin kalan > 0 partiler, en yakin son kullanma once.
create index if not exists idx_ef_credit_lots_tenant_live
  on public.ef_credit_lots (tenant_id, expires_at, created_at)
  where remaining > 0;
-- Yanma taramasi (tenant bagimsiz).
create index if not exists idx_ef_credit_lots_burn
  on public.ef_credit_lots (expires_at)
  where remaining > 0;

-- remaining yalniz AZALIR; kimlik/birim/sure/anahtar degismez; burned_at yalniz bir kez yazilir.
create or replace function public.ef_credit_lots_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
    or new.tenant_id is distinct from old.tenant_id
    or new.kind is distinct from old.kind
    or new.units is distinct from old.units
    or new.expires_at is distinct from old.expires_at
    or new.grant_key is distinct from old.grant_key
    or new.created_at is distinct from old.created_at then
    raise exception 'ef_credit_lots: degismez alan guncellenemez.' using errcode = '42501';
  end if;
  if new.remaining > old.remaining then
    raise exception 'ef_credit_lots: kalan artirilamaz.' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.ef_credit_lots_guard() from public, anon, authenticated;

drop trigger if exists trg_ef_credit_lots_guard on public.ef_credit_lots;
create trigger trg_ef_credit_lots_guard
  before update on public.ef_credit_lots
  for each row execute function public.ef_credit_lots_guard();

alter table public.ef_credit_lots enable row level security;
drop policy if exists ef_credit_lots_select on public.ef_credit_lots;
create policy ef_credit_lots_select on public.ef_credit_lots
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_profile_role()) in ('owner', 'gm')
  );
revoke all privileges on table public.ef_credit_lots from public, anon, authenticated;
grant select on table public.ef_credit_lots to authenticated;
grant all privileges on table public.ef_credit_lots to service_role;

-- ---------------------------------------------------------------------------
-- 2. Mevcut bakiyeler: tek seferlik 12 aylik 'legacy' lot (defter net bakiyesi kadar)
-- ---------------------------------------------------------------------------
insert into public.ef_credit_lots (tenant_id, kind, units, remaining, expires_at, grant_key, meta)
select t.tenant_id, 'legacy', t.bal, t.bal, now() + interval '12 months', 'ef:legacy:' || t.tenant_id::text,
       jsonb_build_object('legacy', true, 'migration', '20261010000300')
from (
  select l.tenant_id, sum(l.amount)::integer as bal
  from public.account_credit_ledger l
  where l.unit = 'ef'
  group by l.tenant_id
  having sum(l.amount) > 0
) t
on conflict (grant_key) do nothing;

-- ---------------------------------------------------------------------------
-- 3. ef_credit_balance: partilerden (sure dolmamis) hesap; ek alanlar geriye uyumlu
-- ---------------------------------------------------------------------------
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
  v_expired bigint;
  v_reserved bigint;
  v_live bigint;
  v_next_at timestamptz;
  v_next_units bigint;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if p_tenant is null then
    raise exception 'Tenant is required.' using errcode = '22023';
  end if;

  select
    coalesce(sum(l.amount) filter (where l.entry_type = 'grant'), 0)::bigint,
    coalesce(-sum(l.amount) filter (where l.entry_type = 'spend' and l.source is distinct from 'expire'), 0)::bigint,
    coalesce(-sum(l.amount) filter (where l.entry_type = 'spend' and l.source = 'expire'), 0)::bigint
  into v_granted, v_spent, v_expired
  from public.account_credit_ledger l
  where l.tenant_id = p_tenant and l.unit = 'ef';

  select coalesce(sum(r.units), 0)::bigint into v_reserved
  from public.ef_credit_reservations r
  where r.tenant_id = p_tenant and r.state = 'reserved';

  select coalesce(sum(o.remaining), 0)::bigint into v_live
  from public.ef_credit_lots o
  where o.tenant_id = p_tenant and o.remaining > 0 and o.expires_at > now();

  -- Sonraki yanma: sure dolmamis en yakin parti (ayni ani paylasanlar toplanir).
  select o.expires_at into v_next_at
  from public.ef_credit_lots o
  where o.tenant_id = p_tenant and o.remaining > 0 and o.expires_at > now()
  order by o.expires_at
  limit 1;
  if v_next_at is not null then
    select coalesce(sum(o.remaining), 0)::bigint into v_next_units
    from public.ef_credit_lots o
    where o.tenant_id = p_tenant and o.remaining > 0 and o.expires_at = v_next_at;
  end if;

  return jsonb_build_object(
    'available', greatest(v_live - v_reserved, 0),
    'reserved', v_reserved,
    'granted_total', v_granted,
    'committed_total', v_spent,
    'expired_total', v_expired,
    'next_expiry_at', v_next_at,
    'next_expiry_units', coalesce(v_next_units, 0)
  );
end;
$$;

revoke all on function public.ef_credit_balance(uuid) from public, anon, authenticated;
grant execute on function public.ef_credit_balance(uuid) to service_role;
comment on function public.ef_credit_balance(uuid) is
  'EF kontor bakiyesi: available = sure dolmamis parti kalani - acik rezerv. expired_total/next_expiry_* ek. Service-role-only.';

-- ---------------------------------------------------------------------------
-- 4. ef_credit_commit: kesinlestirmede partilerden FIFO (en yakin son kullanma once)
-- ---------------------------------------------------------------------------
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
  v_lot record;
  v_need integer;
  v_take integer;
  v_used jsonb := '[]'::jsonb;
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

  -- reserved -> committed: partilerden FIFO dus (sure dolmamis once, en yakin son kullanma once), sonra defter satiri + durum.
  v_need := v_row.units;
  for v_lot in
    select o.id, o.remaining
    from public.ef_credit_lots o
    where o.tenant_id = p_tenant and o.remaining > 0
    order by (o.expires_at <= now()), o.expires_at, o.created_at, o.id
    for update
  loop
    exit when v_need <= 0;
    v_take := least(v_lot.remaining, v_need);
    update public.ef_credit_lots o set remaining = o.remaining - v_take where o.id = v_lot.id;
    v_used := v_used || jsonb_build_array(jsonb_build_object('lot', v_lot.id::text, 'units', v_take));
    v_need := v_need - v_take;
  end loop;

  -- Defter: gercekten dusulen kadar (normalde units; partiler yetmezse kalan kadar). Tek satir, rezerv kimligiyle tekil.
  if v_row.units - v_need > 0 then
    insert into public.account_credit_ledger
      (tenant_id, unit, entry_type, amount, source, source_id, idempotency_key, created_by, feature, meta)
    values
      (p_tenant, 'ef', 'spend', -(v_row.units - v_need), 'usage', v_row.id, 'ef:spend:' || v_row.id::text, v_row.user_id, v_row.item,
       jsonb_build_object('lots', v_used));
  end if;

  update public.ef_credit_reservations r
  set state = 'committed', settled_at = now(), ref = coalesce(p_ref, r.ref)
  where r.id = v_row.id;

  return jsonb_build_object('ok', true, 'state', 'committed', 'already', false);
end;
$$;

revoke all on function public.ef_credit_commit(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.ef_credit_commit(uuid, uuid, jsonb) to service_role;
comment on function public.ef_credit_commit(uuid, uuid, jsonb) is
  'EF kontor kesinlestirme: reserved -> committed; partilerden FIFO dusum (en yakin son kullanma once) + defter spend; idempotent (already=true). Service-role-only.';

-- ---------------------------------------------------------------------------
-- 5. ef_credit_grant: her yukleme bir sureli lot olusturur
-- ---------------------------------------------------------------------------
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
  v_months integer;
  v_expires timestamptz;
  v_raw text;
begin
  -- lots:v1 (20261010000300): sureli parti isareti (ef_credit_lots_ready bunu arar).
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

  -- Son kullanma tarihi (kurallar dosya basliginda; TS config.ts ile ayni).
  if p_kind = 'plan_monthly' then
    -- Istanbul ayinin sonu (ertesi ayin 1'i 00:00 Istanbul)
    v_expires := (date_trunc('month', now() at time zone 'Europe/Istanbul') + interval '1 month') at time zone 'Europe/Istanbul';
  else
    v_raw := nullif(btrim(coalesce(p_meta ->> 'validityMonths', '')), '');
    if v_raw is null and p_kind = 'purchase' and p_meta ? 'invoiceId' then
      -- Paket faturasi: sure checkout'ta faturanin meta'sina yazilir (fulfill govdesi degismedi).
      begin
        select nullif(btrim(coalesce(i.meta ->> 'validityMonths', '')), '') into v_raw
        from public.invoices i
        where i.id = (p_meta ->> 'invoiceId')::uuid and i.tenant_id = p_tenant;
      exception when others then
        v_raw := null;
      end;
    end if;
    if v_raw is not null then
      if v_raw !~ '^[0-9]{1,2}$' or v_raw::integer < 1 or v_raw::integer > 24 then
        raise exception 'Invalid validity months.' using errcode = '22023';
      end if;
      v_months := v_raw::integer;
      v_expires := now() + make_interval(months => v_months);
    elsif p_kind = 'bonus' then
      v_expires := now() + interval '30 days';
    else
      v_expires := now() + interval '12 months';
    end if;
  end if;

  -- Defter (suresiz kayit; son kullanma lotta) + parti.
  insert into public.account_credit_ledger
    (tenant_id, unit, entry_type, amount, source, idempotency_key, feature, meta)
  values
    (p_tenant, 'ef', 'grant', p_units, v_source, v_key, 'ef_grant:' || p_kind, p_meta);

  insert into public.ef_credit_lots (tenant_id, kind, units, remaining, expires_at, grant_key, meta)
  values (p_tenant, p_kind, p_units, p_units, v_expires, v_key, p_meta);

  v_available := (public.ef_credit_balance(p_tenant) ->> 'available')::bigint;
  return jsonb_build_object('ok', true, 'already', false, 'available', v_available, 'expires_at', v_expires);
end;
$$;

revoke all on function public.ef_credit_grant(uuid, integer, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.ef_credit_grant(uuid, integer, text, text, jsonb) to service_role;
comment on function public.ef_credit_grant(uuid, integer, text, text, jsonb) is
  'EF kontor yukleme (purchase|plan_monthly|bonus|admin|refund); (tenant,p_idem) tekil; SURELI parti (lots:v1): plan=ay sonu, bonus=30 gun, paket=validityMonths. Service-role-only.';

-- ---------------------------------------------------------------------------
-- 6. ef_credit_burn_expired: suresi dolan partileri yakar (gunluk cron adimi)
-- ---------------------------------------------------------------------------
create or replace function public.ef_credit_burn_expired(
  p_limit integer default 500,
  p_grace interval default interval '1 hour'
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_lot public.ef_credit_lots%rowtype;
  v_lots integer := 0;
  v_units bigint := 0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 5000 then
    raise exception 'Invalid limit.' using errcode = '22023';
  end if;
  if p_grace is null or p_grace < interval '0 minutes' or p_grace > interval '7 days' then
    raise exception 'Invalid grace.' using errcode = '22023';
  end if;

  -- Es zamanli ikinci kosu beklemez.
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('ef-credit:burn', 0)) then
    return jsonb_build_object('ok', true, 'burned_lots', 0, 'burned_units', 0, 'skipped', true);
  end if;

  -- Kilit sirasi: tenant kilidi -> parti satiri (commit ile ayni); tenant sirasiyla, cikmaz yok.
  for v_row in
    select o.id, o.tenant_id
    from public.ef_credit_lots o
    where o.remaining > 0 and o.expires_at <= now() - p_grace
    order by o.tenant_id, o.expires_at, o.id
    limit p_limit
  loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ef-credit:' || v_row.tenant_id::text, 0));

    select o.* into v_lot from public.ef_credit_lots o where o.id = v_row.id for update;
    if not found or v_lot.remaining <= 0 then
      continue;
    end if;

    insert into public.account_credit_ledger
      (tenant_id, unit, entry_type, amount, source, source_id, idempotency_key, feature, meta)
    values
      (v_lot.tenant_id, 'ef', 'spend', -v_lot.remaining, 'expire', v_lot.id, 'ef:burn:' || v_lot.id::text, 'ef_expire_lot',
       jsonb_build_object('lot', v_lot.id::text, 'kind', v_lot.kind, 'expires_at', v_lot.expires_at));

    update public.ef_credit_lots o set remaining = 0, burned_at = now() where o.id = v_lot.id;

    v_lots := v_lots + 1;
    v_units := v_units + v_lot.remaining;
  end loop;

  return jsonb_build_object('ok', true, 'burned_lots', v_lots, 'burned_units', v_units, 'skipped', false);
end;
$$;

revoke all on function public.ef_credit_burn_expired(integer, interval) from public, anon, authenticated;
grant execute on function public.ef_credit_burn_expired(integer, interval) to service_role;
comment on function public.ef_credit_burn_expired(integer, interval) is
  'Suresi dolan EF kontor partilerini yakar (defter spend source expire + kalan=0); idempotent. Gunluk ef-kontor-hak cron adimi. Service-role-only.';

-- ---------------------------------------------------------------------------
-- 7. ef_credit_expire_plan: devir tavani KALDIRILDI (aylik hak ay sonunda yanar) -> NO-OP (imza ayni)
-- ---------------------------------------------------------------------------
create or replace function public.ef_credit_expire_plan(
  p_tenant uuid,
  p_keep integer,
  p_idem text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_available bigint;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if p_tenant is null then
    raise exception 'Tenant is required.' using errcode = '22023';
  end if;
  v_available := (public.ef_credit_balance(p_tenant) ->> 'available')::bigint;
  return jsonb_build_object('ok', true, 'already', false, 'expired', 0, 'available', v_available);
end;
$$;

revoke all on function public.ef_credit_expire_plan(uuid, integer, text) from public, anon, authenticated;
grant execute on function public.ef_credit_expire_plan(uuid, integer, text) to service_role;
comment on function public.ef_credit_expire_plan(uuid, integer, text) is
  'KULLANIMDAN KALKTI (20261010000300): aylik hak ay sonunda yanar; devir tavani yok. NO-OP, imza geriye uyum icin duruyor. Service-role-only.';

-- ---------------------------------------------------------------------------
-- 8. ef_credit_lots_ready: sureli parti sistemi hazir mi (paket satisi bunu bekler). Hata firlatmaz.
-- ---------------------------------------------------------------------------
create or replace function public.ef_credit_lots_ready()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role' then
    return false;
  end if;
  if pg_catalog.to_regclass('public.ef_credit_lots') is null
    or pg_catalog.to_regprocedure('public.ef_credit_burn_expired(integer, interval)') is null then
    return false;
  end if;
  -- Sureli grant govdesi (lots:v1) canli olmali: eski govdeyle paket satilirsa kontor suresiz kalirdi.
  if not exists (
    select 1 from pg_catalog.pg_proc p
    where p.oid = pg_catalog.to_regprocedure('public.ef_credit_grant(uuid, integer, text, text, jsonb)')
      and position('lots:v1' in p.prosrc) > 0
  ) then
    return false;
  end if;
  return true;
exception when others then
  return false;
end;
$$;

revoke all on function public.ef_credit_lots_ready() from public, anon, authenticated;
grant execute on function public.ef_credit_lots_ready() to service_role;
comment on function public.ef_credit_lots_ready() is
  'Sureli EF kontor partileri hazir mi (tablo + yanma RPC + lots:v1 grant). Hata firlatmaz; yalniz service_role kimliginde true.';

notify pgrst, 'reload schema';

-- MUTABAKAT (salt-okunur; her zaman bos donmeli): lot toplami = defter toplami (tenant basina)
-- select l.tenant_id, l.lots, d.ledger from
--   (select tenant_id, sum(remaining) lots from public.ef_credit_lots group by 1) l
--   full join (select tenant_id, sum(amount) ledger from public.account_credit_ledger where unit = 'ef' group by 1) d using (tenant_id)
--  where coalesce(l.lots, 0) <> coalesce(d.ledger, 0);
