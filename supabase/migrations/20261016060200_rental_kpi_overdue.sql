-- MIGRATION 20261016060200_rental_kpi_overdue.sql
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI uygular.
-- Geri alma: supabase/rollbacks/20261016060200_rental_kpi_overdue.rollback.sql (20261009000400 govdesi birebir).
-- BAGIMLILIK: 20261009000400_db_perf_rls_initplan_kpi.sql (rental_kpi_snapshot ilk tanim + ACL).
--
-- BULGU SK6/B107 (Kiralama "Bu ayin tahsilati" geciken tahakkuklari yok sayiyor): period_paid bu ayin TUM tahakkuklarinin odenen
--   kismini sayiyor, period_pending ise yalniz status in ('pending','partial'). Bu ayin 'overdue' durumuna gecmis tahakkuklarinin
--   KALAN kismi hicbir dilime girmiyordu; oran tahsil / (tahsil + bekleyen) %78 cikiyordu (gercek tahsil / tahakkuk %43).
-- COZUM: iki yeni anahtar (eski anahtarlar ve anlamlari AYNI):
--   period_overdue = bu donemin 'overdue' tahakkuklarinin kalan tutari; period_total = bu donemin tahakkuk toplami.
--   Boylece period_paid + period_pending + period_overdue = period_total (iptal edilen/diger durumlar haric).
-- GUVENLIK DEGISMEZ: SECURITY INVOKER (RLS cagiranin yetkisiyle), imza/ACL ayni.
-- KOD SIRASI: bagimsiz; KOD YAYININDAN ONCE ya da SONRA uygulanabilir (kod yeni anahtarlar yokken eski satir sorgusundan hesaplar).
set local lock_timeout = '5s';

create or replace function public.rental_kpi_snapshot(p_period date)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'period_count', count(*) filter (where c.period = p_period),
    'period_paid', coalesce(sum(least(c.amount, coalesce(c.paid_amount, 0))) filter (where c.period = p_period), 0),
    'period_pending', coalesce(sum(greatest(0, c.amount - least(c.amount, coalesce(c.paid_amount, 0))))
      filter (where c.period = p_period and c.status in ('pending', 'partial')), 0),
    'period_overdue', coalesce(sum(greatest(0, c.amount - least(c.amount, coalesce(c.paid_amount, 0))))
      filter (where c.period = p_period and c.status = 'overdue'), 0),
    'period_total', coalesce(sum(c.amount) filter (where c.period = p_period), 0),
    'overdue_count', count(*) filter (where c.status = 'overdue'),
    'overdue_sum', coalesce(sum(greatest(0, c.amount - coalesce(c.paid_amount, 0))) filter (where c.status = 'overdue'), 0),
    'overdue_rentals', count(distinct c.rental_id) filter (where c.status = 'overdue'),
    'active_rentals', (select count(*) from public.rentals r where r.status = 'active')
  )
  from public.rent_charges c
  where c.period = p_period or c.status = 'overdue';
$$;

revoke all on function public.rental_kpi_snapshot(date) from public, anon;
grant execute on function public.rental_kpi_snapshot(date) to authenticated, service_role;
