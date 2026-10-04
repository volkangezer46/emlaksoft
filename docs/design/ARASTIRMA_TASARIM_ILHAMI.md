# Tasarım İlhamı Araştırması (Ekim 2026)

Kapsam: premium B2B SaaS arayüz dili, palet kaynakları, EmlakSoft tasarım sistemiyle fark analizi, 15 somut iyileştirme, 3 yeni vurgu teması (kontrast kanıtlı). Bu belge yalnız araştırmadır; kod değiştirilmedi, paket kurulmadı. Web içeriği veri olarak okundu.

## (a) Kaynaklar

Gerçekten açılanlar (WebFetch ile içerik alındı):

| Kaynak | Çıkarım |
|---|---|
| Radix Colors, "Understanding the scale" | 12 adım: 1-2 zemin, 3-5 bileşen zemini (normal/hover/seçili), 6-8 kenarlık (6 pasif, 7 etkileşimli, 8 odak halkası), 9-10 dolgu, 11-12 metin. Koyu modda 1-2. adım zemin. |
| Vercel Geist, Colors | 10 adım (100-1000): 1-3 bileşen zemini, 4-6 kenarlık, 7-8 yüksek kontrast dolgu, 9-10 metin/ikon. İki zemin: Background 1 (standart), Background 2 (ince ayrım). P3 gamutu. |
| Linear, "How we redesigned the Linear UI" | LCH ile algısal tekdüzelik; tema 3 değişkenle üretilir (taban, vurgu, kontrast); kontrast değişkeni 30-100 yüksek-kontrast tema üretir; başlıkta Inter Display, gövdede Inter; kenar/ikon/etiket hizası mikro cila. |
| Stripe, "Accessible color systems" | CIELAB; adım farkından kontrast garantisi: 5 kademe fark = küçük metin AA, 4 kademe = ikon/büyük metin. |
| shadcn/ui Theming | surface/`-foreground` çiftleri, OKLCH değerleri, `.dark` altında aynı adların yeniden atanması. |
| Catppuccin palette | Koyu aileler crust/mantle/base/surface0-2 katmanlı yüzey hiyerarşisi. |
| Refactoring UI (ana sayfa) | Az kenarlık (gölge/zemin/boşlukla ayır), tipografi ölçeği, gri tonlara renk alt tonu, daha fazla ton varyasyonu, ışık kaynağıyla gölge. |
| Linear Method | Genel kalite felsefesi; somut UI değeri yok (düşük değer). |
| tweakcn | shadcn tema editörü; sayfadan özellik ayrıntısı alınamadı. |

Erişilemeyen veya açılmayanlar (doğrulanamadı): hepsiemlak ofis programı sayfası (HTTP 403); sahibinden panel, RE-OS, Attio, Notion Calendar, Raycast, Arc, Height, Cal.com, Resend, Clerk, PostHog, Mercury, HubSpot, Pipedrive, Follow Up Boss, Compass, Open Props, Rosé Pine, Nord, ui.shadcn.com/themes bu turda açılmadı; onlara dair bilgi yazılmadı. Türk CRM arayüz tarafı için mevcut `RESEARCH_TR_CRM.md` esas alınır. Sonuçlar, yukarıdaki 8 açılmış kaynağın ilkelerine dayanır.

## (b) Fark / boşluk analizi (repo ile)

