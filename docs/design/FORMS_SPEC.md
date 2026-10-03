# Yeni Kayıt Formları — Masaüstü Sekmeli Deneyim Şartnamesi

Durum: tasarım şartnamesi (kod değişmez). Kapsam: 16 tam sayfa "Yeni X" formu. Değişmeyenler: server action, doğrulama, yetki, `useCreateForm`; yalnız yerleşim. Yeni npm bağımlılığı yok.

## (a) Referans analizi

Not: kalıplar, aşağıdaki kaynaklar ve genel ürün bilgisiyle derlenmiştir; her ürünün güncel arayüzü ayrıca doğrulanmadı (Stripe, Linear, Airbnb için canlı sayfa incelenmedi).

1. **Shopify admin (Polaris)**: iki sütunlu yerleşim; ana bölüm (~2/3) asıl içerik, yan bölüm (~1/3) ikincil/bağlam bilgisi; kart başına tek tema. Alınan: sağda ikincil panel, kart başlıkları. Kaynak: https://polaris-react.shopify.com/design/layout
2. **Cal.com event type**: Basics / Advanced / Availability gibi sekmeler; masaüstünde dikey, mobilde yatay. Alınan: dikey sekme rayı, kaydet düğmesinin sekmeler arası ortak olması. Kaynak: https://cal.com/blog/event-types-guide-calcom
3. **Stripe Dashboard (ürün/müşteri oluşturma)**: form solda, sağda canlı önizleme/özet. Alınan: sağ "özet ve önizleme" paneli.
4. **HubSpot (kişi/anlaşma oluşturma)**: sağ çekmece, çok panelli; gelişmiş alanlar ayrı. Alınan: zorunlu alanları öne alma, ikincil alanları ayrı sekmeye koyma.
5. **Linear "create issue"**: ana alan büyük, meta alanlar altta; Cmd+Enter ile gönder. Alınan: Ctrl/Cmd+Enter, taslağın korunması.
6. **Attio / Notion / Airtable**: kayıt sayfası; özellik listesi + sekmeli ilişkili içerik. Alınan: sekme başlığında sayaç/rozet.
7. **Pipedrive**: kısa zorunlu çekirdek, kalan alanlar "diğer". Alınan: çekirdeği ilk sekmede toplama.
8. **Airbnb ilan oluşturma**: adım adım (stepper), ilerleme çubuğu, otomatik kayıt, "Kaydet ve çık". Alınan: ilerleme göstergesi, taslak. Reddedilen: zorunlu doğrusal akış.
9. **Typeform**: tek soru/ekran; tamamlanma yüksek ama yavaş. Reddedilen: emlakçı için fazla yavaş.
10. **Vercel "new project"**: sol yapılandırma, sağ özet; tek eylem. Alınan: özet panelinin yapışkan olması.
11. **Erişilebilirlik**: WAI-ARIA Authoring Practices sekme deseni (roving tabindex, ok tuşları, Home/End). Kaynak: https://www.w3.org/TR/2021/NOTE-wai-aria-practices-1.2-20211129/ ve https://www.deque.com/blog/a11y-support-series-part-1-aria-tab-panel-accessibility/

## (b) Seçilen desen ve gerekçe

**Stepper yerine serbest sekmeler.** Emlak danışmanı telefonda konuşurken veriyi sırasız girer; doğrusal sihirbaz (Airbnb/Typeform) engel olur. Sekmeler serbest gezilir, ilerleme yalnız bilgilendiricidir. İstisna: Otomasyonlar zaten 3 adımlı sihirbaz (Tetikleyici, Koşul, Aksiyon); sihirbaz mantığı korunur, yalnız aynı kabuk görünümü (ray + özet) giydirilir.

**Masaüstü (>=1024px) üç sütun:**
- Sol (14rem): dikey sekme rayı. Her sekme: ikon, etiket, durum (tamam tik / zorunlu eksik nokta / hata rozeti sayı). Altında ilerleme "3/5 bölüm tamam".
- Orta (esnek, max ~46rem): aktif sekme paneli; bölüm başlığı + açıklama + alan ızgarası (mevcut `FormSection` içeriği). Altında "Önceki / Sonraki".
- Sağ (20rem, sticky): "Özet ve önizleme" kartı (bkz. e). >=1280px görünür; 1024-1279'da daraltılabilir çekmece.
- Altta sticky eylem çubuğu (mevcut `FormActions`): sol İptal, sağ "Kaydet" + taslak durumu ("Taslak kaydedildi 14:32"). `max-w-3xl` kalkar, kabuk `max-w-[80rem]`.

