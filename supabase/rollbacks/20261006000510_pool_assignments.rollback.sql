-- Rollback: 20261006000510_pool_assignments
-- Atama gecmisi SILINIR (properties.assigned_to ve listing_pool_entries DEGISMEZ). Geri almadan once dokum alin:
--   select * from public.pool_assignments order by created_at;
drop policy if exists pool_assignments_update on public.pool_assignments;
drop policy if exists pool_assignments_insert on public.pool_assignments;
drop policy if exists pool_assignments_select on public.pool_assignments;
drop table if exists public.pool_assignments;
notify pgrst, 'reload schema';
