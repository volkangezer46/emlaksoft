-- SK2 YAYIN NOTU (ZORUNLU, bir kez): ozel Broadcast kanallarinin okuma politikalari (realtime.messages).
-- Neden ayri dosya: realtime.messages'in sahibi supabase_realtime_admin; Supabase'te `postgres` superuser degil ve bu
-- role uye degil, bu yuzden migration 20261016020000 politika adimini atlar (NOTICE). Icerik migration'daki adimla
-- AYNIDIR (sozlesme testi: src/lib/realtime-route-contract.test.ts). Idempotent: drop if exists + create.
-- Calistirma (canli, supabase_admin):
--   docker exec -i <supabase-db> psql -h /var/run/postgresql -U supabase_admin -d postgres -X -v ON_ERROR_STOP=1 \
--     < scripts/sunucu/realtime-policies.sql
-- Dogrulama: select polname from pg_policy where polrelid = 'realtime.messages'::regclass;  -> rt_tenant_topic_read, rt_inbox_topic_read
-- Geri alma: drop policy if exists rt_tenant_topic_read on realtime.messages; drop policy if exists rt_inbox_topic_read on realtime.messages;
begin;
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
commit;
