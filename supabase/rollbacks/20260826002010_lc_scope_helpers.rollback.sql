-- Rollback: 20260826002010_lc_scope_helpers. Elle calistirilir; schema_migrations ledger satirina DOKUNMAZ.
-- UYARI: once bu yardimcilara bagli politikalari tasiyan 20260826002020..002070 geri alinmali (aksi halde DROP basarisiz olur).
-- oversight_settings.listing_control kolonundaki ofis ayarlari KAYBOLUR.
alter table if exists public.oversight_settings drop column if exists listing_control;
drop function if exists public.lc_row_visible(uuid, uuid, uuid);
drop function if exists public.lc_current_team_id();
drop function if exists public.lc_current_branch_id();
