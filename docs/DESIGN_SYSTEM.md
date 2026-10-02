# Tasarım Sistemi Kılavuzu (v3 ortak bileşenler)

Amaç: sayfalar arası tutarlılık. Aynı iş için tek bileşen.

## Hangi bileşen ne zaman

| İhtiyaç | Bileşen | Not |
|---|---|---|
| Sayfa başlığı + eylem | `PageHeader` | Her sayfada bir tane |
| Özet sayılar | `StatRow` (`ui/stat-row`) | `href` zorunlu; 0 değer sönük ama tıklanabilir |
| Arama + durum sekmesi + filtre paneli + sonuç sayısı | `FilterBar` (`ui/filter-bar`) | Sunucu bileşeni, form GET, URL ile iki yönlü |
| Tarih aralığı | `DateRangeField` | FilterBar `panel` içinde kullan |
| Durum etiketi | `StatusBadge` (`ui/status-badge`) | Yalnız 3 anlam: `neutral`, `attention`, `success` |
| Boş liste/kart | `EmptyStateV3` | `inline` / `compact` / `full` |
| Serbest renkli etiket | `Badge` (eski) | Yeni sayfalarda StatusBadge tercih edilir |

## Sayfa şablonu

```tsx
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  // sunucu sorgusu aynı params'ı okur (q, durum, from, to, page)
  return (
    <>
      <PageHeader title="Müşteriler" actions={<Button>Yeni müşteri</Button>} />
      <StatRow items={[{ label: "Aktif", value: 42, href: "?durum=aktif" }]} />
      <FilterBar
        pathname="/app/musteriler"
        params={params}
        tabs={[{ label: "Aktif", value: "aktif", count: 42 }]}
        panel={<DateRangeField fromValue={String(params.from ?? "")} toValue={String(params.to ?? "")} />}
        panelParamKeys={["from", "to"]}
        resultCount={total}
        resultNoun="müşteri"
      />
      {rows.length ? <Liste /> : <EmptyStateV3 title="Müşteri bulunamadı" description="Filtreleri temizlemeyi deneyin." />}
    </>
  );
}
```

Saf mantık: `src/lib/ui/filter-params.ts` (`mergeParams`, `buildHref`, `countActiveFilters`, `formatCount`, `isRangeInvalid`).
Sekme linkleri mevcut parametreleri korur ve `page`'i sıfırlar. Panel alanlarına `name` ver; `panelParamKeys` o isimleri listeler.

## Yasaklar

- Bileşende `Date.now()` / `new Date()` — `src/lib/clock.ts` kullan.
- `text-xs` altı yazı, `rounded-[Npx]` (token: `--radius-control`, `--radius-card`).
- Ham renk/hex; token sınıfları kullan: `bg-surface`, `text-text`, `text-text-muted`, `border-line`.
- Üçten fazla rozet rengi; renk tek başına anlam taşımaz (metin/ikon şart).
- `href`siz KPI, sahte skor, sessiz boş durum.
- Dokunma hedefi 32px altı, odak halkasız (`focus-ring`) etkileşimli öğe.
- Dark modu bozan sabit `bg-white` / `text-black`.

## Tema sistemi (mod + vurgu)

Dosyalar: `src/app/tokens.css` (ham skala + semantik takma adlar + `@theme`), `theme-dark.css` (yalnız koyu değerler),
`themes.css` (vurgu temaları), `globals.css` (bileşen/yardımcı sınıflar). `globals.css` bilerek `@layer` içine sarılmadı:
mevcut kurallar katmansız (Tailwind yardımcılarını ezen) çalışıyor; sarmak görsel regresyon yaratırdı. Bölme `@import` ile,
kaskad sırası korunarak yapıldı.

