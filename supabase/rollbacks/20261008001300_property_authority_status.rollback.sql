-- Rollback: 20261008001300_property_authority_status. Elle calistirilir; schema_migrations ledger satirina DOKUNMAZ.
-- UYARI: girilmis yetki belgesi no, e-Devlet onay isaretleri ve hatirlatma izi KAYBOLUR.
drop index if exists public.idx_properties_authority_pending;
alter table public.properties drop constraint if exists properties_authority_eids_status_check;
alter table public.properties drop constraint if exists properties_authority_doc_no_len_check;
alter table public.properties drop constraint if exists properties_authority_reminder_channel_check;
alter table public.properties drop constraint if exists properties_authority_reminder_count_check;
alter table public.properties
  drop column if exists authority_doc_no,
  drop column if exists authority_eids_status,
  drop column if exists authority_owner_approved_at,
  drop column if exists authority_reminder_sent_at,
  drop column if exists authority_reminder_count,
  drop column if exists authority_reminder_channel;