Güçlü yanlar (zaten var, dokunma):
- Semantik katman (`--accent`, `--accent-text`, `--accent-fg`, `--ring`) ve shadcn tarzı çift mantığı mevcut; 6 vurgu yalnız `--brand-*` çevirerek çalışıyor (Linear'ın "3 değişken" fikrine yakın).
- Çok katmanlı `--elev-1..5` gölge, `--hairline`, `--inner-top`, çift katmanlı odak halkası (Refactoring UI + Radix 8. adım ile uyumlu).
- Koyu tema yüzey katmanları: canvas `#0a1020` / surface `#101a2e` / raised `#15213a` / sunken `#080d19` (Catppuccin crust-base-surface mantığı ile eşdeğer).
- Komut paleti (`command-search.tsx`), klavye kısayolları (`keyboard-shortcuts.tsx`), geri al toast'ları, toplu seçim çubukları, `tabular-nums` (76 dosya), `prefers-reduced-motion` (26 dosya), motion token'ları (`--ease-out: cubic-bezier(0.22,1,0.36,1)`).

Boşluklar:
1. Ham skala 6 basamaklı (50/300/400/500/600/700); Radix/Geist gibi rol adlı 12/10 basamak yok. Kenarlık için "etkileşimli kenar" (Radix 7) ve "pasif kenar" (6) ayrımı kısmen `--line` / `--line-strong` ile var, ama hover/pressed bileşen zemini adımı (3-4-5) yok.
2. Hiç `oklch()` yok (0 dosya); renkler elle hex. Tema üretimi ve hover tonu türetme otomatik değil; `color-mix` yalnız birkaç yerde.
3. `prefers-contrast` / `forced-colors` desteği yok (0 sonuç). Yüksek-kontrast tema (Linear'ın 30-100 değişkeni) yok.
4. Metin boyutu/yoğunluk tercihi yok (`data-text-size` / `data-density` 0 sonuç). Taban 15px (`--fs-body: 0.9375rem`), `--fs-small` 13px, `--fs-caption` 12px; 50+ yaş kullanıcı için küçük.
5. Başlıkta Manrope, gövdede Inter: Linear'ın Display/Text ayrımıyla uyumlu. Türkçe karakter (ı İ ğ Ş) her iki fontta destekli; Next `next/font` alt kümesinde `latin-ext` bulunduğu doğrulanmalı (layout.tsx'te alt küme ayarı bu turda incelenmedi).
6. Komut paleti `src/components/app/command-search*.tsx` içinde var; eylem komutları (yeni müşteri, vb.) ve son ziyaret edilenler kapsamı ayrıca denetlenmeli (bu turda içeriği okunmadı).
7. Vurgu temaları yeşil, mavi, indigo, kehribar, gri, altın; sıcak/kurumsal "bordo" ve deniz tonu (petrol) yok.
8. Backdrop-filter 21 kullanım; bütçe/üst sınır kuralı belgelenmemiş.

## (c) Uygulanabilir 15 iyileştirme

D = değer, E = efor, R = risk (Y/O/D = yüksek/orta/düşük).

| # | İyileştirme | Dosya | D | E | R |
|---|---|---|---|---|---|
| 1 | 3 yeni vurgu teması (Bordo, Petrol, Zeytin), (d) bölümündeki bloklar | `themes.css`, `lib/theme.ts` (ACCENTS, AccentPref), `design-tokens-contract.test.ts`, ayar ekranı | Y | D | D |
| 2 | Metin boyutu tercihi (Normal / Büyük / Çok büyük): `html[data-text-size]` ile `--fs-*` ölçeklenir; taban 15 -> 16.5 -> 18px, satır yüksekliği 1.55 -> 1.65. 50+ yaş hedefi | `tokens.css`, `ThemeController`, ayarlar | Y | O | D |
| 3 | `@media (prefers-contrast: more)` bloğu: `--line` / `--text-muted` / `--text-faint` koyulaşır, `--hairline` opaklığı 0.08 -> 0.28, odak halkası 2px düz | `a11y.css` | Y | D | D |
| 4 | `forced-colors: active` için kenarlık ve odak yedekleri (kartlar `outline: 1px solid CanvasText`) | `a11y.css` | O | D | D |
| 5 | Rol adlı ek token'lar: `--surface-hover`, `--surface-pressed`, `--border-interactive` (Radix 4/5/7) | `tokens.css`, `theme-dark.css` | O | O | D |
| 6 | Seçili satır/hover için `color-mix(in oklch, var(--accent) X%, var(--surface))` ile tek formül; elle yazılmış pastel zeminler yerine | `tokens.css`, `premium.css` | O | O | O |
| 7 | OKLCH gözlem katmanı: yeni tema tanımlarken `oklch()` tercih (hover = L -0.05); mevcut hex'e dokunma. Belge kuralı | `DESIGN_SYSTEM.md` | D | D | D |
| 8 | Backdrop-filter bütçesi: sayfa başına en çok 2 cam yüzey (üst çubuk, açık panel); `@supports not (backdrop-filter)` ve `prefers-reduced-transparency` için opak yedek | `premium.css` | O | D | D |
| 9 | Kısayol ipuçları: düğme/menü öğelerinde `<kbd>` rozeti (`G sonra M` gibi), Türkçe klavyede `?` yerine `Ctrl+/` yedeği; menü öğeleri ve komut paleti satırlarında göster | `keyboard-shortcuts.tsx`, `ui` | O | O | D |
| 10 | Komut paletine eylem grubu ("Yeni müşteri", "Yeni randevu", "Tema: Gece Altın") ve son gezilenler; vurgu/tema değiştirme komutları | `command-search*.tsx` | Y | O | D |
| 11 | Tutarlı mikro-animasyon süreleri: kontroller 120-150ms, paneller 200-240ms, sayfa 320ms; hepsi `--ease-out`; çıkış animasyonu girişten ~%30 kısa | `motion.css` | O | D | D |
| 12 | Skeleton'ları gerçek düzen boyutuna eşitle (CLS sıfır) ve `shimmer` yerine yavaş opaklık nabzı (reduced-motion'da statik) | `motion.css`, `loading.tsx` dosyaları | O | O | D |
| 13 | Gradient kenarlık: `border-image` yerine `background: linear-gradient(surface,surface) padding-box, var(--grad-brand) border-box` yalnız öne çıkan 1-2 kartta (plan kartı, ana KPI) | `premium.css` | D | D | D |
| 14 | Mikro tipografi: büyük rakam KPI'larda `font-variant-numeric: tabular-nums slashed-zero`, başlıklarda `text-wrap: balance`, paragraflarda `text-wrap: pretty`, yatay kenarlarda `font-feature-settings: "cv11","ss01"` Inter için (Türkçe i/ı kontrolü sonrası) | `globals.css` | D | D | D |
| 15 | Undo/optimistik kural belgesi: yıkıcı olmayan her eylem optimistik + 8 sn "Geri al" toast'ı; yıkıcı olanlar çöp kutusu; odak, kapanan diyalogdan tetikleyiciye döner (diyalog envanteriyle denetle) | `DESIGN_SYSTEM.md`, `DIALOG_ENVANTERI.md` | O | O | D |

