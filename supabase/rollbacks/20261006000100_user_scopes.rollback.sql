-- Rollback: user_scopes tablosunu sil
drop policy if exists user_scopes_write on public.user_scopes;
drop policy if exists user_scopes_read on public.user_scopes;
drop table if exists public.user_scopes;
