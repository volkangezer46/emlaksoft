-- ROLLBACK 20261016100000_scope_rls.sql
-- Politikalar 20260802000300 bicimine (ofis + modul izni; kapsam ve silinmis kayit kosulu yok) doner, kapsam fonksiyonlari
-- silinir. Veri degismez. Idempotent.

set local lock_timeout = '5s';

do $$
declare
  t text;
  m text;
  tables text[] := array['customers', 'properties', 'deals', 'customer_demands', 'tasks', 'appointments'];
  mods text[] := array['customers', 'properties', 'commissions', 'demands', 'tasks', 'appointments'];
  base text;
begin
  for i in 1 .. array_length(tables, 1) loop
    t := tables[i];
    m := mods[i];
    base := '(tenant_id = (select public.current_active_tenant_id()))';
    execute format('drop policy if exists %I on public.%I', 'identity_' || t || '_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (%s and (select public.has_effective_permission(%L, %L)))',
                   'identity_' || t || '_select', t, base, m, 'view');
    execute format('drop policy if exists %I on public.%I', 'identity_' || t || '_update', t);
    execute format('create policy %I on public.%I for update to authenticated using (%s and (select public.has_effective_permission(%L, %L))) with check (%s and (select public.has_effective_permission(%L, %L)))',
                   'identity_' || t || '_update', t, base, m, 'edit', base, m, 'edit');
    execute format('drop policy if exists %I on public.%I', 'identity_' || t || '_delete', t);
    execute format('create policy %I on public.%I for delete to authenticated using (%s and (select public.has_effective_permission(%L, %L)))',
                   'identity_' || t || '_delete', t, base, m, 'delete');
  end loop;
end $$;

drop function if exists public.scope_allows(uuid);
drop function if exists public.scope_enforced();
drop function if exists public.scope_owner_ids();
drop function if exists public.scope_context();
