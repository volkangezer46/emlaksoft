alter table public.profiles
  drop column if exists accepts_pool,
  drop column if exists pool_paused_until,
  drop column if exists max_active_listings;
