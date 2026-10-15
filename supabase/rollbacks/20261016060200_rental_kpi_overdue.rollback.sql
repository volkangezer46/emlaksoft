-- 20261016060200 geri alma: rental_kpi_snapshot'in canli govdesi (20261009000400; pg_get_functiondef birebir). period_overdue ve
--   period_total anahtarlari kalkar; kod bu anahtarlar yokken eski satir sorgusundan hesaplar. CREATE OR REPLACE ACL'i korur.
set local lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.rental_kpi_snapshot(p_period date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'period_count', count(*) filter (where c.period = p_period),
    'period_paid', coalesce(sum(least(c.amount, coalesce(c.paid_amount, 0))) filter (where c.period = p_period), 0),
    'period_pending', coalesce(sum(greatest(0, c.amount - least(c.amount, coalesce(c.paid_amount, 0))))
      filter (where c.period = p_period and c.status in ('pending', 'partial')), 0),
    'overdue_count', count(*) filter (where c.status = 'overdue'),
    'overdue_sum', coalesce(sum(greatest(0, c.amount - coalesce(c.paid_amount, 0))) filter (where c.status = 'overdue'), 0),
    'overdue_rentals', count(distinct c.rental_id) filter (where c.status = 'overdue'),
    'active_rentals', (select count(*) from public.rentals r where r.status = 'active')
  )
  from public.rent_charges c
  where c.period = p_period or c.status = 'overdue';
$function$;

revoke all on function public.rental_kpi_snapshot(date) from public, anon;
grant execute on function public.rental_kpi_snapshot(date) to authenticated, service_role;
