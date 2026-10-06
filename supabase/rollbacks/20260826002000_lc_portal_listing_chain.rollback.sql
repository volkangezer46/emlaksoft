-- Rollback: 20260826002000_lc_portal_listing_chain. Elle calistirilir; schema_migrations ledger satirina DOKUNMAZ.
-- UYARI: supersedes zinciri, source_kind/ended_reason/created_via degerleri KAYBOLUR. 'superseded' durumlu satirlar
-- silinmez ama status'u 'removed'a cekilir (yayin gecmisi korunur).
update public.portal_listings set status = 'removed' where status = 'superseded';
drop function if exists public.lc_bind_portal_listing(uuid, uuid, uuid, text, text, text, text, text);
drop function if exists public.lc_rotate_portal_listing(uuid, uuid, uuid, text, text, text);
drop index if exists public.idx_portal_listings_property_portal;
drop index if exists public.uq_portal_listings_supersedes;
drop index if exists public.uq_portal_listings_live_external;
alter table public.portal_listings drop constraint if exists portal_listings_supersedes_tenant_fkey;
alter table public.portal_listings drop constraint if exists portal_listings_created_via_check;
alter table public.portal_listings drop constraint if exists portal_listings_ended_reason_check;
alter table public.portal_listings drop constraint if exists portal_listings_source_kind_check;
alter table public.portal_listings drop column if exists external_id_norm;
alter table public.portal_listings drop column if exists created_via;
alter table public.portal_listings drop column if exists ended_reason;
alter table public.portal_listings drop column if exists source_kind;
alter table public.portal_listings drop column if exists supersedes_id;
