-- MIGRATION 20261019070000_platform_mrr_month_end.sql
-- UYGULANMADI: yalniz restore edilebilir yedek dogrulandiktan sonra SAHIBI uygular (`npm run db:migrate`).
-- KOD YAYININDAN ONCE ya da SONRA uygulanabilir: fonksiyon yokken /admin/raporlar MRR hareketleri, NRR/GRR ve kohort
--   kartlari "veri birikiyor / okunamadi" der (sayi uydurulmaz).
-- Geri alma: supabase/rollbacks/20261019070000_platform_mrr_month_end.rollback.sql (yalniz fonksiyon duser).
-- BAGIMLILIK: 20261013001000 (platform_mrr_daily).
--
-- NE (PA-3, ChartMogul MRR Movements / Net-Gross MRR Retention / kohort):
--   platform_mrr_month_end(p_from, p_to): [p_from, p_to] TR takvim aylarinda her ofisin AY SONU MRR'i (ayin son anlik
--   goruntusu; bu ay icin bugune kadarki son gun). Ofis x gun satirlarini istemciye tasimadan tek SQL turunda indirger.
--   Yalniz service_role cagirir (admin raporlari); anon/authenticated yurutemez. Veri degismez.
set local lock_timeout = '5s';

create or replace function public.platform_mrr_month_end(p_from date, p_to date)
returns table (tenant_id uuid, month text, mrr numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'platform_mrr_month_end: yalniz service_role' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 800 then
    raise exception 'platform_mrr_month_end: gecersiz aralik' using errcode = '22023';
  end if;
  return query
    select distinct on (d.tenant_id, date_trunc('month', d.day))
      d.tenant_id,
      to_char(d.day, 'YYYY-MM') as month,
      d.mrr_try as mrr
    from public.platform_mrr_daily d
    where d.day >= date_trunc('month', p_from)::date
      and d.day < (date_trunc('month', p_to) + interval '1 month')::date
    order by d.tenant_id, date_trunc('month', d.day), d.day desc;
end;
$$;

revoke all on function public.platform_mrr_month_end(date, date) from public, anon, authenticated;
grant execute on function public.platform_mrr_month_end(date, date) to service_role;
