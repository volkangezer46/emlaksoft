-- Rollback: 20260816001500_listing_pool
-- Havuz kayıtları ve atama geçmişi (listing_pool_events) KALICI silinir. properties.assigned_to değerleri kalır.
-- Önce /app/havuz ve havuz cron'unu kapatın.
drop function if exists public.assign_pool_entry(uuid, uuid, text, text, smallint, jsonb);
drop table if exists public.listing_pool_events;
drop table if exists public.listing_pool_entries;
