-- MIGRATION 20261012002700_portal_transfer_sessions.sql
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20261012002700_portal_transfer_sessions.sql` ile uygular.
-- Geri alma: supabase/rollbacks/20261012002700_portal_transfer_sessions.rollback.sql
-- BAGIMLILIK: tenants, profiles, properties, portal_listings, public.current_tenant_id(), public.has_effective_permission(),
--   public.current_profile_role(), public.lc_row_visible() (20260826002010), public.lc_bind_portal_listing() (20260826002000),
--   public.lc_mark_state_stale() (20260826002040).
--
-- AMAC: "Portala aktar" (eklentiyle yardimli doldurma) ve "Portaldan al" (secili ilanlari portfoy taslagi yap) akislarinin
--   oturum kaydi. Kullanici portal formunu KENDI oturumunda doldurur ve "Yayinla"ya KENDISI basar; EmlakSoft yalniz
--   paketi hazirlar, ilan no/URL'yi geri baglar. Yeni portal-ilan tablosu ACILMAZ: baglama mevcut portal_listings +
--   lc_bind_portal_listing uzerinden yapilir (kaynak 'assisted').
-- NE: (1) portal_transfer_sessions tablosu (tek kullanimlik aktarim kodunun SHA-256 ozeti, yuk ozeti, alan raporu, durum, sure);
--   (2) kullanici oturumuyla (JWT) calisan 4 SECURITY DEFINER RPC: pt_prepare_session, pt_consume_code, pt_complete_session,
--   pt_import_bind + pt_record_import. service_role KULLANILMAZ (createAdminClient yok).
-- GIZLILIK: yuk (baslik, fiyat, fotograf) SAKLANMAZ; yalniz ozet (payload_hash) ve alan basina durum. Ham kod SAKLANMAZ (yalniz hash).
-- RLS: tenant siniri `tenant_id = public.current_tenant_id()`; okuma portals/view + (kendi oturumu ya da yonetim kademesi);
--   dogrudan INSERT/UPDATE/DELETE politikasi YOK (yazma yalniz asagidaki RPC'lerle).
-- GRANT: authenticated yalniz SELECT; service_role ACIKCA tum yetki (acik grant'siz tablo service_role'de yazilamiyor).
-- RISK: dusuk (yeni tablo + yeni fonksiyonlar; mevcut tablo/politika/veri degismez).

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.properties') is null or pg_catalog.to_regclass('public.portal_listings') is null then
    raise exception 'properties/portal_listings tablolarindan biri yok.';
  end if;
  if not exists (select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'lc_bind_portal_listing')
     or not exists (select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
                     where n.nspname = 'public' and p.proname = 'lc_row_visible') then
    raise exception 'ilan kontrol cekirdegi yok; once 20260826002000 ve 20260826002010 uygulanmali.';
  end if;
end $$;

create table if not exists public.portal_transfer_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  property_id uuid references public.properties(id) on delete cascade,
  portal text not null check (portal in ('sahibinden', 'hepsiemlak', 'emlakjet')),
  direction text not null default 'export' check (direction in ('export', 'update', 'import')),
  state text not null default 'prepared' check (state in ('prepared', 'fetched', 'filled', 'published', 'imported', 'failed', 'abandoned')),
  code_hash text check (code_hash is null or code_hash ~ '^[0-9a-f]{64}$'),
  payload_hash text check (payload_hash is null or payload_hash ~ '^[0-9a-f]{64}$'),
  field_report jsonb not null default '{}'::jsonb check (pg_column_size(field_report) <= 16384),
  missing_fields text[] not null default '{}',
  portal_listing_id uuid references public.portal_listings(id) on delete set null,
  actor_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  fetched_at timestamptz,
  completed_at timestamptz,
  expires_at timestamptz not null,
  check (direction = 'import' or property_id is not null)
);
create unique index if not exists uq_portal_transfer_sessions_code on public.portal_transfer_sessions (code_hash) where code_hash is not null;
create index if not exists idx_portal_transfer_sessions_tenant on public.portal_transfer_sessions (tenant_id, created_at desc);
create index if not exists idx_portal_transfer_sessions_property on public.portal_transfer_sessions (property_id, created_at desc) where property_id is not null;

alter table public.portal_transfer_sessions enable row level security;
drop policy if exists portal_transfer_sessions_select on public.portal_transfer_sessions;
create policy portal_transfer_sessions_select on public.portal_transfer_sessions for select to authenticated
using (
  tenant_id = (select public.current_tenant_id())
  and (select public.has_effective_permission('portals', 'view'))
  and (actor_id = (select auth.uid()) or (select public.current_profile_role()) in ('owner', 'gm', 'branch_manager'))
);
revoke all on table public.portal_transfer_sessions from public, anon, authenticated;
grant select on table public.portal_transfer_sessions to authenticated;
grant all on table public.portal_transfer_sessions to service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- Ortak: portfoy bu kullaniciya gorunur mu (kiraci + silinmemis + rol kapsami)
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.pt_property_visible(p_property_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_branch uuid;
  v_advisor uuid;
  v_team uuid;
begin
  select pr.branch_id, pr.assigned_to into v_branch, v_advisor
    from public.properties pr
   where pr.id = p_property_id and pr.tenant_id = public.current_tenant_id() and pr.deleted_at is null;
  if not found then
    return false;
  end if;
  select nullif(to_jsonb(pf) ->> 'team_id', '')::uuid into v_team from public.profiles pf where pf.id = v_advisor;
  return public.lc_row_visible(v_branch, v_team, v_advisor);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 1) Aktarim oturumu hazirla (kod ozeti uygulama tarafinda uretilir; ham kod DB'ye girmez)
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.pt_prepare_session(
  p_property_id uuid,
  p_portal text,
  p_direction text,
  p_code_hash text,
  p_payload_hash text,
  p_missing text[],
  p_ttl_minutes integer default 120
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_uid uuid := auth.uid();
  v_portal text := lower(btrim(coalesce(p_portal, '')));
  v_status text;
  v_id uuid;
  v_exp timestamptz;
begin
  if v_uid is null or v_tenant is null or not public.has_effective_permission('portals', 'edit') then
    return jsonb_build_object('outcome', 'forbidden');
  end if;
  if v_portal not in ('sahibinden', 'hepsiemlak', 'emlakjet') or p_direction not in ('export', 'update')
     or p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$'
     or (p_payload_hash is not null and p_payload_hash !~ '^[0-9a-f]{64}$') then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;
  if not public.pt_property_visible(p_property_id) then
    return jsonb_build_object('outcome', 'property_not_found');
  end if;
  select status into v_status from public.properties where id = p_property_id and tenant_id = v_tenant;
  if v_status in ('sold', 'rented', 'archived') then
    return jsonb_build_object('outcome', 'property_closed');
  end if;
  -- Ayni portfoy+portal icin onceki acik oturumlar birakilir (tek aktif oturum).
  update public.portal_transfer_sessions
     set state = 'abandoned', completed_at = now()
   where tenant_id = v_tenant and property_id = p_property_id and portal = v_portal and actor_id = v_uid
     and state in ('prepared', 'fetched', 'filled');
  v_exp := now() + make_interval(mins => greatest(5, least(coalesce(p_ttl_minutes, 120), 240)));
  insert into public.portal_transfer_sessions
    (tenant_id, property_id, portal, direction, code_hash, payload_hash, missing_fields, actor_id, expires_at)
  values
    (v_tenant, p_property_id, v_portal, p_direction, p_code_hash, p_payload_hash,
     coalesce((select array_agg(left(q.m, 60)) from (select m from unnest(coalesce(p_missing, '{}'::text[])) as m limit 40) q), '{}'::text[]),
     v_uid, v_exp)
  returning id into v_id;
  return jsonb_build_object('outcome', 'ok', 'session_id', v_id, 'expires_at', v_exp);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 2) Kodu TEK KULLANIMLIK tuket (eklenti paketi alirken): ikinci kullanim 'used', sure dolmussa 'expired'
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.pt_consume_code(p_code_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_uid uuid := auth.uid();
  s public.portal_transfer_sessions%rowtype;
begin
  if v_uid is null or v_tenant is null or not public.has_effective_permission('portals', 'edit') then
    return jsonb_build_object('outcome', 'forbidden');
  end if;
  if p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;
  select * into s from public.portal_transfer_sessions
   where code_hash = p_code_hash and tenant_id = v_tenant and actor_id = v_uid
   for update;
  if not found then
    return jsonb_build_object('outcome', 'invalid');
  end if;
  if s.fetched_at is not null or s.state <> 'prepared' then
    return jsonb_build_object('outcome', 'used');
  end if;
  if s.expires_at <= now() then
    update public.portal_transfer_sessions set state = 'abandoned', completed_at = now() where id = s.id;
    return jsonb_build_object('outcome', 'expired');
  end if;
  if not public.pt_property_visible(s.property_id) then
    return jsonb_build_object('outcome', 'property_not_found');
  end if;
  update public.portal_transfer_sessions set state = 'fetched', fetched_at = now() where id = s.id;
  return jsonb_build_object('outcome', 'ok', 'session_id', s.id, 'property_id', s.property_id, 'portal', s.portal, 'direction', s.direction);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 3) Oturumu ilerlet / tamamla. p_state='filled': yalniz ilerleme + alan raporu.
--    p_state='published': ilan no ZORUNLU; lc_bind_portal_listing(source 'assisted', created_via 'bind') ile portfoye baglanir.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.pt_complete_session(
  p_session_id uuid,
  p_state text,
  p_external_id text,
  p_url text,
  p_field_report jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_uid uuid := auth.uid();
  s public.portal_transfer_sessions%rowtype;
  v_bind jsonb;
  v_listing uuid;
begin
  if v_uid is null or v_tenant is null or not public.has_effective_permission('portals', 'edit') then
    return jsonb_build_object('outcome', 'forbidden');
  end if;
  if p_state not in ('filled', 'published', 'failed') then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;
  if p_field_report is not null and (jsonb_typeof(p_field_report) <> 'object' or pg_column_size(p_field_report) > 16384) then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;
  select * into s from public.portal_transfer_sessions
   where id = p_session_id and tenant_id = v_tenant and actor_id = v_uid
   for update;
  if not found then
    return jsonb_build_object('outcome', 'invalid');
  end if;
  if s.state in ('published', 'abandoned', 'imported') then
    return jsonb_build_object('outcome', case when s.state = 'published' then 'replay' else 'closed' end, 'listing_id', s.portal_listing_id);
  end if;
  -- Yayin sonrasi baglama icin 24 saat tanınir; dolu oturum yeniden acilmaz.
  if s.created_at < now() - interval '24 hours' then
    return jsonb_build_object('outcome', 'expired');
  end if;
  if p_state = 'published' then
    if nullif(btrim(coalesce(p_external_id, '')), '') is null or length(p_external_id) > 40
       or length(coalesce(p_url, '')) > 2048 then
      return jsonb_build_object('outcome', 'invalid_input');
    end if;
    if not public.pt_property_visible(s.property_id) then
      return jsonb_build_object('outcome', 'property_not_found');
    end if;
    v_bind := public.lc_bind_portal_listing(v_tenant, v_uid, s.property_id, initcap(s.portal), btrim(p_external_id), p_url, 'assisted', 'bind');
    if v_bind ->> 'outcome' not in ('applied', 'replay') then
      return jsonb_build_object('outcome', coalesce(v_bind ->> 'outcome', 'bind_failed'));
    end if;
    v_listing := (v_bind ->> 'listing_id')::uuid;
    perform public.lc_mark_state_stale(v_tenant, s.property_id);
    update public.portal_transfer_sessions
       set state = 'published', portal_listing_id = v_listing, completed_at = now(),
           field_report = coalesce(p_field_report, field_report)
     where id = s.id;
    return jsonb_build_object('outcome', 'ok', 'listing_id', v_listing, 'bind', v_bind ->> 'outcome');
  end if;
  update public.portal_transfer_sessions
     set state = p_state, field_report = coalesce(p_field_report, field_report),
         completed_at = case when p_state = 'failed' then now() else completed_at end
   where id = s.id;
  return jsonb_build_object('outcome', 'ok');
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 4) Portaldan alinan ilani portfoye bagla (created_via 'import', kaynak 'assisted')
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.pt_import_bind(p_property_id uuid, p_portal text, p_external_id text, p_url text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_uid uuid := auth.uid();
  v_portal text := lower(btrim(coalesce(p_portal, '')));
  v_bind jsonb;
begin
  if v_uid is null or v_tenant is null or not public.has_effective_permission('portals', 'edit')
     or not public.has_effective_permission('properties', 'create') then
    return jsonb_build_object('outcome', 'forbidden');
  end if;
  if v_portal not in ('sahibinden', 'hepsiemlak', 'emlakjet') or nullif(btrim(coalesce(p_external_id, '')), '') is null
     or length(p_external_id) > 40 or length(coalesce(p_url, '')) > 2048 then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;
  if not public.pt_property_visible(p_property_id) then
    return jsonb_build_object('outcome', 'property_not_found');
  end if;
  v_bind := public.lc_bind_portal_listing(v_tenant, v_uid, p_property_id, initcap(v_portal), btrim(p_external_id), p_url, 'assisted', 'import');
  if v_bind ->> 'outcome' in ('applied', 'replay') then
    perform public.lc_mark_state_stale(v_tenant, p_property_id);
  end if;
  return v_bind;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 5) Icerik aktarma ozetini oturum olarak kaydet (olcum; kisisel veri yok)
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.pt_record_import(p_portal text, p_summary jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_uid uuid := auth.uid();
  v_portal text := lower(btrim(coalesce(p_portal, '')));
  v_id uuid;
begin
  if v_uid is null or v_tenant is null or not public.has_effective_permission('portals', 'edit') then
    return jsonb_build_object('outcome', 'forbidden');
  end if;
  if v_portal not in ('sahibinden', 'hepsiemlak', 'emlakjet')
     or (p_summary is not null and (jsonb_typeof(p_summary) <> 'object' or pg_column_size(p_summary) > 16384)) then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;
  insert into public.portal_transfer_sessions (tenant_id, portal, direction, state, field_report, actor_id, expires_at, completed_at)
  values (v_tenant, v_portal, 'import', 'imported', coalesce(p_summary, '{}'::jsonb), v_uid, now(), now())
  returning id into v_id;
  return jsonb_build_object('outcome', 'ok', 'session_id', v_id);
end;
$$;

revoke all on function public.pt_property_visible(uuid) from public, anon, authenticated;
revoke all on function public.pt_prepare_session(uuid, text, text, text, text, text[], integer) from public, anon;
revoke all on function public.pt_consume_code(text) from public, anon;
revoke all on function public.pt_complete_session(uuid, text, text, text, jsonb) from public, anon;
revoke all on function public.pt_import_bind(uuid, text, text, text) from public, anon;
revoke all on function public.pt_record_import(text, jsonb) from public, anon;
grant execute on function public.pt_prepare_session(uuid, text, text, text, text, text[], integer) to authenticated;
grant execute on function public.pt_consume_code(text) to authenticated;
grant execute on function public.pt_complete_session(uuid, text, text, text, jsonb) to authenticated;
grant execute on function public.pt_import_bind(uuid, text, text, text) to authenticated;
grant execute on function public.pt_record_import(text, jsonb) to authenticated;

notify pgrst, 'reload schema';
