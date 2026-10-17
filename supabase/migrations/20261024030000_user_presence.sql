-- MIGRATION 20261024030000_user_presence.sql
-- UYGULANMADI: yalniz restore edilebilir yedek dogrulandiktan sonra SAHIBI uygular (`npm run db:migrate`).
-- KOD YAYININDAN ONCE ya da SONRA uygulanabilir: kod tablo/RPC yokken durum secici "henuz etkin degil" der, ana sayfa
--   "Bugun ofiste olanlar" yalniz denetim kayitlariyla calisir, "Son yedekleme" karosu cizilmez.
-- Geri alma: supabase/rollbacks/20261024030000_user_presence.rollback.sql
-- BAGIMLILIK: public.current_tenant_id(), public.profiles, public.tenants. backup_runs (20261013005000) ISTEGE BAGLI.
--
-- NE (ekip durumu: Ofiste / Mola / Uzakta / Sahada / Gorusmede / Cevrimdisi):
--   user_presence            : kisi basi TEK satir (user_id PK). Okuma: ayni ofis (current_tenant_id). Yazma: yalniz
--                              kendi satiri (user_id = auth.uid(), tenant_id = current_tenant_id(); goruntuleme modundaki
--                              personel yazamaz). updated_at istemciden alinmaz (tetik now() yazar; service_role tohumu
--                              haric). Gun sonu (Europe/Istanbul) bitisi UYGULAMADA hesaplanir (satir silinmez).
--   profiles is_active=false : pasiflesen kullanicinin durum satiri silinir (demo ekip purge'unda da gecerli).
--   office_last_backup()     : SECURITY DEFINER; oturumlu ofis kullanicisina yalniz SON yedeklemenin zamani ve durumu
--                              (dosya adi, boyut, ayrinti DONMEZ). backup_runs yoksa bos.
-- RISK: dusuk (yeni tablo + yeni fonksiyonlar + profiles uzerinde dar AFTER UPDATE OF is_active tetigi).

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regprocedure('public.current_tenant_id()') is null then
    raise exception 'public.current_tenant_id() yok; once kimlik migrationlari uygulanmali.';
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 1) Durum tablosu
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.user_presence (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  status     text not null check (status in ('office', 'break', 'away', 'field', 'meeting', 'offline')),
  note       text check (note is null or char_length(note) <= 60),
  is_sample  boolean not null default false,
  updated_at timestamptz not null default now()
);

comment on table public.user_presence is
  'Ekip durumu (kisi basi tek satir). Okuma ayni ofis, yazma yalniz kendi satiri; gun sonu bitisi uygulamada (Europe/Istanbul).';

create index if not exists idx_user_presence_tenant_updated on public.user_presence (tenant_id, updated_at desc);

alter table public.user_presence enable row level security;

drop policy if exists user_presence_tenant_select on public.user_presence;
create policy user_presence_tenant_select on public.user_presence
  for select to authenticated
  using (tenant_id = (select public.current_tenant_id()));

drop policy if exists user_presence_self_insert on public.user_presence;
create policy user_presence_self_insert on public.user_presence
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and tenant_id = (select public.current_tenant_id())
    and coalesce((select auth.jwt()) -> 'app_metadata' ->> 'impersonating', 'false') <> 'true'
  );

drop policy if exists user_presence_self_update on public.user_presence;
create policy user_presence_self_update on public.user_presence
  for update to authenticated
  using (user_id = (select auth.uid()) and tenant_id = (select public.current_tenant_id()))
  with check (
    user_id = (select auth.uid())
    and tenant_id = (select public.current_tenant_id())
    and coalesce((select auth.jwt()) -> 'app_metadata' ->> 'impersonating', 'false') <> 'true'
  );

drop policy if exists user_presence_self_delete on public.user_presence;
create policy user_presence_self_delete on public.user_presence
  for delete to authenticated
  using (user_id = (select auth.uid()) and tenant_id = (select public.current_tenant_id()));

revoke all on table public.user_presence from public, anon, authenticated;
grant select, insert, update, delete on table public.user_presence to authenticated;
grant all on table public.user_presence to service_role;

-- updated_at istemciden gelmez (sahte "Su an aktif" yok); is_sample yalniz service_role tohumunda true olabilir.
create or replace function public.user_presence_stamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce((select auth.jwt()) ->> 'role', '') <> 'service_role' then
    new.updated_at := pg_catalog.now();
    new.is_sample := false;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_user_presence_stamp on public.user_presence;
create trigger trg_user_presence_stamp
  before insert or update on public.user_presence
  for each row execute function public.user_presence_stamp();

-- Pasiflesen kullanicinin durumu kalmaz (ekip listesinde "Ofiste" gorunmesin).
create or replace function public.user_presence_clear_inactive()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_active is distinct from true and old.is_active is distinct from new.is_active then
    delete from public.user_presence where user_id = new.id;
  end if;
  return null;
end;
$$;

revoke all on function public.user_presence_clear_inactive() from public, anon, authenticated;

drop trigger if exists trg_profiles_presence_clear on public.profiles;
create trigger trg_profiles_presence_clear
  after update of is_active on public.profiles
  for each row execute function public.user_presence_clear_inactive();

-- ---------------------------------------------------------------------------------------------------------------
-- 2) Son yedekleme (ofis paneli): yalniz zaman + durum
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.office_last_backup()
returns table (finished_at timestamptz, status text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select public.current_tenant_id()) is null then
    return;
  end if;
  if pg_catalog.to_regclass('public.backup_runs') is null then
    return;
  end if;
  return query execute
    'select b.finished_at, b.status::text from public.backup_runs b order by b.finished_at desc limit 1';
end;
$$;

comment on function public.office_last_backup() is
  'Ofis paneli "Son yedekleme": en son backup_runs satirinin YALNIZ zamani ve durumu (dosya/boyut/ayrinti donmez); oturumlu ofis kullanicisi.';

revoke all on function public.office_last_backup() from public, anon;
grant execute on function public.office_last_backup() to authenticated, service_role;
