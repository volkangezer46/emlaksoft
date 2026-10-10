-- e-Fatura entegrasyonu (Paket D): ofis baslarina tek saglayici baglantisi + fatura kayitlari.
--
-- NEDEN: Komisyon/anlasma/kira yonetim ucreti icin ofisin kendi e-Fatura/e-Arsiv saglayicisinda (Nilvera, Parasut)
--   fatura kesmek; durum ve PDF izlemek. EmlakSoft muhasebe programi degildir; yalniz belge keser ve izler.
-- NE: (1) einvoice_connections: ofis basina TEK baglanti (unique tenant_id); kimlik bilgisi uygulama katmaninda
--         SIFRELI (credentials_sealed; AAD einvoice:<tenant>:<provider>) saklanir, authenticated bu sutunu OKUYAMAZ
--         (sutun bazli SELECT yetkisi); okuma yalniz izin kapili DEFINER RPC (einvoice_connection_secret).
--     (2) einvoices: taslak|resmilesti|hata|iptal; idempotency_key = kaynak+tur (ofis icinde benzersiz, iptal edilmisler haric);
--         resmilesen belgenin tutar/alici/kalem alanlari tetikleyiciyle degistirilemez.
--     (3) RLS: tum satirlar ofis kapsamli; yazma commissions.create (fatura) / settings.edit (baglanti) izniyle. (select fn()) sarmali.
-- GIZLILIK: P12 (kazanc gizliligi) korunur: faturalar yalniz commissions.create izinli rollerce (sahip/GM/muhasebe) okunur;
--   danismanlar fatura listesini goremez. Kimlik bilgisi duz metin ASLA yazilmaz (kod sifreleme anahtari yokken kaydetmez).
-- GERI ALMA: supabase/rollbacks/20261010000700_einvoice.rollback.sql (tablolar+RPC duser; kod tablo yokken bolumu "etkin degil" der).
-- RISK: dusuk (yeni tablo/RPC; mevcut tablo ve politika degismez).

set local lock_timeout = '5s';
set local search_path = public;

-- ---------------------------------------------------------------------------
-- 1) Baglanti
-- ---------------------------------------------------------------------------
create table if not exists public.einvoice_connections (
  id                  uuid        primary key default gen_random_uuid(),
  tenant_id           uuid        not null references public.tenants(id) on delete cascade,
  provider            text        not null check (provider in ('nilvera', 'parasut')),
  mode                text        not null default 'live' check (mode in ('sandbox', 'live')),
  status              text        not null default 'active' check (status in ('active', 'error')),
  credentials_sealed  text        not null check (char_length(credentials_sealed) between 20 and 8000),
  fingerprint         text        check (fingerprint is null or char_length(fingerprint) <= 32),
  company_name        text        check (company_name is null or char_length(company_name) <= 200),
  last_test_at        timestamptz,
  last_test_ok        boolean,
  last_error          text        check (last_error is null or char_length(last_error) <= 500),
  created_by          uuid        references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint einvoice_connections_one_per_tenant unique (tenant_id)
);

comment on table public.einvoice_connections is 'Ofis basina tek e-Fatura saglayici baglantisi. credentials_sealed uygulama katmaninda AES-GCM sifreli; istemciye okunmaz.';

alter table public.einvoice_connections enable row level security;

drop policy if exists einvoice_connections_select on public.einvoice_connections;
create policy einvoice_connections_select on public.einvoice_connections
  for select to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and (
      (select public.has_effective_permission('settings', 'view'))
      or (select public.has_effective_permission('commissions', 'create'))
    )
  );

drop policy if exists einvoice_connections_insert on public.einvoice_connections;
create policy einvoice_connections_insert on public.einvoice_connections
  for insert to authenticated
  with check (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('settings', 'edit'))
  );

drop policy if exists einvoice_connections_update on public.einvoice_connections;
create policy einvoice_connections_update on public.einvoice_connections
  for update to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('settings', 'edit'))
  )
  with check (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('settings', 'edit'))
  );

drop policy if exists einvoice_connections_delete on public.einvoice_connections;
create policy einvoice_connections_delete on public.einvoice_connections
  for delete to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('settings', 'edit'))
  );

