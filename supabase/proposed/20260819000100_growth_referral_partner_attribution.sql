-- TASLAK (UYGULANMADI) — organik büyüme: ofis referral, ortaklar, kaynak yakalama, hesap kredisi defteri.
-- Tasarım: docs/design/ORGANIK_BUYUME_PLANI.md. supabase/migrations'a taşımadan önce: numara güncelle,
-- check:migrations + dry-run, restore edilebilir yedek. K2 (plan/kupon/kampanya) tablolarına DOKUNMAZ.
-- Not: mevcut `referral_links/referrals` (müşteri tavsiye programı) ile ilgisi yoktur; adlar bilerek ayrıdır (growth_*).
-- Tablolar RLS'li; yazma yalnız service_role. Kişisel veri partnere gitmez: partner raporu agregattır.

-- 1) Ödül kuralları (admin düzenler; kod içine sabit oran yazılmaz).
create table if not exists public.growth_reward_rules (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in ('referral','partner')),
  name          text not null,
  reward_type   text not null check (reward_type in ('fixed_try','percent_of_payment')),
  reward_value  numeric(12,2) not null check (reward_value >= 0),
  duration_months int check (duration_months is null or duration_months between 1 and 60),
  hold_days     int not null default 30 check (hold_days between 0 and 180),
  monthly_cap_try numeric(12,2) check (monthly_cap_try is null or monthly_cap_try >= 0),
  credit_expires_days int check (credit_expires_days is null or credit_expires_days > 0),
  valid_from    timestamptz not null default now(),
  valid_until   timestamptz,
  is_active     boolean not null default true,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);

-- 2) Ortaklar (affiliate): eğitmen, ajans, mali müşavir, içerik üreticisi, kurum.
create table if not exists public.growth_partners (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  partner_type  text not null check (partner_type in ('trainer','agency','accountant','creator','institution','other')),
  code          text not null unique check (code ~ '^[a-z0-9][a-z0-9-]{2,39}$'),
  status        text not null default 'draft' check (status in ('draft','active','suspended','ended')),
  rule_id       uuid references public.growth_reward_rules(id) on delete set null,
  contract_signed_at date,
  report_token_hash text unique,
  owner_tenant_id uuid references public.tenants(id) on delete set null,
  notes         text,
  created_at    timestamptz not null default now()
);

-- 3) Ofis referral kodu (her ofise bir tane).
create table if not exists public.growth_referral_codes (
  tenant_id     uuid primary key references public.tenants(id) on delete cascade,
  code          text not null unique check (code ~ '^[a-z0-9]{6,12}$'),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

-- 4) Kaynak/atıf: kayıt olan her ofis için tek (ilk dokunuş) kayıt.
create table if not exists public.signup_attributions (
  tenant_id     uuid primary key references public.tenants(id) on delete cascade,
  ref_kind      text check (ref_kind in ('referral','partner','tool','powered_by','none')),
  referrer_tenant_id uuid references public.tenants(id) on delete set null,
  partner_id    uuid references public.growth_partners(id) on delete set null,
  utm_source    text,
  utm_medium    text,
  utm_campaign  text,
  landing_path  text,
  first_seen_at timestamptz,
  -- KVKK: IP/cihaz izi (signup_ip_hash) bilerek YOK; uygulama kodu kişisel veri toplamaz.
  created_at   timestamptz not null default now(),
  check (referrer_tenant_id is null or referrer_tenant_id <> tenant_id)
);
create index if not exists idx_signup_attr_partner on public.signup_attributions(partner_id) where partner_id is not null;
create index if not exists idx_signup_attr_referrer on public.signup_attributions(referrer_tenant_id) where referrer_tenant_id is not null;

