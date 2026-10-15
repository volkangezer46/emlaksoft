-- 20261020030033 geri alma: isletme projesi ve bina duyurulari duser (butceler ve duyurular silinir). Butceden uretilmis
--   aidat tahakkuklari KALIR (yalniz budget_id sutunu duser); kod tablolar yokken bolumleri "kurulum bekliyor" olarak gosterir.
set local lock_timeout = '5s';

drop function if exists public.accrue_building_budget(uuid, jsonb, jsonb);
drop function if exists public.set_building_budget_status(uuid, text);
drop function if exists public.save_building_budget(uuid, uuid, text, date, integer, text, jsonb, date, text, text);

alter table if exists public.building_charge_batches drop constraint if exists building_batches_budget_fkey;
drop index if exists public.idx_building_batches_budget;
alter table if exists public.building_charge_batches drop column if exists budget_id;

drop table if exists public.building_announcements;
drop table if exists public.building_budgets;