**Form bütünlüğü:** tek `<form>`; tüm sekme panelleri DOM'da kalır, pasif olanlar `hidden` (alanlar `FormData`'ya yine girer). Gizli alandaki `required` tarayıcı doğrulaması "not focusable" hatası verir; bu yüzden `invalid` olayı capture ile yakalanır: ilk geçersiz alanın sekmesine geçilir, bir sonraki karede alana odak verilir. Sunucu hatası alanla eşlenemiyorsa hata bandı üstte kalır.

**Sekme başına doğrulama göstergesi:** hata sayısı = panelde `panel.querySelectorAll(":invalid").length` + sunucu hatasından eşlenen alan; `complete` = zorunlu alanların hepsi dolu. Sekme başlığında `aria-describedby` ile "2 eksik alan".

**Taslak otomatik kayıt:** `localStorage` anahtarı `emlaksoft:draft:v1:{userId}:{formId}`; 800 ms debounce; yalnız hassas olmayan alan beyaz listesi. Kaydedilmeyen: telefon, e-posta, TC, IBAN, `body` (sözleşme metni), `notes`, `description`. Müşteri formunda yalnız `type`, `branch_id` gibi seçimler. Tüm erişimler try/catch; hatada sessiz geç. Başarılı gönderimde ve çıkışta `emlaksoft:draft:v1:{userId}:*` temizlenir; 7 gün TTL. Açılışta "Taslağı geri yükle / Sil" bandı; otomatik geri yükleme yok (hidratasyon uyuşmazlığı ve yanlış kayıt riski).

**Klavye:** Ctrl/Cmd+Enter `form.requestSubmit()`; Alt+↓/Alt+↑ sonraki/önceki sekme; rayda Yukarı/Aşağı (+Sol/Sağ, Home/End) roving tabindex, `aria-orientation="vertical"`, odak = seçim. Çubukta `<kbd>` ipucu. `textarea` içinde Enter değişmez. `?sekme=konum` ile derin bağlantı (replaceState).

**Hareket / tema:** panel geçişi 150 ms opaklık + 4px kayma; `prefers-reduced-motion: reduce` ile kapalı. Yalnız mevcut token'lar (`bg-surface`, `border-line`, `text-text-muted`, `accent`); koyu temada `theme-dark.css` token'ları zaten çevirir, sabit renk yok.

## (c) Yeni API: `TabbedFormShell`

Konum: `src/components/ui/tabbed-form-shell.tsx`. Mevcut `FormShell` aynen kalır; `FormSection`'lı tek sütun formlar çalışmaya devam eder. Tür önerisi:

```ts
type FormTab = {
  id: string;                 // "temel"
  label: string;
  icon?: LucideIcon;
  description?: string;
  required?: string[];        // zorunlu alan name'leri -> complete hesabı
  errorCount?: number;        // sunucu hatası eşlemesi (isteğe bağlı)
};
type TabbedFormShellProps = Omit<FormShellProps, "children"> & {
  tabs: FormTab[];
  tabPanels: Record<string, ReactNode>;
  summary?: ReactNode;        // sağ panel
  preview?: ReactNode;        // özetin altında canlı önizleme
  draftKey?: string;          // verilirse taslak açılır
  draftFields?: string[];     // beyaz liste
  initialTab?: string;
  layout?: "auto" | "single"; // single = eski görünüm
};
```
İç bileşenler: `FormTabList`, `FormTabPanel` (role=tabpanel, `hidden`, `tabIndex=0`, `aria-labelledby`), `FormSummaryRail`. Canlı değerler için `useFormValues(formRef, names)`: `input/change` olaylarını dinler (kontrolsüz alanlar kontrolsüz kalır). `layout="single"` veya dar ekranda panelleri `FormSection` gibi alt alta gösterir.

## (d) 16 formun sekme yapısı (koddaki alanlara göre)

