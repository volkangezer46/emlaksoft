# Erişilebilirlik (WCAG 2.2 AA) ve Responsive Denetimi

Tarih: 3 Ekim 2026. Kapsam: liste ve detay sayfaları (müşteriler, portföyler, talepler, anlaşmalar, teklifler, sözleşmeler, randevular, görevler, kiralama, giderler, aidat, arama, gelen kutusu, ayarlar altı, destek, değerleme, sunumlar; 21 liste + 8 detay = 29 sayfa) ve ortak ui bileşenleri.

Yöntem: canlı site (https://emlaksoft.vercel.app), "Ofis sahibi" demo girişi, yalnız gezinme (veri yazma / Kaydet yok). Playwright + axe-core (wcag2a/2aa/21a/21aa/22aa + best-practice) 360 / 390 / 768 / 1024 / 1440 genişlikte; ölçümler: yatay taşma, 44 px altı etkileşimli öğe, adsız düğme/bağlantı, `th` scope, h1 sayısı, main sayısı, Tab ile odak halkası (1440 ve 390). Betikler: scratchpad `a11y/audit.cjs`, `sum.cjs`.

Not: Dikey sidebar, üst çubuk, kullanıcı menüsü, `nav-config` ve global font ölçeği başka ajanın alanıdır; bu belgede yalnız raporlanır (aşağıda "Çakışma / devredilen").

## Önce (canlı, düzeltme öncesi) — sayfa toplamı, 29 sayfa

| Genişlik | Yatay taşma | 44 px altı öğe (toplam) | Adsız düğme | axe düğüm (toplam) | h1 != 1 | Odak halkası yok |
|---|---|---|---|---|---|---|
| 360 | 1 (kiralama detay, +249) | 1365 | 112 | 446 | 0 | 0 |
| 390 | 1 (kiralama detay, +219) | 1372 | 112 | 451 | 0 | 2 |
| 768 | 1 (aidat, +160) | 1599 | 112 | 471 | 0 | 0 |
| 1024 | 1 (aidat, +160) | 4898* | 112 | 1048* | 0 | 0 |
| 1440 | 0 | 4965* | 112 | 1107* | 0 | 0 |

\* 1024/1440'ta sayı şişkinliğinin ana kaynağı kalıcı sol menüdür (satır 40 px, "sabitle" 28 px, bölüm daralt 32 px; her sayfada tekrar). Menü başka ajanın kapsamında; içerik alanı kendi başına çok daha düşüktür (içerik alanı: sayfa başına yaklaşık 4-130 öğe, en kötü görevler/müşteriler/gelen kutusu/talepler/anlaşmalar).

axe ihlal özeti (kural, ciddiyet, düğüm sayısı, sayfa sayısı):

| Kural | Ciddiyet | Not |
|---|---|---|
| color-contrast | serious | Çoğu sidebar yanlış-pozitifi (koyu zemin gradient). Gerçekler: sıfır değerli KPI kartı `opacity-70` (3.1:1), `text-mint-600` küçük metin (2.98:1), `text-amber-600` (3.44:1), bildirim rozeti beyaz/`danger-500` (3.9:1), Button `danger` (3.9:1) |
| target-size | serious | Anlaşma kartı rozetleri, görevler, arama sonucu, teklif ayrıntısı (24 px altı bitişik hedefler) |
| button-name | critical | /app/ayarlar/roller izin matrisi: 112 adsız onay düğmesi |
| aria-prohibited-attr | serious | /app/anlasmalar: sürükleme tutamağı `span aria-label` (rolsüz) |
| aria-allowed-attr | critical | musteriler, sozlesmeler: `<a aria-pressed>` |
| label | critical | gelen-kutusu: `from`/`to` tarih alanları etiketsiz |
| landmark-* | moderate | destek/[id]: `main` içinde ikinci `main` |
| scrollable-region-focusable | serious | ayarlar/guvenlik: kaydırılabilir kap klavyeyle odaklanamıyor |
| heading-order | moderate | giderler: h3, h2 yok |
| th scope | - | ayarlar/roller, guvenlik, degerleme tablo başlıkları (16 hücre) |

## Bulgular (sayfa x genişlik, ciddiyet, dosya)

| # | Ciddiyet | Sayfa / genişlik | Bulgu | Dosya | Durum |
|---|---|---|---|---|---|
| 1 | P1 | Tüm tablolu sayfalar, 390-1440 (aidat 768-1024; kiralama detay 360-390) | Tablo içindeki `absolute` öğeler (satır-bağlantı örtüsü `a.absolute inset-0`, `th > span.sr-only`) kaydırma kabının dışındaki konumlama bağlamına bağlanıp belgeyi yatay genişletiyor (scrollWidth 928 > 768) | `src/components/ui/table.tsx` (TableFrame kaydırıcı `relative`) | Düzeltildi |
| 2 | P1 | /app/ayarlar/roller, 360-1440 | 112 adsız izin hücresi düğmesi (ekran okuyucu "düğme" der); durum yalnız renk/ikon | `role-permissions-matrix.tsx`, `user-exceptions.tsx` (aria-label + aria-pressed, `th scope`, odak halkası, 44 px) | Düzeltildi |
| 3 | P1 | /app/gelen-kutusu | Tarih alanları etiketsiz | `gelen-kutusu/page.tsx` | Düzeltildi |
| 4 | P1 | /app/musteriler, /app/sozlesmeler | `<a aria-pressed>` geçersiz; "sıcak önce"/"yenileme" düğmesi durumu duyurulmuyor | `musteriler/page.tsx`, `sozlesmeler/page.tsx` (`aria-current`) | Düzeltildi |
| 5 | P2 | /app/anlasmalar | Sürükleme tutamağı rolsüz aria-label | `anlasmalar/deal-board.tsx` (`role="img"`) | Düzeltildi |
| 6 | P2 | /app/destek/[id] | İç içe `main` (landmark çakışması) | `destek/[id]/page.tsx` | Düzeltildi |
| 7 | P1 | Ortak: buton, liste araç çubuğu, filtre, sayfalayıcı, görünüm anahtarı, çipler, satır eylemleri, sekmeler, input/checkbox | Dokunma hedefi 28-40 px (xs 28, sm 32, md 40, satır eylemi 32, çip 32-36) | `button.tsx`, `list-kit/*`, `filter-bar.tsx`, `data-table.tsx`, `tabs.tsx`, `input.tsx`, `form-controls.tsx`, `checkbox.tsx` (`touch:` varyantı) | Düzeltildi (dokunmatik ve <768 px) |
| 8 | P2 | Ortak Tabs | Odak halkası yok (`outline-none`), sekme çubuğu taşıyor | `tabs.tsx` | Düzeltildi |
| 9 | P2 | Mobil giriş alanları | 14 px yazı iOS'ta odakta sayfayı yakınlaştırıyor | `input.tsx`, `form-controls.tsx`, `filter-field.tsx` (`touch:text-base`) | Düzeltildi |
| 10 | P2 | Kontrast (açık tema) | `text-mint-600`, `text-amber-600`, `bg-danger-500 text-white`, Button danger, sıfır KPI `opacity-70` | `src/app/a11y.css`, `button.tsx`, `list-kit/kpi-strip.tsx` | Düzeltildi |
| 11 | P2 | Windows yüksek kontrast | `.focus-ring` gölge tabanlı halka (`outline:none`); forced-colors'ta kaybolur; kartlar ve çipler kenarsız | `src/app/a11y.css` (outline `Highlight !important`, `CanvasText` kenar, seçili sekme anahatı) | Düzeltildi |
| 12 | P3 | prefers-reduced-motion | Global azaltma kuralı zaten var (globals.css); katman yinelendi, tüm animasyon/geçiş/scroll-behavior kapatılıyor | `src/app/a11y.css` | Doğrulandı + sertleştirildi |
| 13 | P3 | Tablo | Uzun metin kırpma, sabit ilk sütun yoktu | `table.tsx` (`TD truncate` + `title`, `TableFrame stickyFirst`) | Eklendi (opt-in; `stickyFirst` satır-bağlantı örtüsü olan tablolarda kullanılmamalı: sticky hücre örtünün konum bağlamı olur) |
| 14 | P2 | /app/ayarlar/guvenlik | Kaydırılabilir kap klavye odağı almıyor (`scrollable-region-focusable`) | `ayarlar/guvenlik/*` | Açık |
| 15 | P3 | /app/giderler | h3 öncesi h2 yok | `giderler/page.tsx` | Açık |
| 16 | P3 | ayarlar/guvenlik, degerleme | Başlık hücrelerinde `scope` eksik (elle yazılmış tablolar) | ilgili sayfa dosyaları | Açık |
| 17 | P2 | Tüm sayfalar (sidebar) | Menü satırı 40, sabitle 28, daralt 32, üst çubuk düğmeleri 40, "İçeriğe atla" 41 px; sidebar kontrast yanlış-pozitifi | `app-sidebar.tsx`, `nav-kit`, `user-menu` | Devredildi (nav/sade görünüm ajanı) |
| 18 | P2 | Yazı boyutu (Normal / Büyük / Çok büyük) | `html[data-font]` ölçeği | `globals.css` font ölçeği | Devredildi; bu ajanın bileşenleri rem/`min-h` kullandığı için ölçekle büyür (sabit px yükseklik yok, yalnız `h-*` alt sınırları) |
| 19 | P3 | Tablolar mobilde | Kart listesi yerine kaydırılabilir kap + `touch:` hedefler; tam kart dönüşümü tablo başına özel iş | liste sayfaları | Açık (öneri: görev/müşteri/portföy `RowCard` varyantı) |

## Filtre paneli (mobil)

`ListToolbar` ve `FilterBar` zaten `<details>` ile sayfa içi açılır paneldir (popup değil): mobilde akış içinde, `sm+` mutlak konumlu. Bu çalışmada yalnız dokunma yüksekliği ve yazı boyutu düzeltildi.

## Doğrulama

Yeniden ölçüm (düzeltme sonrası) canlıya yayın gerektirir: Vercel `main` deploy edilmeden canlı site aynı sayıları verir. Yerelde tsc, eslint, vitest (design-tokens ve contract testleri) çalıştırıldı; sonuçlar commit mesajında ve görev raporundadır. Playwright ile "sonra" ölçümü deploy sonrası `node audit.cjs` ile tekrarlanmalıdır.
