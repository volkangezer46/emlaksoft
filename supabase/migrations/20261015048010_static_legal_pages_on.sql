-- MIGRATION 20261015048010_static_legal_pages_on.sql
-- YD8 (2026-10-15): yasal sayfalar (gizlilik, KVKK, kullanım şartları, çerez, mesafeli satış, ön bilgilendirme, iptal-iade,
-- davet koşulları) statik sunuma açılır: ilk yükte Next/React JS'i YOK, CSS sayfada kullanılanla sınırlı ve satır içi.
-- Geri alma: supabase/rollbacks/20261015048010_static_legal_pages_on.rollback.sql
-- BAGIMLILIK: platform_settings (mevcut). Kod: src/lib/static-home/registry.ts (yasal kimlikler, adacıksız) +
--   src/lib/static-home/settings.ts (`statik.routes` = {"<id>": true|false}; proxy 30 sn önbellekle okur).
--
-- AMAC: kayıt defterinde yasal sayfalar varsayılan KAPALI (sahip Hız ekranından açar). Canlıda `statik.routes` hiç
--   yazılmamış (2026-10-15 salt-okunur kontrol), yani yasal sayfalar 10-11 JS parçası (~470 KB çözülmüş, ~125 KB aktarım)
--   ve 310 KB ortak CSS ile sunuluyor. Canlı HTML üzerinde aynı dönüşümle ölçüldü: /gizlilik 11,5 KB HTML + ~125 KB JS
--   + ~46 KB CSS (gzip) → tek belge 13,4 KB (gzip), harici betik yok.
-- GÜVENLİK AĞI: dönüşüm beklenmeyen biçim görürse normal Next HTML'i sunulur (render.ts yedeği) ve Hız ekranı
--   "statik_fallback" uyarısı verir; sahip anahtarı tek tuşla kapatabilir, env `STATIC_PAGES=off` hepsini kapatır.
-- ETKI: yalnız ayar satırı (ek). Anahtar ZATEN varsa (sahip karar vermiş) DOKUNULMAZ. Idempotent.

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.platform_settings') is null then
    raise exception 'platform_settings yok.';
  end if;
end $$;

insert into public.platform_settings (key, value)
values (
  'statik.routes',
  '{"gizlilik":true,"kvkk-aydinlatma":true,"kullanim-sartlari":true,"cerez-politikasi":true,"mesafeli-satis":true,"on-bilgilendirme":true,"iptal-iade":true,"davet-kosullari":true}'
)
on conflict (key) do nothing;
