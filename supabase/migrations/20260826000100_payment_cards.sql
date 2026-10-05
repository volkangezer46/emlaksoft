-- MIGRATION 20260826000100: kayitli odeme karti (iyzico kart saklama) - KART BIZDE DEGIL, iyzico'dadir.
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20260826000100_payment_cards.sql` ile uygular (ledger drift varsa yazma yapma).
-- Geri alma: supabase/rollbacks/20260826000100_payment_cards.rollback.sql. Forward-only; mevcut nesneye dokunmaz.
--
-- PCI KAPSAMI: ham kart no / CVC / son kullanma tarihi HICBIR sutunda tutulmaz. Yalniz saglayici anahtarlari
-- (cardUserKey, cardToken) + gosterim icin marka, ilk 6 (BIN), son 4 hane. CHECK kisitlari ham PAN'i yapisal olarak
-- imkansiz kilar (bin_prefix tam 6 rakam, last_four tam 4 rakam).
--
-- KAPSAM KARARI (ofis duzeyi, kullanici degil): abonelik/fatura tenant'a aittir; kart "ofisin odeme araci"dir ve
-- sahip/GM degisse de kalir. Kaydi yapan kisi consent_by ile izlenir. Ekleme/silme/varsayilan yalniz owner/gm
-- (uygulama katmaninda requirePermission billing:edit + rol). iyzico cardUserKey ofis basina TEK (tenant_payment_profiles).
--
-- ERISIM: istemci (authenticated) YALNIZ guvenli sutunlari okur (provider anahtarlari sutun yetkisiyle gizli) ve
-- hicbir yazma politikasi yoktur; tum yazma sunucuda service_role ile, tenant filtreli yapilir.

create table if not exists public.tenant_payment_profiles (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  provider text not null default 'iyzico' check (provider in ('iyzico')),
  provider_card_user_key text check (provider_card_user_key is null or char_length(provider_card_user_key) between 8 and 128),
  -- Otomatik yenileme: varsayilan KAPALI; acik riza (kim/ne zaman/hangi IP) olmadan tahsilat yapilmaz.
  auto_renew_enabled boolean not null default false,
  auto_renew_card_id uuid,
  auto_renew_consent_at timestamptz,
  auto_renew_consent_by uuid references public.profiles(id) on delete set null,
  auto_renew_consent_ip text check (auto_renew_consent_ip is null or char_length(auto_renew_consent_ip) <= 64),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tpp_auto_renew_needs_consent check (
    not auto_renew_enabled
    or (auto_renew_consent_at is not null and auto_renew_card_id is not null)
  )
);

create table if not exists public.payment_cards (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  provider text not null default 'iyzico' check (provider in ('iyzico')),
  provider_card_token text not null check (char_length(provider_card_token) between 8 and 128),
  brand text check (brand is null or char_length(brand) <= 32),
  card_family text check (card_family is null or char_length(card_family) <= 48),
  bin_prefix text not null check (bin_prefix ~ '^[0-9]{6}$'),
  last_four text not null check (last_four ~ '^[0-9]{4}$'),
  is_default boolean not null default false,
  -- Acik riza kaydi (varsayilan KAPALI onay kutusu; metin surumu ile).
  consent_at timestamptz not null,
  consent_by uuid references public.profiles(id) on delete set null,
  consent_version text not null check (char_length(consent_version) between 1 and 32),
  source_invoice_id uuid references public.invoices(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists uq_payment_cards_token on public.payment_cards (tenant_id, provider_card_token);
create unique index if not exists uq_payment_cards_one_default on public.payment_cards (tenant_id) where is_default;
create index if not exists idx_payment_cards_tenant on public.payment_cards (tenant_id, created_at desc);

alter table public.tenant_payment_profiles drop constraint if exists tpp_auto_renew_card_fk;
alter table public.tenant_payment_profiles
  add constraint tpp_auto_renew_card_fk foreign key (auto_renew_card_id)
  references public.payment_cards(id) on delete set null;

alter table public.payment_cards enable row level security;
alter table public.tenant_payment_profiles enable row level security;

revoke all privileges on table public.payment_cards from public, anon, authenticated;
revoke all privileges on table public.tenant_payment_profiles from public, anon, authenticated;
grant all privileges on table public.payment_cards to service_role;
grant all privileges on table public.tenant_payment_profiles to service_role;

-- Yalniz guvenli sutunlar (provider_card_token / provider_card_user_key / consent_ip istemciye ASLA gitmez).
grant select (id, tenant_id, brand, card_family, bin_prefix, last_four, is_default, consent_at, created_at)
  on public.payment_cards to authenticated;
grant select (tenant_id, auto_renew_enabled, auto_renew_card_id, auto_renew_consent_at, updated_at)
  on public.tenant_payment_profiles to authenticated;

drop policy if exists payment_cards_tenant_select on public.payment_cards;
create policy payment_cards_tenant_select on public.payment_cards
  for select to authenticated
  using (tenant_id = (select public.current_tenant_id()));

drop policy if exists tenant_payment_profiles_tenant_select on public.tenant_payment_profiles;
create policy tenant_payment_profiles_tenant_select on public.tenant_payment_profiles
  for select to authenticated
  using (tenant_id = (select public.current_tenant_id()));

-- Varsayilan karti atomik degistirir (tek islemde).
create or replace function public.set_default_payment_card(p_tenant_id uuid, p_card_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.payment_cards where id = p_card_id and tenant_id = p_tenant_id) then
    raise exception 'Card not found.' using errcode = 'P0002';
  end if;
  update public.payment_cards set is_default = false where tenant_id = p_tenant_id and is_default and id <> p_card_id;
  update public.payment_cards set is_default = true where id = p_card_id and tenant_id = p_tenant_id;
  return true;
end;
$$;

revoke all privileges on function public.set_default_payment_card(uuid, uuid) from public, anon, authenticated;
grant execute on function public.set_default_payment_card(uuid, uuid) to service_role;

-- Otomatik yenileme bayragi: platform_settings 'billing.auto_renew_enabled' = 'true' olmadikca KAPALI (satir eklenmez).
notify pgrst, 'reload schema';
