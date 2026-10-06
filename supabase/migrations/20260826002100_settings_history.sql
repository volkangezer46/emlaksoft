-- MIGRATION 20260826002100_settings_history.sql
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20260826002100_settings_history.sql` ile uygular.
-- Geri alma: supabase/rollbacks/20260826002100_settings_history.rollback.sql
-- BAGIMLILIK: public.tenants, public.is_platform_staff(). On-kosul blogu eksikse HICBIR sey yazmaz.
--
-- AMAC (Ayar Kayit Defteri): her ayar degisikliginin APPEND-ONLY gecmisi. Yeni tablo; mevcut satir/davranis degismez.
-- Gizli (is_secret) satirlarda old_value/new_value HER ZAMAN null'dur; yalniz parmak izi (fingerprint) tutulur.
-- UPDATE/DELETE yetkisi kimseye verilmez (service_role dahil); satir yazan tek yol write_setting RPC'si
-- (20260826002400) ve platform_settings dogrudan-yazim tetikleyicisidir (20260826002300).

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.tenants') is null then
    raise exception 'tenants yok; once temel migrationlar uygulanmali.';
  end if;
  if pg_catalog.to_regprocedure('public.is_platform_staff()') is null then
    raise exception 'is_platform_staff() yok; once platform_staff migrationi uygulanmali.';
  end if;
end $$;

create table if not exists public.settings_history (
  id          uuid primary key default gen_random_uuid(),
  scope       text not null check (scope in ('platform', 'tenant', 'branch', 'user')),
  tenant_id   uuid references public.tenants(id) on delete cascade,
  scope_id    uuid,
  key         text not null check (char_length(key) between 1 and 120),
  version     integer not null check (version >= 0),
  old_value   jsonb,
  new_value   jsonb,
  is_secret   boolean not null default false,
  fingerprint text,
  summary     text,
  changed_by  uuid,
  actor_type  text not null default 'system'
              check (actor_type in ('platform_staff', 'tenant_user', 'system', 'direct')),
  reason      text check (reason is null or char_length(reason) <= 500),
  created_at  timestamptz not null default now(),
  constraint settings_history_scope_tenant_check
    check ((scope = 'platform' and tenant_id is null) or (scope <> 'platform' and tenant_id is not null)),
  constraint settings_history_secret_no_value_check
    check (not is_secret or (old_value is null and new_value is null))
);

create index if not exists settings_history_lookup_idx
  on public.settings_history (scope, tenant_id, key, created_at desc);

alter table public.settings_history enable row level security;

drop policy if exists settings_history_platform_select on public.settings_history;
create policy settings_history_platform_select on public.settings_history
  for select to authenticated
  using (scope = 'platform' and public.is_platform_staff());

drop policy if exists settings_history_tenant_select on public.settings_history;
create policy settings_history_tenant_select on public.settings_history
  for select to authenticated
  using (scope <> 'platform' and tenant_id = public.current_tenant_id());

-- Yazma politikasi YOK: yalniz service_role (RLS bypass) + security definer fonksiyonlar yazar. UPDATE/DELETE yok.
revoke all on public.settings_history from public, anon, authenticated;
grant select on public.settings_history to authenticated;
grant select, insert on public.settings_history to service_role;

comment on table public.settings_history is
  'Ayar Kayit Defteri: append-only degisiklik gecmisi. Gizli ayarlarda deger YOK, yalniz parmak izi.';