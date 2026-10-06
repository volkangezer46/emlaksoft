-- Rollback: 20260826002900_takim_teams. Elle calistirilir; schema_migrations ledger satirina DOKUNMAZ.
-- UYARI: takim uyelikleri (profiles.team_id) ve takimlar silinir; properties.assigned_at kaybolur.
-- Ilan kontrol kapsami team_id yokken zarifce null doner (takim lideri yalniz kendi ilanini gorur).
drop trigger if exists trg_properties_assigned_at on public.properties;
drop function if exists public.properties_set_assigned_at();
drop trigger if exists trg_profiles_team_guard on public.profiles;
drop function if exists public.profiles_team_guard();
drop index if exists public.idx_profiles_team;
alter table public.profiles drop column if exists team_id;
alter table public.properties drop column if exists assigned_at;
drop table if exists public.teams;
notify pgrst, 'reload schema';
