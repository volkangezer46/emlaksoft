-- MIGRATION 20260826002900_takim_teams.sql
-- UYGULANMADI (DOGRULANMADI): yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20260826002900_takim_teams.sql` ile uygular.
-- Geri alma: supabase/rollbacks/20260826002900_takim_teams.rollback.sql
-- BAGIMLILIK: public.tenants, public.profiles, public.branches, public.properties, public.current_tenant_id(),
--   public.current_profile_role(). 20260826002010 (lc_current_team_id/lc_row_visible) team_id kolonunu
--   to_jsonb ile DINAMIK okur: bu migration kolonu eklediginde takim lideri kapsami otomatik canlanir.
--
-- AMAC: takim modeli. (1) teams tablosu (ofis/sube bagli, lider = profiles.id), (2) profiles.team_id,
--   (3) properties.assigned_at (danisman atama zamani; ilan kontrol SLA "yayinlanmadi" sayaci icin guvenilir kaynak).
--   Portal ilanlarinda danisman atamasi yoktur (portal_listings -> properties.assigned_to); ayri sutun gerekmez.
-- ETKI: 1 yeni tablo + RLS, profiles/properties'e nullable kolon, 2 tetikleyici. Mevcut veri degismez
--   (assigned_at geriye doldurulmaz: bilinmeyen zaman uydurulmaz; kod null'u "ilk gorulme" ile ele alir).

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.profiles') is null or pg_catalog.to_regclass('public.branches') is null
     or pg_catalog.to_regclass('public.properties') is null then
    raise exception 'profiles/branches/properties yok; once temel migrationlar uygulanmali.';
  end if;
  if pg_catalog.to_regprocedure('public.current_tenant_id()') is null
     or pg_catalog.to_regprocedure('public.current_profile_role()') is null then
    raise exception 'current_tenant_id()/current_profile_role() yok.';
  end if;
end $$;

create table if not exists public.teams (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  branch_id     uuid references public.branches(id) on delete set null,
  name          text not null check (char_length(btrim(name)) between 1 and 80),
  lead_user_id  uuid references public.profiles(id) on delete set null,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);
create unique index if not exists uq_teams_tenant_name on public.teams (tenant_id, lower(btrim(name)));
create index if not exists idx_teams_tenant on public.teams (tenant_id);
create index if not exists idx_teams_lead on public.teams (lead_user_id) where lead_user_id is not null;

alter table public.profiles add column if not exists team_id uuid references public.teams(id) on delete set null;
create index if not exists idx_profiles_team on public.profiles (team_id) where team_id is not null;

alter table public.properties add column if not exists assigned_at timestamptz;

alter table public.teams enable row level security;

drop policy if exists teams_select on public.teams;
create policy teams_select on public.teams
  for select using (tenant_id = (select public.current_tenant_id()));

drop policy if exists teams_insert on public.teams;
create policy teams_insert on public.teams
  for insert with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_profile_role()) in ('owner', 'gm', 'branch_manager')
  );

drop policy if exists teams_update on public.teams;
create policy teams_update on public.teams
  for update using (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_profile_role()) in ('owner', 'gm', 'branch_manager')
  ) with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_profile_role()) in ('owner', 'gm', 'branch_manager')
  );

drop policy if exists teams_delete on public.teams;
create policy teams_delete on public.teams
  for delete using (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_profile_role()) in ('owner', 'gm', 'branch_manager')
  );

revoke all on public.teams from anon;
grant select, insert, update, delete on public.teams to authenticated;
grant all on public.teams to service_role;

-- team_id / lider tutarliligi: takim ve profil ayni ofiste olmali; ofis disi takima atama engellenir.
create or replace function public.profiles_team_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_team_tenant uuid;
  v_role text := coalesce(public.current_profile_role(), '');
begin
  if new.team_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.team_id is not distinct from old.team_id then
    return new;
  end if;
  select t.tenant_id into v_team_tenant from public.teams t where t.id = new.team_id;
  if v_team_tenant is null or v_team_tenant <> new.tenant_id then
    raise exception 'team_id farkli ofise ait' using errcode = '23514';
  end if;
  -- Kullanici oturumunda yalniz yonetim rolleri takim atayabilir (service_role: auth.uid() null).
  if auth.uid() is not null and v_role not in ('owner', 'gm', 'branch_manager') then
    raise exception 'takim atamasi icin yetki yok' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists trg_profiles_team_guard on public.profiles;
create trigger trg_profiles_team_guard
  before insert or update of team_id on public.profiles
  for each row execute function public.profiles_team_guard();

-- Danisman atama zamani: assigned_to degisince/dolunca now(), bosalinca null.
create or replace function public.properties_set_assigned_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.assigned_to is null then
    new.assigned_at := null;
  elsif tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to then
    new.assigned_at := now();
  end if;
  return new;
end $$;

drop trigger if exists trg_properties_assigned_at on public.properties;
create trigger trg_properties_assigned_at
  before insert or update of assigned_to on public.properties
  for each row execute function public.properties_set_assigned_at();

comment on table public.teams is 'Ofis takimlari (lider = profiles.id). Takim lideri rolu lc_row_visible kapsami ve SLA yukseltme aliciligi icin kullanilir.';

notify pgrst, 'reload schema';