**Seçim:** `html[data-theme="dark"]` (mod) + `html[data-accent="emerald|indigo|amber|graphite"]` (Okyanus = öznitelik yok).
Yalnız `/app` ve `/admin`; public vitrin/portallar hep açık ve marka renginde. Öznitelikleri yalnız `lib/theme.ts`
(`THEME_BOOT_SCRIPT` + `applyTheme`) yazar; test korur. Kalıcılık: `localStorage` + 1 yıllık çerez yedeği
(`es-theme`, `es-accent`). Boot script `<head>`'de bloklayıcıdır (FOUC yok); çerez SSR'da okunmaz, çünkü kök layout'ta
`cookies()` tüm public sayfaları dinamik yapar.

**Semantik token:** `--bg --surface --surface-2 --surface-raised --surface-sunken --text --text-muted --text-faint --border
--accent --accent-fg --accent-text --ring --success --warning --danger --info --heading`. Eski adlar (`--canvas --line --brand-*`)
takma ad olarak çalışır. Yeni kodda ham `--brand-*`, hex veya `bg-white` yok.

**Vurgu sözleşmesi (yalnız `--brand-*` ölçeği çevrilir):** `--brand-600` DOLGU (üzerinde beyaz yazı ≥4.5:1),
`--brand-700` METİN/bağlantı (`--surface` üzerinde ≥4.5:1; koyuda açık ton). Metin için `text-accent-text`, düğme için
`bg-accent` + `text-accent-fg`. Yeni vurgu eklemek: `themes.css` iki blok + `ACCENTS` tablosu; `design-tokens-contract.test.ts` AA'yi doğrular.

**Yüzey hiyerarşisi (yazılı kural):**
1. `--bg` sayfa zemini; 2. `--surface` kart/panel; 3. `--surface-raised` açılır katman (popover, dropdown, modal);
`--surface-sunken` gömülü alan (girdi içi, sekme çubuğu, ilerleme yatağı); `--surface-2` kart içi ikincil bölüm.
Bir yüzeyin içine aynı seviye yüzey konmaz (kart içinde kart yok; ayrım için `--border` veya `surface-sunken`).
Derinlik yalnız `--elev-1..5`: 1 kart, 2 hover/yapışkan bar, 3 popover, 4 modal, 5 komut paleti. Kenarlık `--border`
(belirgin: `--border-strong`), gölge yumuşak. Cam (`.glass-bar`, backdrop-blur) yalnız üst bar ve komut paletinde.

**Tipografi ve etkileşim:** `.type-display / .type-h1 / .type-h2 / .type-body / .type-small / .type-caption` (`--fs-*`);
rakamlar `tabular-nums` (`.numeric`, başlık sınıflarında otomatik). Basılı `scale: .98` yalnız
`prefers-reduced-motion: no-preference`; geçişler ≤150 ms. Odak halkası `--ring`; `forced-colors: active` bloğu mevcut.

**Kontrast (WCAG 2.1, ölçülmüş; test aynısını hesaplar):**

| Vurgu | Açık: beyaz/dolgu | Açık: metin/beyaz | Koyu: beyaz/dolgu | Koyu: metin/`#101a2e` |
|---|---|---|---|---|
| Okyanus | 4.93 | 6.77 | 4.93 | 7.40 |
| Zümrüt | 5.48 | 7.68 | 5.48 | 9.03 |
| İndigo | 6.26 | 7.45 | 6.26 | 8.71 |
| Kehribar | 5.02 | 7.09 | 5.02 | 10.40 |
| Grafit | 10.35 | 14.63 | 4.76 | 11.70 |

Metin tokenları: açıkta `--text-muted #5b6577` ≥4.9:1, `--text-faint #667085` ≥4.5:1; koyuda `--text-faint #7d8aa5` ≥4.6:1.

**Tercih DB'de (öneri, yazılmadı):** `profiles.ui_prefs jsonb` (`{theme, accent}`), girişte localStorage ile birleştirilir;
cihazlar arası senkron için gerekir. Şimdilik yalnız tarayıcıda kalıcı.