-- 5) Ödül kuyruğu (admin onay/ret, kötüye kullanım bayrakları).
create table if not exists public.growth_reward_claims (
  id            uuid primary key default gen_random_uuid(),
  rule_id       uuid not null references public.growth_reward_rules(id),
  beneficiary_tenant_id uuid references public.tenants(id) on delete set null,
  partner_id    uuid references public.growth_partners(id) on delete set null,
  referred_tenant_id uuid not null references public.tenants(id) on delete cascade,
  amount_try    numeric(12,2) not null check (amount_try >= 0),
  status        text not null default 'pending' check (status in ('pending','held','approved','rejected','reversed','paid')),
  flags         text[] not null default '{}',
  eligible_at   timestamptz,
  decided_by    uuid references public.profiles(id) on delete set null,
  decided_at    timestamptz,
  note          text,
  created_at    timestamptz not null default now(),
  check ((beneficiary_tenant_id is not null) <> (partner_id is not null)),
  unique (rule_id, referred_tenant_id)
);

-- 6) TEK hesap kredisi defteri (append-only). unit='ai' ileride AI kredi ölçümüyle birleşir.
create table if not exists public.account_credit_ledger (
  id            bigint generated always as identity primary key,
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  unit          text not null check (unit in ('try','ai')),
  entry_type    text not null check (entry_type in ('grant','spend','expire','adjust','reverse')),
  amount        numeric(14,2) not null check (amount <> 0),
  source        text not null check (source in ('referral','partner','campaign','manual','usage')),
  source_id     uuid,
  idempotency_key text not null unique,
  available_at  timestamptz not null default now(),
  expires_at    timestamptz,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists idx_credit_ledger_tenant on public.account_credit_ledger(tenant_id, unit, created_at desc);

create or replace function public.account_credit_ledger_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'account_credit_ledger append-only' using errcode = '42501';
end $$;
drop trigger if exists trg_credit_ledger_immutable on public.account_credit_ledger;
create trigger trg_credit_ledger_immutable before update or delete on public.account_credit_ledger
  for each row execute function public.account_credit_ledger_immutable();

create or replace view public.account_credit_balances with (security_invoker = true) as
  select tenant_id, unit, sum(amount) as balance
  from public.account_credit_ledger
  where available_at <= now() and (expires_at is null or expires_at > now())
  group by tenant_id, unit;

-- 7) Ortak ödemeleri (nakit yok; admin elle "ödendi" + dış belge no; vergi: mali müşavir teyidi gerekir).
create table if not exists public.growth_partner_payouts (
  id            uuid primary key default gen_random_uuid(),
  partner_id    uuid not null references public.growth_partners(id),
  amount_try    numeric(12,2) not null check (amount_try > 0),
  method        text not null check (method in ('account_credit','bank_transfer_external')),
  document_no   text,
  paid_at       date,
  marked_by     uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  check (method = 'account_credit' or (document_no is not null and paid_at is not null))
);

-- 8) Başarı hikâyesi: yazılı izin kaydı olmadan yayınlanamaz.
create table if not exists public.success_stories (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid references public.tenants(id) on delete set null,
  office_name   text not null,
  quote         text not null,
  figure_label  text,
  figure_value  text,
  figure_source_note text,
  consent_date  date,
  consent_file_ref text,
  published     boolean not null default false,
  created_at    timestamptz not null default now(),
  check (published = false or (consent_date is not null and consent_file_ref is not null))
);

alter table public.growth_reward_rules   enable row level security;
alter table public.growth_partners        enable row level security;
alter table public.growth_referral_codes  enable row level security;
alter table public.signup_attributions    enable row level security;
alter table public.growth_reward_claims   enable row level security;
alter table public.account_credit_ledger  enable row level security;
alter table public.growth_partner_payouts enable row level security;
alter table public.success_stories        enable row level security;

drop policy if exists growth_referral_codes_own on public.growth_referral_codes;
create policy growth_referral_codes_own on public.growth_referral_codes for select
  using (tenant_id = public.current_tenant_id());
drop policy if exists credit_ledger_own_select on public.account_credit_ledger;
create policy credit_ledger_own_select on public.account_credit_ledger for select
  using (tenant_id = public.current_tenant_id());
-- Diğer tablolar politikasız: yalnız service_role. Yazma her yerde service_role/RPC.
