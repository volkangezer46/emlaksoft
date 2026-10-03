# Dashboard Yerleşim Denetimi (3 Ekim 2026)

Yöntem: canlı site (https://emlaksoft.vercel.app) Playwright ile gezildi (Ofis sahibi, Süper admin demo kartları; veri yazılmadı). Tam sayfa ekran görüntüleri 1440 (açık tema) ve 390/768 (ilk ekran), her sayfada yatay taşma ve kırpılan metin ölçüldü. Ekran görüntüleri gözle incelendi. Koyu tema ve Gece Altın vurgusu kod düzeyinde (yalnız token kullanan yeni bileşenler) doğrulandı, canlıda görsel tarama yapılmadı (bkz. "Doğrulanamayanlar").

Ölçüm özeti: hiçbir sayfada yatay taşma yok (1440/768/390). Kırpılan metin: ana ekran KPI etiketleri ve tutarlar.

## Sayfa x genişlik özeti

| Sayfa | 390 | 768 | 1440 | Ana sorun |
|---|---|---|---|---|
| /app | uyarı | uyarı | uyarı | KPI etiket kırpma, 5. portföy kartı yetim, KPI iskeleti 8 kart (gerçek 4) |
| /app/raporlar | tamam | tamam | uyarı | KPI kartları farklı stil, 7 kısayol kartı yetim |
| /app/danisman-kpi | uyarı | uyarı | uyarı | hero başlık kalıbı, tablo kart genişliğini doldurmuyor, tek kişilik podyum, 2/4 rozet yetim |
| /app/lig | uyarı | uyarı | uyarı | tablo genişlik, tek kişilik podyum, koyu aksiyon kutusu |
| /app/hedefler | uyarı | tamam | uyarı | koyu hero + kalın çerçeveli "Yeni hedef", KPI stili |
| /app/ekip (Genel) | uyarı | uyarı | uyarı | koyu hero, koyu aksiyon kutusu, KPI stili |
| /app/ekip/kiyas, /kazanc | tamam | tamam | uyarı | tablo genişlik (kart 920px'te bitiyor) |
| /app/kayip-kacak | tamam | tamam | uyarı | koyu hero + KPI (farklı başlık kalıbı) |
| /app/komisyon | uyarı | uyarı | uyarı | koyu hero, iki ayrı KPI bloğu aynı kavram, paylaşım kartı boşluğu |
| /app/cuzdan | tamam | tamam | uyarı | hero ve StatCard satırı aynı sayıları tekrarlıyor |
| /app/eslestirme, /abonelik, /ayarlar | tamam | tamam | tamam | başlık kalıbı (hero) farkı |
| /admin | uyarı | uyarı | uyarı | satır sonları hizasız (kartlar farklı genişlikte), yetim "Son hareketler" |
| /admin/billing, /satis, /raporlar, /sistem, /tenants | tamam | tamam | uyarı | hero kalıbı, abonelik satır sütunları hizasız |
| /fiyatlar | tamam | tamam | tamam | (bu turda yalnız gözlem) |

## Bulgular

Ciddiyet: P0 kırık, P1 belirgin bozukluk, P2 tutarsızlık, P3 cila. Durum: D = düzeltildi, A = açık (sonraki tur).

| # | Sayfa | Genişlik | Görülen | Ciddiyet | Düzeltme | Dosya | Durum |
|---|---|---|---|---|---|---|---|
| 1 | tüm TableFrame kullanan sayfalar (danisman-kpi, lig, ekip/kazanc...) | >=1280 | `sm:[min-width:var(--tbl-mw)]` `min-w-full`'u eziyor; tablo kartın sağında boş bırakıyor (QA #7) | P1 | `min-width:max(100%,var(--tbl-mw))` | `ui/table.tsx` | D |
| 2 | /app | tümü | KPI etiketleri kırpılıyor ("Yeni müşte...", "Bugün gele...") | P1 | etiket 2 satıra sarar, `title` ile tam metin | `ui/premium/kpi-card.tsx` | D |
| 3 | /app | 1440 | KPI iskeleti 8 kart, gerçek 4 kart: yükleme sonrası düzen kayması | P1 | iskelet 4 kart, `pm-card-inline` ile aynı yükseklik | `app/app/page.tsx` | D |
| 4 | /app | 1440 | Portföy vitrini 5 kart: 4+1 yetim | P2 | sütun sayısı öğe sayısına göre (`kpiColumns`) | `_home/portfoy-seridi.tsx` | D |
| 5 | 4 KPI kartı stili: StatCard, KpiCard, KpiStrip, GlassKpi/AdminStatCard | tümü | Aynı kavram 4 farklı kart (ikon rozeti, gölge, tipografi, ok davranışı farklı) | P1 | tek `KpiTile`; StatCard ve KpiStrip onu çizer; KpiCard ince sarmalayıcı | `premium/kpi-card.tsx`, `app/stat-card.tsx`, `list-kit/kpi-strip.tsx` | D (GlassKpi ve AdminStatCard hero içi koyu varyant olarak kaldı: A) |
| 6 | hedefler, ekip, komisyon, cuzdan, danisman-kpi, lig | 1440 | Her sayfa kendi koyu gradient hero'sunu/aksiyon kutusunu çiziyor; başlık kalıbı sayfadan sayfaya değişiyor; "Yeni hedef" kalın koyu çerçeve (QA #11) | P1 | `PageHeader` + açık `KpiGrid`/`KpiTile`; aksiyonlar açık token düğmeleri | ilgili `page.tsx` dosyaları | D (6 sayfa; kayip-kacak, eslestirme, abonelik, ayarlar ve admin hero'ları: A) |
| 7 | cuzdan | tümü | Hero'daki 3 sayı ve altındaki StatCard satırı aynı değerleri tekrarlıyor | P2 | tek 4'lü KPI satırı (bekleyen bakiye, bu ay, bu yıl tahsil, kayıt) | `cuzdan/page.tsx` | D |
| 8 | komisyon | 1440 | Toplam/tahsil/bekleyen iki kez (tüm zamanlar ve dönem) farklı stilde | P2 | iki grup aynı `KpiTile`; dönem grubu başlıklı kartta | `komisyon/page.tsx` | D |
| 9 | danisman-kpi, lig | 1440 | 1-2 kişilik podyum sola yığılı, sağda geniş boş alan | P2 | `podiumColumns(n)`: az kişide ortalanır, dar genişlik | `ui/dashboard-grid.tsx`, iki sayfa | D |
| 10 | danisman-kpi | 1440 | 2 rozet kartı 4 sütunlu ızgarada (yarı boş satır) | P2 | `kpiColumns(n)` | `danisman-kpi/page.tsx` | D |
| 11 | ekip (Genel) | 1440 | Rol karışımı halkası koyu hero içinde; iş yükü kartı ayrı, tam genişlikte | P2 | 12 kolonlu `DashboardGrid`: 5+7 eşit yükseklikli iki kart | `ekip/page.tsx` | D |
| 12 | hedefler | 1440 | Hedef kartları lg'de 3 sütun (1280 altında sıkışma) | P3 | `xl:grid-cols-3`, `items-stretch` | `hedefler/page.tsx` | D |
| 13 | cuzdan, komisyon, danisman-kpi vb. | 390 | KPI ızgaraları sayfaya göre 1/2/3/4 sütun (ritim yok) | P2 | `KpiGrid`: öğe sayısına göre yetim üretmeyen sütunlar, tek `gap-4` | `ui/dashboard-grid.tsx` | D |
| 14 | komisyon | 1440 | "Paylaşım analizi" kartı grafik kartı yüksekliğinde, altı boş | P3 | `items-stretch`; içerik az olduğunda doğal boşluk (sahte içerik eklenmedi) | `komisyon/page.tsx` | kısmen D |
| 15 | raporlar | 1440 | "Hacim dağılımı" tam renkli gradient çubuklar, 7 kısayol kartı (3+3+1) | P3 | kısayollar `kpiColumns`/3'lü; çubuk stili | `raporlar/page.tsx` | A |
| 16 | admin genel bakış | 1440 | Kart satırları farklı genişlikte (3'lü KPI, 957px'lik iki kart, yarım "Son hareketler"): sağ kenar ragged | P2 | `DashboardGrid` + `DashCell` ile 12 kolon (6+6, 4+4+4) | `admin/page.tsx`, `_dashboards/*` | A |
| 17 | admin/billing | 1440 | Abonelik/fatura satırlarında sütunlar hizasız | P3 | tablo kalıbı (`TableFrame`) | `admin/billing` | A |
| 18 | kayip-kacak | 1440 | Koyu hero + trend kartı; diğer sayfalardan farklı başlık | P2 | `PageHeader` + `KpiGrid` + trend kartı `DashCard` | `kayip-kacak/page.tsx` | A |
| 19 | app genel | 1440 | Üst sekme şeridi etiketleri kırpılıyor ("Rapor...", "Kayıp-...") canlıda | P2 | etiket yoğunluğu (aktif genişler, pasif ikon) kod tarafında zaten bu yönde; canlı sürüm eski olabilir, yeniden dağıtımdan sonra doğrulanmalı | `ui/morph-tab-parts.tsx` | A |
| 20 | /app | 390 | İlk ekran tamamen hero (CityNight) tarafından dolduruluyor; "bugün kuyruğu" ilk ekranda yok | P2 | DASHBOARD_SPEC B0: hero kaldır | `_home/hero.tsx` | A |
| 21 | /app | 1440 | "Bugün kuyruğu" ve "Randevular" kartlarında az satırla büyük boş alan | P3 | boş durum dikey ortala, kart yüksekliği içerik odaklı | `_home/bugun-ozet.tsx`, `randevular.tsx` | A |
| 22 | /app | 1440 | Satış hunisi yanında boş "Canlı akış" kartı | P3 | boş durumda yarı yükseklik | `_home/canli-akis.tsx` | A |
| 23 | komisyon | 390 | Hero KPI "₺1,5 Mn" kısaltması masaüstü tam değerle tutarsız | P3 | `MoneyValue` tam değer; `title` | `komisyon/page.tsx` | D (KpiTile satırı sarar) |
| 24 | ana sayfa/fiyatlar | 1440 | /fiyatlar üst menüsü ana sayfadan farklı (QA #3) | P2 | landing header ortak | `fiyatlar/page.tsx` | A |

Toplam: 24 bulgu; P1: 5, P2: 11, P3: 8 (D: 15 tam/kısmi, A: 9).

## Ortak yerleşim sistemi (yapılan)

- `src/components/ui/dashboard-grid.tsx`: `DashboardGrid` (1/6/12 kolon, `gap-4`, `items-stretch`), `DashCell` (md/xl span, çocuk yüksekliği doldurur), `DashCard` (tek kart yüzeyi, `p-4 sm:p-5`), `SectionHeader` (başlık + açıklama + eylem yuvası), `DashboardStack` (bölümler arası 24px), `KpiGrid` + `kpiColumns(n)` (yetim kart üretmeyen sütun düzeni), `podiumColumns(n)`.
- `KpiTile` (`ui/premium/kpi-card.tsx`): tek KPI kartı. `StatCard` (eski imza korunur) ve `KpiStrip` (liste kiti) artık bunu çizer; `KpiCard` `href` zorunlu sarmalayıcıdır. Etiket kırpılmaz (2 satır + `title`), grafik yalnız gerçek seride, `href` yoksa düz kart.
- `TableFrame`: geniş ekranda tablo kartı tam doldurur.
- Spacing ölçeği: kartlar arası 16px, bölümler arası 24px, kart iç boşluğu 16/20px.

## Başka ajanlarla çakışma riski

`ekip/page.tsx` ve `ekip/team-panels.tsx` (main'de AddMemberTrigger kaldırıldı; birleştirmede main sürümü esas alındı, yalnız yerleşim sınıfları yeniden uygulandı), `komisyon/page.tsx`, `hedefler/page.tsx`, `danisman-kpi/page.tsx`, `cuzdan/page.tsx` (yalnız hero/KPI sarmalayıcıları değişti; veri ve yetki mantığına dokunulmadı).

## Doğrulanamayanlar

- Düzeltmeler canlıda henüz yok; önce/sonra görüntüsü için sahte veriyle geçici önizleme yapılamadı (yerel prod sunucu `.env.local` kopyalanmadan çalıştırılamıyor).
- Koyu tema ve Gece Altın vurgusu canlıda sayfa sayfa taranmadı; yeni bileşenler yalnız token kullanır.
- 1024 ve 1920 genişlikleri ölçülmedi; kırılımlar (768/1280) üzerinden gözlendi.
