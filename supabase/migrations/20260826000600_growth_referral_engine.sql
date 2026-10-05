-- MIGRATION 20260826000600_growth_referral_engine.sql
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20260826000600_growth_referral_engine.sql` ile uygular.
-- Geri alma: supabase/rollbacks/20260826000600_growth_referral_engine.rollback.sql
-- BAGIMLILIK (sirayla): 20260825000800 (growth_* tablolari) -> 20260825000900 (tiklama sayaci) -> 20260826000400/000500 (TL cuzdan).
--   On-kosul blogu eksikse HICBIR sey yazmadan durur.
--
-- MUSTERI-GETIR-MUSTERI (FAZ 1) + PROFESYONEL ORTAK (FAZ 2) MOTORU. Tasarim: docs/design/REFERANS_PROGRAMI.md.
-- Bayraklar platform_settings'te VARSAYILAN KAPALI: growth_referral_enabled, growth_partner_enabled,
-- growth_cash_payout_enabled. Bu migration hicbir bayragi ACMAZ ve hicbir kural/odul SATIRI eklemez
-- (tek ayar satiri growth_referral_settings varsayilanlarla gelir; hos geldin kredisi varsayilan 0 = kapali).
--
-- NE DEGISIR
--   1. growth_reward_rules.reward_type CHECK'i 'monthly_multiple' (paket aylik bedelinin kati) ile genisler.
--   2. YENI growth_referral_settings (tek satir: kademe, rozet, yillik tavan, hiz siniri, ortak kademeleri/esigi).
--   3. growth_reward_claims: component/invoice_id/months_units/grant_idem/granted_at/clawed_back_at/payout_id... + tekillik
--      (referans ofis basina TEK taban talep; bonus bileşenleri ayri; ortak komisyonu fatura basina).
--   4. YENI growth_claim_events (append-only denetim izi).
--   5. growth_partners: vergi mukellefi bilgisi; growth_partner_payouts: durum.
--   6. RPC'ler. SERVICE_ROLE-ONLY: growth_claim_register, growth_grant_welcome, growth_claims_process,
--      growth_claims_reverse_for_invoice, growth_admin_metrics, growth_admin_queue, growth_engine_ready.
--      OTURUMLU OFIS (yalniz KENDI tenant'i, yazma yok): growth_my_dashboard, growth_my_partner_dashboard.
--      PLATFORM PERSONELI (DB icinde super_admin dogrulamasi; service_role GEREKMEZ): growth_admin_decide,
--      growth_admin_save_settings, growth_admin_payout_create, growth_admin_partner_update.
--      ANON (yalniz program aciksa, aktif kod): growth_invite_preview (kayit ekraninda "X sizi davet etti").
--   Ic yardimcilar (kimseye acik degil): growth_flag_on, growth_public_email_domain, growth_tenant_email_domains,
--      growth_pair_flags, growth_cash_net, growth_monthly_equiv, growth_real_payment, growth_register_referral, growth_register_partner,
--      growth_reverse_claims, growth_grant_claim, growth_clawback_pending.
--
-- GUVENLIK DENETIMI DUZELTMELERI (bu surum)
--   * Odul/komisyon TABANI = NAKIT net tutar (fatura meta.walletCashTry / 1.2; yoksa amount_try). Kismen hesap kredisiyle
--     odenen faturada kredi kismi odule esas OLMAZ. Nakit orani growth_referral_settings.min_cash_ratio altindaysa talep
--     'low_cash_ratio' bayragiyla inceleme kuyruguna (pending) duser.
--   * Cok hesap: ilk manual_review_first_n (varsayilan 3) davetci talebi ve hos geldin kredisi KULLANAN cift manuel onaya duser
--     (flags: first_claims_review, welcome_credit_used); otomatik held->paid olmaz.
--   * Kademe bonusu growth_referral_enabled KAPALIYKEN uretilmez; tarama yalniz ilk-odeme (taban) talepli, bonusu eksik davetcilerle
--     sinirli ve limitlidir.
--   * Personel RPC'leri, platform_settings 'platform.mfa_enforced' acikken DB icinde auth.jwt()->>'aal' = 'aal2' ister
--     (growth_staff_super_admin; ayar yoksa/kapaliysa yalniz super_admin); ayar/ortak/odeme degisiklikleri
--     append-only growth_admin_audit tablosuna yazilir.
--
-- TASARIM KARARLARI
--   * Odul TETIKLEYICISI: davet edilen ofisin ILK GERCEK ODEMESI (invoices.status='paid', demo/hesap-kredisi-tam/iade yok,
--     meta.kind yok = plan faturasi). Kayitta davetci odulu YOK. Odul hold_days sonra (kural), davetci aboneligi aktif ve
--     davet edilen abonelik aktifse tahakkuk eder; TL hesap kredisi = try_credit_grant (idem 'ref-claim-<claim id>',
--     meta.claim_id; defter source_id RPC'den yazilamaz, bag meta'dadir). Kredi nakde cevrilmez.
--   * Hos geldin (davet edilen): kayitta fatura indirimi DEGIL, growth_referral_settings.welcome_credit_try kadar TL
--     hesap kredisi (vade welcome_expires_days). Kredi faturanin en cok %50'sine uygulandigi icin (try_credit.max_invoice_share)
--     "ilk ay %50'ye kadar indirim" gibi davranir. Tutar 0 ise KAPALI.
--   * Kotuye kullanim: ayni tenant (red), ayni vergi no, ayni telefon (ofis/profil), ayni e-posta alan adi (genel saglayicilar
--     haric) => talep 'pending' (inceleme kuyrugu), odul yok. IP/cihaz hash'i SAKLANMAZ. Hiz siniri: davetci basina 24 saatte
--     velocity_max_per_day talepten fazlasi 'velocity' bayragi.
--   * Iade/iptal/chargeback: fatura paid degilse, meta.refund varsa ya da yakalama refunded/refund_required ise talep
--     'reversed'; kredi verilmisse try_credit_reverse (p_original_idem) ile geri alinir (eksi bakiye mumkun, harcanamaz).
--   * Yillik tavan: davetci basina son 365 gunde annual_cap_months aylik bedel (bonuslar dahil); asan kisim kirpilir/reddedilir.
--     rule.monthly_cap_try varsa takvim ayi (Europe/Istanbul) TL tavani; dolunca talep ertesi aya bekler.
--   * Kademe bonusu: N. basarili (odenmis) taban talepte bir kez (tier1_at/tier2_at). Rozet DEPOLANMAZ, sayimdan turetilir.
--   * FAZ 2 (ortak): komisyon YALNIZ growth_partner_enabled acikken uretilir (ilk ilk-odeme + 'duration' ay yineleyen);
--     nakit odeme YALNIZ growth_cash_payout_enabled ACIKKEN, yalniz vergi mukellefi ortaga, belge no + tarih zorunlu
--     (bank_transfer_external) ya da hesap kredisi; min esik settings'ten. Vergi/stopaj mali musavir teyidi gerektirir.
--   * Onay/ret/geri alma kararlari platform personelince DB RPC'si ile verilir; kredi YAZIMI (grant/clawback) yalniz
--     service_role isleyicisinde (growth_claims_process; cron + odeme kancasi) yapilir: personel oturumu cuzdani yazamaz.
--
-- SALT-OKUNUR DOGRULAMA (uygulamadan SONRA; SQL editorunde growth_engine_ready() FALSE doner - service_role gerekir):
-- select to_regclass('public.growth_referral_settings') is not null as settings,
--        to_regclass('public.growth_claim_events') is not null as events,
--        (select count(*) from public.growth_referral_settings) as ayar_satiri,
--        (select count(*) from pg_proc where pronamespace='public'::regnamespace and prosecdef and proname like 'growth\_%') as fn,
--        has_function_privilege('authenticated','public.growth_claims_process(integer)','execute') as auth_process,
--        has_function_privilege('authenticated','public.growth_my_dashboard()','execute') as auth_dash,
--        (select count(*) from public.growth_reward_claims) as talep;
-- BEKLENEN: t | t | 1 | 20 | f | t | 0

set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 0. On-kosul
-- ---------------------------------------------------------------------------
do $$
begin
  if pg_catalog.to_regclass('public.growth_reward_claims') is null
     or pg_catalog.to_regclass('public.growth_reward_rules') is null
     or pg_catalog.to_regclass('public.signup_attributions') is null
     or pg_catalog.to_regclass('public.growth_partners') is null
     or pg_catalog.to_regclass('public.growth_partner_payouts') is null
     or pg_catalog.to_regclass('public.growth_referral_codes') is null then
    raise exception 'Once 20260825000800_growth_referral_partner_attribution.sql uygulanmali.';
  end if;
  if pg_catalog.to_regclass('public.growth_click_counters') is null then
    raise exception 'Once 20260825000900_growth_click_counters.sql uygulanmali.';
  end if;
  if pg_catalog.to_regprocedure('public.try_credit_grant(uuid, numeric, text, text, timestamptz, jsonb)') is null
     or pg_catalog.to_regprocedure('public.try_credit_reverse(uuid, numeric, text, text, text, jsonb)') is null
     or pg_catalog.to_regprocedure('public.try_credit_ready()') is null then
    raise exception 'Once 20260826000400/000500 (TL hesap kredisi cuzdani) uygulanmali.';
  end if;
  if pg_catalog.to_regclass('public.platform_settings') is null
     or pg_catalog.to_regclass('public.platform_staff') is null
     or pg_catalog.to_regclass('public.billing_payment_captures') is null then
    raise exception 'Platform ayar/personel/yakalama tablolari yok.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Kural tipi: paket aylik bedelinin kati
-- ---------------------------------------------------------------------------
alter table public.growth_reward_rules drop constraint if exists growth_reward_rules_reward_type_check;
alter table public.growth_reward_rules
  add constraint growth_reward_rules_reward_type_check
  check (reward_type in ('fixed_try', 'percent_of_payment', 'monthly_multiple'));

-- ---------------------------------------------------------------------------
-- 2. Program ayarlari (tek satir; admin duzenler)
-- ---------------------------------------------------------------------------
create table if not exists public.growth_referral_settings (
  singleton boolean primary key default true check (singleton),
  welcome_credit_try numeric(12,2) not null default 0 check (welcome_credit_try >= 0 and welcome_credit_try <= 100000),
  welcome_expires_days int not null default 45 check (welcome_expires_days between 1 and 365),
  tier1_at int not null default 3 check (tier1_at >= 1),
  tier1_bonus_months numeric(5,2) not null default 0.50 check (tier1_bonus_months >= 0 and tier1_bonus_months <= 24),
  tier1_badge text not null default 'Gümüş Elçi' check (char_length(tier1_badge) between 1 and 40),
  tier2_at int not null default 10,
  tier2_bonus_months numeric(5,2) not null default 2.00 check (tier2_bonus_months >= 0 and tier2_bonus_months <= 24),
  tier2_badge text not null default 'Altın Elçi' check (char_length(tier2_badge) between 1 and 40),
  annual_cap_months numeric(5,2) not null default 12.00 check (annual_cap_months > 0 and annual_cap_months <= 120),
  velocity_max_per_day int not null default 5 check (velocity_max_per_day between 1 and 1000),
  partner_tier1_max int not null default 4 check (partner_tier1_max >= 0),
  partner_tier1_pct numeric(5,2) not null default 20 check (partner_tier1_pct between 0 and 100),
  partner_tier2_max int not null default 14,
  partner_tier2_pct numeric(5,2) not null default 25 check (partner_tier2_pct between 0 and 100),
  partner_tier3_pct numeric(5,2) not null default 30 check (partner_tier3_pct between 0 and 100),
  partner_duration_months int not null default 12 check (partner_duration_months between 1 and 60),
  partner_min_payout_try numeric(12,2) not null default 1000 check (partner_min_payout_try >= 0),
  min_cash_ratio numeric(4,2) not null default 0.50 check (min_cash_ratio >= 0 and min_cash_ratio <= 1),
  manual_review_first_n int not null default 3 check (manual_review_first_n between 0 and 1000),
  updated_by uuid references public.platform_staff(id) on delete set null,
  updated_at timestamptz not null default now(),
  check (tier2_at > tier1_at),
  check (partner_tier2_max > partner_tier1_max)
);
insert into public.growth_referral_settings (singleton) values (true) on conflict (singleton) do nothing;
alter table public.growth_referral_settings enable row level security;
revoke all privileges on table public.growth_referral_settings from public, anon, authenticated;
grant all privileges on table public.growth_referral_settings to service_role;

-- ---------------------------------------------------------------------------
-- 3. Ortak/odeme alanlari (claims'ten ONCE: payout_id FK)
-- ---------------------------------------------------------------------------
alter table public.growth_partners
  add column if not exists is_tax_payer boolean not null default false,
  add column if not exists tax_no text;
alter table public.growth_partners drop constraint if exists growth_partners_tax_no_check;
alter table public.growth_partners
  add constraint growth_partners_tax_no_check check (tax_no is null or tax_no ~ '^[0-9]{10,11}$');

alter table public.growth_partner_payouts
  add column if not exists status text not null default 'requested',
  add column if not exists note text,
  add column if not exists marked_by_staff uuid references public.platform_staff(id) on delete set null;
alter table public.growth_partner_payouts drop constraint if exists growth_partner_payouts_status_check;
alter table public.growth_partner_payouts
  add constraint growth_partner_payouts_status_check check (status in ('requested', 'paid', 'cancelled'));
alter table public.growth_partner_payouts drop constraint if exists growth_partner_payouts_paid_check;
alter table public.growth_partner_payouts
  add constraint growth_partner_payouts_paid_check check (status <> 'paid' or paid_at is not null);

-- ---------------------------------------------------------------------------
-- 4. Talep (claim) genislemesi
-- ---------------------------------------------------------------------------
alter table public.growth_reward_claims
  add column if not exists component text not null default 'base',
  add column if not exists invoice_id uuid references public.invoices(id) on delete set null,
  add column if not exists months_units numeric(8,2) not null default 0,
  add column if not exists base_monthly_try numeric(12,2),
  add column if not exists grant_idem text,
  add column if not exists granted_at timestamptz,
  add column if not exists clawed_back_at timestamptz,
  add column if not exists reversal_reason text,
  add column if not exists payout_id uuid references public.growth_partner_payouts(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();
alter table public.growth_reward_claims drop constraint if exists growth_reward_claims_component_check;
alter table public.growth_reward_claims
  add constraint growth_reward_claims_component_check check (component in ('base', 'tier1', 'tier2', 'commission'));
alter table public.growth_reward_claims drop constraint if exists growth_reward_claims_commission_partner_check;
alter table public.growth_reward_claims
  add constraint growth_reward_claims_commission_partner_check check ((component = 'commission') = (partner_id is not null));

alter table public.growth_reward_claims drop constraint if exists growth_reward_claims_rule_id_referred_tenant_id_key;
create unique index if not exists uq_growth_claims_component
  on public.growth_reward_claims (rule_id, referred_tenant_id, component, coalesce(invoice_id, '00000000-0000-0000-0000-000000000000'::uuid));
-- Referans: davet edilen ofis basina TEK taban talep (tum kurallar boyunca); bonus bilesenleri de tek.
create unique index if not exists uq_growth_claims_base_once
  on public.growth_reward_claims (referred_tenant_id) where component = 'base';
create unique index if not exists uq_growth_claims_tier_once
  on public.growth_reward_claims (referred_tenant_id, component) where component in ('tier1', 'tier2');
create index if not exists idx_growth_claims_status on public.growth_reward_claims (status, eligible_at);
create index if not exists idx_growth_claims_beneficiary on public.growth_reward_claims (beneficiary_tenant_id, status)
  where beneficiary_tenant_id is not null;
create index if not exists idx_growth_claims_partner on public.growth_reward_claims (partner_id, status)
  where partner_id is not null;
create index if not exists idx_growth_claims_invoice on public.growth_reward_claims (invoice_id) where invoice_id is not null;

-- ---------------------------------------------------------------------------
-- 5. Denetim izi (append-only)
-- ---------------------------------------------------------------------------
create table if not exists public.growth_claim_events (
  id bigint generated always as identity primary key,
  claim_id uuid not null references public.growth_reward_claims(id) on delete cascade,
  event text not null check (event in ('registered', 'flagged', 'approved', 'rejected', 'granted', 'reversed', 'clawback', 'blocked', 'payout', 'note')),
  actor_id uuid references public.platform_staff(id) on delete set null,
  meta jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_growth_claim_events_claim on public.growth_claim_events (claim_id, created_at desc);

create or replace function public.growth_claim_events_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'growth_claim_events append-only' using errcode = '42501';
end $$;
drop trigger if exists trg_growth_claim_events_immutable on public.growth_claim_events;
create trigger trg_growth_claim_events_immutable before update or delete on public.growth_claim_events
  for each row execute function public.growth_claim_events_immutable();
alter table public.growth_claim_events enable row level security;
revoke all privileges on table public.growth_claim_events from public, anon, authenticated;
grant select on table public.growth_claim_events to service_role;

-- Personel degisikliklerinin denetim izi (ayar / ortak / odeme); append-only.
create table if not exists public.growth_admin_audit (
  id bigint generated always as identity primary key,
  action text not null check (action in ('settings_save', 'partner_update', 'payout_create')),
  actor_id uuid references public.platform_staff(id) on delete set null,
  target text,
  meta jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_growth_admin_audit_created on public.growth_admin_audit (created_at desc);
create index if not exists idx_growth_admin_audit_actor on public.growth_admin_audit (actor_id) where actor_id is not null;
drop trigger if exists trg_growth_admin_audit_immutable on public.growth_admin_audit;
create trigger trg_growth_admin_audit_immutable before update or delete on public.growth_admin_audit
  for each row execute function public.growth_claim_events_immutable();
alter table public.growth_admin_audit enable row level security;
revoke all privileges on table public.growth_admin_audit from public, anon, authenticated;
grant select on table public.growth_admin_audit to service_role;

-- ---------------------------------------------------------------------------
-- 6. IC YARDIMCILAR
-- ---------------------------------------------------------------------------
create or replace function public.growth_flag_on(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select lower(btrim(coalesce(s.value, ''))) in ('on', 'true', '1') from public.platform_settings s where s.key = p_key),
    false);
$$;

create or replace function public.growth_public_email_domain(p_domain text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select lower(coalesce(p_domain, '')) = any (array[
    'gmail.com','googlemail.com','hotmail.com','hotmail.com.tr','outlook.com','outlook.com.tr','live.com','msn.com',
    'yahoo.com','yahoo.com.tr','ymail.com','icloud.com','me.com','yandex.com','yandex.com.tr','proton.me','protonmail.com',
    'mynet.com','yaani.com','gmx.com','aol.com','mail.com','zoho.com'
  ]::text[]);
$$;

-- Ofisin KURUMSAL (genel saglayici olmayan) e-posta alan adlari.
create or replace function public.growth_tenant_email_domains(p_tenant uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct d), '{}'::text[])
  from (
    select lower(split_part(u.email::text, '@', 2)) as d
    from public.profiles p
    join auth.users u on u.id = p.id
    where p.tenant_id = p_tenant and u.email is not null and position('@' in u.email::text) > 0
  ) x
  where d <> '' and not public.growth_public_email_domain(d);
$$;

-- Ofisin normalize telefon uclari (son 10 hane): ofis telefonu + profil telefonlari.
create or replace function public.growth_tenant_phone_tails(p_tenant uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct tail), '{}'::text[])
  from (
    select right(regexp_replace(tt.phone, '\D', '', 'g'), 10) as tail from public.tenants tt where tt.id = p_tenant and tt.phone is not null
    union
    select right(regexp_replace(p.phone, '\D', '', 'g'), 10) from public.profiles p where p.tenant_id = p_tenant and p.phone is not null
  ) x
  where char_length(tail) = 10;
$$;

-- Cift bayraklari: ayni tenant / vergi no / telefon / kurumsal e-posta alan adi.
create or replace function public.growth_pair_flags(p_a uuid, p_b uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_flags text[] := '{}';
  v_tax_a text;
  v_tax_b text;
begin
  if p_a is null or p_b is null then
    return v_flags;
  end if;
  if p_a = p_b then
    return array['same_tenant'];
  end if;
  select nullif(regexp_replace(coalesce(t.tax_number, ''), '\D', '', 'g'), '') into v_tax_a from public.tenants t where t.id = p_a;
  select nullif(regexp_replace(coalesce(t.tax_number, ''), '\D', '', 'g'), '') into v_tax_b from public.tenants t where t.id = p_b;
  if v_tax_a is not null and v_tax_a = v_tax_b then
    v_flags := array_append(v_flags, 'same_tax_no'::text);
  end if;
  if public.growth_tenant_phone_tails(p_a) && public.growth_tenant_phone_tails(p_b) then
    v_flags := array_append(v_flags, 'same_phone'::text);
  end if;
  if public.growth_tenant_email_domains(p_a) && public.growth_tenant_email_domains(p_b) then
    v_flags := array_append(v_flags, 'same_email_domain'::text);
  end if;
  return v_flags;
end;
$$;

-- NAKIT net tutar (KDV haric): kismen hesap kredisiyle odenen faturada yalniz nakit kisim (walletCashTry brut / 1.2).
-- walletCashTry yoksa fatura tamamen nakit sayilir (amount_try). Asla amount_try'yi asmaz.
create or replace function public.growth_cash_net(p_invoice uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select round(case
           when jsonb_typeof(i.meta -> 'walletCashTry') = 'number' and (i.meta ->> 'walletCashTry')::numeric > 0
             then least((i.meta ->> 'walletCashTry')::numeric / 1.2, i.amount_try)
           else i.amount_try end, 2)
  from public.invoices i where i.id = p_invoice;
$$;

-- Faturanin "1 aylik paket bedeli" karsiligi (NAKIT net, KDV haric): yillik = /12.
create or replace function public.growth_monthly_equiv(p_invoice uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select round(case when i.meta ->> 'cycle' = 'yearly' then public.growth_cash_net(i.id) / 12 else public.growth_cash_net(i.id) end, 2)
  from public.invoices i where i.id = p_invoice;
$$;

-- GERCEK odeme: odenmis plan faturasi; demo / tam hesap kredisi / iade kaydi / iptal yakalama yok.
create or replace function public.growth_real_payment(p_invoice uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  i public.invoices%rowtype;
  v_cash numeric;
begin
  select * into i from public.invoices where id = p_invoice;
  if not found then return false; end if;
  if i.status <> 'paid' or i.currency <> 'TRY' or coalesce(i.amount_try, 0) <= 0 then return false; end if;
  if i.meta ->> 'kind' is not null then return false; end if;
  if coalesce(i.meta ->> 'plan', '') = '' then return false; end if;
  if coalesce(i.meta ->> 'provider', '') in ('demo', 'account_credit')
     or coalesce(i.meta ->> 'source', '') in ('demo', 'account_credit')
     or coalesce(i.iyzico_payment_id, '') like 'demo-%' then
    return false;
  end if;
  if jsonb_typeof(i.meta -> 'walletCashTry') = 'number' then
    v_cash := (i.meta ->> 'walletCashTry')::numeric;
    if v_cash <= 0 then return false; end if;
  end if;
  if i.meta -> 'refund' is not null then return false; end if;
  return true;
end;
$$;

-- Talep olayi (denetim izi).
create or replace function public.growth_log_event(p_claim uuid, p_event text, p_actor uuid, p_meta jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.growth_claim_events (claim_id, event, actor_id, meta) values (p_claim, p_event, p_actor, p_meta);
$$;

-- ---------------------------------------------------------------------------
-- 7. TALEP URETIMI (ilk gercek odeme) — service_role
-- ---------------------------------------------------------------------------
create or replace function public.growth_register_referral(p_invoice uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  i public.invoices%rowtype;
  a public.signup_attributions%rowtype;
  s public.growth_referral_settings%rowtype;
  r public.growth_reward_rules%rowtype;
  v_base numeric;
  v_amount numeric;
  v_units numeric;
  v_flags text[];
  v_status text;
  v_note text;
  v_claim uuid;
  v_recent int;
  v_cash numeric;
  v_prior int;
begin
  select * into i from public.invoices where id = p_invoice;
  select * into a from public.signup_attributions where tenant_id = i.tenant_id;
  if not found or a.referrer_tenant_id is null then
    return jsonb_build_object('ok', true, 'skipped', 'no_attribution');
  end if;
  if not public.growth_flag_on('growth_referral_enabled') then
    return jsonb_build_object('ok', true, 'skipped', 'program_off');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('growth-claim:' || a.referrer_tenant_id::text, 0));

  if exists (select 1 from public.growth_reward_claims c where c.referred_tenant_id = i.tenant_id and c.component = 'base') then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  -- ILK gercek odeme: ayni ofisin daha once gercek odenmis plan faturasi varsa bu talep uretilmez.
  if exists (
    select 1 from public.invoices x
    where x.tenant_id = i.tenant_id and x.id <> i.id and x.status = 'paid'
      and public.growth_real_payment(x.id)
      and (x.paid_at < i.paid_at or (x.paid_at = i.paid_at and x.id < i.id))
  ) then
    return jsonb_build_object('ok', true, 'skipped', 'not_first_payment');
  end if;

  select * into r from public.growth_reward_rules
  where kind = 'referral' and is_active and valid_from <= now() and (valid_until is null or valid_until > now())
  order by created_at desc limit 1;
  if not found then
    return jsonb_build_object('ok', true, 'skipped', 'no_rule');
  end if;
  select * into s from public.growth_referral_settings where singleton;

  v_base := public.growth_monthly_equiv(p_invoice);
  v_cash := public.growth_cash_net(p_invoice);
  v_amount := round(case r.reward_type
    when 'monthly_multiple' then v_base * r.reward_value
    when 'fixed_try' then r.reward_value
    else v_cash * r.reward_value / 100 end, 2);
  if v_amount is null or v_amount <= 0 then
    return jsonb_build_object('ok', true, 'skipped', 'zero_amount');
  end if;
  v_units := case when r.reward_type = 'monthly_multiple' then r.reward_value
                  when v_base > 0 then round(v_amount / v_base, 2) else 0 end;

  v_flags := public.growth_pair_flags(a.referrer_tenant_id, i.tenant_id);
  select count(*) into v_recent from public.growth_reward_claims c
  where c.beneficiary_tenant_id = a.referrer_tenant_id and c.component = 'base' and c.created_at > now() - interval '24 hours';
  if v_recent >= s.velocity_max_per_day then
    v_flags := array_append(v_flags, 'velocity'::text);
  end if;
  -- Nakit orani dusukse (hos geldin/kampanya kredisiyle odenmis fatura) odul otomatik verilmez.
  if i.amount_try > 0 and v_cash < round(i.amount_try * s.min_cash_ratio, 2) then
    v_flags := array_append(v_flags, 'low_cash_ratio'::text);
  end if;
  -- Hos geldin kredisini KULLANAN cift: ayni davetliye verilen hos geldin kredisi harcanmissa manuel onay.
  if exists (select 1 from public.account_credit_ledger l
             where l.idempotency_key = 'try:grant:' || i.tenant_id::text || ':growth-welcome-' || i.tenant_id::text)
     and exists (select 1 from public.try_credit_reservations rv where rv.tenant_id = i.tenant_id and rv.state = 'committed') then
    v_flags := array_append(v_flags, 'welcome_credit_used'::text);
  end if;
  -- Ilk N davetci talebi manuel onaya duser (cok hesap/sahte zincir korumasi).
  select count(*) into v_prior from public.growth_reward_claims c
  where c.beneficiary_tenant_id = a.referrer_tenant_id and c.component = 'base' and c.status not in ('rejected', 'reversed');
  if v_prior < s.manual_review_first_n then
    v_flags := array_append(v_flags, 'first_claims_review'::text);
  end if;

  if 'same_tenant' = any (v_flags) then
    v_status := 'rejected';
    v_note := 'same_tenant';
  elsif coalesce(array_length(v_flags, 1), 0) > 0 then
    v_status := 'pending';
  else
    v_status := 'held';
  end if;

  insert into public.growth_reward_claims
    (rule_id, beneficiary_tenant_id, referred_tenant_id, amount_try, status, flags, eligible_at, note,
     component, invoice_id, months_units, base_monthly_try)
  values
    (r.id, a.referrer_tenant_id, i.tenant_id, v_amount, v_status, v_flags,
     coalesce(i.paid_at, now()) + make_interval(days => r.hold_days), v_note,
     'base', i.id, v_units, v_base)
  returning id into v_claim;

  perform public.growth_log_event(v_claim, 'registered', null,
    jsonb_build_object('status', v_status, 'amount', v_amount, 'holdDays', r.hold_days));
  if coalesce(array_length(v_flags, 1), 0) > 0 then
    perform public.growth_log_event(v_claim, 'flagged', null, jsonb_build_object('flags', to_jsonb(v_flags)));
  end if;
  return jsonb_build_object('ok', true, 'claim_id', v_claim, 'status', v_status, 'flags', to_jsonb(v_flags));
end;
$$;

create or replace function public.growth_register_partner(p_invoice uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  i public.invoices%rowtype;
  a public.signup_attributions%rowtype;
  s public.growth_referral_settings%rowtype;
  p public.growth_partners%rowtype;
  r public.growth_reward_rules%rowtype;
  v_first timestamptz;
  v_months int;
  v_n int;
  v_pct numeric;
  v_amount numeric;
  v_flags text[] := '{}';
  v_claim uuid;
  v_cash numeric;
begin
  select * into i from public.invoices where id = p_invoice;
  select * into a from public.signup_attributions where tenant_id = i.tenant_id;
  if not found or a.partner_id is null then
    return jsonb_build_object('ok', true, 'skipped', 'no_attribution');
  end if;
  -- FAZ 2 bayragi kapaliyken HICBIR komisyon uretilmez.
  if not public.growth_flag_on('growth_partner_enabled') then
    return jsonb_build_object('ok', true, 'skipped', 'partner_program_off');
  end if;
  select * into p from public.growth_partners where id = a.partner_id and status = 'active';
  if not found then
    return jsonb_build_object('ok', true, 'skipped', 'partner_inactive');
  end if;
  select * into r from public.growth_reward_rules
  where id = p.rule_id and kind = 'partner' and is_active and valid_from <= now() and (valid_until is null or valid_until > now());
  if not found then
    return jsonb_build_object('ok', true, 'skipped', 'no_rule');
  end if;
  select * into s from public.growth_referral_settings where singleton;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('growth-partner:' || p.id::text, 0));

  if exists (select 1 from public.growth_reward_claims c
             where c.rule_id = r.id and c.referred_tenant_id = i.tenant_id and c.component = 'commission' and c.invoice_id = i.id) then
    return jsonb_build_object('ok', true, 'already', true);
  end if;

  -- Yinelenen komisyon penceresi: ILK gercek odemeden itibaren duration ay.
  select min(x.paid_at) into v_first from public.invoices x
  where x.tenant_id = i.tenant_id and x.status = 'paid' and public.growth_real_payment(x.id);
  v_months := coalesce(r.duration_months, s.partner_duration_months);
  if v_first is null or i.paid_at > v_first + make_interval(months => v_months) then
    return jsonb_build_object('ok', true, 'skipped', 'out_of_window');
  end if;

  -- Kademe: ortagin AKTIF ucretli musteri sayisi (0-tier1_max / -tier2_max / ustu).
  select count(distinct sa.tenant_id) into v_n
  from public.signup_attributions sa
  join public.subscriptions sub on sub.tenant_id = sa.tenant_id and sub.status = 'active'
  where sa.partner_id = p.id;
  v_pct := case when v_n <= s.partner_tier1_max then s.partner_tier1_pct
                when v_n <= s.partner_tier2_max then s.partner_tier2_pct
                else s.partner_tier3_pct end;
  v_cash := public.growth_cash_net(p_invoice);
  v_amount := round(v_cash * v_pct / 100, 2);
  if v_amount <= 0 then
    return jsonb_build_object('ok', true, 'skipped', 'zero_amount');
  end if;

  if p.owner_tenant_id is not null then
    v_flags := public.growth_pair_flags(p.owner_tenant_id, i.tenant_id);
  end if;
  if i.amount_try > 0 and v_cash < round(i.amount_try * s.min_cash_ratio, 2) then
    v_flags := array_append(v_flags, 'low_cash_ratio'::text);
  end if;

  insert into public.growth_reward_claims
    (rule_id, partner_id, referred_tenant_id, amount_try, status, flags, eligible_at, component, invoice_id, months_units, base_monthly_try)
  values
    (r.id, p.id, i.tenant_id,
     v_amount,
     case when 'same_tenant' = any (v_flags) then 'rejected'
          when coalesce(array_length(v_flags, 1), 0) > 0 then 'pending' else 'held' end,
     v_flags, coalesce(i.paid_at, now()) + make_interval(days => r.hold_days), 'commission', i.id, 0, v_cash)
  returning id into v_claim;
  perform public.growth_log_event(v_claim, 'registered', null,
    jsonb_build_object('pct', v_pct, 'activeCustomers', v_n, 'amount', v_amount));
  return jsonb_build_object('ok', true, 'claim_id', v_claim, 'pct', v_pct);
end;
$$;

create or replace function public.growth_claim_register(p_invoice uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_kind text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if p_invoice is null or not exists (select 1 from public.invoices where id = p_invoice) then
    return jsonb_build_object('ok', false, 'code', 'invoice_not_found');
  end if;
  if not public.growth_real_payment(p_invoice) then
    return jsonb_build_object('ok', true, 'skipped', 'not_real_payment');
  end if;
  select sa.ref_kind into v_kind from public.signup_attributions sa
  join public.invoices i on i.tenant_id = sa.tenant_id where i.id = p_invoice;
  if v_kind = 'referral' then
    return public.growth_register_referral(p_invoice);
  elsif v_kind = 'partner' then
    return public.growth_register_partner(p_invoice);
  end if;
  return jsonb_build_object('ok', true, 'skipped', 'no_attribution');
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. HOS GELDIN KREDISI (davet edilen) — service_role
-- ---------------------------------------------------------------------------
create or replace function public.growth_grant_welcome(p_referred uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  a public.signup_attributions%rowtype;
  s public.growth_referral_settings%rowtype;
  v_flags text[];
  v_res jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if not public.growth_flag_on('growth_referral_enabled') then
    return jsonb_build_object('ok', true, 'skipped', 'program_off');
  end if;
  select * into s from public.growth_referral_settings where singleton;
  if not found or s.welcome_credit_try <= 0 then
    return jsonb_build_object('ok', true, 'skipped', 'not_configured');
  end if;
  select * into a from public.signup_attributions where tenant_id = p_referred and ref_kind = 'referral';
  if not found or a.referrer_tenant_id is null then
    return jsonb_build_object('ok', true, 'skipped', 'no_attribution');
  end if;
  v_flags := public.growth_pair_flags(a.referrer_tenant_id, p_referred);
  if coalesce(array_length(v_flags, 1), 0) > 0 then
    return jsonb_build_object('ok', true, 'skipped', 'flagged');
  end if;
  if not public.try_credit_ready() then
    return jsonb_build_object('ok', true, 'skipped', 'wallet_not_ready');
  end if;
  v_res := public.try_credit_grant(
    p_referred, s.welcome_credit_try, 'campaign', 'growth-welcome-' || p_referred::text,
    now() + make_interval(days => s.welcome_expires_days),
    jsonb_build_object('program', 'referral_welcome'));
  return jsonb_build_object('ok', true, 'already', coalesce((v_res ->> 'already')::boolean, false), 'amount', s.welcome_credit_try);
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. GERI ALMA / ODUL VERME / CLAWBACK (ic)
-- ---------------------------------------------------------------------------
-- Faturaya bagli tum canli talepleri 'reversed' yapar (taban + bonus + komisyon). Sayi doner.
create or replace function public.growth_reverse_claims(p_invoice uuid, p_reason text)
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  c record;
  v_n int := 0;
begin
  for c in
    select id, payout_id from public.growth_reward_claims
    where invoice_id = p_invoice and status in ('held', 'pending', 'approved', 'paid')
    for update
  loop
    update public.growth_reward_claims
    set status = 'reversed', reversal_reason = left(p_reason, 200), updated_at = now(),
        flags = case when c.payout_id is not null and not ('clawback_due' = any (flags)) then array_append(flags, 'clawback_due'::text) else flags end
    where id = c.id;
    perform public.growth_log_event(c.id, 'reversed', null, jsonb_build_object('reason', left(p_reason, 200)));
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- Verilmis krediyi geri al (clawback). Cuzdan hazir degilse atlanir.
create or replace function public.growth_clawback_pending(p_limit int, p_wallet_ok boolean)
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  c record;
  v_res jsonb;
  v_n int := 0;
begin
  if not p_wallet_ok then
    return 0;
  end if;
  for c in
    select id, beneficiary_tenant_id, amount_try, grant_idem from public.growth_reward_claims
    where status = 'reversed' and granted_at is not null and clawed_back_at is null and beneficiary_tenant_id is not null
    order by updated_at limit greatest(p_limit, 1)
    for update skip locked
  loop
    begin
      v_res := public.try_credit_reverse(c.beneficiary_tenant_id, c.amount_try, 'referral_reversed',
        'ref-rev-' || c.id::text, c.grant_idem, jsonb_build_object('claim_id', c.id::text));
      if coalesce((v_res ->> 'ok')::boolean, false) or v_res ->> 'code' in ('exceeds_original', 'original_not_found') then
        update public.growth_reward_claims set clawed_back_at = now(), updated_at = now() where id = c.id;
        perform public.growth_log_event(c.id, 'clawback', null, v_res);
        v_n := v_n + 1;
      end if;
    exception when others then
      perform public.growth_log_event(c.id, 'note', null, jsonb_build_object('clawback_error', sqlstate));
    end;
  end loop;
  return v_n;
end;
$$;

-- Tek davetci talebini ode: davetci aktif mi, yillik/aylik tavan, TL kredi hibesi. Sonuc metni doner:
-- paid | blocked_referrer | blocked_cap | rejected_cap | wallet | error
create or replace function public.growth_grant_claim(p_claim uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  c public.growth_reward_claims%rowtype;
  r public.growth_reward_rules%rowtype;
  s public.growth_referral_settings%rowtype;
  v_used numeric;
  v_remaining numeric;
  v_units numeric;
  v_amount numeric;
  v_month_used numeric;
  v_month_left numeric;
  v_expires timestamptz;
  v_res jsonb;
  v_idem text;
begin
  select * into c from public.growth_reward_claims where id = p_claim for update;
  if not found or c.beneficiary_tenant_id is null or c.status not in ('held', 'approved') then
    return 'error';
  end if;
  select * into r from public.growth_reward_rules where id = c.rule_id;
  select * into s from public.growth_referral_settings where singleton;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('growth-claim:' || c.beneficiary_tenant_id::text, 0));

  -- Davetcinin kendi aboneligi aktif olmali.
  if not exists (select 1 from public.subscriptions sub where sub.tenant_id = c.beneficiary_tenant_id and sub.status = 'active') then
    if not ('referrer_inactive' = any (c.flags)) then
      update public.growth_reward_claims set flags = array_append(flags, 'referrer_inactive'::text), updated_at = now() where id = c.id;
      perform public.growth_log_event(c.id, 'blocked', null, jsonb_build_object('reason', 'referrer_inactive'));
    end if;
    return 'blocked_referrer';
  elsif 'referrer_inactive' = any (c.flags) then
    update public.growth_reward_claims set flags = array_remove(flags, 'referrer_inactive'), updated_at = now() where id = c.id;
  end if;

  -- Yillik tavan (aylik bedel cinsinden; bonuslar dahil).
  select coalesce(sum(x.months_units), 0) into v_used from public.growth_reward_claims x
  where x.beneficiary_tenant_id = c.beneficiary_tenant_id and x.id <> c.id and x.status = 'paid'
    and x.granted_at > now() - interval '365 days';
  v_remaining := s.annual_cap_months - v_used;
  if v_remaining <= 0 then
    update public.growth_reward_claims set status = 'rejected', note = 'annual_cap', decided_at = now(), updated_at = now() where id = c.id;
    perform public.growth_log_event(c.id, 'rejected', null, jsonb_build_object('reason', 'annual_cap'));
    return 'rejected_cap';
  end if;
  v_units := c.months_units;
  v_amount := c.amount_try;
  if c.months_units > 0 and c.months_units > v_remaining then
    v_units := v_remaining;
    v_amount := round(c.amount_try * v_remaining / c.months_units, 2);
  end if;

  -- Aylik TL tavani (kural): takvim ayi (Europe/Istanbul); dolunca ertesi aya bekler.
  if r.monthly_cap_try is not null then
    select coalesce(sum(x.amount_try), 0) into v_month_used from public.growth_reward_claims x
    where x.beneficiary_tenant_id = c.beneficiary_tenant_id and x.id <> c.id and x.status = 'paid'
      and date_trunc('month', x.granted_at at time zone 'Europe/Istanbul') = date_trunc('month', now() at time zone 'Europe/Istanbul');
    v_month_left := r.monthly_cap_try - v_month_used;
    if v_month_left < 0.01 then
      return 'blocked_cap';
    end if;
    if v_amount > v_month_left then
      v_units := case when v_amount > 0 then round(v_units * v_month_left / v_amount, 2) else v_units end;
      v_amount := round(v_month_left, 2);
    end if;
  end if;
  if v_amount < 0.01 then
    return 'blocked_cap';
  end if;

  v_idem := 'ref-claim-' || c.id::text;
  v_expires := case when r.credit_expires_days is not null then now() + make_interval(days => r.credit_expires_days) else null end;
  begin
    v_res := public.try_credit_grant(c.beneficiary_tenant_id, v_amount, 'referral', v_idem, v_expires,
      jsonb_build_object('claim_id', c.id::text, 'program', 'referral', 'component', c.component));
  exception when others then
    return 'error';
  end;
  if not coalesce((v_res ->> 'ok')::boolean, false) then
    return 'error';
  end if;
  update public.growth_reward_claims
  set status = 'paid', amount_try = v_amount, months_units = v_units, grant_idem = v_idem, granted_at = now(),
      decided_at = coalesce(decided_at, now()), updated_at = now()
  where id = c.id;
  perform public.growth_log_event(c.id, 'granted', null, jsonb_build_object('amount', v_amount, 'idem', v_idem));
  return 'paid';
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. ISLEYICI (cron + odeme kancasi) — service_role
-- ---------------------------------------------------------------------------
create or replace function public.growth_claims_process(p_limit integer default 200)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_limit int := greatest(least(coalesce(p_limit, 200), 1000), 1);
  v_wallet boolean;
  s public.growth_referral_settings%rowtype;
  rc record;
  v_inv uuid;
  v_res text;
  n_registered int := 0;
  n_reversed int := 0;
  n_paid int := 0;
  n_blocked int := 0;
  n_rejected int := 0;
  n_clawback int := 0;
  n_wallet_skip int := 0;
  n_bonus int := 0;
  n_partner int := 0;
  n_payout int := 0;
  v_count int;
  v_bonus_id uuid;
  v_payout record;
  v_grant jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  v_wallet := public.try_credit_ready();
  select * into s from public.growth_referral_settings where singleton;

  -- A. Kacirilmis talep uretimi (odeme kancasi hata verdiyse): son 60 gunun odenmis atifli faturalari.
  for v_inv in
    select i.id from public.invoices i
    join public.signup_attributions sa on sa.tenant_id = i.tenant_id and sa.ref_kind in ('referral', 'partner')
    where i.status = 'paid' and i.paid_at > now() - interval '60 days'
      and not exists (select 1 from public.growth_reward_claims c where c.invoice_id = i.id)
    order by i.paid_at desc limit v_limit
  loop
    if (public.growth_claim_register(v_inv) ->> 'claim_id') is not null then
      n_registered := n_registered + 1;
    end if;
  end loop;

  -- B. Iade / iptal / chargeback: odenmis olmayan, iade kaydi olan ya da yakalamasi iade edilen fatura.
  for v_inv in
    select distinct c.invoice_id from public.growth_reward_claims c
    join public.invoices i on i.id = c.invoice_id
    where c.status in ('held', 'pending', 'approved', 'paid')
      and (i.status <> 'paid'
           or i.meta -> 'refund' is not null
           or exists (select 1 from public.billing_payment_captures bc
                      where bc.conversation_id = i.meta ->> 'conversationId' and bc.status in ('refunded', 'refund_required')))
    limit v_limit
  loop
    n_reversed := n_reversed + public.growth_reverse_claims(v_inv, 'invoice_refunded_or_void');
  end loop;
  -- Davet edilen abonelik IPTAL: bekleme suresinde iptal = geri al.
  for rc in
    select distinct x.invoice_id from public.growth_reward_claims x
    join public.subscriptions sub on sub.tenant_id = x.referred_tenant_id
    where x.status in ('held', 'pending', 'approved') and x.component in ('base', 'tier1', 'tier2') and sub.status = 'cancelled'
    limit v_limit
  loop
    n_reversed := n_reversed + public.growth_reverse_claims(rc.invoice_id, 'referred_cancelled');
  end loop;

  -- C. Vadesi gelen / onaylanan davetci talepleri -> TL kredisi
  for rc in
    select x.id, x.referred_tenant_id, x.component from public.growth_reward_claims x
    where x.component in ('base', 'tier1', 'tier2') and x.beneficiary_tenant_id is not null
      and ((x.status = 'held' and x.eligible_at <= now() and cardinality(array_remove(x.flags, 'referrer_inactive')) = 0)
           or x.status = 'approved')
    order by x.eligible_at nulls first limit v_limit
  loop
    if not v_wallet then
      n_wallet_skip := n_wallet_skip + 1;
      continue;
    end if;
    -- Davet edilen abonelik aktif olmali (askida/gecikmis = bekle).
    if exists (select 1 from public.growth_reward_claims q where q.id = rc.id and q.status = 'held')
       and not exists (select 1 from public.subscriptions sub where sub.tenant_id = rc.referred_tenant_id and sub.status = 'active') then
      n_blocked := n_blocked + 1;
      continue;
    end if;
    v_res := public.growth_grant_claim(rc.id);
    if v_res = 'paid' then
      n_paid := n_paid + 1;
    elsif v_res in ('blocked_referrer', 'blocked_cap') then
      n_blocked := n_blocked + 1;
    elsif v_res = 'rejected_cap' then
      n_rejected := n_rejected + 1;
    end if;
  end loop;

  -- C2. Kademe bonusu: yeni odenen taban taleplerden sonra (davetci basina bir kez). Program bayragi KAPALIYKEN uretilmez;
  -- tarama yalniz ilk-odeme (taban) taleplerinden bonusu henuz eksik davetcilerle sinirli ve limitlidir.
  if v_wallet and public.growth_flag_on('growth_referral_enabled') then
    for rc in
      select b.beneficiary_tenant_id as ref_tenant, count(*) as paid_n
      from public.growth_reward_claims b
      where b.component = 'base' and b.status = 'paid' and b.beneficiary_tenant_id is not null
        and ((s.tier1_bonus_months > 0 and not exists (
                select 1 from public.growth_reward_claims t
                where t.beneficiary_tenant_id = b.beneficiary_tenant_id and t.component = 'tier1' and t.status <> 'rejected'))
             or (s.tier2_bonus_months > 0 and not exists (
                select 1 from public.growth_reward_claims t
                where t.beneficiary_tenant_id = b.beneficiary_tenant_id and t.component = 'tier2' and t.status <> 'rejected')))
      group by b.beneficiary_tenant_id
      having count(*) >= s.tier1_at
      order by min(b.granted_at) nulls last
      limit v_limit
    loop
      v_count := rc.paid_n;
      -- tier1
      if s.tier1_bonus_months > 0 and v_count >= s.tier1_at
         and not exists (select 1 from public.growth_reward_claims t where t.beneficiary_tenant_id = rc.ref_tenant and t.component = 'tier1' and t.status <> 'rejected') then
        insert into public.growth_reward_claims
          (rule_id, beneficiary_tenant_id, referred_tenant_id, amount_try, status, eligible_at, component, invoice_id, months_units, base_monthly_try)
        select b.rule_id, b.beneficiary_tenant_id, b.referred_tenant_id,
               round(coalesce(b.base_monthly_try, 0) * s.tier1_bonus_months, 2), 'approved', now(), 'tier1', b.invoice_id,
               s.tier1_bonus_months, b.base_monthly_try
        from public.growth_reward_claims b
        where b.beneficiary_tenant_id = rc.ref_tenant and b.component = 'base' and b.status = 'paid'
        order by b.granted_at asc offset (s.tier1_at - 1) limit 1
        on conflict do nothing
        returning id into v_bonus_id;
        if v_bonus_id is not null then
          perform public.growth_log_event(v_bonus_id, 'registered', null, jsonb_build_object('tier', 1, 'paidReferrals', v_count));
          if public.growth_grant_claim(v_bonus_id) = 'paid' then n_bonus := n_bonus + 1; end if;
          v_bonus_id := null;
        end if;
      end if;
      if s.tier2_bonus_months > 0 and v_count >= s.tier2_at
         and not exists (select 1 from public.growth_reward_claims t where t.beneficiary_tenant_id = rc.ref_tenant and t.component = 'tier2' and t.status <> 'rejected') then
        insert into public.growth_reward_claims
          (rule_id, beneficiary_tenant_id, referred_tenant_id, amount_try, status, eligible_at, component, invoice_id, months_units, base_monthly_try)
        select b.rule_id, b.beneficiary_tenant_id, b.referred_tenant_id,
               round(coalesce(b.base_monthly_try, 0) * s.tier2_bonus_months, 2), 'approved', now(), 'tier2', b.invoice_id,
               s.tier2_bonus_months, b.base_monthly_try
        from public.growth_reward_claims b
        where b.beneficiary_tenant_id = rc.ref_tenant and b.component = 'base' and b.status = 'paid'
        order by b.granted_at asc offset (s.tier2_at - 1) limit 1
        on conflict do nothing
        returning id into v_bonus_id;
        if v_bonus_id is not null then
          perform public.growth_log_event(v_bonus_id, 'registered', null, jsonb_build_object('tier', 2, 'paidReferrals', v_count));
          if public.growth_grant_claim(v_bonus_id) = 'paid' then n_bonus := n_bonus + 1; end if;
          v_bonus_id := null;
        end if;
      end if;
    end loop;
  end if;

  -- D. Clawback
  n_clawback := public.growth_clawback_pending(v_limit, v_wallet);

  -- E. Ortak komisyonlari: vadesi gelen -> 'approved' (odenebilir bakiye). Ortak programi kapaliysa DOKUNULMAZ.
  if public.growth_flag_on('growth_partner_enabled') then
    with up as (
      update public.growth_reward_claims x
      set status = 'approved', decided_at = now(), updated_at = now()
      where x.id in (
        select y.id from public.growth_reward_claims y
        join public.growth_partners p on p.id = y.partner_id and p.status = 'active'
        where y.component = 'commission' and y.status = 'held' and y.eligible_at <= now() and cardinality(y.flags) = 0
        order by y.eligible_at limit v_limit)
      returning x.id)
    select count(*) into n_partner from up;

    -- F. Hesap kredisi olarak talep edilen ortak odemeleri (kredi yazimi yalniz burada).
    if v_wallet then
      for v_payout in
        select po.id, po.amount_try, p.owner_tenant_id from public.growth_partner_payouts po
        join public.growth_partners p on p.id = po.partner_id
        where po.status = 'requested' and po.method = 'account_credit' and p.owner_tenant_id is not null
        order by po.created_at limit 50
      loop
        begin
          v_grant := public.try_credit_grant(v_payout.owner_tenant_id, v_payout.amount_try, 'partner',
            'partner-payout-' || v_payout.id::text, null, jsonb_build_object('payout_id', v_payout.id::text, 'program', 'partner'));
          if coalesce((v_grant ->> 'ok')::boolean, false) then
            update public.growth_partner_payouts set status = 'paid', paid_at = (now() at time zone 'Europe/Istanbul')::date
            where id = v_payout.id;
            update public.growth_reward_claims set status = 'paid', granted_at = now(), updated_at = now()
            where payout_id = v_payout.id and status = 'approved';
            n_payout := n_payout + 1;
          end if;
        exception when others then
          null;
        end;
      end loop;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true, 'wallet_ready', v_wallet, 'registered', n_registered, 'reversed', n_reversed, 'paid', n_paid,
    'bonus', n_bonus, 'blocked', n_blocked, 'rejected', n_rejected, 'clawback', n_clawback,
    'wallet_skipped', n_wallet_skip, 'partner_approved', n_partner, 'partner_payouts_credited', n_payout);
end;
$$;

-- Odeme sonrasi / iade sonrasi kanca yardimcilari (service_role)
create or replace function public.growth_claims_reverse_for_invoice(p_invoice uuid, p_reason text default 'invoice_refunded')
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_n int;
  v_claw int := 0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  v_n := public.growth_reverse_claims(p_invoice, coalesce(nullif(btrim(p_reason), ''), 'invoice_refunded'));
  if v_n > 0 then
    v_claw := public.growth_clawback_pending(50, public.try_credit_ready());
  end if;
  return jsonb_build_object('ok', true, 'reversed', v_n, 'clawback', v_claw);
end;
$$;

-- ---------------------------------------------------------------------------
-- 11. OFIS OKUMA (oturumlu; YALNIZ kendi tenant'i)
-- ---------------------------------------------------------------------------
create or replace function public.growth_my_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  s public.growth_referral_settings%rowtype;
  r public.growth_reward_rules%rowtype;
  v_code text;
  v_clicks bigint := 0;
  v_invites jsonb;
  v_earned numeric;
  v_pending numeric;
  v_paid_n int;
  v_signups int;
  v_waiting int;
  v_cancelled int;
  v_trial int;
  v_enabled boolean := public.growth_flag_on('growth_referral_enabled');
begin
  if v_tenant is null then
    return null;
  end if;
  select * into s from public.growth_referral_settings where singleton;
  select * into r from public.growth_reward_rules
  where kind = 'referral' and is_active and valid_from <= now() and (valid_until is null or valid_until > now())
  order by created_at desc limit 1;
  select c.code into v_code from public.growth_referral_codes c where c.tenant_id = v_tenant and c.is_active;
  if v_code is not null then
    select coalesce(sum(n), 0) into v_clicks from public.growth_click_counters where kind = 'referral' and code = v_code;
  end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.at desc), '[]'::jsonb) into v_invites
  from (
    select sa.created_at as at,
           case
             when c.status = 'paid' then 'paid'
             when c.status in ('held', 'approved', 'pending') then 'waiting'
             when c.status in ('reversed', 'rejected') then 'cancelled'
             else 'trial' end as stage,
           coalesce(c.amount_try, 0) as amount
    from public.signup_attributions sa
    left join public.growth_reward_claims c on c.referred_tenant_id = sa.tenant_id and c.component = 'base'
    where sa.referrer_tenant_id = v_tenant and sa.ref_kind = 'referral'
    order by sa.created_at desc limit 200
  ) x;

  select coalesce(sum(amount_try), 0) into v_earned from public.growth_reward_claims
  where beneficiary_tenant_id = v_tenant and status = 'paid';
  select coalesce(sum(amount_try), 0) into v_pending from public.growth_reward_claims
  where beneficiary_tenant_id = v_tenant and status in ('held', 'approved', 'pending');
  select count(*) into v_paid_n from public.growth_reward_claims
  where beneficiary_tenant_id = v_tenant and component = 'base' and status = 'paid';
  select count(*) into v_signups from public.signup_attributions where referrer_tenant_id = v_tenant and ref_kind = 'referral';
  select count(*) into v_waiting from public.growth_reward_claims
  where beneficiary_tenant_id = v_tenant and component = 'base' and status in ('held', 'approved', 'pending');
  select count(*) into v_cancelled from public.growth_reward_claims
  where beneficiary_tenant_id = v_tenant and component = 'base' and status in ('reversed', 'rejected');
  v_trial := greatest(v_signups - v_paid_n - v_waiting - v_cancelled, 0);

  return jsonb_build_object(
    'enabled', v_enabled,
    'code', v_code,
    'clicks', v_clicks,
    'signups', v_signups,
    'trial', v_trial,
    'waiting', v_waiting,
    'paid', v_paid_n,
    'cancelled', v_cancelled,
    'earned_try', v_earned,
    'pending_try', v_pending,
    'invites', v_invites,
    'rule', case when r.id is null then null else jsonb_build_object(
      'reward_type', r.reward_type, 'reward_value', r.reward_value, 'hold_days', r.hold_days,
      'credit_expires_days', r.credit_expires_days) end,
    'tiers', jsonb_build_object(
      'tier1_at', s.tier1_at, 'tier1_bonus_months', s.tier1_bonus_months, 'tier1_badge', s.tier1_badge,
      'tier2_at', s.tier2_at, 'tier2_bonus_months', s.tier2_bonus_months, 'tier2_badge', s.tier2_badge,
      'annual_cap_months', s.annual_cap_months),
    'welcome_credit_try', s.welcome_credit_try);
end;
$$;

create or replace function public.growth_my_partner_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  s public.growth_referral_settings%rowtype;
  p public.growth_partners%rowtype;
  v_clicks bigint := 0;
  v_signups int;
  v_payers int;
  v_pending numeric;
  v_approved numeric;
  v_paid numeric;
  v_clawback numeric;
  v_pct numeric;
  v_next_at int;
begin
  if v_tenant is null then
    return null;
  end if;
  select * into p from public.growth_partners where owner_tenant_id = v_tenant and status in ('active', 'suspended') order by created_at limit 1;
  if not found then
    return null;
  end if;
  select * into s from public.growth_referral_settings where singleton;
  select coalesce(sum(n), 0) into v_clicks from public.growth_click_counters where kind = 'partner' and code = p.code;
  select count(*) into v_signups from public.signup_attributions where partner_id = p.id;
  select count(distinct sa.tenant_id) into v_payers
  from public.signup_attributions sa
  join public.subscriptions sub on sub.tenant_id = sa.tenant_id and sub.status = 'active'
  where sa.partner_id = p.id;
  select coalesce(sum(amount_try) filter (where status in ('held', 'pending')), 0),
         coalesce(sum(amount_try) filter (where status = 'approved' and payout_id is null), 0),
         coalesce(sum(amount_try) filter (where status = 'paid'), 0),
         coalesce(sum(amount_try) filter (where status = 'reversed' and 'clawback_due' = any (flags)), 0)
    into v_pending, v_approved, v_paid, v_clawback
  from public.growth_reward_claims where partner_id = p.id;
  v_pct := case when v_payers <= s.partner_tier1_max then s.partner_tier1_pct
                when v_payers <= s.partner_tier2_max then s.partner_tier2_pct else s.partner_tier3_pct end;
  v_next_at := case when v_payers <= s.partner_tier1_max then s.partner_tier1_max + 1
                    when v_payers <= s.partner_tier2_max then s.partner_tier2_max + 1 else null end;
  return jsonb_build_object(
    'name', p.name, 'code', p.code, 'status', p.status,
    'program_enabled', public.growth_flag_on('growth_partner_enabled'),
    'cash_enabled', public.growth_flag_on('growth_cash_payout_enabled'),
    'is_tax_payer', p.is_tax_payer,
    'clicks', v_clicks, 'signups', v_signups, 'payers', v_payers,
    'pending_try', v_pending, 'payable_try', v_approved, 'paid_try', v_paid, 'clawback_due_try', v_clawback,
    'tier_pct', v_pct, 'next_tier_at', v_next_at, 'min_payout_try', s.partner_min_payout_try,
    'duration_months', s.partner_duration_months);
end;
$$;

-- ---------------------------------------------------------------------------
-- 12. ADMIN OKUMA (service_role): metrikler + kuyruk + hazirlik
-- ---------------------------------------------------------------------------
create or replace function public.growth_admin_metrics()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_clicks bigint;
  v_signups int;
  v_referrers int;
  v_payers int;
  v_claims int;
  v_flagged int;
  v_cost numeric;
  v_revenue numeric;
  v_status jsonb;
  v_due int;
  v_partner jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  select coalesce(sum(n), 0) into v_clicks from public.growth_click_counters where kind = 'referral';
  select count(*), count(distinct referrer_tenant_id) into v_signups, v_referrers
  from public.signup_attributions where ref_kind = 'referral';
  select count(*) into v_payers from public.growth_reward_claims where component = 'base' and status in ('held', 'pending', 'approved', 'paid');
  select count(*), count(*) filter (where cardinality(flags) > 0) into v_claims, v_flagged
  from public.growth_reward_claims where component = 'base';
  select coalesce(sum(amount_try), 0) into v_cost from public.growth_reward_claims
  where beneficiary_tenant_id is not null and status = 'paid';
  select coalesce(sum(i.amount_try), 0) into v_revenue
  from public.growth_reward_claims c join public.invoices i on i.id = c.invoice_id
  where c.component = 'base' and c.status not in ('rejected', 'reversed');
  select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) into v_status
  from (select status, count(*) as n from public.growth_reward_claims group by status) q;
  select count(*) into v_due from public.growth_reward_claims where status = 'held' and eligible_at <= now();
  select jsonb_build_object(
    'claims', count(*),
    'held', count(*) filter (where status in ('held', 'pending')),
    'approved_try', coalesce(sum(amount_try) filter (where status = 'approved' and payout_id is null), 0),
    'paid_try', coalesce(sum(amount_try) filter (where status = 'paid'), 0))
    into v_partner
  from public.growth_reward_claims where component = 'commission';
  return jsonb_build_object(
    'clicks', v_clicks, 'signups', v_signups, 'referrers', v_referrers, 'payers', v_payers,
    'claims', v_claims, 'flagged', v_flagged,
    'reward_cost_try', v_cost, 'first_payment_revenue_try', v_revenue,
    'status_counts', v_status, 'due_now', v_due, 'partner', v_partner);
end;
$$;

create or replace function public.growth_admin_queue(p_status text default null, p_limit integer default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb) into v_rows
  from (
    select c.id, c.status, c.component, c.amount_try, c.flags, c.eligible_at, c.created_at, c.note, c.reversal_reason,
           c.granted_at, c.clawed_back_at, c.referred_tenant_id, c.beneficiary_tenant_id, c.partner_id,
           rt.name as referred_name, bt.name as beneficiary_name, gp.name as partner_name
    from public.growth_reward_claims c
    left join public.tenants rt on rt.id = c.referred_tenant_id
    left join public.tenants bt on bt.id = c.beneficiary_tenant_id
    left join public.growth_partners gp on gp.id = c.partner_id
    where p_status is null or c.status = p_status
       or (p_status = 'due' and c.status = 'held' and c.eligible_at <= now())
       or (p_status = 'flagged' and cardinality(c.flags) > 0)
    order by c.created_at desc
    limit greatest(least(coalesce(p_limit, 100), 500), 1)
  ) x;
  return v_rows;
end;
$$;

create or replace function public.growth_engine_ready()
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
  if pg_catalog.to_regclass('public.growth_referral_settings') is null
     or pg_catalog.to_regclass('public.growth_claim_events') is null
     or not exists (select 1 from public.growth_referral_settings where singleton)
     or pg_catalog.to_regprocedure('public.growth_claim_register(uuid)') is null
     or pg_catalog.to_regprocedure('public.growth_claims_process(integer)') is null
     or pg_catalog.to_regprocedure('public.growth_grant_welcome(uuid)') is null then
    return false;
  end if;
  return true;
exception when others then
  return false;
end;
$$;

-- ---------------------------------------------------------------------------
-- 13. PLATFORM PERSONELI RPC'leri (DB icinde super_admin dogrulamasi)
-- ---------------------------------------------------------------------------
-- Personel kapisi: aktif super_admin. platform_settings 'platform.mfa_enforced' = on/true/1 ise ayrica oturum AAL2 (MFA)
-- ister; ayar yoksa/kapaliysa YALNIZ super_admin kontrolu (zorunlu MFA yayin oncesine kadar kapali; onaysiz sert kapi yok).
create or replace function public.growth_staff_super_admin()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select ps.id from public.platform_staff ps
  where ps.id = auth.uid() and ps.is_active and ps.role = 'super_admin'
    and (not public.growth_flag_on('platform.mfa_enforced') or (auth.jwt() ->> 'aal') = 'aal2');
$$;

create or replace function public.growth_admin_decide(p_claim uuid, p_decision text, p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.growth_staff_super_admin();
  v_reason text := left(nullif(btrim(coalesce(p_reason, '')), ''), 300);
  c public.growth_reward_claims%rowtype;
  v_status text;
begin
  if v_actor is null then
    raise exception 'Super admin required.' using errcode = '42501';
  end if;
  if v_reason is null or char_length(v_reason) < 3 then
    return jsonb_build_object('ok', false, 'code', 'reason_required');
  end if;
  if p_decision not in ('approve', 'reject', 'reverse') then
    return jsonb_build_object('ok', false, 'code', 'bad_decision');
  end if;
  select * into c from public.growth_reward_claims where id = p_claim for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  if p_decision = 'approve' then
    -- Yalniz inceleme kuyrugundaki (bayrakli) talep; ayni-ofis talebi ONAYLANAMAZ.
    if c.status <> 'pending' or 'same_tenant' = any (c.flags) then
      return jsonb_build_object('ok', false, 'code', 'not_approvable', 'status', c.status);
    end if;
    v_status := 'approved';
    update public.growth_reward_claims set status = 'approved', decided_at = now(), note = v_reason, updated_at = now() where id = c.id;
    perform public.growth_log_event(c.id, 'approved', v_actor, jsonb_build_object('reason', v_reason));
  elsif p_decision = 'reject' then
    if c.status not in ('pending', 'held', 'approved') then
      return jsonb_build_object('ok', false, 'code', 'not_rejectable', 'status', c.status);
    end if;
    v_status := 'rejected';
    update public.growth_reward_claims set status = 'rejected', decided_at = now(), note = v_reason, updated_at = now() where id = c.id;
    perform public.growth_log_event(c.id, 'rejected', v_actor, jsonb_build_object('reason', v_reason));
  else
    if c.status <> 'paid' and c.status <> 'approved' then
      return jsonb_build_object('ok', false, 'code', 'not_reversible', 'status', c.status);
    end if;
    v_status := 'reversed';
    update public.growth_reward_claims
    set status = 'reversed', decided_at = now(), reversal_reason = v_reason, updated_at = now(),
        flags = case when c.payout_id is not null and not ('clawback_due' = any (flags)) then array_append(flags, 'clawback_due'::text) else flags end
    where id = c.id;
    perform public.growth_log_event(c.id, 'reversed', v_actor, jsonb_build_object('reason', v_reason, 'manual', true));
  end if;
  return jsonb_build_object('ok', true, 'status', v_status);
end;
$$;

create or replace function public.growth_admin_save_settings(p_values jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.growth_staff_super_admin();
  s public.growth_referral_settings%rowtype;
begin
  if v_actor is null then
    raise exception 'Super admin required.' using errcode = '42501';
  end if;
  if p_values is null or jsonb_typeof(p_values) <> 'object' then
    return jsonb_build_object('ok', false, 'code', 'bad_input');
  end if;
  select * into s from public.growth_referral_settings where singleton for update;
  -- Denetim: onceki satir + istenen degerler (kisisel veri yok; yalniz program parametreleri).
  insert into public.growth_admin_audit (action, actor_id, target, meta)
  values ('settings_save', v_actor, 'growth_referral_settings',
          jsonb_build_object('before', to_jsonb(s) - 'updated_by' - 'updated_at', 'requested', p_values));
  update public.growth_referral_settings set
    welcome_credit_try = coalesce((p_values ->> 'welcome_credit_try')::numeric, welcome_credit_try),
    welcome_expires_days = coalesce((p_values ->> 'welcome_expires_days')::int, welcome_expires_days),
    tier1_at = coalesce((p_values ->> 'tier1_at')::int, tier1_at),
    tier1_bonus_months = coalesce((p_values ->> 'tier1_bonus_months')::numeric, tier1_bonus_months),
    tier1_badge = coalesce(nullif(btrim(p_values ->> 'tier1_badge'), ''), tier1_badge),
    tier2_at = coalesce((p_values ->> 'tier2_at')::int, tier2_at),
    tier2_bonus_months = coalesce((p_values ->> 'tier2_bonus_months')::numeric, tier2_bonus_months),
    tier2_badge = coalesce(nullif(btrim(p_values ->> 'tier2_badge'), ''), tier2_badge),
    annual_cap_months = coalesce((p_values ->> 'annual_cap_months')::numeric, annual_cap_months),
    velocity_max_per_day = coalesce((p_values ->> 'velocity_max_per_day')::int, velocity_max_per_day),
    partner_tier1_max = coalesce((p_values ->> 'partner_tier1_max')::int, partner_tier1_max),
    partner_tier1_pct = coalesce((p_values ->> 'partner_tier1_pct')::numeric, partner_tier1_pct),
    partner_tier2_max = coalesce((p_values ->> 'partner_tier2_max')::int, partner_tier2_max),
    partner_tier2_pct = coalesce((p_values ->> 'partner_tier2_pct')::numeric, partner_tier2_pct),
    partner_tier3_pct = coalesce((p_values ->> 'partner_tier3_pct')::numeric, partner_tier3_pct),
    partner_duration_months = coalesce((p_values ->> 'partner_duration_months')::int, partner_duration_months),
    partner_min_payout_try = coalesce((p_values ->> 'partner_min_payout_try')::numeric, partner_min_payout_try),
    min_cash_ratio = coalesce((p_values ->> 'min_cash_ratio')::numeric, min_cash_ratio),
    manual_review_first_n = coalesce((p_values ->> 'manual_review_first_n')::int, manual_review_first_n),
    updated_by = v_actor, updated_at = now()
  where singleton;
  return jsonb_build_object('ok', true);
exception when check_violation or invalid_text_representation or numeric_value_out_of_range then
  return jsonb_build_object('ok', false, 'code', 'invalid_value');
end;
$$;

-- Ortak odemesi: nakit (bank_transfer_external) YALNIZ growth_cash_payout_enabled acikken, vergi mukellefi ortaga, belge no + tarih ile.
create or replace function public.growth_admin_payout_create(
  p_partner uuid, p_method text, p_document_no text, p_paid_at date, p_note text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.growth_staff_super_admin();
  p public.growth_partners%rowtype;
  s public.growth_referral_settings%rowtype;
  v_gross numeric;
  v_claw numeric;
  v_net numeric;
  v_doc text := nullif(btrim(coalesce(p_document_no, '')), '');
  v_payout uuid;
begin
  if v_actor is null then
    raise exception 'Super admin required.' using errcode = '42501';
  end if;
  if p_method not in ('account_credit', 'bank_transfer_external') then
    return jsonb_build_object('ok', false, 'code', 'bad_method');
  end if;
  if not public.growth_flag_on('growth_partner_enabled') then
    return jsonb_build_object('ok', false, 'code', 'partner_program_off');
  end if;
  select * into p from public.growth_partners where id = p_partner for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'partner_not_found');
  end if;
  select * into s from public.growth_referral_settings where singleton;

  if p_method = 'bank_transfer_external' then
    if not public.growth_flag_on('growth_cash_payout_enabled') then
      return jsonb_build_object('ok', false, 'code', 'cash_payout_off');
    end if;
    if not p.is_tax_payer or p.tax_no is null then
      return jsonb_build_object('ok', false, 'code', 'not_tax_payer');
    end if;
    if v_doc is null or char_length(v_doc) < 3 or p_paid_at is null then
      return jsonb_build_object('ok', false, 'code', 'document_required');
    end if;
    if p_paid_at > (now() at time zone 'Europe/Istanbul')::date then
      return jsonb_build_object('ok', false, 'code', 'future_date');
    end if;
  elsif p.owner_tenant_id is null then
    return jsonb_build_object('ok', false, 'code', 'no_owner_tenant');
  end if;

  select coalesce(sum(amount_try), 0) into v_gross from public.growth_reward_claims
  where partner_id = p.id and component = 'commission' and status = 'approved' and payout_id is null;
  select coalesce(sum(amount_try), 0) into v_claw from public.growth_reward_claims
  where partner_id = p.id and status = 'reversed' and 'clawback_due' = any (flags);
  v_net := v_gross - v_claw;
  if v_net < s.partner_min_payout_try or v_net <= 0 then
    return jsonb_build_object('ok', false, 'code', 'below_min', 'net', v_net, 'min', s.partner_min_payout_try);
  end if;

  insert into public.growth_partner_payouts (partner_id, amount_try, method, document_no, paid_at, marked_by_staff, status, note)
  values (p.id, v_net, p_method, v_doc, case when p_method = 'bank_transfer_external' then p_paid_at else null end,
          v_actor, case when p_method = 'bank_transfer_external' then 'paid' else 'requested' end, left(p_note, 300))
  returning id into v_payout;

  update public.growth_reward_claims
  set payout_id = v_payout,
      status = case when p_method = 'bank_transfer_external' then 'paid' else status end,
      granted_at = case when p_method = 'bank_transfer_external' then now() else granted_at end,
      updated_at = now()
  where partner_id = p.id and component = 'commission' and status = 'approved' and payout_id is null;
  update public.growth_reward_claims
  set flags = array_append(array_remove(flags, 'clawback_due'), 'clawback_offset'::text), updated_at = now()
  where partner_id = p.id and status = 'reversed' and 'clawback_due' = any (flags);

  insert into public.growth_admin_audit (action, actor_id, target, meta)
  values ('payout_create', v_actor, p.id::text,
          jsonb_build_object('payout_id', v_payout, 'method', p_method, 'amount', v_net, 'clawback_offset', v_claw));

  return jsonb_build_object('ok', true, 'payout_id', v_payout, 'amount', v_net, 'clawback_offset', v_claw);
end;
$$;

-- Ortak tanimi guncelle: vergi mukellefi, ofis sahibi, kural, sozlesme tarihi (yalniz super_admin; DB icinde dogrulanir).
create or replace function public.growth_admin_partner_update(p_partner uuid, p_values jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.growth_staff_super_admin();
  v_owner uuid;
  v_rule uuid;
begin
  if v_actor is null then
    raise exception 'Super admin required.' using errcode = '42501';
  end if;
  if p_values is null or jsonb_typeof(p_values) <> 'object' then
    return jsonb_build_object('ok', false, 'code', 'bad_input');
  end if;
  if not exists (select 1 from public.growth_partners where id = p_partner) then
    return jsonb_build_object('ok', false, 'code', 'partner_not_found');
  end if;
  if p_values ? 'owner_tenant_id' and nullif(p_values ->> 'owner_tenant_id', '') is not null then
    v_owner := (p_values ->> 'owner_tenant_id')::uuid;
    if not exists (select 1 from public.tenants where id = v_owner) then
      return jsonb_build_object('ok', false, 'code', 'owner_not_found');
    end if;
  end if;
  if p_values ? 'rule_id' and nullif(p_values ->> 'rule_id', '') is not null then
    v_rule := (p_values ->> 'rule_id')::uuid;
    if not exists (select 1 from public.growth_reward_rules where id = v_rule and kind = 'partner') then
      return jsonb_build_object('ok', false, 'code', 'rule_not_found');
    end if;
  end if;
  -- Denetim (vergi no degeri YAZILMAZ; yalniz degisti bilgisi).
  insert into public.growth_admin_audit (action, actor_id, target, meta)
  values ('partner_update', v_actor, p_partner::text,
          jsonb_build_object('fields', (select coalesce(jsonb_agg(k order by k), '[]'::jsonb) from jsonb_object_keys(p_values) k),
                             'is_tax_payer', p_values -> 'is_tax_payer',
                             'tax_no_changed', p_values ? 'tax_no',
                             'owner_tenant_id', p_values -> 'owner_tenant_id',
                             'rule_id', p_values -> 'rule_id',
                             'contract_signed_at', p_values -> 'contract_signed_at'));
  update public.growth_partners set
    is_tax_payer = case when p_values ? 'is_tax_payer' then (p_values ->> 'is_tax_payer')::boolean else is_tax_payer end,
    tax_no = case when p_values ? 'tax_no' then nullif(regexp_replace(coalesce(p_values ->> 'tax_no', ''), '\D', '', 'g'), '') else tax_no end,
    owner_tenant_id = case when p_values ? 'owner_tenant_id' then v_owner else owner_tenant_id end,
    rule_id = case when p_values ? 'rule_id' then v_rule else rule_id end,
    contract_signed_at = case when p_values ? 'contract_signed_at' then nullif(p_values ->> 'contract_signed_at', '')::date else contract_signed_at end
  where id = p_partner;
  return jsonb_build_object('ok', true);
exception when check_violation or invalid_text_representation or invalid_datetime_format then
  return jsonb_build_object('ok', false, 'code', 'invalid_value');
end;
$$;

-- Davet baglantisini acan ziyaretci icin onizleme (ANON; yalniz program aciksa, yalniz aktif kod): ofis adi + hos geldin kredisi.
create or replace function public.growth_invite_preview(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_welcome numeric;
begin
  if p_code is null or p_code !~ '^[a-z0-9]{6,12}$' or not public.growth_flag_on('growth_referral_enabled') then
    return null;
  end if;
  select t.name into v_name
  from public.growth_referral_codes c join public.tenants t on t.id = c.tenant_id
  where c.code = p_code and c.is_active;
  if v_name is null then
    return null;
  end if;
  select welcome_credit_try into v_welcome from public.growth_referral_settings where singleton;
  return jsonb_build_object('office_name', left(v_name, 80), 'welcome_credit_try', coalesce(v_welcome, 0));
end;
$$;

-- ---------------------------------------------------------------------------
-- 14. YETKILER
-- ---------------------------------------------------------------------------
do $$
declare
  v_sig text;
begin
  -- Hepsini kapat, sonra gerekenleri ac.
  for v_sig in
    select p.oid::regprocedure::text
    from pg_catalog.pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname like 'growth\_%' and p.proname <> 'growth_count_click'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', v_sig);
    execute format('grant execute on function %s to service_role', v_sig);
  end loop;
end $$;

grant execute on function public.growth_my_dashboard() to authenticated;
grant execute on function public.growth_my_partner_dashboard() to authenticated;
grant execute on function public.growth_admin_decide(uuid, text, text) to authenticated;
grant execute on function public.growth_admin_save_settings(jsonb) to authenticated;
grant execute on function public.growth_admin_payout_create(uuid, text, text, date, text) to authenticated;
grant execute on function public.growth_admin_partner_update(uuid, jsonb) to authenticated;
grant execute on function public.growth_invite_preview(text) to anon, authenticated;

comment on function public.growth_claims_process(integer) is
  'Referans/ortak talep isleyicisi: kacirilan talepler, iade geri alma, vadesi gelen odul (TL kredi), kademe bonusu, clawback, ortak komisyon onayi. Service-role-only; cron growth-claims + odeme kancasi.';
comment on function public.growth_admin_decide(uuid, text, text) is
  'Referans inceleme karari (approve|reject|reverse) - DB icinde super_admin dogrulamasi; kredi yazimi yapmaz (isleyici yapar).';

notify pgrst, 'reload schema';
