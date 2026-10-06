-- Rollback: Scope-aware RPC fonksiyonlarını sil
drop function if exists public.has_permission_with_scope(text, text, text, uuid);
drop function if exists public.current_user_branch_id();
drop function if exists public.current_user_team_id();
drop function if exists public.current_user_scope();
