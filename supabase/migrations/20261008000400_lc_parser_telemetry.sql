-- MIGRATION 20261008000400_lc_parser_telemetry.sql
-- UYGULANMADI (DOGRULANMADI): yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20261008000400_lc_parser_telemetry.sql` ile uygular.
-- Geri alma: supabase/rollbacks/20261008000400_lc_parser_telemetry.rollback.sql
-- BAGIMLILIK: 20260826002800 (lc_worker_* RPC'leri ayni izin kapisini kullanir), public.tenants, has_effective_permission,
--   current_tenant_id, current_profile_role.
--
-- AMAC: tarayici eklentisinin portal ayristiricisi her sonucla birlikte SAYAC bildirir (portal, ayristirici surumu, sinif,
-- kimligi dogrulayan katman, hata kodu, kismi okuma). Sunucu hangi surumun ne kadar "kontrol edilemedi" urettigini
-- (secici kaymasi/engel) gorebilir. KISISEL VERI YOK: ilan no, baslik, fiyat, ilan sahibi adi bu tabloya GIRMEZ.
-- Gunluk sayac (tenant + gun + portal + surum + sinif + katman + hata kodu + kismi): satir sayisi sinirlidir
-- (portal x surum x sinif x katman x kod). Mevcut lc_worker_complete / lc_complete_listing_check govdeleri DEGISMEZ.
-- Yazma yolu: JWT kimlikli SECURITY DEFINER RPC (portals/edit); dogrudan INSERT/UPDATE kapali. Okuma: portals/view + yonetim
-- kademesi (owner/gm/branch_manager) kendi ofisi.

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.tenants') is null then
    raise exception 'tenants tablosu yok.';
  end if;
  if not exists (select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'lc_worker_complete') then
    raise exception 'lc_worker_complete yok; once 20260826002800 uygulanmali.';
  end if;
end $$;

create table if not exists public.lc_parser_telemetry (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  day date not null,
  portal text not null check (portal ~ '^[a-z0-9-]{2,40}$'),
  parser_version text not null check (parser_version ~ '^[A-Za-z0-9._@-]{1,40}$'),
  classification text not null check (classification in ('live', 'removed', 'not_found', 'blocked', 'unknown')),
  layer text not null default '' check (layer in ('', 'json_ld', 'meta', 'state', 'pattern', 'url')),
  error_code text not null default '' check (error_code ~ '^[a-z0-9_]{0,40}$'),
  partial boolean not null default false,
  n integer not null default 0 check (n >= 0),
  primary key (tenant_id, day, portal, parser_version, classification, layer, error_code, partial)
);

create index if not exists idx_lc_parser_telemetry_day on public.lc_parser_telemetry (tenant_id, day desc);

alter table public.lc_parser_telemetry enable row level security;
drop policy if exists lc_parser_telemetry_select on public.lc_parser_telemetry;
create policy lc_parser_telemetry_select on public.lc_parser_telemetry for select to authenticated
using (
  tenant_id = (select public.current_tenant_id())
  and (select public.has_effective_permission('portals', 'view'))
  and (select public.current_profile_role()) in ('owner', 'gm', 'branch_manager')
);
revoke all on table public.lc_parser_telemetry from public, anon, authenticated;
grant select on table public.lc_parser_telemetry to authenticated;
grant all on table public.lc_parser_telemetry to service_role;

create or replace function public.lc_parser_report(
  p_portal text,
  p_parser_version text,
  p_classification text,
  p_layer text default null,
  p_error_code text default null,
  p_partial boolean default false
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
  v_layer text := coalesce(p_layer, '');
  v_code text := coalesce(p_error_code, '');
begin
  if v_uid is null or v_tenant is null or not public.has_effective_permission('portals', 'edit') then
    return jsonb_build_object('outcome', 'forbidden');
  end if;
  if v_portal !~ '^[a-z0-9-]{2,40}$'
     or coalesce(p_parser_version, '') !~ '^[A-Za-z0-9._@-]{1,40}$'
     or coalesce(p_classification, '') not in ('live', 'removed', 'not_found', 'blocked', 'unknown')
     or v_layer not in ('', 'json_ld', 'meta', 'state', 'pattern', 'url')
     or v_code !~ '^[a-z0-9_]{0,40}$' then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;
  -- Satir patlamasi korumasi: ofis basina gunde en cok 200 farkli sayac satiri (mevcut satirin artirimi her zaman serbest).
  if not exists (
       select 1 from public.lc_parser_telemetry x
        where x.tenant_id = v_tenant and x.day = current_date and x.portal = v_portal and x.parser_version = p_parser_version
          and x.classification = p_classification and x.layer = v_layer and x.error_code = v_code and x.partial = coalesce(p_partial, false))
     and (select count(*) from public.lc_parser_telemetry y where y.tenant_id = v_tenant and y.day = current_date) >= 200 then
    return jsonb_build_object('outcome', 'limit');
  end if;
  insert into public.lc_parser_telemetry as t (tenant_id, day, portal, parser_version, classification, layer, error_code, partial, n)
  values (v_tenant, current_date, v_portal, p_parser_version, p_classification, v_layer, v_code, coalesce(p_partial, false), 1)
  on conflict (tenant_id, day, portal, parser_version, classification, layer, error_code, partial)
  do update set n = t.n + 1;
  return jsonb_build_object('outcome', 'ok');
end;
$$;

revoke all on function public.lc_parser_report(text, text, text, text, text, boolean) from public, anon;
grant execute on function public.lc_parser_report(text, text, text, text, text, boolean) to authenticated, service_role;

notify pgrst, 'reload schema';
