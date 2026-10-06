-- Rollback: 20260826002950_property_eids_no. Elle calistirilir; schema_migrations ledger satirina DOKUNMAZ.
-- UYARI: girilmis EIDS tasinmaz numaralari KAYBOLUR.
drop index if exists public.idx_properties_eids_no;
alter table public.properties drop constraint if exists properties_eids_property_no_format_check;
alter table public.properties drop column if exists eids_property_no;