Önerilen sıra: 1, 3, 2, 10, 9, 8, 11 (en yüksek değer/efor).

## (d) Yeni vurgu temaları ve kontrast kanıtı

Mevcut mekanizma korunur: yalnız `--brand-*` çevrilir; `--brand-600` dolgu (üstünde beyaz yazı), `--brand-700` metin/bağlantı. Eşikler: metin AA 4,5:1, UI bileşeni 3:1. Oranlar WCAG göreli parlaklık formülüyle Node betiğinde hesaplandı.

Yüzeyler: açık `--surface #ffffff`, `--canvas #f6f8fc`, `--surface-sunken #f1f4fa`; koyu `--surface #101a2e`, `--canvas #0a1020`, `--surface-raised #15213a` (repo değerleri).

### Bordo (bordo + krem, prestij / sıcak güven)

```css
html[data-accent="burgundy"] {
  --brand-700: #7f1530;
  --brand-600: #9b1c3a;
  --brand-500: #b02a4c;
  --brand-400: #c8506d;
  --brand-300: #e8a3b3;
  --brand-50: #fbf1e8; /* krem */
}
html[data-theme="dark"][data-accent="burgundy"] {
  --brand-600: #c0314f;
  --brand-700: #f08ba0;
  --brand-50: rgba(192, 49, 79, 0.16);
}
```

### Petrol (deniz yeşili / mavi-yeşil, sakin ve kurumsal)