-- ---------------------------------------------------------------------------
-- 2) Faturalar
-- ---------------------------------------------------------------------------
create table if not exists public.einvoices (
  id               uuid          primary key default gen_random_uuid(),
  tenant_id        uuid          not null references public.tenants(id) on delete cascade,
  connection_id    uuid          references public.einvoice_connections(id) on delete set null,
  provider         text          not null check (provider in ('nilvera', 'parasut')),
  mode             text          not null default 'live' check (mode in ('sandbox', 'live')),
  source_type      text          not null check (source_type in ('commission', 'deal', 'rent_management_fee', 'free')),
  source_id        uuid,
  source_label     text          check (source_label is null or char_length(source_label) <= 200),
  doc_type         text          not null check (doc_type in ('e-fatura', 'e-arsiv', 'e-smm')),
  status           text          not null default 'draft' check (status in ('draft', 'issued', 'error', 'cancelled')),
  provider_state   text          not null default 'none' check (provider_state in ('none', 'waiting', 'succeeded', 'failed')),
  buyer_name       text          not null check (char_length(buyer_name) between 1 and 300),
  buyer_tax_id     text          not null check (buyer_tax_id ~ '^[0-9]{10,11}$'),
  buyer_tax_office text          check (buyer_tax_office is null or char_length(buyer_tax_office) <= 120),
  buyer_address    text          check (buyer_address is null or char_length(buyer_address) <= 500),
  buyer_city       text          check (buyer_city is null or char_length(buyer_city) <= 100),
  buyer_district   text          check (buyer_district is null or char_length(buyer_district) <= 100),
  buyer_alias      text          check (buyer_alias is null or char_length(buyer_alias) <= 300),
  lines            jsonb         not null check (jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) between 1 and 50),
  currency         text          not null default 'TRY' check (currency = 'TRY'),
  net_total        numeric(14,2) not null check (net_total >= 0),
  vat_total        numeric(14,2) not null check (vat_total >= 0),
  gross_total      numeric(14,2) not null check (gross_total >= 0),
  issue_date       date          not null,
  note             text          check (note is null or char_length(note) <= 500),
  external_id      uuid          not null default gen_random_uuid(),
  provider_ref     jsonb         not null default '{}'::jsonb,
  number           text          check (number is null or char_length(number) <= 100),
  error            text          check (error is null or char_length(error) <= 500),
  idempotency_key  text          not null check (char_length(idempotency_key) between 3 and 200),
  issued_at        timestamptz,
  last_checked_at  timestamptz,
  created_by       uuid          references public.profiles(id) on delete set null,
  created_at       timestamptz   not null default now(),
  updated_at       timestamptz   not null default now()
);

comment on table public.einvoices is 'e-Fatura/e-Arsiv kayitlari. Kaynak+tur basina tek fatura (idempotency_key). Resmilesen belgenin tutar/alici/kalem alanlari degistirilemez.';

-- Ayni kaynak iki kez faturalanmaz (iptal edilenler yeniden kesilebilir).
create unique index if not exists einvoices_idempotency_uidx
  on public.einvoices (tenant_id, idempotency_key)
  where status <> 'cancelled';
create unique index if not exists einvoices_external_uidx on public.einvoices (external_id);
create index if not exists einvoices_tenant_created_idx on public.einvoices (tenant_id, created_at desc);
create index if not exists einvoices_pending_idx on public.einvoices (provider_state, last_checked_at)
  where status = 'issued' and provider_state in ('none', 'waiting');
create index if not exists einvoices_source_idx on public.einvoices (tenant_id, source_type, source_id);

alter table public.einvoices enable row level security;

drop policy if exists einvoices_select on public.einvoices;
create policy einvoices_select on public.einvoices
  for select to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('commissions', 'create'))
  );

drop policy if exists einvoices_insert on public.einvoices;
create policy einvoices_insert on public.einvoices
  for insert to authenticated
  with check (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('commissions', 'create'))
    and created_by = (select auth.uid())
  );

drop policy if exists einvoices_update on public.einvoices;
create policy einvoices_update on public.einvoices
  for update to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('commissions', 'create'))
  )
  with check (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('commissions', 'create'))
  );

