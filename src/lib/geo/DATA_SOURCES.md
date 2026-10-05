# Coğrafya veri kaynakları

## Kaynak: TurkiyeAPI (açık veri)

* Proje: TurkiyeAPI (`https://api.turkiyeapi.dev`, GitHub: ubeydeozdmr/turkiye-api)
* **Lisans: MIT** (Copyright (c) 2022-2026 Ubeyde Emir Özdemir) — ticari kullanıma uygun; telif notu korunmalı.
* Güncel sürüm (bu görevde doğrulandı): `datasetVersion: "2025"`, `lastUpdated: "2026-05-21"`.
* Kapsam (v2 statik veri setleri, aynı gün indirildi): **81 il, 973 ilçe, 32.279 mahalle** (posta kodu dahil; yetim kayıt 0).
* Not: kaynak kendi içinde aynı ilçede aynı (normalize) adı taşıyan mahalleler içerir; `(district_id, name)` benzersizliği nedeniyle
  planlayıcı bunları tek kayda indirger (32.279 → 31.946 mahalle ekleme adayı; fark ≈333 yinelenen ad). Canlı DB ≈31.9 bin mahalle ile uyumlu.
* Canlıdaki mevcut veri de aynı kaynaktan gelir (`scripts/geo-sync.ts`, il bazlı `geo-province-sync` çalışanı).

## Veri dosyası repoya KONMAZ (≈1,6 MB CSV / 50 MB değil ama sürümlü veri repoda tutulmaz)

İndirme + dönüştürme (kaynak `v2` statik dosyaları):

```
https://api.turkiyeapi.dev/v2/datasets/provinces.json
https://api.turkiyeapi.dev/v2/datasets/districts.json
https://api.turkiyeapi.dev/v2/datasets/neighborhoods.json
```

Üç dosyayı düz satır biçimine çevirin (aşağıdaki sütunlar). Örnek eşleme: il `id` → `plate_code`; ilçe `id` → `source_id`;
mahalle `id` → `source_id`, `postalCode` → `postal_code`; il `coordinates.latitude/longitude` → `lat/lng`.

```
plate_code,province,district,neighborhood,source_id,postal_code,lat,lng,population
34,İstanbul,,,,,41.0082,28.9784,
34,İstanbul,Kadıköy,,1234,,,,
34,İstanbul,Kadıköy,Caferağa Mahallesi,56789,34710,,,
```

Doğrulama kuralları (içe aktarmada zorunlu): il satırlarında plaka 01-81 ve benzersiz; tam kaynak kipinde 81 il; her ilçe/mahalle
bir ile (dosyada ya da DB'de) bağlanabilmeli; mahalle satırında ilçe zorunlu; koordinat Türkiye aralığında (uyarı).

## İçe aktarma yolları

* Ekran: `/admin/geo/ice-aktar` (≤3 MB; super_admin uygular, ops önizler): KURU ÇALIŞTIRMA → fark özeti → onay → partili uygulama → sürüm kaydı.
* CLI: `npm run geo:import -- --file X --dry-run` (salt okunur), `--apply` (canlı yazım; `GEO_IMPORT_CONFIRM=1` + yedek/PITR + migration şart),
  `--against snapshot.json` ile DB'siz kuru çalıştırma, `--mode full` ile tam kaynak (olmayanları pasife alır; SİLME YOK).

## Bu görevdeki doğrulama (canlı DB'ye YAZILMADI)

Veri v2 kaynağından indirildi, düz CSV'ye çevrildi (33.333 satır) ve `npm run geo:import -- --dry-run --mode full --against <yalnız 81 il anlık görüntüsü>`
ile yerel olarak denendi: ayrıştırma + doğrulama (81 il, plaka 01-81, ilçe-il bağları) geçti; plan 973 ilçe + 31.946 mahalle ekleme önerdi.
Canlı DB ile gerçek fark için migration uygulandıktan sonra `--dry-run` (DB'ye bağlı) çalıştırılmalıdır.
