-- Rollback: 20261014021010_platform_staff_can_gates
-- Personel kapıları yeniden rol ADINA bakar (DG1 öncesi gövdeler); politikalar eski ifadelerine döner; yardımcılar en sonda düşer.
-- Veri değişmez.

set local lock_timeout = '5s';

drop policy if exists platform_settings_super_admin on public.platform_settings;
create policy platform_settings_super_admin on public.platform_settings
  for all
  using (exists (select 1 from public.platform_staff s where s.id = (select auth.uid()) and s.is_active and s.role = 'super_admin'))
  with check (exists (select 1 from public.platform_staff s where s.id = (select auth.uid()) and s.is_active and s.role = 'super_admin'));

drop policy if exists platform_mrr_daily_staff_select on public.platform_mrr_daily;
create policy platform_mrr_daily_staff_select on public.platform_mrr_daily
  for select to authenticated
  using (
    (select public.is_platform_staff())
    and exists (
      select 1 from public.platform_staff ps
      where ps.id = (select auth.uid())
        and ps.is_active = true
        and ps.role in ('super_admin', 'ops', 'billing')
    )
  );

do $$
declare
  r record;
  v_def text;
begin
  for r in
    select t.sig, t.old_expr, t.new_expr
    from (values
      ('public.update_tenant_plan_subscription(uuid,uuid,text,text)',
       'and ps.role in (''super_admin'', ''billing'')',
       'and public.platform_staff_can(ps.id, ''billing'', ''write'')'),
      ('public.convert_demo_request_to_tenant(uuid,uuid,uuid,text)',
       'and ps.role in (''super_admin'', ''ops'', ''support'')',
       'and public.platform_staff_can(ps.id, ''sales'', ''write'')')
    ) as t(sig, old_expr, new_expr)
  loop
    v_def := pg_catalog.pg_get_functiondef(r.sig::regprocedure);
    if pg_catalog.strpos(v_def, r.new_expr) > 0 then
      execute pg_catalog.replace(v_def, r.new_expr, r.old_expr);
    end if;
  end loop;
end
$$;

create or replace function public.support_is_ticket_staff()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return exists (
    select 1
    from public.platform_staff s
    where s.id = auth.uid()
      and s.is_active = true
      and s.role in ('super_admin', 'ops', 'support', 'billing')
  );
end;
$$;

create or replace function public.support_actor_is_valid(p_actor_id uuid, p_actor_kind text, p_tenant_id uuid default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case p_actor_kind
    when 'tenant' then exists (
      select 1
      from public.profiles p
      where p.id = p_actor_id
        and p.tenant_id = p_tenant_id
        and p.is_active = true
    )
    when 'staff' then exists (
      select 1
      from public.platform_staff s
      where s.id = p_actor_id
        and s.is_active = true
        and s.role in ('super_admin', 'ops', 'support', 'billing')
    )
    else false
  end;
$$;

create or replace function public.pt_rules_is_operator()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.platform_staff ps
     where ps.id = auth.uid() and ps.is_active = true and ps.role in ('super_admin', 'ops')
       and coalesce(auth.jwt() -> 'app_metadata' ->> 'impersonating', 'false') <> 'true'
  );
$$;

create or replace function public.pt_rules_is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.platform_staff ps
     where ps.id = auth.uid() and ps.is_active = true and ps.role = 'super_admin'
       and coalesce(auth.jwt() -> 'app_metadata' ->> 'impersonating', 'false') <> 'true'
  );
$$;

create or replace function public.growth_staff_super_admin()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select ps.id from public.platform_staff ps
  where ps.id = auth.uid() and ps.is_active and ps.role = 'super_admin'
    and (not public.growth_flag_on('platform.mfa_enforced') or (auth.jwt() ->> 'aal') = 'aal2');
$$;

drop function if exists public.platform_staff_can(text, text);
drop function if exists public.platform_staff_can(uuid, text, text);
drop function if exists public.platform_fixed_role_actions(text, text);

notify pgrst, 'reload schema';
