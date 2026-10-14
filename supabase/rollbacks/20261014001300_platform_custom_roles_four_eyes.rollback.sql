-- 20261014001300 geri alma: DG1 dort goz kuyrugu ve ozel roller duser. Ozel rol atanmis personel sabit (taban) rolune doner
-- (custom_role_id sutunu silinir; role sutunu zaten taban roldur). Kod sutun/tablo yokken eski kimlik sorgusuna duser,
-- Roller ve Onaylar ekranlari "veritabani guncellemesi bekliyor" der. Baska nesneye dokunmaz.
drop table if exists public.platform_approval_requests;
alter table public.platform_staff drop constraint if exists platform_staff_custom_role_not_super;
alter table public.platform_staff drop constraint if exists platform_staff_custom_role_id_fkey;
drop index if exists public.platform_staff_custom_role_idx;
alter table public.platform_staff drop column if exists custom_role_id;
drop table if exists public.platform_custom_roles;
notify pgrst, 'reload schema';
