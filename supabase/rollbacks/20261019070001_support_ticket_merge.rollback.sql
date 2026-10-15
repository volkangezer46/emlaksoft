-- Geri alma: 20261019070001_support_ticket_merge.sql
-- Birlestirme fonksiyonu, indeks, kisit ve kolonlar duser. Birlestirilmis kaynak talepler "Kapali" (cozum kodu 'merged')
-- kalir; eklenen sistem mesajlari, ic notlar ve olay kayitlari korunur (gecmis silinmez).
set local lock_timeout = '5s';
drop function if exists public.support_merge_tickets(uuid, uuid, uuid);
drop index if exists public.idx_support_tickets_merged_into;
alter table public.support_tickets drop constraint if exists support_tickets_merged_not_self;
alter table public.support_tickets drop column if exists merged_at;
alter table public.support_tickets drop column if exists merged_into_id;