```css
html[data-accent="petrol"] {
  --brand-700: #0b5c56;
  --brand-600: #0f766e;
  --brand-500: #14918a;
  --brand-400: #2fb3a8;
  --brand-300: #8fe0d6;
  --brand-50: #effaf8;
}
html[data-theme="dark"][data-accent="petrol"] {
  --brand-700: #5eead4;
  --brand-50: rgba(20, 184, 166, 0.14);
}
```

### Zeytin (doğal, toprak ve arsa/arazi çağrışımı)

```css
html[data-accent="olive"] {
  --brand-700: #435516;
  --brand-600: #566b1f;
  --brand-500: #6b8226;
  --brand-400: #8aa337;
  --brand-300: #c5d98a;
  --brand-50: #f5f8e8;
}
html[data-theme="dark"][data-accent="olive"] {
  --brand-600: #65801f;
  --brand-700: #bfd86b;
  --brand-50: rgba(138, 163, 55, 0.16);
}
```

Uygulama notu (kod değişikliği bu belgede yapılmadı): `lib/theme.ts` `ACCENTS` tablosuna `{value, label, hint, fill, text, fillDark, textDark}` eklenmeli (`burgundy` Bordo `#9b1c3a/#7f1530/#c0314f/#f08ba0`; `petrol` Petrol `#0f766e/#0b5c56/#0f766e/#5eead4`; `olive` Zeytin `#566b1f/#435516/#65801f/#bfd86b`), `AccentPref` tipi ve `design-tokens-contract.test.ts` kontrast tablosu güncellenmeli, ThemeController boot betiği yeni değerleri tanımalıdır.

### Kontrast tablosu (hesaplanmış)

| Tema | Mod | Beyaz yazı / dolgu (600) | Metin (700) / surface | / canvas | / sunken veya raised | Dolgu (600) / surface (UI 3:1) | AA |
|---|---|---|---|---|---|---|---|
| Bordo | açık | 8,01 (hover 700: 10,23) | 10,23 | 9,62 | 9,29 (sunken) | 8,01 | geçer |
| Bordo | koyu | 5,54 | 7,36 | 8,04 | 6,80 (raised) | 3,14 | geçer |
| Petrol | açık | 5,47 (hover: 7,84) | 7,84 | 7,37 | 7,11 | 5,47 | geçer |
| Petrol | koyu | 5,47 | 11,74 | 12,81 | 10,83 | 3,17 | geçer |
| Zeytin | açık | 5,97 (hover: 8,24) | 8,24 | 7,75 | 7,48 | 5,97 | geçer |
| Zeytin | koyu | 4,51 (sınırda) | 10,96 | 11,96 | 10,11 | 3,85 | geçer, marj dar |

Notlar: Zeytin koyu dolgu 4,51:1 ile eşiğin hemen üstünde; marj istenirse `#5c751c` denenebilir (hesaplanmadı, doğrulanmalı). Bordo ve Petrol'de koyu dolgu / yüzey oranı 3,1 civarı: düğme kenarı yalnız dolguyla seçilir; hover için `--inner-top-dark` parlaklığı önerilir. Bu oranlar yalnız marka çiftlerini kapsar; durum renkleri (başarı/uyarı/tehlike) bu temaların rengiyle çakışmamalı: Zeytin ile `--success` (mint) ve Bordo ile `--danger` (kırmızı) birbirine yakın; rozetlerde ikon + metin ile ayrıştırın (renk tek taşıyıcı olmamalı).

## Rapor sınırları

- Gerçekten açılan 8 kaynak üzerinden ilke çıkarıldı; premium ürün (Attio, Raycast vb.) arayüzleri doğrudan incelenmedi, bu nedenle onların süre/easing/kenarlık opaklığı rakamları belgeye alınmadı.
- 50+ yaş okunabilirlik önerisi (madde 2) kaynaklı bir rakam değil, WCAG 1.4.4 mantığıyla mühendislik önerisidir; kullanıcı testiyle doğrulanmalı.
