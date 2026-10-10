-- 20261010000400 geri alma: onceki duruma doner (guvenlik acigi geri gelir; yalniz acil durumda).
set local search_path = public;

alter table public.profiles add column if not exists calendar_token uuid not null default gen_random_uuid();
update public.profiles p set calendar_token = t.token from public.user_calendar_tokens t where t.user_id = p.id;
create unique index if not exists idx_profiles_calendar_token on public.profiles(calendar_token);

drop trigger if exists trg_profiles_drop_calendar_token on public.profiles;
drop function if exists public.drop_calendar_token_on_deactivate();
drop function if exists public.rotate_my_calendar_token();
drop table if exists public.user_calendar_tokens;

alter policy "audit_tenant" on public.audit_logs
  using ((tenant_id = (select public.current_tenant_id())));
alter policy "error_logs_tenant_read" on public.error_logs
  using ((tenant_id = (select public.current_tenant_id())));

grant truncate, trigger, references on all tables in schema public to anon, authenticated;
alter default privileges for role postgres in schema public
  grant truncate, trigger, references on tables to anon, authenticated;

notify pgrst, 'reload schema';
