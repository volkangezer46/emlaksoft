# Liste sayfaları hız değerlendirmesi (2026-10-12)

Yöntem: yerel `next start` (üretim derlemesi, `EMLAKSOFT_SERVER_TIMING=1`) → canlı Supabase; tek kullanıcı (demo-ofis sahibi),
istekler arası >=1 sn, sayfa başına 3 tekrar. Araçlar: `scripts/perf/measure-live.mts`, `rsc-size.mts`, `main-thread.mts`, `dom-count.mts`.
Yerel makine → uzak DB gidiş-dönüşü ~80-100 ms olduğu için ölçüler Vercel'den kötümserdir; ağ gürültüsü yüksektir (aynı sayfada 2x oynama).
Demo kiracıda veri azdır (müşteri ~45, portföy ~31); 30'luk sayfa boyutunun kazancı büyük kiracıda daha belirgindir.

## 1. Değerlendirme (önce)

| Sayfa | Toplam ms (min-maks) | RSC KB | DOM düğümü | Varsayılan satır | Gözlem |
|---|---|---|---|---|---|
| musteriler | 792-1064 | 361 | 3412 | 50 | 15+ sorgu; 2000'lik ısı havuzu + ısı RPC'si, tip/büyüme taramaları listeyle aynı kapıda; satır başı ~4,8 KB RSC |
| portfoyler | 710-815 | 255 | 2764 | 50 | ~19 paralel sorgu + 2000 satırlık tarama; kapak sorgusu liste ardından |
| talepler | 513-703 | 322 | 2699 | 50 | havuz 500 + seri 2000 tarama |
| anlasmalar | 611-759 | 108 | 1989 | 50 | |
| randevular | 571-721 | 126 | 1447 | 50 (pencere 500 çekilir) | takvim penceresi için 500 satır |
| gorevler | 614-719 | 127 | 2480 | 50 | |
| ilan-havuzu | 689-1076 | 102 | 1628 | 50 | 4 gidiş-dönüş zinciri (başka ajan alanı, dokunulmadı) |
| giderler | 892-1191 | 133 | 2108 | 200 | kategori süzgeci bellekte |
| komisyon | 508-705 | 169 | 2002 | 50 | |
| kiralama | 932-1023 | 123 | 1179 | 50 (300 çekilir) | |

`select *` yok: liste sütunları zaten dar (yalnız `kiralama` ayar tablosunda tek satırlık `select("*")`). Gömmeler FK ipuculu.
Ana iş parçacığı (gezinme, 50 satır): musteriler 578 ms (uzun görev 239 ms), portfoyler 383 ms (137), anlasmalar 653 ms (3 uzun görev).
`musteriler-liste` sunucu bölümü: 464 / 410 / 294 ms.

Kök nedenler: (1) ilk ekrana gerekmeyen taramaların (ısı havuzu, tip sayacı, büyüme, özel gün) liste ile aynı kapıda beklenmesi,
(2) ardışık gidiş-dönüşler (özel alan tanımı -> liste; ısı RPC'si -> randevu/sahip geçmişi), (3) satır başına büyük RSC ağacı.

## 2. Uygulananlar

- Varsayılan sayfa boyutu 30: musteriler, portfoyler, talepler, anlasmalar, randevular, gorevler, komisyon, kiralama (URL `?sayfa=` korunur);
  giderler 200 -> 30 (`?adet=`, "Daha fazla göster" 30'ar).
- Giderler: `?kategori=` süzgeci bellekten sunucuya taşındı (30'luk dilimde kayıt kaçırmasın).
- Müşteriler liste-önce akış: KPI şeridi, grafikler, özel günler, tip/sıcaklık çipleri `Suspense` ile ayrı akar (`summary` sözü);
  liste yalnız kendi sorguları + sayfa kimlikleri için küçük ısı RPC'sini bekler. `?segment=` süzgeci havuza ihtiyaç duyduğu için o yolda havuz beklenir.
- Müşteriler: yaklaşan randevu + sahip geçmişi sorguları ısı RPC'sini beklemeden satırlar belli olunca başlar (1 gidiş-dönüş kazancı).
- Müşteriler, Portföyler: `?ozel=` yokken özel alan tanımı okuması listeden önceki ayrı tur olmaktan çıktı (sorgularla paralel).
- Migration/RPC: YAZILMADI. Sorgular zaten paralel; tek-RPC kazancı (~1 tur) ölçümde büyük çıkmadı.

## 3. Sonra

Bkz. aşağıdaki ölçüm tablosu (aynı yöntem).

| Ölçü | Önce | Sonra |
|---|---|---|
| `musteriler-liste` sunucu bölümü (ms) | 464 / 410 / 294 | 335 / 346 / 258 |
| musteriler HTML KB / DOM | 759 / 3412 | 595 / 2593 |
| portfoyler HTML KB / DOM | 560 / 2764 | 550 / 2710 |
| talepler HTML KB / DOM | 643 / 2699 | 566 / 2374 |
| musteriler satır sayısı | 45 | 30 |

Sınırlar: RSC <120 KB hedefine musteriler/portfoyler/talepler ulaşmadı (satır başına sunucuda üretilen ağaç; kalıcı çözüm satırları
istemci bileşenine kompakt props ile taşımak, ayrı iş). Uçtan uca "toplam" süre Suspense akışıyla azalmaz (akış toplamı değil ilk liste anını öne çeker);
ilk satır zamanı `dom-count.mts` ile ölçülür (liste-hazır ms). Ağ gürültüsü nedeniyle toplam-ms karşılaştırması güvenilir değildir.
