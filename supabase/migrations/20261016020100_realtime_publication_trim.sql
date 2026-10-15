-- MIGRATION 20261016020100_realtime_publication_trim.sql
-- SK2 REALTIME-1 (B015): sayfa tablolari supabase_realtime yayinindan cikarilir; ofis ekranlari artik deyim duzeyinde
-- Broadcast dinler (20261016020000, konu tenant:<id> / inbox:<uid>). postgres_changes aboneligi kalmayinca Realtime
-- realtime.list_changes ile WAL yoklamasini birakir (olcum: DB yurutme suresinin %37-39'u bu yoklamaydi).
-- Geri alma: supabase/rollbacks/20261016020100_realtime_publication_trim.rollback.sql (statik liste geri eklenir).
--
-- KALANLAR (kodda postgres_changes ile GERCEKTEN abone olunan; sozlesme src/lib/kq2-db-surface-contract.test.ts):
--   support_ticket_messages, support_ticket_attachments: /admin destek konusmasinda personel gorunumu
--   (src/app/app/destek/[id]/ticket-thread.tsx audience="staff"; platform personeli ofis konusuna katilamaz).
--   Ofis gorunumu Broadcast'e tasindi. Personel kanali ayri Broadcast'e tasininca bu iki tablo da cikarilir.
-- CIKANLAR: geri kalan her tablo (canlida 19: 17 rota tablosu + listing_control_events + notifications).
--
-- KAPI ("canli dogrulamadan sonra"): Broadcast okuma politikalari (rt_tenant_topic_read + rt_inbox_topic_read)
--   realtime.messages'ta YOKSA bu dosya HICBIR SEY yapmaz (NOTICE). Supabase'te migration rolu `postgres` bu
--   politikalari kuramaz (20261016020000 basligi); canlida sira:
--     (1) db:migrate (020000 tetikleyicileri kurar, 020100 burada ertelenir) -> (2) deploy ->
--     (3) supabase_admin: scripts/sunucu/realtime-policies.sql (politikalar) -> (4) canli dogrulama (rt-e2e S1-S4) ->
--     (5) supabase_admin: scripts/sunucu/realtime-policies.sql -v trim=1 (bu dosyanin adimi; ayni SQL, idempotent).
--   Politikalari kurabilen rolle (golge/yerel superuser) calisirsa kirpma burada yapilir.
-- Yayin yoksa ya da FOR ALL TABLES ise atlanir. Idempotent. Tablo/veri degismez.
set local lock_timeout = '5s';

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
    raise notice 'SK2: Broadcast tetikleyicisi (20261016020000) yok; yayin kirpma ERTELENDI';
    return;
  end if;
  -- to_regclass (::regclass DEGIL): Realtime semasi olmayan golgede sabit cast plan aninda hata verirdi.
  if (select count(*) from pg_catalog.pg_policy
      where polrelid = pg_catalog.to_regclass('realtime.messages')
        and polname in ('rt_tenant_topic_read', 'rt_inbox_topic_read')) < 2 then
    raise notice 'SK2: Broadcast okuma politikalari yok; yayin kirpma ERTELENDI (supabase_admin: scripts/sunucu/realtime-policies.sql, dogrulamadan sonra -v trim=1)';
    return;
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