| Form | Sekmeler (alan name'leri) |
|---|---|
| Portföy | Temel (title, transaction_type, property_type, rooms, sqm, branch_id) · Konum (address_line + konum seçicileri) · Fiyat & Komisyon (list_price, commission_rate) · Özellikler (floor, heating, building_age, facade, parcel_block, parcel_lot) · Medya/Not (formda varsa dosya/not alanları) |
| Müşteri | Kişi (full_name, type, branch_id) · İletişim & Bölge (phone, email, bölge seçicileri) · Özel günler (birth_date, anniversary_date, anniversary_note) · Not (notes) |
| Talep | Müşteri & İşlem (customer_id, transaction_type, property_type, urgency) · Bütçe & Kriter (budget_min, budget_max, rooms, min_sqm) |
| Sunum | `sunumlar/yeni` bu çalışmada incelenen `*form.tsx` listesinde yok; uygulama ajanı önce gerçek alanlara bakmalı. Önerilen: Seçim (müşteri, portföyler) · Mesaj & Süre; tek bölümlü ise `layout="single"` |
| Açık ev | Portföy & Zaman (property_id, scheduled_at, duration_min) · Yer & Kapasite (location, max_visitors) · Not (notes) |
| Anlaşma | Taraflar (property_id, customer_id) · Detay (deal_type, stage, deal_value, has_authority) |
| Teklif | Taraflar (property_id, customer_id) · Koşullar (amount, valid_until, notes) |
| Sözleşme | Taraflar (customer_id, property_id) · Bilgiler (title, contract_type, expires_at) · İçerik (body; geniş alan) |
| Randevu | Zaman (appointment_type, duration_min, date, time) · Katılımcı & Yer (customer_id, property_id, location, notes); çakışma uyarısı (confirm_conflict) sekmeden bağımsız sabit bantta |
| Görev | Görev (title, kind, priority, notes) · Zamanlama & Atama (due_at, recurrence, assigned_to, customer_id) |
| Kiralama | Taraflar (property_id, renter_customer_id) · Bedel & Vade (monthly_rent, due_day, deposit) · Süre & Not (start_date, end_date, notes) |
| Proje | Proje (name, developer_name, status) · Konum & Teslim (location, delivery_date) · Açıklama (description); küçük form, `single` da olabilir |
| Kampanya | Kampanya & Kanal (title, channel, filter) · WhatsApp şablonu (whatsappTemplateName, whatsappTemplateLanguage; yalnız ilgili kanalda görünür, DOM'da kalır) · Mesaj (message) |
| Onay | Talep (kind, title, current_value, requested_value) · Kayıt & Gerekçe (entity_type, entity_id, description) |
| Destek | Talep bilgisi (request_id, subject, category, priority) · Açıklama (body) · Ekler (dosya girişi) |
| Otomasyon | Mevcut `AutomationWizard` 3 adımı: Tetikleyici · Koşul · Aksiyon; ray + özet ("Eğer … ise … yap" kural cümlesi) |

Kural: sekme sayısı 2-5; tek bölümlü ve <=4 alanlı form sekmeye zorlanmaz.

## (e) Sağ panel içeriği (gerçek veriden)

- Portföy: başlık, tür, m², liste fiyatı, m² birim fiyatı (list_price / sqm), komisyon tutarı (list_price x commission_rate, mevcut hesap yardımcısı), eksik alan listesi (tıklayınca ilgili sekmeye gider).
- Anlaşma / Teklif / Kiralama / Sözleşme: seçilen portföy kartı (başlık, fiyat, durum) + müşteri kartı (ad, tür), tahmini komisyon; kira için yıllık bedel ve depozito; sözleşme için bitişe kalan gün (`clock.ts`).
- Randevu: tarih/saat/süre özeti, çakışma uyarısı (mevcut çakışma verisi), seçilen müşteri/portföy.
- Talep: seçilen müşteri + bütçe aralığı; varsa eşleşme motorundan "eşleşen portföy sayısı" (tıklanır, filtreli liste). Veri yoksa gösterme (sahte skor yasak).
- Kampanya: filtreye uyan alıcı sayısı (mevcut sayım varsa) ve mesaj önizleme balonu.
- Her satır "sıfır çıkmaz metrik" kuralı gereği filtrelenmiş hedefe bağlanır. Yeni sorgu gerekiyorsa sayfa sunucu bileşeninde mevcut listelerden türetilir; aksi halde ayrı tasarım.
- Kişisel veri: panelde telefon/e-posta gösterilmez (yalnız ad), taslağa da yazılmaz.

## (f) Tablet / mobil

- >=1280: üç sütun. 1024-1279: ray + içerik, özet çekmece ("Özet" düğmesi). 769-1023: ray yatay sekme şeridine döner, özet altta katlanır.
- <=768: tek sütun; sekme şeridi `overflow-x-auto`, `scroll-snap`, aktif sekme `scrollIntoView({inline:"center"})`, kenar solma gradyanı; `aria-orientation="horizontal"` (Sol/Sağ). Eylem çubuğu sabit alt gezinmenin (`4.5rem`) üstünde; mevcut `FormActions` ofsetleri korunur. Özet panel yerine `<details>` ile "Özet".
- Dokunma hedefi >=44px; alanlar tek sütun; yatay kaydırma yalnız sekme şeridinde.

## (g) Test stratejisi (vitest, ortam node: saf mantık)

DOM testi yok; mantık `src/lib/form-tabs.ts` içine çıkarılır:
- `nextTabId(tabs, current, key)`: ok tuşları, Home/End, döngü, Alt+↑/↓.
- `computeTabState({required, values})` -> `{complete, missing}`; `tabForInvalidField(tabs, fieldName)`.
- `pickDraftFields(values, whitelist)`: hassas alanı asla geçirmez (telefon, e-posta, body, notes için özel test); `draftKey(userId, formId)`; TTL; bozuk JSON ve `localStorage` hatası -> null.
- `commissionSummary(price, rate)`: boş/negatif/sayısal sınırlar.
- Sözleşme testi: tanımlı sekmelerin alan listelerinin birleşimi, ilgili form kaynağındaki `name=` kümesine eşit olmalı (statik kaynak taraması; yetim alan kalmaz).
- Elle/E2E (playwright, yalnız izole test DB): gizli sekmedeki zorunlu alan boşken gönder -> sekme otomatik açılır; gizli sekme alanları payload'da; axe, koyu tema, reduced-motion.

## (h) Uygulama ajanı için dosya yapısı

```
src/components/ui/tabbed-form-shell.tsx   // kabuk (client)
src/components/ui/form-tabs.tsx           // FormTabList / FormTabPanel / FormSummaryRail
src/components/app/use-form-values.ts     // canlı değer aboneliği
src/components/app/use-form-draft.ts      // localStorage taslak (try/catch)
src/lib/form-tabs.ts (+ .test.ts)         // saf mantık
src/app/premium.css                       // gerekirse .tfs-* sınıfları
```
Somut sınıflar (Tailwind 4, token tabanlı):
- Kabuk: `mx-auto w-full max-w-[80rem] lg:grid lg:grid-cols-[14rem_minmax(0,1fr)] xl:grid-cols-[14rem_minmax(0,1fr)_20rem] lg:gap-6`.
- Ray: `lg:sticky lg:top-20 lg:self-start flex lg:flex-col gap-1`; sekme: `flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-text-muted aria-selected:bg-accent/10 aria-selected:text-text aria-selected:font-medium focus-visible:ring-2`.
- Rozet: `ml-auto min-w-5 rounded-full bg-danger/15 px-1.5 text-xs text-danger`; tamam: `text-success` tik.
- Panel: `rounded-[var(--radius-card)] border border-line bg-surface p-6 shadow-[var(--shadow-sm)]`, içerik `grid gap-5 md:grid-cols-2`.
- Özet: `xl:sticky xl:top-20 xl:self-start rounded-[var(--radius-card)] border border-line p-4 text-sm`.
- Geçiş: `motion-safe:animate-[tab-in_150ms_ease-out]`.

Aşamalar: (1) saf mantık + testler, (2) kabuk + Müşteri formu pilot, (3) Portföy, Anlaşma, Sözleşme, Randevu, (4) kalan formlar, (5) `docs/DESIGN_SYSTEM.md` güncellemesi. Her aşamada `npm run type-check`, `npm run lint`, `npm run test` yeşil olmalı.
