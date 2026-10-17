-- MIGRATION 20261027030100_realtime_publication_trim_apply.sql
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20261027030100_realtime_publication_trim_apply.sql` ile uygular.
-- Geri alma: supabase/rollbacks/20261027030100_realtime_publication_trim_apply.rollback.sql (statik liste geri eklenir).
-- BAGIMLILIK: 20261016020000 (rt_emit_tenant_change Broadcast tetikleyicileri), realtime.messages okuma politikalari
--   (rt_tenant_topic_read + rt_inbox_topic_read; supabase_admin scripts/sunucu/realtime-policies.sql).
--
-- NEDEN (PERF-12): pg_stat_statements'ta en buyuk DB tuketicisi Realtime WAL yoklamasi (realtime.list_changes: 375k cagri,
--   ort. 17.7 ms, toplam ~6.6M ms). 20261016020100 ayni kirpmayi yapacakti ama uygulandiginda Broadcast okuma politikalari
--   henuz yoktu (NOTICE ile ERTELENDI); canlida yayin hala 21 tablo. Politikalar artik kurulu (2026-10-27 salt-okunur:
--   pg_policy realtime.messages rt_tenant_topic_read + rt_inbox_topic_read var; rt_emit_tenant_change var), ofis istemcisi
--   Broadcast dinliyor; postgres_changes geri dusus kanali yalniz politika reddinde acilir.
-- NE YAPAR: 20261016020100 ile AYNI kapilar ve AYNI keep listesi (kodda postgres_changes ile GERCEKTEN dinlenen tek tablolar:
--   support_ticket_messages, support_ticket_attachments; personel destek gorunumu, ticket_id suzgecli). Geri kalan her tablo
--   yayindan cikar. Kapilardan biri tutmazsa hicbir sey yapmaz (NOTICE). Yayin yoksa / FOR ALL TABLES ise atlanir.
--   Idempotent; tablo/veri degismez. Sozlesme: src/lib/kq2-db-surface-contract.test.ts.
-- KAPI ONCESI (sahip): rt-e2e S1-S4 canli dogrulamasi (Broadcast ile canli tazeleme) yapilmis olmali; dosya uygulaninca
--   eski istemcinin postgres_changes geri dususu sayfa tablolarinda olay almaz.
set local lock_timeout = '5s';

do $$
declare
  keep constant text[] := array['support_ticket_attachments', 'support_ticket_messages'];
  r record;
begin
  if not exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime') then
    raise notice 'PERF-12: supabase_realtime yayini yok, atlandi';
    return;
  end if;
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime' and puballtables) then
    raise notice 'PERF-12: supabase_realtime FOR ALL TABLES, atlandi';
    return;
  end if;
  if pg_catalog.to_regprocedure('public.rt_emit_tenant_change()') is null then
    raise notice 'PERF-12: Broadcast tetikleyicisi (20261016020000) yok; yayin kirpma ERTELENDI';
    return;
  end if;
  -- to_regclass (::regclass DEGIL): Realtime semasi olmayan golgede sabit cast plan aninda hata verirdi.
  if (select count(*) from pg_catalog.pg_policy
      where polrelid = pg_catalog.to_regclass('realtime.messages')
        and polname in ('rt_tenant_topic_read', 'rt_inbox_topic_read')) < 2 then
    raise notice 'PERF-12: Broadcast okuma politikalari yok; yayin kirpma ERTELENDI (supabase_admin: scripts/sunucu/realtime-policies.sql, dogrulamadan sonra -v trim=1)';
    return;
  end if;
  for r in
    select pt.schemaname, pt.tablename
    from pg_catalog.pg_publication_tables pt
    where pt.pubname = 'supabase_realtime'
      and not (pt.schemaname = 'public' and pt.tablename = any (keep))
    order by 1, 2
  loop
    raise notice 'PERF-12: supabase_realtime yayinindan cikariliyor: %.%', r.schemaname, r.tablename;
    execute pg_catalog.format('alter publication supabase_realtime drop table %I.%I', r.schemaname, r.tablename);
  end loop;
end $$;
