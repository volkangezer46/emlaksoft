-- MIGRATION 20261015017000_realtime_publication_trim.sql
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI uygular (gölgede denendi).
-- Geri alma: supabase/rollbacks/20261015017000_realtime_publication_trim.rollback.sql (bu dosyanin cikardigi tablolar
--   yayinin yorumuna yazilan `kq2_trimmed:<schema.tablo,...>` izinden geri eklenir).
--
-- AMAC (KQ2, Realtime yuzeyi): supabase_realtime yayininda yalniz istemci kodunda GERCEKTEN abone olunan tablolar kalir.
--   Yayindaki her tablo WAL'dan cozulur ve Realtime sunucusunda RLS ile suzulur; dinlenmeyen tablo bos maliyettir.
-- ABONE OLUNAN TABLOLAR (2026-10-15, kod taramasi; sozlesme testi src/lib/kq2-db-surface-contract.test.ts kilitler):
--   src/components/app/realtime-refresh.tsx + src/hooks/use-realtime-refresh.ts (rota kanali, kaynak ROUTE_TABLES
--     src/lib/realtime-throttle.ts): appointments, cash_entries, commissions, customer_demands, customers, deals,
--     finance_open_items, finance_parties, fsbo_leads, listing_pool_entries, offers, portal_listings, properties,
--     property_keys, rent_charges, rent_payments, tasks
--   src/components/app/realtime-refresh.tsx (zil kanali): notifications
--   src/components/listing-control/live-refresh.tsx (useRealtimeRefresh): listing_control_events
--   src/lib/realtime.ts subscribeToInserts: support_ticket_messages, support_ticket_attachments (destek konusmasi),
--     pano TV (customers, appointments, offers, properties, commissions, tasks - yukaridakilerin alt kumesi)
-- SONUC: canlida yayindaki 21 tablonun 21'i de abone listesinde (2026-10-15 salt-okunur pg_publication_tables);
--   bu dosya canlida HICBIR tabloyu cikarmaz. Gelecekte elle ya da baska bir yoldan yayina eklenmis, kodda dinlenmeyen
--   her public tablo bu adimda DROP edilir (ALTER PUBLICATION ... DROP TABLE). Liste disi tablo EKLENMEZ.
-- Yayin yoksa (yalin Postgres) atlanir. Idempotent.
set local lock_timeout = '5s';

do $$
declare
  keep constant text[] := array[
    'appointments', 'cash_entries', 'commissions', 'customer_demands', 'customers', 'deals',
    'finance_open_items', 'finance_parties', 'fsbo_leads', 'listing_control_events', 'listing_pool_entries',
    'notifications', 'offers', 'portal_listings', 'properties', 'property_keys', 'rent_charges', 'rent_payments',
    'support_ticket_attachments', 'support_ticket_messages', 'tasks'
  ];
  r record;
  dropped text[] := array[]::text[];
begin
  if not exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime') then
    raise notice 'KQ2: supabase_realtime yayini yok, atlandi';
    return;
  end if;
  -- FOR ALL TABLES yayininda tablo bazli DROP yapilamaz; o durumda dokunulmaz.
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime' and puballtables) then
    raise notice 'KQ2: supabase_realtime FOR ALL TABLES, atlandi';
    return;
  end if;
  for r in
    select pt.schemaname, pt.tablename
    from pg_catalog.pg_publication_tables pt
    where pt.pubname = 'supabase_realtime'
      and not (pt.schemaname = 'public' and pt.tablename = any (keep))
    order by 1, 2
  loop
    raise notice 'KQ2: supabase_realtime yayinindan cikariliyor: %.%', r.schemaname, r.tablename;
    execute format('alter publication supabase_realtime drop table %I.%I', r.schemaname, r.tablename);
    dropped := dropped || (r.schemaname || '.' || r.tablename);
  end loop;
  -- Geri alma icin iz: cikarilan tablolar yayinin yorumuna yazilir (rollback buradan geri ekler). Bos ise yorum degismez.
  if cardinality(dropped) > 0 then
    execute format('comment on publication supabase_realtime is %L', 'kq2_trimmed:' || array_to_string(dropped, ','));
  end if;
end $$;
