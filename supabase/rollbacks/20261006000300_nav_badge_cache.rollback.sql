-- Rollback: Navigation badge cache
drop function if exists public.cleanup_stale_nav_badges();
drop function if exists public.refresh_nav_badge_snapshot(uuid, uuid);
drop function if exists public.get_nav_badge_snapshot(uuid, uuid);
drop table if exists public.nav_badge_snapshots;
