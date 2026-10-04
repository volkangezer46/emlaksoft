-- Rollback: 20260816001200_assignment_rules_listing_target
-- Önce havuz kodunu (listing_pool_enabled okuyan yerleri) kapatın. target_kind='listing' kural satırları kaybolur.
delete from public.assignment_rules where target_kind = 'listing';
drop index if exists public.idx_assignment_rules_target;
alter table public.assignment_rules
  drop column if exists min_score,
  drop column if exists assign_mode,
  drop column if exists target_kind;
alter table public.tenants drop column if exists listing_pool_enabled;
