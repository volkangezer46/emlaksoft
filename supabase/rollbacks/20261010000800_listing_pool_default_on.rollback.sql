-- Rollback: 20261010000800_listing_pool_default_on. Elle calistirilir; schema_migrations ledger satirina DOKUNMAZ.
-- Varsayilan tekrar kapali olur (mevcut ofis ayarlari degismez). 'extension' kaynakli kayitlar once 'manual'a cevrilir.

set local lock_timeout = '5s';

alter table public.tenants alter column listing_pool_enabled set default false;
update public.listing_pool_entries set source = 'manual' where source = 'extension';
alter table public.listing_pool_entries drop constraint if exists listing_pool_entries_source_check;
alter table public.listing_pool_entries
  add constraint listing_pool_entries_source_check
  check (source in ('manual', 'import', 'portal_form', 'network', 'api', 'transfer'));

-- Ornek isareti kolonlari duser (isaret kaybolur; satirlar KALIR).
alter table public.advisor_specialties drop column if exists is_sample;
alter table public.advisor_regions drop column if exists is_sample;
