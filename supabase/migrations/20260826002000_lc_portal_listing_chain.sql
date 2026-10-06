-- MIGRATION 20260826002000_lc_portal_listing_chain.sql
-- UYGULANMADI (DOGRULANMADI): yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20260826002000_lc_portal_listing_chain.sql` ile uygular.
-- Geri alma: supabase/rollbacks/20260826002000_lc_portal_listing_chain.rollback.sql
-- BAGIMLILIK: public.portal_listings (init + 20260809000020 composite unique), public.properties, public.audit_logs.
--
-- AMAC (Portfoy-Ilan Yasam Dongusu ve Kayip/Kacak Denetimi, WP-2): portal ilan no DEGISIMI icin YENI GECMIS TABLOSU
-- ACILMAZ. Her harici ilan no ayri portal_listings satiridir; satirlar supersedes_id ile zincirlenir (toplam yayin suresi =
-- ayni (portfoy, portal) zincirindeki published_at..removed_at toplami). Sik degisen kontrol alanlari (portal fiyati, son
-- gorulme...) BURAYA KONMAZ: portal_listings Realtime publication'inda (router.refresh firtinasi) -> 20260826002020
-- portal_listing_health (1:1).
--
-- DAVRANIS NOTU: (tenant, portal, ilan no) icin ACIK (status='live') tek satir kurali getirilir. Onkosul blogu mevcut
-- yinelenen canli satir varsa DURUR (elle temizlenmeden uygulanmaz). Eski upsert onConflict
-- 'tenant_id,property_id,portal_name' icin unique index HIC yoktu (42P10); o yol bu paketle RPC'ye gecer.
-- Yazma sozlesmesi: portal_listings authenticated'a kapali (guard_portal_listing_atomic_mutation); RPC'ler YALNIZ service_role.

set local lock_timeout = '5s';

do $$
declare dup integer;
begin
  if pg_catalog.to_regclass('public.portal_listings') is null or pg_catalog.to_regclass('public.properties') is null
     or pg_catalog.to_regclass('public.audit_logs') is null then
    raise exception 'portal_listings/properties/audit_logs yok; once temel migrationlar uygulanmali.';
  end if;
  select count(*) into dup from (
    select 1 from public.portal_listings
    where status = 'live' and nullif(btrim(portal_listing_id), '') is not null
    group by tenant_id, lower(btrim(portal_name)), lower(btrim(portal_listing_id))
    having count(*) > 1
  ) d;
  if dup > 0 then
    raise exception 'Yinelenen canli (ofis, portal, ilan no) grubu: %. Once elle teke indirin (fazlasini kapatin), sonra tekrar uygulayin.', dup;
  end if;
end $$;

alter table public.portal_listings add column if not exists supersedes_id uuid;
alter table public.portal_listings add column if not exists source_kind text;
alter table public.portal_listings add column if not exists ended_reason text;
alter table public.portal_listings add column if not exists created_via text;
-- Normalize ilan no: kucuk harf + bosluk kirpma. Uretilmis kolon (yazilmaz, her zaman tutarli).
alter table public.portal_listings
  add column if not exists external_id_norm text
  generated always as (nullif(lower(btrim(portal_listing_id)), '')) stored;

do $$
begin
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'portal_listings_source_kind_check') then
    alter table public.portal_listings add constraint portal_listings_source_kind_check
      check (source_kind is null or source_kind in ('manual', 'api', 'feed', 'csv', 'assisted'));
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'portal_listings_ended_reason_check') then
    alter table public.portal_listings add constraint portal_listings_ended_reason_check
      check (ended_reason is null or ended_reason in
        ('id_changed', 'sold', 'rented', 'owner_withdrew', 'authority_expired', 'price_will_update',
         'portal_removed', 'will_republish', 'mistake', 'duplicate', 'other'));
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'portal_listings_created_via_check') then
    alter table public.portal_listings add constraint portal_listings_created_via_check
      check (created_via is null or created_via in ('manual', 'bind', 'rotate', 'import', 'api', 'matching'));
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'portal_listings_supersedes_tenant_fkey') then
    alter table public.portal_listings add constraint portal_listings_supersedes_tenant_fkey
      foreign key (supersedes_id, tenant_id) references public.portal_listings (id, tenant_id)
      on delete set null (supersedes_id);
  end if;
end $$;

-- Ayni (ofis, portal, ilan no) icin en fazla BIR acik satir; bir satirin en fazla bir halefi.
create unique index if not exists uq_portal_listings_live_external
  on public.portal_listings (tenant_id, lower(btrim(portal_name)), external_id_norm)
  where status = 'live' and external_id_norm is not null;
create unique index if not exists uq_portal_listings_supersedes
  on public.portal_listings (supersedes_id) where supersedes_id is not null;
create index if not exists idx_portal_listings_property_portal
  on public.portal_listings (tenant_id, property_id, lower(btrim(portal_name)));

-- Ilan no degisimi: eski satiri kapat ('superseded'), yenisini ac, zinciri bagla, audit yaz. Tek transaction.
create or replace function public.lc_rotate_portal_listing(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_listing_id uuid,
  p_new_external_id text,
  p_new_url text default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.portal_listings%rowtype;
  v_new_id uuid;
  v_norm text := nullif(lower(btrim(p_new_external_id)), '');
begin
  if v_norm is null then
    return jsonb_build_object('outcome', 'invalid_external_id');
  end if;
  select * into v_old from public.portal_listings
   where id = p_listing_id and tenant_id = p_tenant_id for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if v_old.status <> 'live' then
    return jsonb_build_object('outcome', 'not_live');
  end if;
  if v_old.external_id_norm is not distinct from v_norm then
    return jsonb_build_object('outcome', 'unchanged', 'listing_id', v_old.id);
  end if;
  if exists (
    select 1 from public.portal_listings
     where tenant_id = p_tenant_id and status = 'live' and lower(btrim(portal_name)) = lower(btrim(v_old.portal_name))
       and external_id_norm = v_norm
  ) then
    return jsonb_build_object('outcome', 'external_id_in_use');
  end if;

  update public.portal_listings
     set status = 'superseded', removed_at = now(), ended_reason = 'id_changed',
         removal_reason = coalesce(nullif(btrim(p_reason), ''), 'Ilan no degisti')
   where id = v_old.id;

  insert into public.portal_listings
    (tenant_id, property_id, portal_name, portal_listing_id, portal_url, status, last_confirmed_at, published_at,
     published_by, supersedes_id, source_kind, created_via)
  values
    (p_tenant_id, v_old.property_id, v_old.portal_name, btrim(p_new_external_id),
     coalesce(nullif(btrim(p_new_url), ''), null), 'live', now(), now(), p_actor_id, v_old.id,
     coalesce(v_old.source_kind, 'manual'), 'rotate')
  returning id into v_new_id;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, old_value, new_value)
  values (p_tenant_id, p_actor_id, 'portal_listing.rotate', 'portal_listing', v_new_id,
          jsonb_build_object('listing_id', v_old.id, 'external_id', v_old.portal_listing_id),
          jsonb_build_object('listing_id', v_new_id, 'external_id', btrim(p_new_external_id)));

  return jsonb_build_object('outcome', 'applied', 'listing_id', v_new_id, 'superseded_id', v_old.id);
end;
$$;

-- Baglama: portal ilanini portfoye bagla (ayni ilan no ayni portfoyde acikken tekrar = replay; baska portfoyde = red).
create or replace function public.lc_bind_portal_listing(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_property_id uuid,
  p_portal_name text,
  p_external_id text,
  p_url text default null,
  p_source_kind text default 'manual',
  p_created_via text default 'bind'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_norm text := nullif(lower(btrim(p_external_id)), '');
  v_existing public.portal_listings%rowtype;
  v_id uuid;
begin
  if nullif(btrim(p_portal_name), '') is null then
    return jsonb_build_object('outcome', 'invalid_portal');
  end if;
  if not exists (select 1 from public.properties where id = p_property_id and tenant_id = p_tenant_id) then
    return jsonb_build_object('outcome', 'property_not_found');
  end if;
  if v_norm is not null then
    select * into v_existing from public.portal_listings
     where tenant_id = p_tenant_id and status = 'live'
       and lower(btrim(portal_name)) = lower(btrim(p_portal_name)) and external_id_norm = v_norm
     for update;
    if found then
      if v_existing.property_id = p_property_id then
        return jsonb_build_object('outcome', 'replay', 'listing_id', v_existing.id);
      end if;
      return jsonb_build_object('outcome', 'bound_to_other_property', 'listing_id', v_existing.id,
                                'property_id', v_existing.property_id);
    end if;
  end if;
  insert into public.portal_listings
    (tenant_id, property_id, portal_name, portal_listing_id, portal_url, status, last_confirmed_at, published_at,
     published_by, source_kind, created_via)
  values
    (p_tenant_id, p_property_id, btrim(p_portal_name), nullif(btrim(p_external_id), ''), nullif(btrim(p_url), ''),
     'live', now(), now(), p_actor_id, coalesce(p_source_kind, 'manual'), coalesce(p_created_via, 'bind'))
  returning id into v_id;
  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, new_value)
  values (p_tenant_id, p_actor_id, 'portal_listing.bind', 'portal_listing', v_id,
          jsonb_build_object('property_id', p_property_id, 'portal', p_portal_name, 'external_id', p_external_id));
  return jsonb_build_object('outcome', 'applied', 'listing_id', v_id);
end;
$$;

revoke all on function public.lc_rotate_portal_listing(uuid, uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.lc_bind_portal_listing(uuid, uuid, uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.lc_rotate_portal_listing(uuid, uuid, uuid, text, text, text) to service_role;
grant execute on function public.lc_bind_portal_listing(uuid, uuid, uuid, text, text, text, text, text) to service_role;

notify pgrst, 'reload schema';