drop policy if exists einvoices_delete on public.einvoices;
create policy einvoices_delete on public.einvoices
  for delete to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and status = 'draft'
    and (select public.has_effective_permission('commissions', 'create'))
  );

-- Resmilesen/iptal edilen belgenin icerigi degistirilemez; iptal geri alinamaz.
create or replace function public.einvoices_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if old.status = 'cancelled' then
      raise exception 'Iptal edilmis fatura degistirilemez.' using errcode = 'check_violation';
    end if;
    if old.status = 'issued' and (
         new.lines is distinct from old.lines
      or new.buyer_name is distinct from old.buyer_name
      or new.buyer_tax_id is distinct from old.buyer_tax_id
      or new.net_total is distinct from old.net_total
      or new.vat_total is distinct from old.vat_total
      or new.gross_total is distinct from old.gross_total
      or new.issue_date is distinct from old.issue_date
      or new.doc_type is distinct from old.doc_type
      or new.source_type is distinct from old.source_type
      or new.source_id is distinct from old.source_id
      or new.idempotency_key is distinct from old.idempotency_key
      or new.external_id is distinct from old.external_id
      or new.tenant_id is distinct from old.tenant_id
    ) then
      raise exception 'Resmilesmis faturanin icerigi degistirilemez.' using errcode = 'check_violation';
    end if;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists einvoices_guard_trg on public.einvoices;
create trigger einvoices_guard_trg
  before update on public.einvoices
  for each row execute function public.einvoices_guard();

-- ---------------------------------------------------------------------------
-- 3) Kimlik bilgisi okuma/yenileme: yalniz izin kapili DEFINER RPC
-- ---------------------------------------------------------------------------
create or replace function public.einvoice_connection_secret()
returns table (id uuid, provider text, mode text, credentials_sealed text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tenant uuid := (select public.current_active_tenant_id());
begin
  if v_tenant is null then
    return;
  end if;
  if not ((select public.has_effective_permission('commissions', 'create'))
       or (select public.has_effective_permission('settings', 'edit'))) then
    return;
  end if;
  return query
    select c.id, c.provider, c.mode, c.credentials_sealed
      from public.einvoice_connections c
     where c.tenant_id = v_tenant;
end;
$$;

-- Parasut yenileme jetonu degisirse (sifreli) yeniden saklanir; ayni izin kapisi.
create or replace function public.einvoice_store_rotated_credentials(p_sealed text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := (select public.current_active_tenant_id());
  v_rows int;
begin
  if v_tenant is null or p_sealed is null or char_length(p_sealed) < 20 or char_length(p_sealed) > 8000 then
    return false;
  end if;
  if not ((select public.has_effective_permission('commissions', 'create'))
       or (select public.has_effective_permission('settings', 'edit'))) then
    return false;
  end if;
  update public.einvoice_connections
     set credentials_sealed = p_sealed, updated_at = now()
   where tenant_id = v_tenant;
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

revoke all on function public.einvoice_connection_secret() from public, anon;
revoke all on function public.einvoice_store_rotated_credentials(text) from public, anon;
grant execute on function public.einvoice_connection_secret() to authenticated, service_role;
grant execute on function public.einvoice_store_rotated_credentials(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4) Tablo yetkileri (000300 dersi: RLS tek basina yetmez)
-- ---------------------------------------------------------------------------
revoke all on public.einvoice_connections from public, anon, authenticated;
revoke all on public.einvoices from public, anon, authenticated;

-- credentials_sealed sutunu authenticated icin OKUNAMAZ (sutun bazli SELECT).
grant select (id, tenant_id, provider, mode, status, fingerprint, company_name, last_test_at, last_test_ok, last_error, created_by, created_at, updated_at)
  on public.einvoice_connections to authenticated;
grant insert, update, delete on public.einvoice_connections to authenticated;
grant select, insert, update, delete on public.einvoices to authenticated;

grant select, insert, update, delete on public.einvoice_connections to service_role;
grant select, insert, update, delete on public.einvoices to service_role;

notify pgrst, 'reload schema';
