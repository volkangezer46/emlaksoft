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

## DataTable (premium liste tablosu)

`ui/data-table.tsx` — Server Component'ten çağrılır; kolonlar bildirimseldir (`format`), render fonksiyonu yoktur.
Aşağıdaki özelliklerin HEPSİ opt-in; hiçbiri verilmezse davranış eskisiyle birebir aynıdır. Saf mantık `ui/data-table-logic.ts` (testli).

| Prop | Etki |
|---|---|
| `densityToggle` + `defaultDensity` | Rahat 44 / Normal 40 / Sıkı 32px anahtarı (`aria-pressed`). Sıkı'da alt satır gizlenir. |
| `storageKey` | Yoğunluk ve gizli sütunlar `localStorage`'da kalır (`<key>:density`, `<key>:columns`; try/catch, hydration güvenli). Tabloya özgü benzersiz ad ver. |
| `columnMenu` | "Sütunlar" menüsü; ilk sütun ve `pinned` sütunlar gizlenemez. |
| `stickyHeader` | `true` → kap 70vh, başlık yapışır; string ile özel `max-height`. |
| `selectable` + `bulkActions` | Onay kutusu sütunu (sayfa için tümünü seç, ara durum) + alt yapışık "N kayıt seçili" çubuğu. `bulkActions` bir ELEMENT'tir; içindeki client bileşen `useDataTableSelection()` ile `selectedIds`/`clear` alır. Yalnız `id` alanı olan satırlar seçilir. |
| `keyboardNav` | Satır `tabIndex` ile roving odak: ↑/↓, `j`/`k`, Home/End, PageUp/Down gezinir; Enter satır linkini açar; Space seçer (`selectable` ise); Esc seçimi temizler. Odak halkası `outline` ile. |
| `revealRowActions` | `rowActions` yalnız hover / satır odağı / dokunmatikte görünür (Attio tarzı). |
| `mobileCards` | ≤640px'de tablo yerine kart listesi. `column.priority`: `primary` (kart başlığı, varsayılan ilk sütun), `secondary` (etiketli satır, varsayılan), `hidden`. |
| `loading` / `loadingRows` | Gövde yerine iskelet satırlar (`aria-busy`). |
| `empty` | `{ title, description, icon, action }` — EmptyStateV3 (`bare`) ile gösterilir; arama boşluğunda "Aramayı temizle" eylemi otomatik. |
| `caption` | Ekran okuyucu için tablo adı. |

Kural: yeni tablo sayfasında `keyboardNav`, `densityToggle` + `storageKey` ve çok sütunlu ise `columnMenu`/`mobileCards` açılması önerilir.
