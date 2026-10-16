-- 20261020020001 geri alma: kiracı başvurusu tabloları (bağlantı, başvuru, evrak), saklama fonksiyonu ve kira kaydı kefil
--   sütunları düşer. Başvuru verisi ve evrak meta kayıtları SİLİNİR (depodaki nesneler silme kuyruğuna ayrıca alınmaz).
--   Kod tablo yokken başvuru ekranlarını "kurulum bekliyor" ile gizler; kefil sütunu yoksa sözleşme {kefil} boş kalır.
set local lock_timeout = '5s';

drop function if exists public.rental_applications_purge_expired(integer);
drop table if exists public.rental_application_files;
drop table if exists public.rental_applications;
drop function if exists public.rental_applications_guard();
drop table if exists public.rental_application_links;
revoke update (guarantor_name, guarantor_phone, guarantor_address) on public.rentals from authenticated;
alter table public.rentals drop constraint if exists rentals_guarantor_len_chk;
alter table public.rentals drop column if exists guarantor_address;
alter table public.rentals drop column if exists guarantor_phone;
alter table public.rentals drop column if exists guarantor_name;
