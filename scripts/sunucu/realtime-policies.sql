-- SK2 YAYIN NOTU (ZORUNLU, bir kez): ozel Broadcast kanallarinin okuma politikalari (realtime.messages).
-- Neden ayri dosya: realtime.messages'in sahibi supabase_realtime_admin; Supabase'te `postgres` superuser degil ve bu
-- role uye degil, bu yuzden migration 20261016020000 politika adimini atlar (NOTICE). Icerik migration'daki adimla
-- AYNIDIR (sozlesme testi: src/lib/realtime-route-contract.test.ts). Idempotent: drop if exists + create.
-- Calistirma (canli, supabase_admin):
--   docker exec -i <supabase-db> psql -h /var/run/postgresql -U supabase_admin -d postgres -X -v ON_ERROR_STOP=1 \
--     < scripts/sunucu/realtime-policies.sql
-- Dogrulama: select polname from pg_policy where polrelid = 'realtime.messages'::regclass;  -> rt_tenant_topic_read, rt_inbox_topic_read
-- Geri alma: drop policy if exists rt_tenant_topic_read on realtime.messages; drop policy if exists rt_inbox_topic_read on realtime.messages;
--
-- YAYIN KIRPMA (migration 20261016020100'in ertelenen adimi; YALNIZ canli dogrulamadan sonra, rt-e2e S1-S4 gecince):
--   ayni komut `-v trim=1` ile: politikalar (idempotent) + sayfa tablolari supabase_realtime yayinindan cikarilir
--   (kalanlar migration'daki keep listesi; sozlesme testi iki listeyi esler). Geri alma:
--   supabase/rollbacks/20261016020100_realtime_publication_trim.rollback.sql (postgres ile calisir).
--   docker exec -i <supabase-db> psql -h /var/run/postgresql -U supabase_admin -d postgres -X -v ON_ERROR_STOP=1 -v trim=1 \
--     < scripts/sunucu/realtime-policies.sql
\set ON_ERROR_STOP on
begin;
set local lock_timeout = '5s';
drop policy if exists rt_tenant_topic_read on realtime.messages;
create policy rt_tenant_topic_read on realtime.messages for select to authenticated
  using (
    extension = 'broadcast'
    and (select realtime.topic()) = 'tenant:' || (select public.current_tenant_id())::text
  );
drop policy if exists rt_inbox_topic_read on realtime.messages;
create policy rt_inbox_topic_read on realtime.messages for select to authenticated
  using (
    extension = 'broadcast'
    and (select realtime.topic()) = 'inbox:' || (select auth.uid())::text
  );

\if :{?trim}
do $$
declare
  keep constant text[] := array['support_ticket_attachments', 'support_ticket_messages'];
  r record;
begin
  if not exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime') then
    raise notice 'SK2: supabase_realtime yayini yok, atlandi';
    return;
  end if;
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime' and puballtables) then
    raise notice 'SK2: supabase_realtime FOR ALL TABLES, atlandi';
    return;
  end if;
  if pg_catalog.to_regprocedure('public.rt_emit_tenant_change()') is null then
    raise exception 'SK2: Broadcast tetikleyicisi (20261016020000) yok; once db:migrate';
  end if;
  for r in
    select pt.schemaname, pt.tablename
    from pg_catalog.pg_publication_tables pt
    where pt.pubname = 'supabase_realtime'
      and not (pt.schemaname = 'public' and pt.tablename = any (keep))
    order by 1, 2
  loop
    raise notice 'SK2: supabase_realtime yayinindan cikariliyor: %.%', r.schemaname, r.tablename;
    execute pg_catalog.format('alter publication supabase_realtime drop table %I.%I', r.schemaname, r.tablename);
  end loop;
end $$;
\endif
commit;

select polname from pg_catalog.pg_policy where polrelid = 'realtime.messages'::regclass order by 1;
select tablename from pg_catalog.pg_publication_tables where pubname = 'supabase_realtime' order by 1;
