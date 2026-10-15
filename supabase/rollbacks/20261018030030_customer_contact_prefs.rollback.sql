-- Geri alma: 20261018030030_customer_contact_prefs.sql
-- Girilen iletisim tercihleri KAYBOLUR. Kod sutunlar yokken tercih kartini "kurulum bekliyor" gosterir.
set local lock_timeout = '5s';
alter table public.customers drop constraint if exists customers_preferred_language_check;
alter table public.customers drop constraint if exists customers_contact_window_check;
alter table public.customers drop constraint if exists customers_preferred_channel_check;
alter table public.customers drop column if exists preferred_language;
alter table public.customers drop column if exists contact_window;
alter table public.customers drop column if exists preferred_channel;
