-- MIGRATION 20260826002200_tenant_settings.sql
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20260826002200_tenant_settings.sql` ile uygular.
-- Geri alma: supabase/rollbacks/20260826002200_tenant_settings.rollback.sql
-- BAGIMLILIK: public.tenants, public.current_tenant_id(). On-kosul blogu eksikse HICBIR sey yazmaz.
--
-- AMAC: ofis (tenant) duzeyi ayar deposu (Ayar Kayit Defteri, ofis tarafi sonraki pakette kullanilir).
-- Yeni tablo; mevcut hicbir davranis degismez. scope_id sube/kullanici kapsamlari icin REZERVE (su an hep null).
-- Yazma yalniz write_setting RPC'si (service_role) ile; istemciye yazma yetkisi verilmez.

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.tenants') is null then
    raise exception 'tenants yok; once temel migrationlar uygulanmali.';
  end if;
  if pg_catalog.to_regprocedure('public.current_tenant_id()') is null then
    raise exception 'current_tenant_id() yok; once temel migrationlar uygulanmali.';
  end if;
end $$;

create table if not exists public.tenant_settings (
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  key        text not null check (char_length(key) between 1 and 120),
  value      jsonb,
  version    integer not null default 1 check (version >= 1),
  scope_id   uuid,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, key)
);

alter table public.tenant_settings enable row level security;

drop policy if exists tenant_settings_select on public.tenant_settings;
create policy tenant_settings_select on public.tenant_settings
  for select to authenticated
  using (tenant_id = public.current_tenant_id());

-- Yazma politikasi YOK (settings:edit denetimi uygulama katmaninda + write_setting RPC'si ile service_role yazar).
revoke all on public.tenant_settings from public, anon, authenticated;
grant select on public.tenant_settings to authenticated;
grant all on public.tenant_settings to service_role;

comment on table public.tenant_settings is
  'Ofis ayar deposu (Ayar Kayit Defteri). Okuma: tenant uyesi (RLS). Yazma: yalniz write_setting RPC.';