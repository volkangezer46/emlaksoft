# Demo verisi (örnek ofis) — tasarım ve kurallar

Sahip kuralı (2026-10-24): ofisler ilk açıldığında fotoğraflı portföylerden ekibe kadar **tam dolu** bir demo ofis görür;
ekranın üstünde demo ofisinde olduğu yazar; tek tuşla (iki onayla) tüm örnekler silinip gerçek kullanıma geçilir; geçişten
ve gerçek kayıt girildikten sonra **bir daha örnek veri yüklenemez**. Admin her şeyi kontrol eder.

## Parçalar

| Parça | Yer |
| --- | --- |
| İçerik planı (saf, deterministik; 6 aya yayılmış tarihler) | `src/lib/sample-data/rich-pack.ts`, `timeline.ts`, `catalog.ts` |
| Yazım (çekirdek + ekler) | `src/lib/sample-data-seed.ts` (`insertSampleRecords`) |
| Kayıt modülleri (finans bütçesi, evrak talebi + yalnız-kayıt dosyası, kiracı başvurusu, teslim/tahliye tutanağı) | `src/lib/sample-data/records-seed.ts` (`seedModuleData` içinden; iki çağıran) |
| Demo ekip (giriş yapamayan 3 profil) | `src/lib/sample-data/personas.ts` |
| Fotoğraflar (statik kütüphane `/img/demo/...`) | `src/lib/media/demo-photos.ts` (manifest), `src/lib/sample-data/demo-photo-pick.ts` |
| Kilit (uygulama + DB tetikleyicisi) | `src/lib/sample-data/lock.ts`, `sample_seed_guard` / `sample_seed_lock_guard` (20261024020000) |
| Gerçek kullanıma geç (iki onay) | `/app/ayarlar/gercek-kullanim`, `clearSampleData`, `purge_tenant_sample_data` v2 |
| Üst şerit | `src/components/app/demo-trial-strip.tsx` (sunucu bileşeni) |
| Admin | Ofis 360 > Yönetim > Demo verisi; `/admin/tenants/demo`; ayarlar `demo.auto_seed_new_offices`, `demo.default_pack` |
| Genel demo ofisi (giriş kartları) | `scripts/seed-demo.ts`, gece sıfırlaması `demo_tenant_nightly_reset` (görüntü geri yükleme + [SAHA] temizliği) |
| Kayıt defteri (tek kaynak) | `src/lib/sample-data/registry.ts` + `registry-contract.test.ts` |

## Yeni modül eklerken demo verisi

Her yeni modül, sayfa ya da varlık **aynı değişiklikte** demo verisiyle gelir. Sözleşme testi
(`src/lib/sample-data/registry-contract.test.ts`) eksik adımı yakalar ve testi kırar.

1. **Şema:** yeni tenant tablosuna `is_sample boolean not null default false` ekleyin (migration). Örnek veri gerektirmeyen
   tablo (ayar, sayaç, günlük) ise `SAMPLE_EXEMPT`'e gerekçesini yazın.
2. **Tohum:** örnek satırları `src/lib/sample-data-seed.ts` içinde bir `group("<ad>", ["<tablo>"], ...)` ile (ya da
   modül tohumunda `modules-seed.ts`) yazın. Gerçekçi Türkçe içerik; para tam TL; telefon `samplePhone()` aralığında;
   tarihler `timeline.ts` ile geçmişe yayılmış (gelecekte `created_at` yok); bağlı kayıtlar gerçek örnek müşteri/portföye bağlı.
3. **Temizlik:** yeni tabloyu `purge_tenant_sample_data`'nın yeni sürümüne ekleyin (yeni migration; uygulanmış dosya
   değiştirilmez): bağımlı tablo ebeveynden önce, `delete ... where is_sample = true and tenant_id = p_tenant_id` ya da
   isteğe bağlı listeye `'<tablo>:is_sample'`. Ebeveynle `on delete cascade` gidiyorsa kayıt defterinde `cascade` yazın.
4. **Kayıt defteri:** `SAMPLE_ENTITIES`'e satır ekleyin (`seed` dosya + grup, `purge` türü). Tetikleyiciyle türeyen tablo
   `derived` olarak gerekçesiyle yazılır. `KNOWN_SEED_GAPS` yalnız küçülür; yeni tablo oraya eklenemez.
5. **Onay ekranı:** kullanıcıya görünen bir varlıksa `SAMPLE_CLEAR_ORDER` (`src/lib/sample-clear.ts`) etiketine ekleyin;
   "Gerçek kullanıma geç" penceresi sayıyı gösterir.
6. **Genel demo ofisi:** `scripts/seed-demo.ts`'e aynı varlığın vitrin kalitesinde örneğini ekleyin; gece geri yüklenmesi
   gerekiyorsa tabloyu `demo_reset_snapshot_tables()` listesine (yeni migration) ekleyin.
7. **Test:** pglite SQL testi (`demo-lock-purge-sql-exec.test.ts` deseni) yeni tablonun purge'de silindiğini ve gerçek
   satıra dokunulmadığını kanıtlar.

## Kilit kuralları

- `tenants.real_use_at` doluysa (gerçek kullanıma geçildi) örnek veri yüklenemez.
- Gerçek (`is_sample=false`) müşteri ya da portföy varsa (silinmiş dahil) örnek veri yüklenemez — istisnasız.
- Tek istisna: platform süper admini, gerçek kaydı olmayan ofiste, 10 dakikalık izinle (`sample_seed_override_until`) yeniden yükler.
- Genel demo ofisi (`demo-ofis`) kilit dışıdır ama gerçek kullanıma geçirilemez.
- Saha testleri (`[SAHA]` önekli kayıtlar) genel demo ofisini değil ayrı QA ofisini hedefler; demo ofiste kalanlar gece silinir
  ve `findSahaRows` değişmezi 0 bekler.
