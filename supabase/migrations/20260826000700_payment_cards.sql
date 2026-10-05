-- MIGRATION 20260826000700: kayitli odeme karti (iyzico kart saklama) - KART BIZDE DEGIL, iyzico'dadir.
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20260826000700_payment_cards.sql` ile uygular (ledger drift varsa yazma yapma).
-- Geri alma: supabase/rollbacks/20260826000700_payment_cards.rollback.sql. Forward-only; mevcut nesneye dokunmaz.
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
-- hicbir yazma politikasi yoktur. Kullanici eylemleri (varsayilan kart, oto-yenileme rizasi, kart silme, anahtar okuma)
-- YALNIZ owner/gm'e acik authenticated SECURITY DEFINER RPC'lerdir (current_tenant_id + current_profile_role);
-- webhook/callback/dunning yazimlari service_role ile ve tenant filtreli yapilir.

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

-- ---------------------------------------------------------------------------------------------------------------
-- Kullanici eylemleri: authenticated + YALNIZ owner/gm. Tenant HER ZAMAN current_tenant_id()'den gelir (parametre degil);
-- impersonation (readonly rol) ve pasif profil current_profile_role() tarafindan zaten reddedilir.
-- ---------------------------------------------------------------------------------------------------------------

-- Ofisin iyzico cardUserKey'i: yalniz odeme baslatan sunucu action'i (owner/gm) okur.
create or replace function public.tenant_card_user_key()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_key text;
begin
  if coalesce(public.current_profile_role(), '') not in ('owner', 'gm') then
    raise exception 'Forbidden.' using errcode = '42501';
  end if;
  select p.provider_card_user_key into v_key
    from public.tenant_payment_profiles p
   where p.tenant_id = public.current_tenant_id();
  return v_key;
end;
$$;

-- Kart silme icin saglayici referansi (iyzico'dan silmek icin). {userKey, token}
create or replace function public.payment_card_provider_ref(p_card_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ref jsonb;
begin
  if coalesce(public.current_profile_role(), '') not in ('owner', 'gm') then
    raise exception 'Forbidden.' using errcode = '42501';
  end if;
  select jsonb_build_object('userKey', pp.provider_card_user_key, 'token', c.provider_card_token)
    into v_ref
    from public.payment_cards c
    join public.tenant_payment_profiles pp on pp.tenant_id = c.tenant_id
   where c.id = p_card_id
     and c.tenant_id = public.current_tenant_id();
  return v_ref;
end;
$$;

-- Varsayilan karti atomik degistirir (kendi ofisi).
create or replace function public.set_my_default_payment_card(p_card_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.current_tenant_id();
begin
  if coalesce(public.current_profile_role(), '') not in ('owner', 'gm') then
    raise exception 'Forbidden.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.payment_cards where id = p_card_id and tenant_id = v_tenant) then
    raise exception 'Card not found.' using errcode = 'P0002';
  end if;
  update public.payment_cards set is_default = false where tenant_id = v_tenant and is_default and id <> p_card_id;
  update public.payment_cards set is_default = true where id = p_card_id and tenant_id = v_tenant;
  return true;
end;
$$;

-- Otomatik yenileme rizasi (ac/kapat). Acarken kart bu ofise ait olmali; riza kimligi auth.uid().
create or replace function public.set_my_auto_renew_consent(p_enabled boolean, p_card_id uuid, p_ip text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_rows integer;
begin
  if coalesce(public.current_profile_role(), '') not in ('owner', 'gm') then
    raise exception 'Forbidden.' using errcode = '42501';
  end if;
  if p_enabled then
    if p_card_id is null
       or not exists (select 1 from public.payment_cards where id = p_card_id and tenant_id = v_tenant) then
      raise exception 'Card not found.' using errcode = 'P0002';
    end if;
    update public.tenant_payment_profiles
       set auto_renew_enabled = true,
           auto_renew_card_id = p_card_id,
           auto_renew_consent_at = now(),
           auto_renew_consent_by = auth.uid(),
           auto_renew_consent_ip = left(coalesce(p_ip, ''), 64),
           updated_at = now()
     where tenant_id = v_tenant;
  else
    update public.tenant_payment_profiles
       set auto_renew_enabled = false, auto_renew_card_id = null, updated_at = now()
     where tenant_id = v_tenant;
  end if;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

-- Kart kaydini siler (iyzico silmesi sunucuda ONCE yapilir). Oto-yenileme karti ise riza duser; varsayilan ise siradaki kart.
create or replace function public.remove_my_payment_card(p_card_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_was_default boolean;
  v_next uuid;
begin
  if coalesce(public.current_profile_role(), '') not in ('owner', 'gm') then
    raise exception 'Forbidden.' using errcode = '42501';
  end if;
  select is_default into v_was_default
    from public.payment_cards where id = p_card_id and tenant_id = v_tenant;
  if not found then
    return false;
  end if;
  update public.tenant_payment_profiles
     set auto_renew_enabled = false, auto_renew_card_id = null, updated_at = now()
   where tenant_id = v_tenant and auto_renew_card_id = p_card_id;
  delete from public.payment_cards where id = p_card_id and tenant_id = v_tenant;
  if v_was_default then
    select id into v_next from public.payment_cards
     where tenant_id = v_tenant order by created_at desc limit 1;
    if v_next is not null then
      update public.payment_cards set is_default = true where id = v_next and tenant_id = v_tenant;
    end if;
  end if;
  return true;
end;
$$;

revoke all privileges on function public.tenant_card_user_key() from public, anon, authenticated;
revoke all privileges on function public.payment_card_provider_ref(uuid) from public, anon, authenticated;
revoke all privileges on function public.set_my_default_payment_card(uuid) from public, anon, authenticated;
revoke all privileges on function public.set_my_auto_renew_consent(boolean, uuid, text) from public, anon, authenticated;
revoke all privileges on function public.remove_my_payment_card(uuid) from public, anon, authenticated;
grant execute on function public.tenant_card_user_key() to authenticated;
grant execute on function public.payment_card_provider_ref(uuid) to authenticated;
grant execute on function public.set_my_default_payment_card(uuid) to authenticated;
grant execute on function public.set_my_auto_renew_consent(boolean, uuid, text) to authenticated;
grant execute on function public.remove_my_payment_card(uuid) to authenticated;

-- Otomatik yenileme: ayni abonelik donemi + deneme numarasi icin TEK fatura (es zamanli iki cron kosusu cift tahsilat yapamaz).
-- Anahtar uygulamada `<subscription_id>:<donem_sonu>:<deneme_no>` olarak yazilir; yalnizca auto_renew faturalari bu anahtari tasir.
create unique index if not exists uq_invoices_auto_renew_attempt
  on public.invoices (tenant_id, (meta ->> 'autoRenewAttemptKey'))
  where (meta ->> 'autoRenewAttemptKey') is not null;

-- Otomatik yenileme bayragi: platform_settings 'billing.auto_renew_enabled' = 'true' olmadikca KAPALI (satir eklenmez).
notify pgrst, 'reload schema';
