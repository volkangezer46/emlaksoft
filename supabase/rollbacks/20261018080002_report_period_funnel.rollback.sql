-- 20261018080002 geri alma: donem/kapsam rapor ve satis hunisi fonksiyonlari kaldirilir. Veri degismez.

set local lock_timeout = '5s';

drop function if exists public.report_sales_funnel(date, date, uuid, uuid, uuid, integer);
drop function if exists public.report_period_overview(date, date, uuid, uuid, uuid, integer);
