-- SK2 (B014) Realtime kiraci sinirlari: _realtime.tenants 'realtime-dev' satiri. GECE, DUYURULARAK, geri alinabilir.
--
-- NEDEN (salt-okunur olcum 2026-10-15): max_concurrent_users 200, max_events_per_second 100, max_joins_per_second 100,
--   max_bytes_per_second 100000. Ofis ekranlari artik sekme basina bir ofis konusu (+ kisisel kutu) kanalina katilir; 200
--   eszamanli kullanici sinirinda 201. kullanici canli veri alamaz (katilim reddi, istemcide 'Canli baglanti yok').
--
-- ONEMLI (KALICILIK): Realtime konteyneri SEED_SELF_HOST=true ile acilir; her baslangicta priv/repo/seeds.exs kiraci
--   satirini SILIP yeniden yazar (sinirlar ortam degiskenlerinden gelir: TENANT_MAX_CONCURRENT_USERS vb.,
--   /app/releases/<surum>/runtime.exs). Bu SQL yalniz ANINDA etki icindir; kalici ayar ortam degiskeniyle yapilir:
--
--   (1) /data/coolify/services/moqbebljyeyprktd19zb1ihn/docker-compose.yml (Coolify > Supabase servisi > realtime-dev
--       ortam degiskenleri; dosyayi elle degil Coolify arayuzunden degistirin):
--         TENANT_MAX_CONCURRENT_USERS=2000
--         TENANT_MAX_EVENTS_PER_SECOND=1000
--         TENANT_MAX_JOINS_PER_SECOND=500
--         TENANT_MAX_BYTES_PER_SECOND=1000000
--         TENANT_MAX_CHANNELS_PER_CLIENT=100   (degismez; sekme basina 2 kanal kullanilir)
--   (2) Gece, duyurarak: realtime-dev konteynerini yeniden baslatin (Coolify "Restart" ya da
--       docker restart realtime-dev-moqbebljyeyprktd19zb1ihn). Acik sayfalar 1-30 sn icinde geri cekilmeyle yeniden
--       baglanir ve tek tazeleme yapar (src/lib/realtime.ts hub'i).
--   (3) Bu dosyayi supabase_admin ile calistirin (postgres bu tabloda UPDATE yetkisine sahip DEGIL; sahibi supabase_admin):
--         docker exec -i supabase-db-moqbebljyeyprktd19zb1ihn psql -h /var/run/postgresql -U supabase_admin -d postgres \
--           -X -v ON_ERROR_STOP=1 < scripts/sunucu/realtime-limits.sql
--       Ortam degiskeni dogru kurulduysa UPDATE 0 satir degistirir (zaten >= hedef); kurulmadiysa satiri hemen yukseltir
--       (Realtime kiraci onbellegi dolunca ya da sonraki katilimlarda gecerli olur) ve sonraki yeniden baslatmada
--       ortam degiskeni yoksa 200'e DONER (son SELECT bunu gosterir; (1)'i atlamayin).
--   (4) %80 uyarisi: scripts/sunucu/realtime-capacity-check.sh (dakikada bir; kurulum o dosyanin basinda).
--
-- GERI ALMA: ortam degiskenlerini kaldirin + realtime-dev'i yeniden baslatin (seed varsayilanlari 200/100/100/100000);
--   anlik geri alma icin asagidaki UPDATE'i eski degerlerle (200, 100, 100, 100000) calistirin.
-- Idempotent: yalniz hedefin altindaki degerleri yukseltir (greatest); daha yuksek elle ayari dusurmez.

\set ON_ERROR_STOP on
begin;
set local lock_timeout = '5s';

update _realtime.tenants
set max_concurrent_users = greatest(max_concurrent_users, 2000),
    max_events_per_second = greatest(max_events_per_second, 1000),
    max_joins_per_second = greatest(max_joins_per_second, 500),
    max_bytes_per_second = greatest(coalesce(max_bytes_per_second, 0), 1000000),
    updated_at = now()
where external_id = 'realtime-dev'
  and (max_concurrent_users < 2000
       or max_events_per_second < 1000
       or max_joins_per_second < 500
       or coalesce(max_bytes_per_second, 0) < 1000000);

commit;

-- Dogrulama (kabul: max_concurrent_users >= 2000).
select external_id, max_concurrent_users, max_events_per_second, max_joins_per_second, max_bytes_per_second,
       max_channels_per_client, updated_at,
       case when max_concurrent_users >= 2000 then 'TAMAM' else 'EKSIK: ortam degiskeni + yeniden baslatma' end as durum
from _realtime.tenants
where external_id = 'realtime-dev';
