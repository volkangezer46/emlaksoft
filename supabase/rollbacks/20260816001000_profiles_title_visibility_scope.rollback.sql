-- Rollback: 20260816001000_profiles_title_visibility_scope
-- Girilmiş unvan ve veri kapsamı tercihleri silinir.
drop trigger if exists trg_guard_profile_visibility_scope on public.profiles;
drop function if exists public.guard_profile_visibility_scope();
alter table public.profiles
  drop column if exists title,
  drop column if exists visibility_scope;
-- Tüm Faz 2 tabloları kaldırıldıysa paylaşılan yardımcı da düşürülebilir:
-- drop function if exists public.faz2_touch_updated_at();
