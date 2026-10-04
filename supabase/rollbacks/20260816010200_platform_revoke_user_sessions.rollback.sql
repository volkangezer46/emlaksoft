-- Rollback: 20260816010200_platform_revoke_user_sessions
drop function if exists public.platform_revoke_user_sessions(uuid);
notify pgrst, 'reload schema';
