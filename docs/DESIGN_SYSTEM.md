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
| `HeroBanner` | Lacivert gradient karşılama bandı + elle çizilmiş SVG gece şehri (`CityNight`) | `eyebrow`, `title`, `highlight` (altın ad), `summary` (ReactNode, Suspense ile akabilir), `actions`, `children` (GlassKpi ızgarası) |
| `GlassKpi` | Hero içi cam (backdrop-blur) KPI: ikon, etiket, değer, alt satır, MiniBars | `href` ZORUNLU, `subTone` (`danger`/`warn`), `series` |
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
- **Yan menü:** aktif öğe `.nav-gold-active` (altın degrade + ince kenar) + `.nav-gold-bar`; menü arama kutusu
  `.nav-search` (yalnız izinli sayfalarda süzer). "Canlı" sistem kartı yalnız gerçek bir sağlık sinyali varsa eklenir
  (şu an layout bu sinyali taşımadığı için eklenmedi).
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
durum kapsülleri, satır eylemleri. Portföy ve müşteri listeleri kullanır; talepler, anlaşmalar, teklifler,
sözleşmeler, randevular, görevler ve kiralama aynı kalıba taşınacaktır. Hepsi sunucu bileşeni (JS yok);
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
