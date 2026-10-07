-- Rollback: 20261007001100_perf_indexes_rpc
-- Fonksiyonlar eski SQL-dilli govdelerine doner (davranis ayni, yalniz yavas); indeks duser. ACL'ler CREATE OR REPLACE ile korunur.

set local lock_timeout = '5s';

drop index if exists public.idx_customer_demands_tenant_created;

create or replace function public.support_is_ticket_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.platform_staff s
    where s.id = auth.uid()
      and s.is_active = true
      and s.role in ('super_admin', 'ops', 'support')
  );
$$;

create or replace function public.is_platform_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.platform_staff ps
    where ps.id = auth.uid()
      and ps.is_active = true
      and coalesce(
        auth.jwt() -> 'app_metadata' ->> 'impersonating',
        'false'
      ) <> 'true'
  );
$$;

create or replace function public.current_session_two_factor_satisfied()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select
        not coalesce(p.two_factor_sms, false)
        or exists (
          select 1
          from public.two_factor_verified_sessions v
          where v.session_id = nullif(btrim(auth.jwt() ->> 'session_id'), '')
            and v.user_id = auth.uid()
            and v.profile_version = p.two_factor_version
            and v.expires_at > now()
        )
      from public.profiles p
      where p.id = auth.uid() and p.is_active = true
      limit 1
    ),
    true
  );
$$;

notify pgrst, 'reload schema';
