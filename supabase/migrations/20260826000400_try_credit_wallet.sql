-- MIGRATION 20260826000400_try_credit_wallet.sql
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20260826000400_try_credit_wallet.sql` ile uygular.
-- Geri alma: supabase/rollbacks/20260826000400_try_credit_wallet.rollback.sql (once 000500 rollback'i).
--
-- TL HESAP KREDISI cuzdani (birim `try`). TEK defter: public.account_credit_ledger (append-only; unit `try` growth
-- migration'i 20260825000800'den beri CHECK'te, ama hicbir RPC/bakiye/UI yoktu). Kredi para degildir: yalniz
-- EmlakSoft faturalarindan (plan / ek kullanici / kontor paketi) dusulur; nakde cevrilmez. RPC sozlesmesi:
-- src/lib/try-credits/config.ts (TRY_RPC + sonuc tipleri) — ad, parametre adi/sirasi ve donus JSON anahtarlari BIREBIR
-- (sozlesme testi: src/lib/try-credits/try-wallet-sql-contract.test.ts).
--
-- NE DEGISIR
--   1. account_credit_ledger: nullable `meta jsonb` (ef migration'i da ekler; `if not exists`), `meta` CHECK'i yoksa
--      eklenir; yeni CHECK `account_credit_ledger_try_entry_check` YALNIZ unit='try' satirlarini kisitlar:
--      grant (+) | spend (-) | reverse (+/-) | expire (-) | adjust (+/-); grant icin expires_at > created_at.
--      ai/valuation/ef satirlari ve davranislari DEGISMEZ.
--   2. YENI tablo public.try_credit_reservations (rezerv -> kesinlestir | serbest birak; fatura baglantili; tek
--      yonlu durum gecisi guard tetikleyicisiyle; silme yok; fatura basina en cok BIR canli rezerv).
--   3. YENI view public.try_credit_movements (security_invoker; ofis hareketleri; idempotency_key/meta GOSTERMEZ).
--   4. YENI RPC'ler (service_role-only, SECURITY DEFINER, search_path=''): try_credit_balance, try_credit_grant,
--      try_credit_reserve, try_credit_commit, try_credit_release, try_credit_reverse.
--      Ofis okuma: try_credit_my_overview() (authenticated, YALNIZ kendi tenant'i; yazma yok).
--      Ic yardimcilar (kimseye acik degil): try_credit_calc_state, try_credit_calc_balance.
--
-- BAKIYE MODELI (append-only defter + TEKRAR OYNATMA)
--   Defter satirlari id sirasiyla oynatilir (tenant basina advisory lock altinda yazilir, bu yuzden id sirasi =
--   zaman sirasi; created_at = clock_timestamp()):
--     * pozitif satir (grant / + reverse / + adjust) = bir "kova" (tutar, expires_at); once varsa BORC kapatilir.
--     * negatif satir (spend / clawback / expire) = en erken vadeli, o an CANLI kovadan baslayarak tuketir; kova
--       yetmezse kalan BORC olur (clawback bakiyeyi eksiye dusurebilir, ama o satir harcanamaz).
--     * VADE: kova, expires_at <= simdi ise olu sayilir; vadeden once yapilan harcama o kovayi tuketmis olur
--       (FIFO by expiry). Vadesi gecen kalan tutar bakiyeden DUSER (ayri "expire" satiri yazmak gerekmez).
--   balance   = canli kovalarin toplami - borc            (EKSI olabilir)
--   available = max(balance - acik rezervler, 0)           (harcanabilir; rezerv ve commit ONUN uzerinden kontrol edilir)
--   NEGATIF BAKIYE HARCANAMAZ: rezerv yalniz available >= tutar iken acilir; commit yalniz o an
--   (balance - DIGER acik rezervler) >= tutar iken yazilir (vade/clawback araya girdiyse commit reddedilir).
--   Esitzamanlilik: her yazan RPC tenant basina pg_advisory_xact_lock('try-credit:<tenant>') alir; bakiye lock
--   altinda okunur => es zamanli iki harcama ayni krediyi iki kez kullanamaz.
--
-- TASARIM KARARLARI
--   * IDEMPOTENCY: grant/reverse defter anahtari 'try:grant:<tenant>:<p_idem>' / 'try:reverse:<tenant>:<p_idem>'
--     (defter anahtari kuresel tekil oldugu icin tenant onekli); ayni anahtar + farkli tutar/tur = 22023 (sessizce
--     yutulmaz). Ayni anahtar + ayni istek = already=true (ilk yazilan gecerli; expires_at karsilastirilmaz).
--     Rezerv: (tenant, p_idem) tekil; ayni anahtar farkli tutar/fatura = 22023.
--     p_idem biçimi: ^[A-Za-z0-9_.:-]{8,128}$ (ef cuzdaniyla ayni sinif).
--   * TUTAR: numeric(14,2), kurus; grant 0.01..1.000.000; rezerv 0.01..1.000.000. Tutar kurus hassasiyetine
--     indirgenemiyorsa (3+ ondalik) 22023.
--   * FATURA SINIRI (rezerv aninda): fatura ofise ait, status draft|open, para birimi TRY; kredi en cok
--     floor(total_try * p_max_share, 2) (p_max_share default 0.5, 0 < share <= 1). Fatura basina tek canli rezerv.
--     Fatura tutari/KDV'si DEGISMEZ; kredi faturanin KDV dahil TOPLAMINA uygulanir, iyzico yalniz kalani tahsil eder.
--   * CLAWBACK (try_credit_reverse): bakiye kontrolu YOK (eksiye dusebilir); p_original_idem verilirse o grant'in
--     toplam geri alinan tutari grant tutarini ASAMAZ.
--   * try_credit_ready(): 000500 tarafindan nihai haliyle (fatura odeme RPC'leri dahil) yeniden tanimlanir;
--     bu dosyada yalniz cuzdan parcasini yoklayan surum vardir. YALNIZ service_role kimliginde true doner
--     (SQL editorunde FALSE beklenir, hata degildir).
--
-- BAGIMLILIK: 20260826000100 (source CHECK'inde 'refund'/'bonus'/'purchase' + meta) ve 20260825000800/001000 (defter).
--   On-kosul blogu eksikse HICBIR sey yazmadan durur.
-- KILIT: account_credit_ledger uzerinde kisa ACCESS EXCLUSIVE (CHECK degisimi + tarama; tablo kucuk). lock_timeout 5 sn.
-- KOD: src/lib/try-credits/* ; kod try_credit_ready() true olmadan kredi akisini ACMAZ.
-- Yeni modul DEGIL: permission_defaults seed'i gerekmez (mevcut `billing` modulunun parcasi).
--
-- SALT-OKUNUR DOGRULAMA (uygulamadan SONRA):
-- select (select count(*) from pg_constraint where conname='account_credit_ledger_try_entry_check') as try_chk,
--        to_regclass('public.try_credit_reservations') is not null as tablo,
--        (select relrowsecurity from pg_class where oid='public.try_credit_reservations'::regclass) as rls,
--        (select count(*) from pg_policies where schemaname='public' and tablename='try_credit_reservations') as pol,
--        (select count(*) from pg_proc where pronamespace='public'::regnamespace and prosecdef and proname in
--          ('try_credit_balance','try_credit_grant','try_credit_reserve','try_credit_commit','try_credit_release','try_credit_reverse','try_credit_my_overview','try_credit_ready')) as fn,
--        has_function_privilege('authenticated','public.try_credit_reserve(uuid,uuid,numeric,text,uuid,numeric)','execute') as auth_exec,
--        has_function_privilege('authenticated','public.try_credit_my_overview()','execute') as my_exec,
--        (select count(*) from public.account_credit_ledger where unit='try') as try_satir;
-- BEKLENEN: 1 | t | t | 1 | 8 | f | t | (mevcut growth try satiri sayisi, normalde 0)

-- ---------------------------------------------------------------------------
-- 0. On-kosul
-- ---------------------------------------------------------------------------
set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.account_credit_ledger') is null then
    raise exception '20260826000400: public.account_credit_ledger yok; once 20260825000800 / 20260825001000 uygulanmali.';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_attribute a
    where a.attrelid = 'public.account_credit_ledger'::regclass and a.attname = 'feature'
      and a.attnum > 0 and not a.attisdropped
  ) then
    raise exception '20260826000400: account_credit_ledger.feature yok; once 20260825001000 uygulanmali.';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint c
    where c.conrelid = 'public.account_credit_ledger'::regclass
      and c.conname = 'account_credit_ledger_source_check'
      and position('''refund''' in pg_catalog.pg_get_constraintdef(c.oid)) > 0
      and position('''bonus''' in pg_catalog.pg_get_constraintdef(c.oid)) > 0
  ) then
    raise exception '20260826000400: account_credit_ledger_source_check refund/bonus icermiyor; once 20260826000100 uygulanmali.';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint c
    where c.conrelid = 'public.account_credit_ledger'::regclass
      and c.conname = 'account_credit_ledger_unit_check'
      and position('''try''' in pg_catalog.pg_get_constraintdef(c.oid)) > 0
  ) then
    raise exception '20260826000400: account_credit_ledger_unit_check try icermiyor; defter durumu beklenenden farkli.';
  end if;
  if pg_catalog.to_regclass('public.tenants') is null
    or pg_catalog.to_regclass('public.profiles') is null
    or pg_catalog.to_regclass('public.invoices') is null then
    raise exception '20260826000400: tenants/profiles/invoices yok.';
  end if;
  if pg_catalog.to_regprocedure('public.current_tenant_id()') is null
    or pg_catalog.to_regprocedure('public.current_profile_role()') is null then
    raise exception '20260826000400: current_tenant_id()/current_profile_role() yok.';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. Defter: meta + try satir bicimi
-- ---------------------------------------------------------------------------
alter table public.account_credit_ledger add column if not exists meta jsonb;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint c
    where c.conrelid = 'public.account_credit_ledger'::regclass and c.conname = 'account_credit_ledger_meta_check'
  ) then
    alter table public.account_credit_ledger add constraint account_credit_ledger_meta_check
      check (meta is null or (jsonb_typeof(meta) = 'object' and octet_length(meta::text) <= 4000));
  end if;
end
$$;

alter table public.account_credit_ledger drop constraint if exists account_credit_ledger_try_entry_check;
alter table public.account_credit_ledger add constraint account_credit_ledger_try_entry_check
  check (
    unit <> 'try'
    or (entry_type = 'grant' and amount > 0 and (expires_at is null or expires_at > created_at))
    or (entry_type = 'spend' and amount < 0)
    or entry_type = 'reverse'
    or (entry_type = 'expire' and amount < 0)
    or entry_type = 'adjust'
  );

-- ---------------------------------------------------------------------------
-- 2. Rezerv tablosu
-- ---------------------------------------------------------------------------
create table if not exists public.try_credit_reservations (
  id              uuid not null default gen_random_uuid(),
  tenant_id       uuid not null,
  user_id         uuid,
  invoice_id      uuid,
  amount          numeric(14,2) not null,
  idempotency_key text not null,
  state           text not null default 'reserved',
  ref             jsonb,
  reason          text,
  created_at      timestamptz not null default now(),
  settled_at      timestamptz,
  constraint try_credit_reservations_pkey primary key (id),
  constraint try_credit_reservations_tenant_id_fkey foreign key (tenant_id)
    references public.tenants(id) on delete cascade,
  constraint try_credit_reservations_user_id_fkey foreign key (user_id)
    references public.profiles(id) on delete set null,
  constraint try_credit_reservations_invoice_id_fkey foreign key (invoice_id)
    references public.invoices(id),
  constraint try_credit_reservations_tenant_idem_key unique (tenant_id, idempotency_key),
  constraint try_credit_reservations_tenant_id_id_key unique (tenant_id, id),
  constraint try_credit_reservations_amount_check check (amount > 0 and amount <= 1000000),
  constraint try_credit_reservations_state_check check (state in ('reserved', 'committed', 'released')),
  constraint try_credit_reservations_idem_check check (idempotency_key ~ '^[A-Za-z0-9_.:-]{8,128}$'),
  constraint try_credit_reservations_ref_check
    check (ref is null or (jsonb_typeof(ref) = 'object' and octet_length(ref::text) <= 4000)),
  constraint try_credit_reservations_reason_check check (reason is null or char_length(reason) between 1 and 200),
  constraint try_credit_reservations_settled_check check ((state = 'reserved') = (settled_at is null))
);

comment on table public.try_credit_reservations is
  'TL hesap kredisi rezervleri (reserved -> committed | released), fatura baglantili. Yazma yalniz service_role try_credit_* RPC''leri. Kisisel veri yok.';

-- Fatura basina en cok BIR canli (reserved/committed) rezerv: ayni faturaya iki kez kredi uygulanamaz.
create unique index if not exists uq_try_credit_reservations_invoice_live
  on public.try_credit_reservations (invoice_id)
  where invoice_id is not null and state in ('reserved', 'committed');
create index if not exists idx_try_credit_reservations_open
  on public.try_credit_reservations (tenant_id) include (amount)
  where state = 'reserved';
create index if not exists idx_try_credit_reservations_user
  on public.try_credit_reservations (tenant_id, user_id, created_at desc);
create index if not exists idx_try_credit_reservations_user_fk
  on public.try_credit_reservations (user_id)
  where user_id is not null;
create index if not exists idx_try_credit_reservations_invoice
  on public.try_credit_reservations (invoice_id)
  where invoice_id is not null;

-- Durum gecisi tek yonlu; kimlik/tutar/anahtar/fatura/zaman degismez; silme yok (denetim kaydi).
create or replace function public.try_credit_reservations_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'try_credit_reservations: kayit silinemez.' using errcode = '42501';
  end if;
  if new.id is distinct from old.id
    or new.tenant_id is distinct from old.tenant_id
    or new.amount is distinct from old.amount
    or new.idempotency_key is distinct from old.idempotency_key
    or new.invoice_id is distinct from old.invoice_id
    or new.created_at is distinct from old.created_at
    or (new.user_id is distinct from old.user_id and new.user_id is not null) then
    raise exception 'try_credit_reservations: degismez alan guncellenemez.' using errcode = '42501';
  end if;
  if old.state <> 'reserved' and new.state is distinct from old.state then
    raise exception 'try_credit_reservations: sonuclanmis rezervin durumu degisemez.' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.try_credit_reservations_guard() from public, anon, authenticated;

drop trigger if exists trg_try_credit_reservations_guard on public.try_credit_reservations;
create trigger trg_try_credit_reservations_guard
  before update or delete on public.try_credit_reservations
  for each row execute function public.try_credit_reservations_guard();

alter table public.try_credit_reservations enable row level security;
drop policy if exists try_credit_reservations_select on public.try_credit_reservations;
create policy try_credit_reservations_select on public.try_credit_reservations
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_profile_role()) in ('owner', 'gm')
  );
revoke all privileges on table public.try_credit_reservations from public, anon, authenticated;
grant select on table public.try_credit_reservations to authenticated;
grant all privileges on table public.try_credit_reservations to service_role;

-- ---------------------------------------------------------------------------
-- 3. Ofis hareket gorunumu (RLS: defterin mevcut tenant select politikasi gecerli; invoker haklariyla calisir)
-- ---------------------------------------------------------------------------
create or replace view public.try_credit_movements with (security_invoker = true) as
  select l.id, l.tenant_id, l.entry_type, l.amount, l.source, l.source_id, l.feature, l.expires_at, l.created_at
  from public.account_credit_ledger l
  where l.unit = 'try'
    and (select public.current_profile_role()) in ('owner', 'gm');

-- Defter tablosunun dogrudan okumasi da TL satirlarinda yalniz owner/gm'e acik (danisman meta/idempotency'yi gormez).
-- Diger birimler (ef/ai) icin mevcut ofis-ici okuma aynen korunur.
drop policy if exists credit_ledger_own_select on public.account_credit_ledger;
create policy credit_ledger_own_select on public.account_credit_ledger for select
  using (
    tenant_id = (select public.current_tenant_id())
    and (unit <> 'try' or (select public.current_profile_role()) in ('owner', 'gm'))
  );

revoke all privileges on table public.try_credit_movements from public, anon, authenticated;
grant select on table public.try_credit_movements to authenticated;
grant select on table public.try_credit_movements to service_role;

-- ---------------------------------------------------------------------------
-- 4. Ic yardimcilar (kimseye acik degil; yalniz asagidaki definer RPC'ler cagirir)
-- ---------------------------------------------------------------------------

-- Defter tekrar oynatma: canli kova toplami, borc, toplam grant/tuketim, vade bilgisi. KILIT ALMAZ (cagiran alir).
create or replace function public.try_credit_calc_state(p_tenant uuid, p_at timestamptz default now())
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r record;
  v_amts numeric[] := '{}';
  v_exps timestamptz[] := '{}';
  v_debt numeric := 0;
  v_granted numeric := 0;
  v_consumed numeric := 0;
  v_need numeric;
  v_amt numeric;
  v_take numeric;
  v_best integer;
  v_i integer;
  v_live numeric := 0;
  v_expiring numeric := 0;
  v_next timestamptz;
  v_buckets jsonb := '[]'::jsonb;
begin
  for r in
    select l.amount, l.expires_at, l.created_at
    from public.account_credit_ledger l
    where l.tenant_id = p_tenant and l.unit = 'try'
    order by l.id
  loop
    if r.amount > 0 then
      v_granted := v_granted + r.amount;
      v_amt := r.amount;
      if v_debt > 0 then
        v_take := least(v_debt, v_amt);
        v_debt := v_debt - v_take;
        v_amt := v_amt - v_take;
      end if;
      if v_amt > 0 then
        v_amts := v_amts || v_amt;
        v_exps := v_exps || r.expires_at;
      end if;
    else
      v_need := -r.amount;
      v_consumed := v_consumed + v_need;
      loop
        exit when v_need <= 0;
        v_best := 0;
        for v_i in 1 .. coalesce(array_length(v_amts, 1), 0) loop
          if v_amts[v_i] > 0 and (v_exps[v_i] is null or v_exps[v_i] > r.created_at) then
            if v_best = 0
              or (v_exps[v_i] is not null and (v_exps[v_best] is null or v_exps[v_i] < v_exps[v_best])) then
              v_best := v_i;
            end if;
          end if;
        end loop;
        exit when v_best = 0;
        v_take := least(v_need, v_amts[v_best]);
        v_amts[v_best] := v_amts[v_best] - v_take;
        v_need := v_need - v_take;
      end loop;
      if v_need > 0 then
        v_debt := v_debt + v_need;
      end if;
    end if;
  end loop;

  for v_i in 1 .. coalesce(array_length(v_amts, 1), 0) loop
    if v_amts[v_i] > 0 and (v_exps[v_i] is null or v_exps[v_i] > p_at) then
      v_live := v_live + v_amts[v_i];
      if v_exps[v_i] is not null then
        if v_next is null or v_exps[v_i] < v_next then
          v_next := v_exps[v_i];
        end if;
        if v_exps[v_i] <= p_at + interval '30 days' then
          v_expiring := v_expiring + v_amts[v_i];
        end if;
        v_buckets := v_buckets || jsonb_build_array(
          jsonb_build_object('amount', v_amts[v_i], 'expires_at', v_exps[v_i])
        );
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'live', v_live,
    'debt', v_debt,
    'granted_total', v_granted,
    'spent_total', v_consumed,
    'next_expiry_at', v_next,
    'expiring_amount', v_expiring,
    'expiring_buckets', v_buckets
  );
end;
$$;

revoke all on function public.try_credit_calc_state(uuid, timestamptz) from public, anon, authenticated, service_role;

create or replace function public.try_credit_calc_balance(p_tenant uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_state jsonb;
  v_reserved numeric;
  v_live numeric;
  v_debt numeric;
begin
  v_state := public.try_credit_calc_state(p_tenant, now());
  select coalesce(sum(r.amount), 0) into v_reserved
  from public.try_credit_reservations r
  where r.tenant_id = p_tenant and r.state = 'reserved';
  v_live := (v_state ->> 'live')::numeric;
  v_debt := (v_state ->> 'debt')::numeric;
  return jsonb_build_object(
    'available', greatest(v_live - v_debt - v_reserved, 0),
    'balance', v_live - v_debt,
    'reserved', v_reserved,
    'debt', v_debt,
    'granted_total', (v_state ->> 'granted_total')::numeric,
    'spent_total', (v_state ->> 'spent_total')::numeric,
    'next_expiry_at', v_state -> 'next_expiry_at',
    'expiring_amount', (v_state ->> 'expiring_amount')::numeric,
    'expiring_buckets', v_state -> 'expiring_buckets'
  );
end;
$$;

revoke all on function public.try_credit_calc_balance(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. RPC'ler (service_role-only). Sozlesme: src/lib/try-credits/config.ts TRY_RPC
-- ---------------------------------------------------------------------------

-- try_credit_balance(p_tenant uuid) -> jsonb TryBalance
create or replace function public.try_credit_balance(p_tenant uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if p_tenant is null then
    raise exception 'Tenant is required.' using errcode = '22023';
  end if;
  return public.try_credit_calc_balance(p_tenant);
end;
$$;

revoke all on function public.try_credit_balance(uuid) from public, anon, authenticated;
grant execute on function public.try_credit_balance(uuid) to service_role;
comment on function public.try_credit_balance(uuid) is
  'TL kredi bakiyesi: available (harcanabilir), balance (eksi olabilir), reserved, debt, vade bilgisi. Service-role-only.';

-- try_credit_grant(p_tenant, p_amount, p_kind, p_idem, p_expires_at, p_meta) -> jsonb TryGrantResult
create or replace function public.try_credit_grant(
  p_tenant uuid,
  p_amount numeric,
  p_kind text,
  p_idem text,
  p_expires_at timestamptz default null,
  p_meta jsonb default null
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
  v_bal jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if p_tenant is null then
    raise exception 'Tenant is required.' using errcode = '22023';
  end if;
  if p_amount is null or p_amount < 0.01 or p_amount > 1000000 or p_amount <> round(p_amount, 2) then
    raise exception 'Invalid amount.' using errcode = '22023';
  end if;
  -- config.ts TRY_GRANT_KINDS -> defter source (CHECK listesinde)
  v_source := case p_kind
    when 'referral' then 'referral'
    when 'partner' then 'partner'
    when 'campaign' then 'campaign'
    when 'manual' then 'manual'
    when 'bonus' then 'bonus'
    when 'refund' then 'refund'
  end;
  if v_source is null then
    raise exception 'Invalid grant kind.' using errcode = '22023';
  end if;
  if p_idem is null or p_idem !~ '^[A-Za-z0-9_.:-]{8,128}$' then
    raise exception 'Invalid idempotency key.' using errcode = '22023';
  end if;
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'Expiry must be in the future.' using errcode = '22023';
  end if;
  if p_meta is not null and (jsonb_typeof(p_meta) <> 'object' or octet_length(p_meta::text) > 4000) then
    raise exception 'Invalid meta.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.tenants t where t.id = p_tenant) then
    raise exception 'Tenant not found.' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('try-credit:' || p_tenant::text, 0));

  v_key := 'try:grant:' || p_tenant::text || ':' || p_idem;

  select l.amount, l.feature into v_existing_amount, v_existing_feature
  from public.account_credit_ledger l
  where l.idempotency_key = v_key;

  if found then
    if v_existing_amount <> p_amount or v_existing_feature is distinct from ('try_grant:' || p_kind) then
      raise exception 'Idempotency key reused with a different grant.' using errcode = '22023';
    end if;
    v_bal := public.try_credit_calc_balance(p_tenant);
    return jsonb_build_object(
      'ok', true,
      'already', true,
      'available', v_bal -> 'available',
      'balance', v_bal -> 'balance'
    );
  end if;

  insert into public.account_credit_ledger
    (tenant_id, unit, entry_type, amount, source, idempotency_key, expires_at, feature, meta, created_at)
  values
    (p_tenant, 'try', 'grant', p_amount, v_source, v_key, p_expires_at, 'try_grant:' || p_kind, p_meta, clock_timestamp());

  v_bal := public.try_credit_calc_balance(p_tenant);
  return jsonb_build_object(
    'ok', true,
    'already', false,
    'available', v_bal -> 'available',
    'balance', v_bal -> 'balance'
  );
end;
$$;

revoke all on function public.try_credit_grant(uuid, numeric, text, text, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.try_credit_grant(uuid, numeric, text, text, timestamptz, jsonb) to service_role;
comment on function public.try_credit_grant(uuid, numeric, text, text, timestamptz, jsonb) is
  'TL kredi yukleme (referral|partner|campaign|manual|bonus|refund); (tenant,p_idem) tekil; opsiyonel vade. Service-role-only.';

-- try_credit_reserve(p_tenant, p_user, p_amount, p_idem, p_invoice, p_max_share) -> jsonb TryReserveResult
create or replace function public.try_credit_reserve(
  p_tenant uuid,
  p_user uuid,
  p_amount numeric,
  p_idem text,
  p_invoice uuid,
  p_max_share numeric default 0.5
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_existing public.try_credit_reservations%rowtype;
  v_live public.try_credit_reservations%rowtype;
  v_inv_status text;
  v_inv_checkout text;
  v_inv_total numeric;
  v_inv_currency text;
  v_max numeric;
  v_bal jsonb;
  v_available numeric;
  v_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if p_tenant is null or p_invoice is null then
    raise exception 'Tenant and invoice are required.' using errcode = '22023';
  end if;
  if p_amount is null or p_amount < 0.01 or p_amount > 1000000 or p_amount <> round(p_amount, 2) then
    raise exception 'Invalid amount.' using errcode = '22023';
  end if;
  if p_idem is null or p_idem !~ '^[A-Za-z0-9_.:-]{8,128}$' then
    raise exception 'Invalid idempotency key.' using errcode = '22023';
  end if;
  if p_max_share is null or p_max_share <= 0 or p_max_share > 1 then
    raise exception 'Invalid max share.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.tenants t where t.id = p_tenant) then
    raise exception 'Tenant not found.' using errcode = '22023';
  end if;
  if p_user is not null and not exists (
    select 1 from public.profiles p where p.id = p_user and p.tenant_id = p_tenant
  ) then
    raise exception 'User does not belong to tenant.' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('try-credit:' || p_tenant::text, 0));

  select r.* into v_existing
  from public.try_credit_reservations r
  where r.tenant_id = p_tenant and r.idempotency_key = p_idem;

  if found then
    if v_existing.amount <> p_amount or v_existing.invoice_id is distinct from p_invoice then
      raise exception 'Idempotency key reused with a different request.' using errcode = '22023';
    end if;
    v_bal := public.try_credit_calc_balance(p_tenant);
    return jsonb_build_object(
      'ok', true,
      'code', 'duplicate',
      'reservation_id', v_existing.id::text,
      'state', v_existing.state,
      'amount', v_existing.amount,
      'available', v_bal -> 'available'
    );
  end if;

  select i.status, i.checkout_status, i.total_try, i.currency
    into v_inv_status, v_inv_checkout, v_inv_total, v_inv_currency
  from public.invoices i
  where i.id = p_invoice and i.tenant_id = p_tenant
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'invoice_not_found');
  end if;
  if v_inv_status not in ('draft', 'open')
    or coalesce(v_inv_checkout, '') in ('expired', 'initialization_failed')
    or upper(btrim(coalesce(v_inv_currency, ''))) <> 'TRY'
    or v_inv_total is null or v_inv_total <= 0 then
    return jsonb_build_object('ok', false, 'code', 'invoice_not_payable');
  end if;

  select r.* into v_live
  from public.try_credit_reservations r
  where r.invoice_id = p_invoice and r.state in ('reserved', 'committed')
  limit 1;
  if found then
    return jsonb_build_object(
      'ok', false,
      'code', 'invoice_already_reserved',
      'reservation_id', v_live.id::text,
      'state', v_live.state
    );
  end if;

  v_max := floor(v_inv_total * p_max_share * 100) / 100;
  if p_amount > v_max then
    return jsonb_build_object('ok', false, 'code', 'over_cap', 'max_amount', v_max);
  end if;

  v_bal := public.try_credit_calc_balance(p_tenant);
  v_available := (v_bal ->> 'available')::numeric;
  if v_available < p_amount then
    return jsonb_build_object('ok', false, 'code', 'insufficient', 'available', v_available);
  end if;

  insert into public.try_credit_reservations (tenant_id, user_id, invoice_id, amount, idempotency_key, state)
  values (p_tenant, p_user, p_invoice, p_amount, p_idem, 'reserved')
  returning id into v_id;

  -- Fatura tutari/KDV'si DEGISMEZ; yalniz bilgi amacli izleme alanlari (yetki kaynagi rezerv satiridir).
  update public.invoices i
  set meta = i.meta || jsonb_build_object(
    'walletReservationId', v_id::text,
    'walletCreditTry', p_amount,
    'walletCashTry', round(v_inv_total - p_amount, 2)
  )
  where i.id = p_invoice and i.tenant_id = p_tenant;

  return jsonb_build_object(
    'ok', true,
    'code', 'ok',
    'reservation_id', v_id::text,
    'state', 'reserved',
    'amount', p_amount,
    'available', v_available - p_amount
  );
end;
$$;

revoke all on function public.try_credit_reserve(uuid, uuid, numeric, text, uuid, numeric) from public, anon, authenticated;
grant execute on function public.try_credit_reserve(uuid, uuid, numeric, text, uuid, numeric) to service_role;
comment on function public.try_credit_reserve(uuid, uuid, numeric, text, uuid, numeric) is
  'TL kredi rezervi (fatura baglantili): (tenant,p_idem) tekil; fatura basina tek canli rezerv; en cok toplam*p_max_share; yetersizse ok=false/insufficient. Service-role-only.';

-- try_credit_commit(p_tenant, p_reservation, p_ref) -> jsonb TrySettleResult; yalniz reserved -> committed
create or replace function public.try_credit_commit(
  p_tenant uuid,
  p_reservation uuid,
  p_ref jsonb default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.try_credit_reservations%rowtype;
  v_state jsonb;
  v_reserved numeric;
  v_spendable numeric;
  v_consumed jsonb;
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

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('try-credit:' || p_tenant::text, 0));

  select r.* into v_row
  from public.try_credit_reservations r
  where r.tenant_id = p_tenant and r.id = p_reservation
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'state', 'unknown', 'already', false);
  end if;

  if v_row.state = 'committed' then
    if v_row.ref is null and p_ref is not null then
      update public.try_credit_reservations r set ref = p_ref where r.id = v_row.id;
    end if;
    return jsonb_build_object('ok', true, 'state', 'committed', 'already', true);
  end if;

  if v_row.state = 'released' then
    return jsonb_build_object('ok', false, 'state', 'released', 'already', false);
  end if;

  -- Harcanabilirlik commit ANINDA yeniden dogrulanir (vade/clawback rezervden sonra araya girmis olabilir):
  -- (canli bakiye - borc) - DIGER acik rezervler >= tutar.
  v_state := public.try_credit_calc_state(p_tenant, now());
  select coalesce(sum(r.amount), 0) into v_reserved
  from public.try_credit_reservations r
  where r.tenant_id = p_tenant and r.state = 'reserved' and r.id <> v_row.id;
  v_spendable := (v_state ->> 'live')::numeric - (v_state ->> 'debt')::numeric - v_reserved;
  if v_spendable < v_row.amount then
    return jsonb_build_object('ok', false, 'state', 'reserved', 'already', false, 'code', 'insufficient');
  end if;

  -- Hangi vadeli kovalardan harcandigi (iade ORIJINAL vade ile geri yazilsin diye): harcama en erken vadeliden baslar;
  -- vadeli kovalar bitince vadesiz kisim kalir (iade tarafi kalani vadesiz sayar).
  select coalesce(jsonb_agg(jsonb_build_object('amount', z.take, 'expires_at', z.exp) order by z.exp), '[]'::jsonb)
    into v_consumed
  from (
    select b.exp,
           least(b.amt, greatest(v_row.amount - coalesce(sum(b.amt) over (order by b.exp rows between unbounded preceding and 1 preceding), 0), 0)) as take
    from (
      select (e ->> 'amount')::numeric as amt, (e ->> 'expires_at')::timestamptz as exp
      from jsonb_array_elements(coalesce(v_state -> 'expiring_buckets', '[]'::jsonb)) e
    ) b
  ) z
  where z.take > 0;

  insert into public.account_credit_ledger
    (tenant_id, unit, entry_type, amount, source, source_id, idempotency_key, created_by, feature, meta, created_at)
  values
    (p_tenant, 'try', 'spend', -v_row.amount, 'usage', v_row.id, 'try:spend:' || v_row.id::text, v_row.user_id,
     'invoice_payment',
     jsonb_build_object('invoiceId', v_row.invoice_id::text, 'reservationId', v_row.id::text,
                        'consumedExpiries', v_consumed),
     clock_timestamp());

  update public.try_credit_reservations r
  set state = 'committed', settled_at = now(), ref = coalesce(p_ref, r.ref)
  where r.id = v_row.id;

  return jsonb_build_object('ok', true, 'state', 'committed', 'already', false);
end;
$$;

revoke all on function public.try_credit_commit(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.try_credit_commit(uuid, uuid, jsonb) to service_role;
comment on function public.try_credit_commit(uuid, uuid, jsonb) is
  'TL kredi kesinlestirme: yalniz reserved -> committed (defter spend satiri); commit aninda harcanabilirlik yeniden dogrulanir; idempotent (already=true). Service-role-only.';

-- try_credit_release(p_tenant, p_reservation, p_reason) -> jsonb TrySettleResult; yalniz reserved -> released
create or replace function public.try_credit_release(
  p_tenant uuid,
  p_reservation uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.try_credit_reservations%rowtype;
  v_reason text := left(nullif(btrim(coalesce(p_reason, '')), ''), 200);
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if p_tenant is null or p_reservation is null then
    raise exception 'Tenant and reservation are required.' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('try-credit:' || p_tenant::text, 0));

  select r.* into v_row
  from public.try_credit_reservations r
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

  update public.try_credit_reservations r
  set state = 'released', settled_at = now(), reason = coalesce(v_reason, 'released')
  where r.id = v_row.id;

  return jsonb_build_object('ok', true, 'state', 'released', 'already', false);
end;
$$;

revoke all on function public.try_credit_release(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.try_credit_release(uuid, uuid, text) to service_role;
comment on function public.try_credit_release(uuid, uuid, text) is
  'TL kredi serbest birakma: yalniz reserved -> released; idempotent (already=true). Service-role-only.';

-- try_credit_reverse(p_tenant, p_amount, p_reason, p_idem, p_original_idem, p_meta) -> jsonb TryReverseResult
-- CLAWBACK: bakiye kontrolu YOK (eksiye dusebilir; eksi bakiye harcanamaz). Defterde negatif 'reverse' satiri.
create or replace function public.try_credit_reverse(
  p_tenant uuid,
  p_amount numeric,
  p_reason text,
  p_idem text,
  p_original_idem text default null,
  p_meta jsonb default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_reason text := left(nullif(btrim(coalesce(p_reason, '')), ''), 200);
  v_key text;
  v_orig_key text;
  v_orig_amount numeric;
  v_orig_source text;
  v_already_reversed numeric;
  v_existing_amount numeric;
  v_source text := 'manual';
  v_meta jsonb;
  v_bal jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if p_tenant is null then
    raise exception 'Tenant is required.' using errcode = '22023';
  end if;
  if p_amount is null or p_amount < 0.01 or p_amount > 1000000 or p_amount <> round(p_amount, 2) then
    raise exception 'Invalid amount.' using errcode = '22023';
  end if;
  if v_reason is null then
    raise exception 'Reason is required.' using errcode = '22023';
  end if;
  if p_idem is null or p_idem !~ '^[A-Za-z0-9_.:-]{8,128}$' then
    raise exception 'Invalid idempotency key.' using errcode = '22023';
  end if;
  if p_original_idem is not null and p_original_idem !~ '^[A-Za-z0-9_.:-]{8,128}$' then
    raise exception 'Invalid original idempotency key.' using errcode = '22023';
  end if;
  if p_meta is not null and (jsonb_typeof(p_meta) <> 'object' or octet_length(p_meta::text) > 3000) then
    raise exception 'Invalid meta.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.tenants t where t.id = p_tenant) then
    raise exception 'Tenant not found.' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('try-credit:' || p_tenant::text, 0));

  v_key := 'try:reverse:' || p_tenant::text || ':' || p_idem;

  select -l.amount into v_existing_amount
  from public.account_credit_ledger l
  where l.idempotency_key = v_key;

  if found then
    if v_existing_amount <> p_amount then
      raise exception 'Idempotency key reused with a different reversal.' using errcode = '22023';
    end if;
    v_bal := public.try_credit_calc_balance(p_tenant);
    return jsonb_build_object(
      'ok', true,
      'already', true,
      'balance', v_bal -> 'balance',
      'available', v_bal -> 'available',
      'debt', v_bal -> 'debt'
    );
  end if;

  if p_original_idem is not null then
    v_orig_key := 'try:grant:' || p_tenant::text || ':' || p_original_idem;
    select l.amount, l.source into v_orig_amount, v_orig_source
    from public.account_credit_ledger l
    where l.tenant_id = p_tenant and l.unit = 'try' and l.entry_type = 'grant' and l.idempotency_key = v_orig_key;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'original_not_found');
    end if;
    select coalesce(sum(-l.amount), 0) into v_already_reversed
    from public.account_credit_ledger l
    where l.tenant_id = p_tenant and l.unit = 'try' and l.entry_type = 'reverse' and l.amount < 0
      and l.meta ->> 'reversesKey' = v_orig_key;
    if v_already_reversed + p_amount > v_orig_amount then
      return jsonb_build_object(
        'ok', false,
        'code', 'exceeds_original',
        'remaining', v_orig_amount - v_already_reversed
      );
    end if;
    v_source := v_orig_source;
  end if;

  v_meta := coalesce(p_meta, '{}'::jsonb) || jsonb_build_object('reason', v_reason);
  if v_orig_key is not null then
    v_meta := v_meta || jsonb_build_object('reversesKey', v_orig_key);
  end if;

  insert into public.account_credit_ledger
    (tenant_id, unit, entry_type, amount, source, idempotency_key, feature, meta, created_at)
  values
    (p_tenant, 'try', 'reverse', -p_amount, v_source, v_key, 'try_reverse', v_meta, clock_timestamp());

  v_bal := public.try_credit_calc_balance(p_tenant);
  return jsonb_build_object(
    'ok', true,
    'already', false,
    'balance', v_bal -> 'balance',
    'available', v_bal -> 'available',
    'debt', v_bal -> 'debt'
  );
end;
$$;

revoke all on function public.try_credit_reverse(uuid, numeric, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.try_credit_reverse(uuid, numeric, text, text, text, jsonb) to service_role;
comment on function public.try_credit_reverse(uuid, numeric, text, text, text, jsonb) is
  'TL kredi clawback: negatif reverse satiri; bakiye eksiye dusebilir ama harcanamaz; p_original_idem verilirse grant tutarini asamaz. Service-role-only.';

-- try_credit_my_overview() -> jsonb: OFIS OKUMA (authenticated; YALNIZ kendi tenant'i; yazma yok)
create or replace function public.try_credit_my_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := (select public.current_tenant_id());
  v_bal jsonb;
  v_open jsonb;
begin
  if auth.role() is distinct from 'authenticated' or v_tenant is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  -- Bakiye/rezerv ozeti yalniz owner/gm (danisman gormez).
  if (select public.current_profile_role()) not in ('owner', 'gm') then
    raise exception 'Owner/gm required.' using errcode = '42501';
  end if;

  v_bal := public.try_credit_calc_balance(v_tenant);

  select coalesce(jsonb_agg(jsonb_build_object(
      'reservation_id', r.id::text,
      'invoice_id', r.invoice_id::text,
      'amount', r.amount,
      'created_at', r.created_at
    ) order by r.created_at desc), '[]'::jsonb)
    into v_open
  from public.try_credit_reservations r
  where r.tenant_id = v_tenant and r.state = 'reserved';

  return v_bal || jsonb_build_object('open_reservations', v_open);
end;
$$;

revoke all on function public.try_credit_my_overview() from public, anon;
grant execute on function public.try_credit_my_overview() to authenticated;
comment on function public.try_credit_my_overview() is
  'Ofis okuma: oturumdaki tenant''in TL kredi ozeti (bakiye, vade, acik rezervler). Yazma yok.';

-- try_credit_ready() -> boolean (hata firlatmaz). 000500 nihai surumle yeniden tanimlar.
create or replace function public.try_credit_ready()
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
  if pg_catalog.to_regclass('public.try_credit_reservations') is null then
    return false;
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint c
    where c.conrelid = pg_catalog.to_regclass('public.account_credit_ledger')
      and c.conname = 'account_credit_ledger_try_entry_check'
  ) then
    return false;
  end if;
  if pg_catalog.to_regprocedure('public.try_credit_balance(uuid)') is null
    or pg_catalog.to_regprocedure('public.try_credit_grant(uuid, numeric, text, text, timestamptz, jsonb)') is null
    or pg_catalog.to_regprocedure('public.try_credit_reserve(uuid, uuid, numeric, text, uuid, numeric)') is null
    or pg_catalog.to_regprocedure('public.try_credit_commit(uuid, uuid, jsonb)') is null
    or pg_catalog.to_regprocedure('public.try_credit_release(uuid, uuid, text)') is null
    or pg_catalog.to_regprocedure('public.try_credit_reverse(uuid, numeric, text, text, text, jsonb)') is null then
    return false;
  end if;
  return true;
exception when others then
  return false;
end;
$$;

revoke all on function public.try_credit_ready() from public, anon, authenticated;
grant execute on function public.try_credit_ready() to service_role;

notify pgrst, 'reload schema';
