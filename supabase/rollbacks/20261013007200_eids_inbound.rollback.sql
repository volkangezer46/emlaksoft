-- 20261013007200 geri alma: EP3 EİDS e-posta alımı tabloları düşer (alma adresleri ve işlenmiş e-posta kayıtları).
-- Kod tablolar yokken kart ve kuyrukta "kurulum bekliyor" der; SMTP köprüsü her alıcıyı 550 ile reddeder.
-- EP2 olay defterindeki (eids_authority_events) kayıtlar etkilenmez (FK yok). Başka nesneye dokunmaz.
drop table if exists public.eids_inbound_messages;
drop table if exists public.eids_inbound_addresses;
notify pgrst, 'reload schema';
