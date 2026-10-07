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
| Boş liste/kart | `EmptyState` (`ui/empty-state`; `EmptyStateV3` eski ad) | `inline` / `compact` / `panel` / `full` |
| Serbest renkli etiket | `Badge` (eski) | Yeni sayfalarda StatusBadge tercih edilir |
| Panel KPI kartı | `KpiCard` + `KpiGrid` (`ui/kpi-card`) | `href` zorunlu; `layout="inline"`, `tinted`, `trend`; iskelet `KpiGridSkeleton` |
| Grafik / panel kartı | `ChartCard` (`ui/chart-frame`) | ikon karosu, `aside`, `href`, `loading`, `empty` |
| Zaman serisi (para/oran) | `AreaTrendChart` (`ui/lazy-charts`) | son nokta etiketi, kesikli tahmin; ipucu TEK `ChartTooltip` |
| "Şimdi ne yapmalıyım" kuyruğu | `AttentionList` (`ui/attention-list`) | Acil/Yüksek/Orta/Düşük; `children` = öneriler |
| Öneri / içgörü | `InsightCard` + `InsightSection` (`ui/insight-card`) | Ertele/Yoksay `actions` yuvası |
| Panel karşılama | `DashboardHero` (`ui/dashboard-hero`) | tek h1; özet KPI tekrarlamaz; `aside` = dönem seçici |
| URL filtresi segmenti | `SegmentedControl` (`ui/segmented-control`) | seçenekler bağlantıdır; kayan hap |
| Durum mini kartı | `StatusTile` (`ui/status-tile`) | ilerleme yalnız gerçek pay ile |
| Görünürlükte giriş / içerik geçişi | `Reveal`, `Stagger`, `FadeSwap` (`ui/motion`) | ilk ekranın ALTINDA; reduce'ta durağan |

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
## Tasarım sistemi v4 (2026-10-06): tek dil, /admin kontrol paneli referans

Dil: Linear + Stripe + Vercel + sakin fintech; açık tema ağırlıklı (koyu yalnız /app ve /admin). Lacivert marka zemini
(yan menü), beyaz/açık mavi yüzeyler, kontrollü altın (para, premium an, aktif işaret çizgisi). Hiyerarşi boşluk ve
tipografiyle; renk anlam taşır, süs değildir. Referans uygulama: `src/app/admin/page.tsx` (+ `_dashboards/*`).

### Token katmanı (tek kaynak `src/app/tokens.css`)

| Grup | Token | Not |
|---|---|---|
| Lacivert (değişmez) | `--navy-950..600`, `--grad-navy` | Koyu temada ve `.theme-dark` kapsamında yeniden tanımlanmaz; sabit lacivert gereken her yer bunu kullanır (ham hex yok, sözleşme testi) |
| Altın | `--gold-200..700`, `--gold-ink` (altın dolgu üstü metin) | metin olarak `--pm-gold-text` (AA) |
| Durum metni | `--pm-success/warn/danger/gold-text` | koyu karşılık `theme-dark.css` ilk blok |
| Boşluk | `--space-1..12` (4 px tabanlı: 4, 8, 12, 16, 20, 24, 32, 40, 48, 56, 64, 80) | bileşen iç boşluğu `.ds-pad` = `--space-4/5` |
| Gösterge tipografisi | `--fs-eyebrow`, `--fs-kpi`, `--fs-kpi-lg`, `--fs-money-hero`, `--tracking-eyebrow` | gövde ölçeği `--fs-*` |
| Gölge | `--elev-1..5`, `--card-shadow`, `--card-shadow-hover` | koyuda koyu gölge + ince üst ışık |
| Kabuk | `--sb-bg-top/mid/bottom` (yan menü), `--nav-badge-*`, `--hero-art` | koyuda menü bir ton derin |
| Radius | `--radius-chip/control/card/panel/hero` (`@theme`) | |
| Hareket | `--motion-*`, `--ease-*` | TEK tanım `motion.css` (sözleşme testleri oradan okur); TS karşılığı `ui/motion/tokens.ts` (test eşitler) |

### Kanonik bileşenler

Hepsi `src/components/ui`; ton/ikon karosu mevcut `.pm-t-*` + `.pm-ico` (yeni ton sınıfı yazılmaz), kart/satır/hap CSS'i
`premium.css` "Tasarım sistemi v4 (ds-*)" bölümünde. Eski adlar ince sarmalayıcı/yeniden dışa aktarım olarak çalışır:
`StatCard` → `KpiTile`; `ChartFrame` = `ChartCard`; `app/_ui/lazy-chart` → `ui/lazy-charts`; `EmptyStateV3` ve
`components/app/empty-state` → `ui/empty-state`; `components/app/skeleton` → `ui/skeleton`; admin `CountUp`/`OdometerNumber` → `ui/count-up`.

- **KpiCard / KpiGrid:** tek uygulama `KpiTile`. `layout="inline"` (ikon solda, etiket, büyük tabular değer + trend hapı,
  alt metin), `tinted` (tonun hafif degradesi + tonlu kenar), sayaç `CountUp` (ilk görünümde bir kez, reduce'ta anında).
  Trend yalnız gerçek önceki değerle (`computeTrend`); önceki yoksa hap yok.
- **ChartCard:** başlık şeridi (ikon karosu, başlık, alt başlık · dönem, `aside`, `action`, ayrıntı bağlantısı), gövde
  `loading` iskeleti veya `empty` anlamlı boş durum. `height={0}` serbest yükseklik.
- **ChartTooltip:** TEK ipucu (recharts'sız modül); her Recharts grafiği bunu kullanır. **AreaTrendChart:** altın (para) /
  mavi seri, degrade dolgu, son gerçek noktada halka + değer etiketi, kesikli TAHMİN uzantısı, `animationKey` ile
  yeniden çizim (500 ms ease-out), sr-only veri tablosu. Recharts yalnız tembel kapıdan (`ui/lazy-charts`).
- **AttentionList:** önem dört düzey (Acil/Yüksek/Orta/Düşük; hap metni + ikon), satır tamamı filtreli hedef, boş durum,
  `children` yuvası (öneriler). **InsightCard:** başlık hedefe, neden, kanıt, önem/tahmin etiketi, Ertele/Yoksay.
- **DashboardHero:** üst tarih satırı, selamlama (tek h1), tek cümle özet (KPI'ları TEKRARLAMAZ; en öncelikli işi adıyla
  ve bağlantısıyla söyler), tazelik, sağda dönem seçici; soluk mavi izometrik `CitySkyline`.
- **SegmentedControl:** URL filtre kontratı (seçenek = bağlantı, JS'siz çalışır); tıklayınca hap anında kayar (CSS
  transform, `--ease-spring`). `motion` layoutId KULLANILMAZ (domMax +~25 KB gerektirir).
- **StatusTile:** durum noktası + etiket, değer, alt metin, isteğe bağlı ilerleme çubuğu (`role="meter"`).
- **İllüstrasyon:** `CitySkyline` (hero), `ev`, `anahtar`, `haritaPin` (+ mevcut `liste`, `basari` …); hepsi
  `currentColor` + token, < 6 KB.
- **Kabuk:** iki yan menü + çekmece `.sb-surface` (lacivert degrade); aktif öğe DOLGULU vurgu hapı (beyaz yazı
  `--accent` üstünde AA) + kayan altın çizgi. Durum bilgisi KART DEĞİL ÇİP: /admin üst çubukta `SystemStatusChip`
  (`getAdminHealth`), /app yan menü altında `OfficeStatusChip` (nokta + paket + deneme günü / en dolu kullanım yüzdesi +
  ince çubuk; daraltılmış menüde yalnız nokta; tıklayınca popover: paket, kullanım kalemleri, "Paketi yönet"; saf karar
  `lib/app-shell/office-status.ts`). Yan menüde arama kutusu YOK (üst çubuk Ctrl K tek arama). Üst çubuk: ev ikonlu konum
  şeridi, yuvarlak arama kapsülü (Ctrl K), dolgulu "Hızlı erişim", kompakt skor hapı, zil, `UserMenuFace` (tek yüz).
  Bilgi şeridi (MFA/geliştirme modu) içerikte yuvarlak `tone-warning` kart.
- **ScopeSwitch (`ui/scope-switch`):** "Ofis geneli | Benim işlerim" (Building2 / User), `.ds-seg` ailesi, kayan hap,
  altında tek satır açıklama, `role=radiogroup` + `aria-checked` + ok tuşları; URL `?kapsam=` + son seçim çerezi `es_scope`
  (`lib/ui/scope.ts`: URL > çerez > "ben"; yönetim rolü değilse daima "ben"). Yalnız yönetim rollerinde çizilir.

### Kurumsal yoğun ölçek ve yerleşim (2026-10)

| Öğe | Normal (kök 15 px) | Kaynak |
|---|---|---|
| Kök yazı | %93,75 (Küçük %87,5, Büyük %112,5 = erişilebilirlik, 44 px dokunma) | `console.css` + `lib/font-scale.ts` |
| Gövde / küçük / en küçük | 14 / 13 / 12 px (12'nin altı yok, `max(12px, …)`) | kabukta `--text-base/sm/xs` |
| Sayfa başlığı (`PageHeader` h1, `text-2xl`) | 20 px | `--text-2xl` |
| Hero selamlaması | 21-26 px (mobil 21) | `.ds-hero-title` |
| KPI sayısı | ~24 px (`--fs-kpi`), büyük ~26 px | `.pm-value` |
| Kart başlığı | 14 px (`SectionHeader` `text-base`) | |
| Düğme / girdi | 34 px (`md`), girdi `py-[0.4375rem]`; dokunmada 44 px | `button.tsx`, `input.tsx` |
| Yan menü öğesi | 13 px / 34 px | `.nav-row lg:min-h-9` |

- **Genişlik:** /app ve /admin içerik izi `minmax(0,1600px)` ve ortalı (`justify-center`); liste/tablo bu sınırda tam
  genişlik. Form sayfası `FormPage` `max-w-4xl` ortalı. `PageHeader` eylemleri başlık satırıyla aynı hizada.
- **KpiGrid (TEK, `ui/dashboard-grid`; `ui/kpi-card` yeniden dışa aktarır):** esnek satır (`.kpi-flow`): satır başına
  `--kpi-cols` kart (`kpiFlowCols(n)`: mobil 2; 5 → xl'de 5, 6 → xl'de 6, 7+ → md'de 4), `flex-grow` son satırı eşit
  genişlikte doldurur → yarım/boş hücre yok, tek kalan kart tam genişlik; boşluk tek token `--kpi-gap`; dar kartta
  (< 11,5 rem, container query) ikon karosu gizlenir. Sabit `grid-cols-4/5/6` KPI şeridi YAZILMAZ.
- **DashboardGrid:** doğrudan `DashCell` çocuklarının span'ları her kırılımda `fillRowSpans` ile satırı tamamlar
  (md'de 3+3+3 → 3+3+6, tek kalan 7 → 12); `span.xxl` ile 2xl (1536+) ayrı düzen.

### Hareket katmanı (`src/components/ui/motion`)

- `motion` paketi YALNIZ `LazyMotion` (strict) + `domAnimation` (ayrı parçada tembel) + `m.*`; `MotionConfig
  reducedMotion="user"`. İçe aktarım yalnız bu klasörde (sözleşme testi `motion-layer.test.ts`). Lottie ve GIF YOK.
- `Reveal` / `Stagger`: sunucu çıktısı görünür; yalnız ekranın ALTINDAKİ öğe kurulur ve kaydırınca bir kez belirir
  (opacity + 8 px, 320 ms; stagger 40 ms, ≤ 12 öğe; motion `m.*`). `FadeSwap`: `?donem=` gibi URL filtresi değişince
  yeni içerik girişi (motion.css `.motion-swap`, 0 KB; AnimatePresence çıkış animasyonu ilk yüke ~10 KB ekliyordu, ölçülüp
  bırakıldı). Arama parametresi değişimi sayfayı yeniden bağlamaz (Next template belgesi). Sayfa geçişi /app ve /admin `template.tsx` ortak `<ViewTransition>`.
- Mikro etkileşim: tıklanabilir kart 2 px yükselir + gölge bir kademe (140 ms), yalnız `prefers-reduced-motion:
  no-preference` ve `hover: hover`; taban `:hover` kuralı hareketsizdir.
- Hareketli degrade YALNIZ `DashboardHero` (`.ds-hero-ambient`, transform, 18 sn alternate; ekran dışında ve sekme
  gizliyken `animation-play-state: paused`, reduce'ta hiç yok). Sonsuz döngünün diğer tek istisnası canlı göstergeler
  (canlı saat, "Çevrimiçi" noktası).

## Premium etkileşim kiti (2026-10-07): düğmeler, satır içi seçici, satır içi kaydetme, admin liste deseni

CSS tek dosya `src/app/kit.css` (globals.css'ten yüklenir, kurallar `@layer components` içinde → `className`
yardımcıları her zaman ezer). Renk yalnız token; hareket yalnız `prefers-reduced-motion: no-preference` içinde.
Referans uygulama: `/admin/tenants`.

### Premium düğme sistemi (`ui/button.tsx`, geriye uyumlu)

| Varyant | Görünüm | Ne zaman |
|---|---|---|
| `primary` | mavi degrade (taban `--accent`, renksiz ışık/gölge katmanı) + üst iç parlama + renkli taban gölgesi | sayfanın TEK birincil eylemi ("+ Yeni ofis") |
| `navy` | lacivert degrade (`--navy-*`, iki temada aynı) | satır içi kalıcı onay ("✓ Kaydet") |
| `gold` | yumuşak altın, metin `--pm-gold-text` (AA) | premium an / içeri girme ("→ Ofise gir") |
| `outline` | beyaz yüzey + ince kenar + yumuşak gölge | ikincil ("⚙ Yönet", "Excel'e aktar") |
| `secondary` / `ghost` | eski ikincil / saydam | mevcut ekranlar; ikon düğmeleri (⋮, ↺) |
| `danger` | kırmızı degrade | geri dönüşü zor eylem, satır içi risk onayı |

Boylar `xs/sm/md/lg` + `icon` (kare; `aria-label` zorunlu). `loading`: sol ikon spinner'a döner, METİN KORUNUR
(genişlik zıplamaz), `aria-busy`. Hover 1 px yükselme + gölge (yalnız no-preference + hover:hover), basılı iç gölge,
odak halkası `--focus-ring`. Pasif: opaklık yerine sönük yüzey (`--surface-sunken`, `--text-muted`) → düşük kontrast
ama okunur. Düğme olmayan öğeye aynı görünüm: `buttonClass({ variant, size })`. Taban renk `background-color`
olduğundan `<Button className="bg-mint-600">` gibi ton ezmeleri çalışır.

### InlineSelect (`ui/inline-select.tsx`)

Tablo hücresi seçicisi: rozet/ikon görünümlü tetik (`pm-t-*` tonu, ikon, etiket, ok) + portal liste (tablo
`overflow` kabı kırpmaz). Radix Select: ok tuşları, Home/End, harfle arama, Esc, odak dönüşü, combobox/listbox rolleri.
`changed` → tetiğin köşesinde amber "değişti" noktası (+ aria-label'a "değişti, kaydedilmedi"). `name` verilirse gizli
native select üretir (FormData). Seçenek ikonları istemcide tanımlanır (fonksiyon sunucudan geçemez). Native `<select>`
yalnız form sayfalarında kalır; tablo satırında InlineSelect kullanılır.

### Satır içi kaydetme standardı (tüm satır içi düzenlemeli tablolar; /app dahil)

Parçalar: saf durum makinesi `src/lib/ui/row-draft.ts` (+ test), hook `src/lib/ui/use-row-draft.ts`
(`useRowDraft`), görünüm `ui/row-save-actions.tsx` (`RowSaveActions`, `rowDraftProps`), tablo sarmalayıcı
`ui/draft-table.tsx` (`DraftTable`), kirli satır deposu `src/lib/ui/row-draft-store.ts`.

1. Kaydet başlangıçta PASİF. Yalnız gerçek değişiklikte AKTİF: "kirli" = taslak ≠ kayıtlı DEĞER (aynı değere dönülürse
   yeniden pasif; tıklama sayılmaz).
2. Geçersiz seçimde PASİF + neden satır altında (`validate` saf fonksiyon, ör. `lib/admin/tenant-row-rules.ts`
   "Askıdaki ofise paket atanamaz"). Sunucu kendi kurallarını yine uygular.
3. Kaydederken: spinner + "Kaydediliyor…", satırın seçicileri kilitli (`draft.locked`), çift gönderim yok.
4. Başarı: ≈1,5 sn "✓ Kaydedildi" (ikon girişi reduce'ta animasyonsuz) → yeniden pasif; kayıtlı değer taslağa eşitlenir.
   Hata: mesaj satırda (`role="alert"`), taslak korunur, Kaydet aktif kalır.
5. Kaydedilmemiş ipucu: satır solunda 3 px amber şerit (`tr[data-dirty="1"]`), değişen hücrede amber nokta, düğme
   yanında "Kaydedilmemiş" etiketi, `aria-live` duyurusu.
6. Gelişmiş: ↺ Vazgeç (kirli satırda); 2+ kirli satırda tablonun üstünde yapışkan çubuk "N satırda kaydedilmemiş
   değişiklik · Tümünü kaydet · Tümünü geri al" (sıralı kayıt; riskli satırlar kendi onayında bekler); kirli satır varken
   `beforeunload` + iç bağlantı tıklamasında onay; riskli değişiklik (`risk`: askıya alma, iptal, paket düşürme,
   pasifleştirme) kaydederken satır içi onay adımı (ConfirmDialog YOK); klavye: satırda Enter = kaydet (kapalı seçicide
   Enter listeyi açmaz, kaydeder), Esc = vazgeç / onayı kapat; açık listede tuşlar listeye aittir.
7. Eşzamanlılık: `version` (ör. `updated_at`) verilirse ve satır kirliyken sunucu değeri değişirse satır "bayat" olur:
   kayıt engellenir, "Bu satır başkası tarafından güncellendi — Yenile". Sunucu tarafı isteğe bağlı denetim:
   `updateTenantPlanStatus` `expected_updated_at` alırsa yazmadan önce karşılaştırır (`code: "stale"`).

```tsx
const draft = useRowDraft({ id, label: name, saved: { status, plan }, version: updatedAt, validate, risk, save });
<tr {...rowDraftProps(draft)}>
  <td><InlineSelect value={draft.draft.status} onValueChange={(v) => draft.set("status", v)} changed={draft.changed.has("status")} disabled={draft.locked} … /></td>
  <td><RowSaveActions draft={draft}>{/* Yönet, Ofise gir, ⋮ */}</RowSaveActions></td>
</tr>
```
Uygulananlar: `/admin/tenants` (durum + paket), `/admin/members` (rol + aktif/pasif), `/admin/personel` (rol + durum).

### Admin liste deseni (`components/admin/admin-list.tsx`, kit.css `.adm-*`)

Hero bandı (`AdminPageHeader` + `art` = `HeroArt` konu figürü + isteğe bağlı `note` gerçek veriden kısa not) →
`KpiGrid` (boşluksuz; seçili süzgecin kartı `tinted`) → 1-2 `ChartCard` (sunucu-güvenli `viz/BarColumns`,
`viz/DonutBreakdown`; her sütun/dilim/lejant satırı filtreli listeye bağlantı) → `AdminListCard` (arama + hızlı
süzgeç çipleri gerçek sayılarla + bilgi satırı; etkin süzgeç çipleri × ile) → `.adm-tbl` (yapışkan başlık, satır
hover vurgusu, tutarlı satır yüksekliği, satır sonu eylem grubu + ⋮ menü). Dar kapta (`.adm-cq` container, 76 rem
altı) eylem metinleri gizlenir (ikon + erişilebilir ad kalır), 70 rem altı ikincil sütun (`data-col`) kimlik hücresine
geçer → 1366 px'te yatay kaydırma yok. 768 px altında satırlar karta dönüşür (`data-label` hücre etiketi; ikinci liste
çizilmez). `HeroArt` türleri: office, users, invoice, support, shield, rocket, coins, ai, megaphone, pulse, layers, coupon
(`ui/illustrations/hero-art.tsx`, token renkli, ≤4 KB gz, test).

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

## İletişim alanları (telefon / e-posta)

Sistemin tamamında telefon ve e-posta girişi tek tiptir; yeni formlarda da aynısı kullanılır.

- **Telefon:** `PhoneInput` (`src/components/ui/phone-input.tsx`) ZORUNLU. Solda ülke seçici (varsayılan Türkiye,
  `defaultCountry` ile değişir), sağda yalnız rakam kabul eden ulusal numara alanı. `+90` / `0090` / `+49`
  yapıştırılırsa ülke otomatik seçilir. Form'a giden `name` değeri SAKLAMA BİÇİMİdir (gizli input).
- **E-posta:** `EmailInput` (`src/components/ui/email-input.tsx`) ZORUNLU. `type=email`, odak çıkınca kırpar + küçük harf,
  geçersizse `Geçerli bir e-posta adresi girin`. Mevcut görünümü korumak için `className` geçilir (yoksa `fieldClass`).
- **Saklama biçimi (DB):** Türkiye cep `05XXXXXXXXX`, Türkiye sabit `0XXXXXXXXXX` (geriye uyumlu); yabancı `+<E.164>`
  (örn. `+4915123456789`). E-posta normalize (kırpılmış, küçük harf). Görüntüleme: `formatPhoneDisplay`
  (`0532 123 45 67`, `+49 151 2345 6789`). Dış servisler: `toWhatsAppLink`, `toWhatsAppMsisdn`, `toTelHref`,
  `toE164Phone` yabancı numaraları da doğru işler. Ham `type="tel"`/`type="email"` input yazma.
- **Ülke kuralı (tek merkez):** `src/lib/phone-rules.ts` (libphonenumber-js/min). PhoneInput onu dinamik import eder
  (ilk yük JS'ine girmez); yüklenene kadar `phone-countries.ts` tablo sınırları geçerlidir. Davranış: ülkeye göre canlı
  biçim (TR `0544 634 64 44`), ülkenin en uzun uzunluğunu aşan rakam yazılmaz (yapıştırma kırpılır, `role="status"`
  uyarısı: "Türkiye numarası en fazla 10 hane olabilir (başındaki 0 hariç); fazlası silindi"), harf atılır ("Yalnız rakam
  girilebilir"), ülke değişiminde numara korunur, uyumsuzsa ülkeye özel hata gösterilir.
  Dar kolonda sarma (container query) korunur; bileşeni kopyalama.
- **Sunucu kapısı:** telefon kaydeden her action `parsePhoneStrict` (veya `phoneSchema`/`optionalPhoneSchema`) kullanır; TR'de
  11+ hane, harf, geçersiz alan kodu reddedilir. İçe aktarma (`import-rows.ts`) aynı kuralla satır hatası üretir.
- **Sunucu doğrulayıcıları:** `src/lib/validation/contact.ts` — `phoneSchema`, `optionalPhoneSchema`, `emailSchema`,
  `optionalEmailSchema` (zod; telefon çıktısı saklama biçimi, boş isteğe bağlı -> `null`). Her action telefon/e-postayı
  bunlarla (veya `parsePhone`/`isValidPhone`/`normalizeEmail`/`isValidEmail` ile) doğrular; `formData.get("phone")`
  değerini doğrulamadan DB'ye yazma. Saf mantık: `src/lib/phone.ts`, `src/lib/phone-countries.ts`, `src/lib/email.ts`.
- **Sözleşme testi:** `src/lib/contact-input-contract.test.ts` ham telefon/e-posta input'unu ve doğrulayıcısız action'ı
  yakalar. Kalan eski ihlaller testteki `ALLOWLIST`'tedir ("rollout bekliyor"); bir dosya düzelince listeden SİLİNİR
  (eskimiş girdi testi kırar). Yeni girdi eklemek yerine `PhoneInput`/`EmailInput` kullan.
## Premium konsol

Lacivert + altın "konsol" görünümü; `/app` ana ekranı ve (sonraki adımda) `/admin` genel bakışı bunlarla kurulur.
Kod: `src/components/ui/premium/*` (içe aktarma: `@/components/ui/premium`), stiller: `src/app/premium.css`.
Hepsi sunucu bileşeni (istemci JS yok), saf SVG, yeni bağımlılık yok, token renkli, koyu temada uyumlu.

| Bileşen | Ne yapar | Önemli prop |
|---|---|---|
| `KpiCard` | Beyaz kart: ikon rozeti, başlık, sağ ok, değer, `TrendPill`, önceki dönem metni, alt grafik | `href` ZORUNLU, `tone`, `trend`, `previousText`/`hint`, `series` + `chart` (`line`/`bars`) |
| `Sparkline` / `MiniBars` | Saf SVG; `role="img"` + `aria-label` (özet otomatik) | `data` (en az 2 sonlu nokta, yoksa HİÇBİR ŞEY çizmez), `tone`, `unit`, `label` |
| `TrendPill` | Yön oku + yüzde; iyi yeşil, kötü kırmızı, düz nötr, "yeni" altın; sr-only cümle | `trend` = `computeTrend(cari, önceki, invert?)` |
| `PeriodToggle` | 7/30/90 gün segmenti, URL `?donem=` ile iki yönlü (bağlantı üretir, JS yok) | `current`, `basePath`, `params` |

Kurallar:

- **Uydurma çizim yok:** grafik yalnız gerçek geçmiş seriden çizilir; seri yoksa `series` verilmez ve kart grafiksiz kalır.
  Önceki dönem 0 iken sahte yüzde yoktur (`computeTrend` "yeni" / "%0" döner).
- **Sıfır çıkmaz metrik:** `KpiCard` ve `GlassKpi` için `href` zorunludur.
- **Dönem seçici dürüstlüğü:** `PeriodToggle` yalnız seçimin veriyi gerçekten etkilediği ekranda gösterilir; sayfa
  `parsePeriod(searchParams.donem)` ile okuyup sorguya uygular. Ana ekranda etkilenenler: hero özet cümlesi ve
  "Yeni müşteri / Yeni talep" kartları (`loadPeriodStats`).
- **Saf mantık** `premium-math.ts` içinde (sparkline yolu, çubuk geometrisi, trend, dönem, kovalama) ve birim testlidir.
- **Hero ve yan menü iki temada da lacivert** kalır; metin sabit beyaz/altın (`--gold-300`). Kontrast
  `design-tokens-contract.test.ts` "premium konsol paleti" bloğunda hesaplanır (hero, cam kutu, altın segment,
  menü aktif öğe, ton rozetleri açık + koyu).
- **Ton:** `brand | success | warn | danger | gold | neutral` → `.pm-t-*` sınıfları `--t` (çizgi/ikon), `--t-soft`
  (zemin), `--t-text` (yazı) üretir. Yeni ton eklenirse AA testine de eklenir.
- **Hareket:** yıldız/pencere ışıltısı ve kart kalkması yalnız `prefers-reduced-motion: no-preference` içindedir.
- **Yan menü (v4 ile güncellendi):** aktif öğe `.nav-pill` = dolgulu vurgu hapı + kayan altın `.nav-bar`; zemin
  `.sb-surface`. Admin menüsündeki arama kutusu kaldırıldı (üst çubuk Ctrl K); "Sistem durumu" kartı gerçek sağlık
  verisiyle eklendi. `HeroBanner` / `GlassKpi` / `CityNight` ve `console/bar-chart` SİLİNDİ (2026-10-06); tüm /admin başlıkları
  `AdminPageHeader` = `DashboardHero` (açık bant), KPI'lar `KpiCard` (`AdminStatCard` silindi), /admin menüsü tek kaynak `src/lib/admin/nav.ts`.
- **Tema:** "Gece Altın" vurgusu (`data-accent="gold"`): `--brand-600 #9a6700` (beyaz yazı 4.87:1), metin `#7a5200`
  açıkta, `#f0c36a` koyuda; `ACCENTS` tablosu, `themes.css` ve boot script ile senkron.

## Sekmeli formlar

"Yeni X" tam sayfa formlarının masaüstü kabuğu. Şartname: `docs/design/FORMS_SPEC.md`. Pilot: Yeni müşteri
(`musteriler/yeni`) ve Yeni portföy (`portfoyler/yeni`). Eski `FormShell` / `FormPage` / `FormSection` AYNEN çalışır;
sekme istemeyen (tek bölümlü, <=4 alanlı) formlar onlarda kalır.

Dosyalar: `ui/tabbed-form-shell.tsx` (kabuk + `SummaryRow` / `SummaryGroup`), `lib/form-tabs.ts` (saf mantık, testli),
`app/use-form-values.ts` (canlı değerler), `app/use-form-draft.ts` (taslak), `premium.css` (`tfs-in` geçişi).

Yerleşim: >=1024px solda dikey sekme rayı (ikon, etiket, tamam tiki / eksik noktası / hata rozeti, "N/M bölüm tamam"),
ortada aktif panel + Önceki/Sonraki, >=1280px sağda yapışkan "Özet ve önizleme"; altta yapışkan `FormActions`.
<1024px: yatay kaydırılan sekme şeridi (dokunma hedefi 44px), tek sütun, özet panelin altında `<details>`.
Kabuk `max-w-[80rem]`. Geçiş 150 ms (opaklık + 4px), `prefers-reduced-motion` ile kapalı. Yalnız token (açık/koyu/Gece Altın uyumlu).

### Kullanım (yeni form eklerken)

1. Sekme VERİSİNİ (ikonsuz) `…/yeni/<x>-tabs.ts` içine yaz: `id`, `label`, `description`, `fields` (sekmedeki TÜM name'ler),
   `required`, ayrıca `FORM_ID` ve taslak beyaz listesi `DRAFT_FIELDS`. Sözleşme testi bu dosyayı form kaynağıyla eşler.
2. Formda ikonları ekleyip `FormTab[]` üret; her sekme için panel içeriğini ver (içerik düz `FormField`'lar; 2 sütun ızgara kabuktan):

```tsx
<TabbedFormShell
  title="Yeni X" breadcrumbs={…} cancelHref="/app/x" submitLabel="Kaydet" pendingLabel="Kaydediliyor…"
  pending={pending} error={error} onSubmit={onSubmit}        // useCreateForm çıktısı, aynen
  tabs={tabs}                                                  // FormTab[]: {id,label,icon?,description?,fields,required?}
  tabPanels={{ temel: <>…FormField'lar…</>, konum: <>…</> }}  // id -> içerik
  summary={({ values, goToTab }) => <>…SummaryGroup/SummaryRow…</>}  // GERÇEK değerden; kişisel veri YOK
  fieldLabels={{ full_name: "Ad soyad" }}                      // "Eksik zorunlu alanlar" listesi etiketleri
  draft={{ userId, formId: X_FORM_ID, fields: [...DRAFT_FIELDS] }}   // isteğe bağlı taslak
  layout="auto" />                                             // "single": sekmesiz alt alta
```

3. `page.tsx` `requireModulePage(...)` sonucundan `userId` alıp forma geçir (taslak anahtarı için).
4. Başarılı kayıtta taslağı sil: `useCreateForm` ile kabuk bunu kendiliğinden yapar (pending biter, hata yok);
   `useState` ile elle gönderen formlar başarıda `clearFormDraft(userId, FORM_ID)` çağırır.
5. `src/lib/form-tabs-contract.test.ts` içindeki `FORMS` listesine formu ekle (sekme alanları = form kaynağındaki `name=` kümesi).

### Davranış kuralları

- **Tek `<form>`, tüm paneller DOM'da:** pasif paneller `hidden` ama gönderilir. Gizli sekmedeki zorunlu/geçersiz alan hatasında
  `invalid` olayı capture ile yakalanır, ilk bozuk sekme açılır, alana odaklanıp tarayıcı balonu gösterilir; hata rozeti
  yalnız ilk gönderim denemesinden sonra görünür.
- **Özet içine form kontrolü koyma** (iki yerde render edilir). Telefon/e-posta/TC/IBAN gösterme; her satır `SummaryRow tab=…`
  ile ilgili sekmeye (ve `field`'a) götürsün (sıfır çıkmaz metrik). Veri yoksa "Girilmedi" de, sahte sayı üretme
  (`commissionSummary` geçersiz girdide null döner).
- **Taslak:** `localStorage` `emlaksoft:draft:v1:{userId}:{formId}`, 800 ms debounce, TTL 7 gün, yalnız beyaz liste VE
  `isSensitiveFieldName` süzgecinden geçen alanlar (telefon, e-posta, TC, IBAN, not, açıklama, metin, adres asla yazılmaz).
  Beyaz listeye YALNIZ kontrolsüz (native) alanları koy (GeoSelect/PhoneInput gibi kontrollü bileşenler geri yüklenemez).
  Otomatik geri yükleme yok: üstte "Taslağı geri yükle / Sil" bandı; karar verilene kadar kayıt duraklar.
- **Klavye:** Ctrl/Cmd+Enter kaydet; Alt+↑/↓ sekme değiştir (ilk alana odaklanır); rayda ↑↓←→ + Home/End
  (roving tabindex, odak = seçim, `aria-orientation` dikeyde `vertical`, dar ekranda `horizontal`). Derin bağlantı: `?sekme=<id>`.
- **ARIA:** `tablist` / `tab` (`aria-selected`, `aria-controls`, `aria-describedby` = "2 zorunlu alan eksik") / `tabpanel`
  (`aria-labelledby`, `tabIndex=0`). Zamanı bileşende `clock.ts` ile oku (`Date.now()` yasak).
- **Sekme kuralı:** 2-5 sekme; alanı olmayan sekme ("Ek bilgi") ilerlemeye girmez. Zorunlusuz sekme, en az bir alan
  dolunca "tamam" sayılır.
- **Özet = "Girilen bilgiler":** kabuk her sekmenin TÜM alanlarını DOM'dan okuyup etiketli satır olarak gösterir
  (`use-form-fields.ts` + `lib/form-summary.ts`): telefon biçimli (`formatPhoneDisplay`), e-posta olduğu gibi, il/ilçe/mahalle
  ve seçimler görünen etiketle, boşsa "Girilmedi"; satır tıklanınca sekmeye/alana gider. Taslak kuralı değişmedi
  (telefon/e-posta/not/gövde localStorage'a yazılmaz).

## Sekmeler (MorphTabs)

Büyüyen/küçülen sekme dili: **aktif sekme genişler** (ikon + etiket [+ açıklama]), **pasifler ikona küçülür** (erişilebilir ad
ve `title` kalır). Tek sistem; ikinci sekme bileşeni yazma.

| Parça | Dosya | Kullanım |
|---|---|---|
| Saf mantık | `lib/morph-tabs.ts` (+ `form-tabs.ts`: `tabProgress`, `slideDirection`) | yoğunluk (`full/label/icon`), rozet önceliği, tercih |
| Yüz + `MorphNav` | `ui/morph-tab-parts.tsx` ("use client" YOK) | bağlantı sekmeleri; sunucudan da çizilir (`DetailTabs`, `SectionTabs`) |
| `MorphTabs` | `ui/morph-tabs.tsx` | ARIA tablist (formlar); yatay + dikey ray |
| Tercih | `ui/use-persisted-flag.ts` | ray/özet daraltma, localStorage try/catch + bellek yedeği |
| CSS | `premium.css` "MorphTabs" | `grid-template-columns 0fr -> 1fr` ile <=200 ms; `prefers-reduced-motion` ile anında |

- **Yön:** `horizontal` (mobil dahil; aktif etiketli, pasif ikon) ve `vertical` ray (açıkken aktif genişler + pasifler ikon+etiket;
  `railCollapsed` ile tamamen ikon-only, rozetler görünür, üzerine gelince/klavye odağında geçici açılan flyout).
- **Rozet (ikon üstü):** hata sayısı > eksik zorunlu nokta > tamam tiki; ilerleme halkası `--mt-p`. Sayaç yalnız GERÇEK veriden
  (`count`); verilmeyen sekmede sayaç gösterilmez.
- **Klavye (ARIA tabs):** yöne uygun oklar + Home/End, roving tabindex, odak = seçim. Form kısayolları (Alt+↑/↓, Ctrl+Enter) aynen.
- **Stil türleri:** `rail` (form rayı), `pill` (kapsül içinde segment), `underline` (ikon kapsüllü aktif + marka alt çizgi + sayaç rozeti;
  `SectionTabs` ve `DetailTabs`). `SectionTabs` `counts` (href -> sayı) ve `actions` (sağda filtre/ayar slotu) alır.
- **Form yerleşimi:** `.tfs-layout` (ray | panel | özet), özet >=1280px'te daraltılabilir, panel geçişi `data-dir` ile yönlü kayma,
  eylem çubuğunda ilerleme çizgisi.
- **İkonlar:** form sekmeleri `lib/icons.ts` `TAB_ICONS` sözlüğünden (aynı kavram = aynı ikon, formda çakışma yok; sözleşme testi).
- **Dokunma hedefi** >=44px (`min-h-11`, ikon-only `2.75rem`); renkler yalnız token (Gece Altın dahil, açık/koyu).


## Liste kiti (`src/components/ui/list-kit`)

Liste sayfalarının ortak dili: sayaçlı kategori çipleri, ikon kapsüllü KPI kartları, kapak önizlemeli tablo, renkli
durum kapsülleri, satır eylemleri. Portföy, müşteri, talepler, anlaşmalar (liste görünümü; pano korunur), teklifler,
sözleşmeler, randevular, görevler ve kiralama kullanır. Ek yapı taşları: `ListPager` (gerçek sayfalama şeridi),
`FilterDate`, `CategoryChips allLabel` ("Tümü" yerine "Açık talepler" gibi), saf yardımcılar `uuidParam`
(doğrulanmış `?danisman=`), `isoDateParam`, `parsePage`, `pageWindow`, `weeklySeriesOf`. İlişkili ad araması
(müşteri/portföy adıyla) `lib/list-search.ts`. Hepsi sunucu bileşeni (JS yok);
import: `@/components/ui/list-kit`.

| Bileşen | Ne yapar | Önemli kural |
| --- | --- | --- |
| `KpiStrip` | İkon kapsüllü, tıklanabilir KPI kartları (`items: KpiItem[]`) | `href` zorunlu. `series` (eskiden yeniye sayılar) YALNIZ gerçek kayıt tarihlerinden (`bucketByWeek`) verilir; yoksa ya da tamamı 0 ise çubuk/trend çizilmez. `showTrend` son yarıyı önceki yarıyla kıyaslar (`trendOf`); önceki dönem 0 ise yüzde uydurmaz. `attention`: sıfır değilse kırmızı. |
| `ListToolbar` | Görünüm anahtarı, arama, "Filtreler (n)" paneli, sıralama yuvası, yoğunluk, aktif filtre çipleri, kayıtlı görünüm yuvası | Tek `<form method=get>`; formun sahip olmadığı parametreler gizli alanla taşınır, `sayfa` sıfırlanır. `panel` içine `FilterGrid` + `FilterSelect` (native select) koy; `panelParamKeys` rozet sayısını belirler. |
| `CategoryChips` | Sayaçlı kategori çipleri (`?kategori=` ya da `paramName`) | Sunucu filtresi (link). `counts` yalnız gerçek sayımla verilir; güvenilir değilse `null` (sayı gösterilmez). Sayacı 0 olan pasif çip gizlenir. |
| `StatusPill` | `tone-*` token kapsülü (success / warning / danger / info / neutral) | Renk tek başına anlam taşımaz, metin zorunlu; kontrast token katmanında garantili (açık/koyu/vurgu temaları). |
| `EntityThumb` | Satır görseli: kapak; yoksa `icon` ya da `name` baş harf avatarı | Sabit kutu, CLS yok. |
| `RowActions`, `RowActionLink`, `RowActionAnchor` | Satır sonu ikon eylemleri | `label` zorunlu (aria-label + title); satır overlay linkinin üstünde (`z-10`). |
| `ViewSwitcher` | Liste / Kart / Galeri / Harita (`?gorunum=`) | YALNIZ var olan görünümler verilir; 2'den az görünümde çizilmez. |
| `BulkBar` | Toplu işlem çubuğu kabuğu (sticky) | Seçim durumu çağıranın istemci sağlayıcısındadır (bkz. `portfoyler/property-bulk-actions.tsx`). |

- **Tablo:** `Table` primitive'leri + `TableFrame density="kompakt"` (`?yogunluk=kompakt`, `ListToolbar densityParam`)
  + `THead sticky` (`TableFrame maxHeight` ile). md altında tablo yerine kart listesi çiz (`hidden md:block` /
  `md:hidden`); yatay taşma olmamalı. Dar ekranda ikincil sütunları `hidden xl:table-cell` ile gizle.
- **Satır kalıbı:** sayfa sunuma hazır bir satır modeli (VM) üretir; tablo ve mobil liste aynı VM'den beslenir
  (bkz. `portfoyler/property-rows.tsx`, `musteriler/customer-rows.tsx`). Saf mantık (ton eşleme, özet metin,
  sayım) `*-list-logic.ts` içinde, testiyle.
- **Gerçek veri disiplini:** sayaç/trend/seri hesaplanamıyorsa çizilmez. Tarama tabanlı sayımlar (ör. tip
  dağılımı) üst sınırı aşarsa gizlenir; yaklaşık sayı gösterilmez.
- **FilterBar ile ilişki:** basit sayfalar için `FilterBar` (sekme + panel) yeterlidir; görünüm anahtarı, aktif çip,
  yoğunluk ve kayıtlı görünüm gereken liste ekranları `ListToolbar` kullanır. İkisi de `lib/ui/filter-params`
  yardımcılarını paylaşır.

## Kaydet/İptal çubuğu (FormActionBar) ve özet kuralı

`src/components/ui/form-action-bar.tsx`: TabbedFormShell ve InlineTabbedPanel ortak alt çubuğu.
Sol: durum rozeti (Kaydediliyor / Kaydedilemedi / Kaydedildi / Taslak kaydedildi hh:mm / Kaydedilmemiş değişiklik),
zorunlu alan sayacı (tıklayınca ilk eksik alana gider; hepsi tamamsa "Hepsi tamam"), kısayol ipucu, üst kenarda ilerleme çizgisi.
Sağ: İptal (kirliyse SATIR İÇİ onay, popup yok), "Taslak kaydet" (`draft` verilen formlarda), "Kaydet ve yenisini ekle"
(`saveAndNew`; yalnız `useCreateForm`/özel submit'inde `takeSubmitIntent()` okuyan formlar), Kaydet (spinner, ✓ animasyonu,
hatada sallanma + hata bandına odak). `destructive` Kaydet'i kırmızı yapar. Mobilde iki satır, 44px düğme, safe-area, klavye açıkken akışa döner.
Sunucu action'ı/doğrulama değişmez; niyet yalnız `src/lib/form-submit-intent.ts` üzerinden başarı sonrası yönlendirmeyi etkiler.

Özet kuralı: özet/önizlemede girilen değer OLDUĞU GİBİ görünür (telefon `formatPhoneDisplay`, e-posta, il/ilçe/mahalle etiketi,
tarih GG.AA.YYYY, tutar ₺, not en çok 3 satır + tamamı `title`). Soyut "Girildi/Seçildi/N karakter" yazılmaz; seçili etiket için
özet fonksiyonuna gelen `display[alanAdı]` kullanılır. Tek istisna parola/OTP/token/API anahtarı (`isSecretFieldName`, `input[type=password]`):
yalnız "Girildi" veya güç etiketi. Taslak (localStorage) tarafında `isSensitiveFieldName` aynen geçerlidir. Sözleşme testi: `form-tabs-contract.test.ts`.

## Sayfa içi sekme alanları (popup yerine)

**Kural:** yeni kayıt ekleme ve düzenleme için popup/diyalog YASAK. Ekle/düzenle akışı ya tam sayfa sekmeli form
(`TabbedFormShell`) ya da bağlam içinde açılan sayfa içi sekme alanıdır (`InlineTabbedPanel`,
`src/components/ui/inline-tabbed-panel.tsx`). Yalnız kısa onay diyaloğu (`ConfirmDialog`: silme, geri alınamaz işlem,
tek alanlı kısa soru) ve gerçekten tam ekran önizleme yüzeyleri (galeri, belge, tur) serbesttir.

`InlineTabbedPanel` modal değildir: arka planı kapatmaz, ekranın üstüne binmez. App layout'undaki
`#inline-panel-host` yuvasına (bölüm sekmelerinin hemen altı) normal akışta yerleşir ve görünüme kaydırılır.
Tetikleyici düğme olduğu yerde kalır (render prop `trigger`); kontrollü kullanım için `open`/`onOpenChange`.

- Sekmeler `MorphTabs`; tüm paneller DOM'da kalır (tek `<form>`), pasifler `hidden`. Tek sekme varsa şerit çizilmez.
- Canlı özet: izlenen alan sayısı >= 5 ise (veya `summary`) yazdıkça güncellenen "Canlı özet" (`useFormFields`);
  satıra tıklayınca ilgili sekme/alan açılır. Mobilde özet alta yığılır, tek sütun.
- Kaydedilmemiş değişiklik koruması (`lib/form-dirty.ts`): X/Vazgeç/Esc kirliyken satır içi onay ister,
  sayfa terkinde `beforeunload` uyarısı. Ctrl/Cmd+Enter kaydeder. Hata bandına odak; gizli sekmedeki geçersiz alan sekmeyi açar.
- Taslak: `draft` (useFormDraft) yeni kayıt akışlarında; yalnız beyaz liste, telefon/e-posta/not saklanmaz.
- Gönderim: `action` (mevcut `<form action>` akışları) veya `onSubmit` (FormData; hatada alanlar korunur, tercih edilir).
  Sunucu action'ı, doğrulama ve yetki değişmez; bileşen yalnız kabuktur.
- Kullanım: `tabs=[{id,label,icon,fields}]`, `panels={{id: <alanlar/>}}`, `hiddenFields`, `fieldLabels`, `error`, `pending`.
  Örnek: `gorevler/task-edit-dialog.tsx`, `randevular/appointment-edit-dialog.tsx`.
- Sözleşme: `src/lib/accessible-dialog-contract.test.ts` "inline panel" bölümü taşınan akışların `Dialog` içermediğini doğrular.

## Hareket ve illüstrasyon

**GIF yok** (ağır, erişilemez, temaya uymaz). Yerine SVG + CSS: tek hareket dosyası `src/app/motion.css`, illüstrasyon kiti `src/components/ui/illustrations/`.

**Token'lar (tek kaynak `motion.css`):** `--motion-fast` 140 ms (kontrol) · `--motion-base` 220 ms (panel) · `--motion-slow` 320 ms (sayfa/liste girişi) · çıkışlar ~%30 kısa (`--motion-exit-fast/base/slow` 100/150/220) · `--ease-out` · `--ease-spring` (`linear()` yay, `@supports` yedekli) · `--motion-stagger` 40 ms. Süreleri bileşende sabit yazma, token kullan.
**Bütçe:** yalnız `transform`/`opacity` (SVG çizgi için `stroke-dashoffset`); CLS yok; `will-change` yok; INP etkilenmez. Her hareket `prefers-reduced-motion: no-preference` içindedir; reduce'ta içerik bitiş durumunda durağandır.

| İhtiyaç | Kullanım |
|---|---|
| KPI sayı sayacı | `StatCard` içinde otomatik (`ui/count-up.tsx`): sunucu sonuç değerini basar, ekrana girince bir kez sayar; biçimli (para, %) değerlere dokunmaz |
| Liste giriş | `.list-stagger` ebeveyne (40 ms aralık, en çok 12 öğe) |
| Canlı değişen sayı | `AnimatedNumber` (`ui/animated-number.tsx`, `@number-flow/react`, dinamik parça; sunucu/reduced-motion'da düz tr-TR metin): hesaplayıcı önizlemeleri, canlı eşleşme sayısı, ROI sonucu |
| Liste ekle/çıkar/sırala | `useAutoAnimate` / `<AutoAnimate>` (`ui/auto-animate.tsx`): yalnız zaten istemci listeler, kararlı `key` |
| Kart hover | `.hover-lift`; düğme basma `.btn-press` (ya da mevcut `.press`) |
| İlerleme dolumu | `Progress` otomatik (`.motion-progress-fill`) |
| Başarı tiki | `<Illustration kind="basari" />` veya SVG path'ine `.tick-draw` |
| Skeleton | `Skeleton` (`.skeleton` shimmer) |
| Sayfa geçişi | view transitions varsa globals.css; yoksa `.motion-page` fade |
| Konfeti | `<Celebration />` (CSS, 1.2 sn, bir kez; `relative` kapsayıcı içinde). YALNIZ anlaşma kazanılınca / ilk müşteri eklenince |

**İllüstrasyon:** `<Illustration kind="musteri|portfoy|talep|randevu|gorev|teklif|komisyon|rapor|bildirim|gelenKutusu|arama|belge|otomasyon|ekip|aramaYok|hata|yetkiYok|cevrimdisi|basari" tone? size? />`. Renk `currentColor` + yüzey token'ları (koyu temada uyar). Dekoratif: `aria-hidden`, alt metin yazılmaz; bilgi başlıktadır.

**EmptyState tek bileşen** (`@/components/ui/empty-state`; eski `components/app/empty-state` ve `ui/empty-state-v3` re-export): `variant` panel (varsayılan) | full | compact | inline; `illustration` (modül anahtarı; eski `list|search|error|start` da geçerli), tek ana `action` (+ `secondary`, `help` = "Nasıl çalışır?"). `icon` lucide bileşeni ya da düğüm olabilir.

**İkon:** kavramsal ikonlar `src/lib/icons.ts` sözlüğünden (`ICONS.musteri`); rastgele lucide kavramları yalnız ok/çarpı gibi süslerde.

**CountUp ile AnimatedNumber rol ayrımı:** `CountUp` = ilk görünümde bir kez sayar (sunucu KPI'ları, ek KB yok). `AnimatedNumber` = kullanıcı girdisiyle değer değiştikçe akar. Aynı öğede ikisi birden kullanılmaz; kapanış sihirbazında kullanılmaz.

**Kutlama:** tek kaynak `ui/illustrations/celebration.tsx`; `ui/celebrate.tsx` yalnız re-export'tur.

**Ücretsiz CSS:** `@starting-style` panel girişi, `animation-timeline: view()` yalnız public landing ve /fiyatlar; hepsi `@supports` yedekli, reduced-motion'da kapalı.

## Veri görselleştirme kiti ve hareket kuralları

**Kod:** `src/components/ui/viz/` (sunucu-güvenli saf SVG/CSS, istemci JS ve yeni bağımlılık yok; `import { ... } from "@/components/ui/viz"`). Recharts yalnız `ui/chart.tsx` (çizgi/çubuk/halka, tooltip gereken yerler) ve `interactive-chart.tsx` (el yapımı SVG) içindir.

| Bileşen | Ne zaman | Notlar |
|---|---|---|
| `AreaChart` | trend (tek/çift seri) | premium ve console `AreaChart` bunun sarmalayıcısıdır. İlk görünümde çizgi soldan açılır (clipPath; `non-scaling-stroke` ile uyumlu) + alan yumuşakça belirir; sr-only veri tablosu; `href` ile tüm grafik bağlantı; ikinci seri kesikli (renk dışı ayrım) |
| `RadialGauge` | hedef/ilerleme | premium `Ring` ve console `Ring` bunun üzerine kuruludur. `pathLength=1` yay süpürmesi, `target` çentiği, uçta ilerleme işareti, sr-only "değer / max (hedef)". `max<=0` → `null` (sahte yüzde yok) |
| `FunnelChart` | aşama dönüşümü | yatay, ORTAK ölçek, etiket + değer her satırda, aşama başına `href`. Dönüşüm oku (↓ %) YALNIZ `ardisik` true ise (her aşama öncekinin alt kümesi); bağımsız sayımlarda oran yanıltıcıdır |
| `Heatmap` | 7×24 vb. yoğunluk | CSS grid, tek hue sıralı palet, hücre `title` + sr-only tablo, veri yoksa illüstrasyonlu boş durum. Hareket yok |
| `ChartCard` (= `ChartFrame`) | her grafik kartı | başlık, `period`, `href`, `loading` (iskelet), `empty` (anlamlı boş durum) |
| `SkeletonCard` | yükleniyor | `.skeleton` parlaması, sabit yükseklik (CLS yok); `lazy-chart` bunu kullanır |
| `CountUp` | KPI sayısı | `value` metin ya da sayı + `format="number\|money\|percent"`; SSR sonucu basar; admin `CountUp` ve `OdometerNumber` bunun eski adlarıdır |
| `DonutRing` | küçük pay dağılımı (danışman/ofis payı, kanal) | saf SVG, istemci bileşeninde de kullanılır; `segments[{label,value,color\|tone}]`, `children` merkez; değer değişince dilimler akıcı kayar (`.viz-ring-seg`); toplam ≤0 → `null`. İpuçlu/tıklanabilir dağılım için `DonutSplit` |

**API ekleri (2026-10-06):** `RadialGauge` → `trackColor` (yatak rengi), `fluid` (kapsayıcıyı doldurur; TV panosu), `live`
(ilk süpürme yerine değer değişiminde akıcı geçiş). `FunnelChart` → `tone`. Recharts sarmalayıcıları (`ui/lazy-charts`):
`BarCompare` / `DonutSplit` → `hrefKey` (satırdaki hedef adres alanı; tıklayınca filtreli sayfa) + `hint` (ipucu alt satırı).
Sayfaya özel Recharts kopyası YAZILMAZ: tıklanabilirlik/biçim gerekiyorsa bu bileşenlere prop eklenir (`viz-depth-contract.test.ts`
recharts içe aktarımını yalnız `ui/chart.tsx`'e kilitler; eski `danisman-kpi/revenue-chart` ve `giderler/category-donut` silindi).

### Grafik derinlik dili ("3B görünüm", WebGL yok)

Kod: `src/app/viz.css` + `ui/chart.tsx` + `ui/viz/*`. Token: `--viz-sheen` (üstten ışık), `--viz-shade` (alt gölge hattı / iç kenar),
`--viz-shadow` (yalnız üzerine gelinen öğe), `--viz-glow` (çizgi parlaması opaklığı); açık değer `tokens.css`, koyu `theme-dark.css`.
- **Çubuk:** yuvarlatılmış uç + üstten ışık degradesi (grafik başına tek `linearGradient`) + taban gölge hattı; üzerine gelinen öne
  çıkar (drop-shadow), diğerleri %55'e söner (`.viz-depth:has(.viz-bar[data-active])`).
- **Halka:** halka kalınlığı boyunca tek "tüp" degradesi (`ui/viz/tube-gradient.tsx`: iç kenar gölge → ortada saydam → dış kenar
  ışık; ayrı şerit gibi okunmaz); Recharts dilimi, `RadialGauge` ve `DonutRing` aynı bileşeni kullanır. Etkin dilim 4 px dışarı taşar.
- **Alan:** 3 duraklı degrade + çizginin altında kalın, yarı saydam ikinci eğri (parlama). SVG `filter` KULLANILMAZ (maliyet; test).
- **Eksen/ızgara:** yalnız yatay kesikli ızgara, 4-5 değer etiketi, eksen çizgisi yok, etiket `--text-muted` (AA).
- **Dönem değişimi:** aynı bileşen yeni veriyle çizilince Recharts eski değerden yeniye canlandırır; `AreaTrendChart` `animationKey`.
- **Kontrast (test):** ışık katmanı çubuğun yarı yüksekliğinde bile `--viz-1..8`'i `--surface` üzerinde ≥3:1 tutar (iki tema).
  Her zaman koyu hero bantlarındaki halka yatağı `--viz-track-inverse`; /app, /admin ve ortak bileşen SVG'lerinde sabit renk yok
  (istisna: üçüncü taraf marka logoları, harita işaretçisi).

Boş durum illüstrasyonları: `Illustration kind="funnel\|gauge\|heatmap"`.
**Kural:** grafik yalnız gerçek veriyle çizilir; veri yoksa `null` döner ya da `ChartCard empty` gösterilir. Görünen her sayı/dilim/aşama mümkünse `href` ile filtrelenmiş hedefe gider (sıfır çıkmaz metrik).

### Palet (`--viz-*`, tokens.css + theme-dark.css)

Kategorik `--viz-1..8`, sıralı tek hue `--viz-seq-1..5` (ısı haritası), `--viz-pos/neg/neutral`, `--viz-gold`; ızgara `--viz-grid`, ipucu metni `--viz-tooltip-text`. `chart-colors.ts`, `pm-chart-*`, `.pm-t-*` bunlara bağlıdır; grafik koduna ham hex yazılmaz.
**Ölçüt (`src/lib/viz-palette-contract.test.ts`):** çizgi/dolgu serileri `--surface` üzerinde ≥3:1 (WCAG 1.4.11); pos/neg/neutral metin olarak ≥4.5:1; kategorik renkler arası CIE76 ΔE ≥20 (mint/cyan gibi yakın hue yok); sıralı palet monoton. Seri ayrımı yalnız renkle yapılmaz: etiket, doğrudan değer, lejant ya da çizgi stili (kesikli) eşlik eder.

| Token | Açık | Koyu |
|---|---|---|
| viz-1 mavi | #1d5fd6 (5.74) | #6ea1ff (6.79) |
| viz-2 yeşil-teal | #0f7b6c (5.16) | #34d3bd (9.26) |
| viz-3 turuncu | #c2410c (5.18) | #fb923c (7.67) |
| viz-4 mor | #7c3aed (5.70) | #a78bfa (6.38) |
| viz-5 amber | #a16207 (4.92) | #fbbf24 (10.40) |
| viz-6 pembe | #be185d (6.04) | #f472b6 (6.56) |
| viz-7 cyan | #0e7490 (5.36) | #38bdf8 (8.11) |
| viz-8 nötr | #78716c (4.80) | #94a3b8 (6.77) |
| seq-1…5 | #e6efff #b4cdfb #5088ec #2f6bdb #17409a | #16294d #1f4585 #2f6bc4 #5b94f0 #a9c8ff |
| pos / neg / neutral | #0b7a4b #c62828 #5b6b86 | #4ade80 #f87171 #94a3b8 |

(Parantez: `--surface` üzerinde kontrast oranı; açık #ffffff, koyu #101a2e. seq-1/2 yüzeyden belirgin ayrılmayan düşük-yoğunluk tonlarıdır: hücre kenarlığı + title + sr-only tablo bilgiyi taşır.)

### Hareket kuralları

- Süre token'ları: `--motion-draw` 600 ms (çizilme/dolum/süpürme), `--motion-count` 700 ms (sayı sayma). `chart-draw`, `ring-sweep`, `dashboard-line`, `bar-live/bar-rise` ve Recharts `animationDuration` buna eşittir.
- **Çizilme animasyonları ilk görünümde BİR kez oynar.** Süs sonsuz animasyon yoktur.
- **Sayfa başına bütçe (ilk boyama):** en çok 1 grafik çizilmesi + sayı sayma + liste stagger ≤12 öğe.
- **Sonsuz döngü yalnız gerçek canlı göstergede** (`.status-pulse`: gerçek zamanlı bağlantı, canlı çağrı vb.). Süs için `.status-pulse-static`. `glow-halo`, `flow-line`, `conic-spin`, `pm-twinkle` sınıfları durağan tanımla kalır (tsx kırılmasın); `.bar-live` tek seferlik dolumdur.
- **Fare süsü yok:** /app ve /admin'de imleç takibi, parallax, tilt yok (standart hover durumu kalır). Veri inceleme imleci (haritalar, `interactive-chart` crosshair) işlevdir ve kalır. Sözleşme: `src/lib/motion-viz-contract.test.ts`.
- reduced-motion: genel kural TEK yerde (`a11y.css`); bileşenler bitiş durumunda durağandır; Recharts `isAnimationActive={!reduce}`.
- `InteractiveChart`: klavye (Tab ile odak, ←/→, Home/End, Esc), `aria-live` duyuru ve sr-only veri tablosu.

### Karar: 3B, GIF, Lottie, degrade, motion (güncel: 2026-10-06)

- **3B pasta/çubuk yok:** derinlik algıyı bozar (ön dilim büyük görünür); yanıltıcı. Derinlik ipucu yalnız yüzey katmanları, ince iç ışık çizgisi (`--inner-top`), yumuşak gölge ve çizgi altı gradyan ile verilir → uygulaması aşağıdaki "Grafik derinlik dili" (perspektif/eğim YOK, oran bozulmaz).
- **GIF yok:** tema duyarsız (koyu/açık), ağır, erişilemez. Hareket SVG + CSS illüstrasyon animasyonlarıdır (`ui/illustrations`, `motion.css`).
- **Lottie yok:** yeni bağımlılık + paket büyümesi + tema renklerine bağlanamama; SVG+CSS aynı işi ölçülü ve kurumsal yapar.
- **Dekoratif degrade:** yalnız `DashboardHero` bandında, çok hafif ve hareketli (yukarıdaki kurallar); kart/panel
  yüzeylerinde degrade dolgu yok (`pm-card-tint` yalnız %8 ton sönmesi). Bulanık (blur) büyük katman yok.
- **motion:** kuruldu ama yalnız `LazyMotion` + `domAnimation` + `m.*` (bkz. "Hareket katmanı"); `domMax`/layoutId yok.

## Marka

**Seçilen sembol:** lacivert karo üzerinde altın çatı + beyaz "E" (omurga + 3 kol; orta kol marka mavisi). Üç alternatif
çizildi ve PNG olarak 160/64/32/16 px, açık ve koyu zeminde gözle karşılaştırıldı: (A) çatı+E, (B) anahtar deliği evi,
(C) iki bloklu yapı silueti. B koyu zeminde kayboldu ve 16 px'te okunmadı; C ayrıntıda dağıldı; A en küçük boyutta bile
"ev + E" olarak okundu, lacivert/mavi/altın paletiyle (`tokens.css`, Gece Altın) uyumlu ve tek renk/ters sürümü kolay.
Kelime işareti elle çizilmiş çizgi-harftir (font/telif yok); "Emlak" lacivert, "Soft" marka mavisi.

**Dosyalar:** `scripts/generate-brand.mjs` hepsini üretir (`node scripts/generate-brand.mjs`): `public/brand/*`
(logo-mark, logo-mark-dark, logo-horizontal[-dark], logo-vertical[-dark], logo-mono, logo-mono-white, favicon.svg,
icon-192/512, maskable-192/512, apple-touch-icon, favicon-32), `public/icon.svg` (açık/koyu sekmeye göre karo rengi, `prefers-color-scheme`),
`public/favicon.ico`. OG/Twitter kartı: `src/lib/brand/og-card.tsx`.

**Kullanım kuralı:** logo gösteren HER yer `src/components/brand/brand.tsx` içindeki `<Brand variant tone>` bileşenini
kullanır (elle "E" kutusu yazma). Özel marka kök layout'taki `BrandProvider` ile gelir.

**Süper admin ayarı:** `/admin/marka` (`marka` platform modülü, yalnız super_admin; yükleme hız sınırlı + denetim kaydı).
Depolama mevcut `platform_settings` (anahtarlar `brand.meta`, `brand.asset.<slot>`; yeni migration yok). SVG katı izin
listesiyle doğrulanır (script/olay özniteliği/dış kaynak/foreignObject REDDEDİLİR), PNG imza + boyut kontrolü; sunum
`/brand-asset/<slot>` (nosniff + CSP sandbox, `<img>` ile). Önbellek `unstable_cache` etiketi `platform-brand` + `updateTag`.
Kapsam dışı: ofis bazlı (beyaz etiket) logo (`tenants.logo_url` ayrı kalır).
