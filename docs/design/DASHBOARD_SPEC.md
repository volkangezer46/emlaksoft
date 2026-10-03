# EmlakSoft Dashboard ve Konsol Kabuğu Tasarım Şartnamesi

Kapsam: `/app` ana ekran, `/admin` genel bakış, kabuk (yan menü, üst çubuk, ızgara, tablo). Bu belge kod değildir; uygulama ajanı için şartnamedir. Değişmez ilkeler: sahte metrik yok, her sayı `href`'li, seri yoksa grafik yok, yeni bağımlılık yok (saf SVG/CSS), sunucu bileşeni ağırlıklı, AA kontrast, `prefers-reduced-motion`, açık+koyu+vurgu temaları, 390 px ve tablet.

## (a) Referans analizi

Web taramasından çıkan, desen düzeyinde (varlık kopyalanmaz) bulgular:

1. **Stripe Dashboard** — Açılışta tek büyük sayı (brüt hacim) ve grafik; her şey bir tık ötede. Renk kısıtlı: yeşil yalnız başarı, kırmızı yalnız hata. Hiyerarşi renkle değil tipografi ve boşlukla kurulur. Erişilebilir renk sistemi (algısal olarak eşit kontrast kademeleri). Ders: renk anlam taşır, süs olmaz.
2. **Linear** — Yan menü, sekme ve başlıklarda gürültü azaltma, hizalama, yoğunluk artışı. Tema üç değişkenle (taban, vurgu, kontrast) üretilir; vurgu rengi "chrome"da az kullanılır. Başlıkta ayrı bir display yüzü, gövdede Inter. Ders: az token, çok tutarlılık; kontrast kaydırıcısı.
3. **Vercel** — 256 px yeniden boyutlanabilir ve gizlenebilir yan menü, işe göre sıralı öğeler, mobilde tek elle kullanılan alt çubuk. Geist Sans/Mono, nötr zemin. Ders: sayılar ve kimlikler mono/tabular.
4. **Attio** — Linear'a yakın sakin görünüm; kayıt sayfasında yapay zekâ "açıklayan ve sonraki adımı öneren" tasarlanmış bileşen olarak durur. Ders: öneri kartı sohbet balonu değil, aksiyon satırıdır.
5. **Mercury** — Editoryal tipografi, disiplinli renk; yoğun tablolar dekorasyonla değil tipografi disipliniyle okunur. Para "mali tablo" gibi dizilir.
6. **Ramp** — "Yapılacak iş" odaklı: onayla, eşleştir, kapat. Açılışta tasarruf (olumlu sonuç) sayısı. Ders: grafikten önce kalan iş listesi.
7. **Follow Up Boss / kvCORE** — FUB: açılışta bugün kime ne zaman ulaşılacağı, kayıtlı dinamik "Smart List"ler (filtre = menü). kvCORE: çok özellikli ama öğrenme eğrisi dik. Ders: "bugün" kuyruğu birinci sınıf; özellik şişkinliği düşmandır.
8. **Raycast / Superhuman (komut paleti)** — Her yerde aynı kısayol (Cmd/Ctrl+K), "Son kullanılanlar" grubu üstte, bulanık eşleşme, kısayol ipuçları satır sonunda, bulunulan sayfaya göre kapsamlı eylemler, `aria-activedescendant`.
9. **Pipedrive / HubSpot** — Pipeline'ın görsel birincilliği ve "bugünün etkinlikleri"; HubSpot'ta özelleştirilebilir ama gürültülü pano. Ders: kişiselleştirme sınırlı kalmalı (blok sırası), yoksa pano dağılır. (Bu ikisi için doğrudan kaynak çekilmedi; genel bilgi, kesin iddia değil.)
10. **Genel rehberler (2026)** — Ekran başına 5-9 metrik, tek birincil metrik sol üstte (F okuma deseni); bento ızgarası farklı boy kutuları ile KPI (2x1), grafik (2x2), liste (1x2) karıştırır; koyu temada zemin saf siyah olmaz, yükselti yüzeyi açarak gösterilir (kademe başına yaklaşık %4-6 açıklık), vurgu doygunluğu düşürülür.

Mevcut ürünün teşhisi ("premium değil, zengin değil" şikayeti): (1) HeroBanner + `CityNight` + 4 cam KPI + 8 KpiCard üst üste **aynı ağırlıkta 3 KPI katmanı**; ilk ekran hiyerarşisiz. (2) Lacivert gradient + altın + gölge + ikon rozeti her kartta tekrarlanıyor; vurgu her yerde olunca hiçbir yerde değil. (3) Yan menü 260 px sabit, daraltılamıyor, lacivert degrade; içerik alanı ile ayrı bir dil konuşuyor. (4) Sayı tipografisi Manrope 800 ağırlıkta ama `tabular-nums` ve birim küçültme sistemi yok. (5) Kartlar hep aynı boyda, ızgara ritmi yok (bento yok). (6) Sayfa tek kolonda 12 blok alt alta; "bugün" kuyruğu hero'nun altına itilmiş.

## (b) Seçilen yön: "Sakin Konsol, Altın Vurgu"

Gerekçe: emlak danışmanı günde onlarca kez açar; hedef kullanıcı Stripe/Linear'in sakin netliği + FUB'ın "bugün kime ne" kuyruğu. Süs azalır, malzeme (yüzey kademesi, tipografi, tek vurgu) artar. Zenginlik dekordan değil **veri yoğunluğu ve doğru hiyerarşiden** gelir. Altın yalnız para ve "premium an" için (komisyon, hedef, aktif menü işareti); marka vurgusu (`--accent`) etkileşim içindir.

**Tipografi** (mevcut fontlar: Manrope, Inter, Geist Mono; yeni font yok):
- Sayfa başlığı: Manrope 700, 24/30 (mobil 20/26), `letter-spacing:-0.02em`.
- Bölüm başlığı: Manrope 650-700, 15/20. Eyebrow: Inter 600, 11/16, `tracking .08em`, büyük harf (TR yerel büyütme).
- Gövde: Inter 14/20; ikincil 13/18; mikro 12/16 (eyebrow dışında 12 altı metin yok).
- **Büyük sayı:** Manrope 700 (800 değil), `font-variant-numeric: tabular-nums`, 28/32 standart KPI, 36/40 yalnız birincil KPI; birim/para simgesi (₺, %, gün) %55 boyutta ve `--text-muted`; "₺1,2 Mn" kısaltması yalnız dar kartta, tam değer `title`/tooltip. Tablo ve ID: Geist Mono veya Inter tabular.

**Renk** (tokens.css ile uyumlu; yeni olanlar belirtildi):
- Açık: `bg #f6f8fc`, `surface #ffffff`, `raised #ffffff`, `overlay #ffffff + elev-5`, `sunken #eef2f9` (yeni), metin `#172033`, muted `#5b6577`, faint `#667085`, çizgi `rgba(10,34,71,.08)`.
- Koyu (saf siyah yok; kademe başına ~%5 açıklık): `bg #0a1020`, `surface #101a2e`, `raised #15213a`, `overlay #1b2a48` (yeni, opak), `sunken #080d19`; metin `#e8edf7`, muted `#a3afc6`, faint `#7d8aa5`. Yükselti = açık yüzey + `inset 0 1px 0 rgba(255,255,255,.06)`; koyuda dış gölge yalnız overlay'de.
- Marka: ocean `--brand-600 #1463ff` (beyaz üstü ≥4.5:1 testi korunur). Altın: `--gold-500 #d4a24c` dolgu/işaret, metin `--pm-gold-text` (#7a5200 açık, #f0c36a koyu).
- Anlamsal: başarı `#0d9373`, uyarı `#c27803`, tehlike `#dc3b3b`; koyuda `#34d3bd / #fbbf24 / #f87171`. Kural: yeşil/kırmızı yalnız durum anlamı taşır; grafik serisi için nötr + tek vurgu.
- Vurgu temaları (ocean, emerald, indigo, amber, graphite ve mevcutlar): yalnız `--brand-*` döner; **altın sabit kalır**, "para" her temada tanınır. Amber temada `--accent` ile `--gold` yakınlaşır: para değerinde ₺ simgesi ve ikon zorunlu, renk tek ayırıcı olmaz.
- Yasak: dekoratif gradient dolgu. `--grad-brand` yalnız logo ve birincil CTA'da.

**Yüzey hiyerarşisi:** L0 `bg` (sayfa) → L1 `surface` (kart, `1px hairline`, `elev-1`) → L2 `raised` (hover/seçili kart, popover: `elev-2`) → L3 `overlay` (dialog, komut paleti, dropdown: `elev-4/5`). `backdrop-blur` yalnız üst çubuk ve palette; kartlarda yok (performans ve sadelik).

**Gölge/kenarlık:** kart = `1px solid var(--hairline)` + `inset-top` + `elev-1`; hover `elev-2` ve kenar `color-mix(accent 30%)`. Kartlar hareket etmez (translateY yok); yalnız gölge/kenar geçişi. Radius: kart 14, panel 16 (20'den indir), kontrol 10, chip 8, palet/dialog 20.

**İkon:** lucide, stroke 1.75; 16 px (liste/menü), 18 px (başlık), 20 px (boş durum). Kart başlıklarında **ikon rozeti yok**: ikon 16 px, `--text-faint`, etiketin solunda. Renkli ikon yalnız durum (uyarı/hata) için.

**Hareket:** 120-180 ms, `cubic-bezier(.2,.7,.2,1)`; yalnız opacity/transform/box-shadow. Bütçe bölüm (g)'de.

## (c) `/app` ana ekran mimarisi

İlke: **ilk ekran (1440x900, scroll'suz) "bugün" cevabını verir**: ne yapmalıyım, para nerede, neye dikkat. Mevcut `_home/*` bileşenleri ve `data.ts` loader'ları korunur (cache + Suspense); yalnız yerleşim ve görsel dil değişir. HeroBanner **kaldırılır**; yerine sade bir başlık şeridi (B0).

### Bento ızgara
Masaüstü ≥1280: `grid-cols-12`, `gap-4`. Tablet 768-1279: 6 sütun. Mobil <768: tek sütun, sıra önem sırasıdır; ilk ekranda B0-B3.

| Blok | Masaüstü (sütun) | Tablet | Mobil |
|---|---|---|---|
| B0 Başlık şeridi | 12 | 6 | 1 |
| B1 Bugün kuyruğu | 5 (2 satır) | 6 | 1 |
| B2 Birincil KPI + gelir grafiği | 7 | 6 | 1 |
| B3 KPI şeridi (4 kompakt) | 12 (4x3) | 3+3 | 2x2 |
| B4 Kayıp-kaçak | 4 | 3 | 1 |
| B5 Randevular (bugün) | 4 | 3 | 1 |
| B6 Hedef | 4 | 6 | 1 |
| B7 Satış hunisi | 6 | 6 | 1 |
| B8 Aktivite akışı | 6 | 6 | 1 |
| B9 Ekip + portal sağlığı | 6 | 6 | 1 |
| B10 Son müşteriler | 12 | 6 | 1 |

### Bloklar

**B0 Başlık şeridi.** Amaç: bağlam + dönem. Sol "Günaydın, Ayşe" (20-24 px Manrope), altında eyebrow (tarih, mevcut `heroEyebrow`). Sağ: `PeriodToggle` (7/30/90) ve "Müşteri +" birincil düğme. Veri: `ctx.period`, saat (`clock.ts`). Arka plansız; `CityNight` ana sayfadan çıkar (yalnız `TvUst` ve boş ofis kapısında dekor kalabilir).

**B1 Bugün kuyruğu** (en önemli blok). Amaç: FUB tarzı "kime ne yap". Veri: `buildDailyBriefing` (`BugunOzet`: gecikmiş görev, bugünkü randevu, sıcak müşteri, teyitsiz ilan, bekleyen komisyon, süresi dolan yetki) + `loadTaskSummary`. Tarif: dikey liste, satır 44 px: 16 px durum ikonu, tek cümle ("3 görev gecikti"), sağda sayı ve `ChevronRight`; satırın tamamı filtrelenmiş hedefe `href`. En çok 6 satır, öncelik: gecikmiş > bugün > sıcak > teyit > komisyon. AI özeti (`BriefingAiLine`) altta tek satır; anahtar yoksa gizli. Boş durum: onay işareti, "Bugün için acil iş yok", tek eylem "Yeni talep ekle".

**B2 Birincil KPI + gelir grafiği.** Amaç: "para ne durumda". Sol üst tek büyük sayı "Bekleyen komisyon" (36 px, altın vurgu), yanında `TrendPill` ve "Önceki ay ₺…". Altında 6 aylık komisyon çubuk grafiği (`loadCommissionSummary().monthTotals`, saf SVG, ~180 px, gerçek ay adı etiketleri, son ay vurgulu, diğerleri `--text-faint` %40). <2 nokta ise grafik yok; yalnız sayı ve "İlk komisyon kaydında grafik oluşur" ipucu (sayı değil). Kartın tamamı `/app/komisyon?durum=bekleyen`. İkincil sayılar (beklenen/tahsil) yalnız kodda gerçekten hesaplanıyorsa.

**B3 KPI şeridi.** Mevcut 8 KpiCard yerine 4 kompakt kart: Yeni müşteri, Yeni talep, Portföy, Bugünkü arama (hepsi `loadKpiCounts`/`loadPeriodStats`'ta hesaplanıyor). Diğerleri (teyitsiz ilan, kayıp) B1/B4'te zaten var; çoğaltılmaz. Anatomi: etiket (13 px muted, hover'da `ChevronRight`); sayı (28 px tabular); trend rozeti + "Önceki 7 gün 6"; alt 28 px sparkline **yalnız `hasSeries`** ise ve `xl`+. İkon rozeti yok. 0 ise "0" yazılır, trend gösterilmez (`computeTrend` baz 0).

**B4 Kayıp-kaçak** (`KayipKacak`, `loadClosures`, `loadLiveListings`). Tutar >0 ise üst kenarda 3 px `--danger` çizgi; başlık "Bu ay tahmini kayıp ₺…" (gerçek `sumLost`), altında en çok 3 satır (ilan, gecikme gün, tutar), "Tümü" bağlantısı. Boş: yeşil onay, "Bu ay kayıp kaydı yok".

**B5 Randevular** (`loadTodayAppointments`). Dikey çizelge: sol saat (mono), sağ müşteri + tür; sıradaki randevu `--accent` sol kenarlı + "45 dk sonra" (`clock.ts`). Boş: "Bugün randevu yok" + "Randevu planla".

**B6 Hedef** (`loadOfficeTarget`). SVG halka (`stroke-dasharray`, 72 px) + gerçekleşen/hedef; yalnız hedef tanımlıysa, altın renk. Tanımsızsa tek satır CTA "Aylık hedef belirle"; sahte yüzde yok.

**B7 Satış hunisi** (`Huni`, `loadDemandCounts`). Yatay çubuklar (saf CSS), aşamada sayı + dönüşüm yüzdesi yalnız iki taraf >0 ise; her çubuk talepler listesine filtreli `href`.

**B8 Aktivite akışı** (`CanliAkis`). Zaman damgalı dikey akış: avatar 24 px, tek cümle, göreli zaman (muted); en çok 8, "Bugün / Dün" gruplu; mevcut realtime yenileme. Boş: "Henüz hareket yok".

**B9 Ekip + portal sağlığı** (`Ekip`, `PortalSagligi`): kompakt iki mini tablo (kişi ve bu ay değerleri; portal, son senkron, durum noktası). Her satır ilgili filtreye gider.

**B10 Son müşteriler.** `HizliAksiyonlar` kartı kaldırılır (hızlı oluştur üst çubuğa taşındı, bkz. e); yalnız "Son müşteriler" tablosu (bkz. f).

Korunur: `BosOfisKapisi`, `KurulumSeridi`, `OrnekVeri`, `DuyuruSatiri` (B0 altında tek satır), TV modu (`tv-zoom`, tek sütun, hareket yok). `HedefKarti`/`KiralamaProje` yalnız yetki ve veri varsa B6/B3 altında şerit.

## (d) `/admin` genel bakış (rol bazlı)

Mevcut `page.tsx` role göre `BillingHome` / `SupportHome` / varsayılan panel seçiyor; yapı korunur, aynı bento dili uygulanır, HeroBanner yok.
- **Süper admin:** B0 + birincil kart **MRR** (`exactMrr`, `platform_reporting_aggregates`), MRR eğrisi (`exactTrendMrr`; seri yoksa grafik yok). Yanında 3 kompakt KPI: yeni ofis (`newTenants` vs `prevTenants`), yeni destek talebi (`newTickets` vs `prevTickets`), aktif ofis. Altta: son ofisler tablosu, denetim akışı (`audit`), haftalık yeni ofis mini grafiği (mevcut SVG, token renkleriyle). Her sayı ilgili `/admin/...` filtresine gider.
- **Faturalama:** birincil: tahsilat bekleyen/geciken tutar; geciken fatura ve başarısız ödeme kuyruğu B1 stilinde; MRR değişimi ikincil.
- **Destek:** birincil: SLA'sı aşılan talepler; "Bana atanan / atanmamış" kuyruğu B1 stilinde; ilk yanıt süresi yalnız hesaplanıyorsa.
- Karışıklığı önlemek için: yan menüde "Platform" etiketi, üst çubukta 2 px `--gold` çizgi. TOTP kapalı uyarısı (`PLATFORM_MFA_ENFORCEMENT`) üst çubuğun altında tek satır `--warn` şeridi.

## (e) Kabuk

**Yan menü** (`app-sidebar.tsx`, `nav-config.ts` tek kaynak, 9 başlık korunur).
- Üç mod: **geniş** 248 px, **ikon-only** 64 px, **mobil çekmece**. Daraltma düğmesi menü altında + kısayol `[`; durum `localStorage` + çerez (SSR'da titremez). İkon-only'de tooltip ve `aria-label`; aktif öğe 3 px sol altın çubuk + `surface-accent-soft` zemin.
- Zemin: lacivert degrade yerine **temayı izleyen** `surface` (açık `#fbfcff`, koyu `#0d1627`) + sağda 1 px hairline (Linear/Vercel çizgisi). Lacivert marka menüsü "Menü stili" ayarında seçenek olarak kalır.
- Gruplar: Bugün, Müşteriler, Portföy, Anlaşmalar, İletişim, Finans, Performans, Araçlar, Ofis; daraltılabilir akordeon (durum saklanır), aktif grup otomatik açık. Başlık eyebrow stili. Öğe 32 px, 13/18 metin, 16 px ikon. Sayaç rozeti yalnız gerçek veri.
- Üst: ofis logosu (32 px); alt: kullanıcı + plan. Mobil: sol çekmece + alt sekme çubuğu (Bugün, Müşteri, Portföy, Randevu, Daha fazla), `safe-area-inset-bottom`.

**Üst çubuk** (sticky, 56 px, `bg-surface/85 backdrop-blur-xl`, alt hairline). Soldan: menü düğmesi (mobil), **breadcrumb** (en çok 3 seviye, son öğe `aria-current`), ortada **arama/komut paleti tetikleyicisi** (320 px kapsül "Ara veya komut yaz  Ctrl K"; mobilde ikon). Sağda: **Hızlı oluştur** `+` (mevcut `quick-create-menu`), bildirim (`notification-bell`), klavye yardımı/tema, kullanıcı menüsü. Mevcut `command-search` paleti: gruplar (Son kullanılanlar, Sayfalar, Müşteriler, Portföy, Eylemler), bulanık eşleşme, kısayol ipuçları, sayfa kapsamlı eylemler, `aria-activedescendant`, `Esc`, odak tuzağı.

**Sayfa başlığı ve breadcrumb:** `PageHeader`: breadcrumb → H1 (24 px) + isteğe bağlı tek satır açıklama → sağda en çok 1 birincil + 1 ikincil + `...` menü. Sayfada tek H1. Breadcrumb ilk öğesi "Bugün". Başlıkta emoji/dekor yok. Detay sayfasında başlık = kayıt adı, yanında durum rozeti.

## (f) Tablo/liste standardı
`DataTable` (mevcut) esas. Satır 44 px (normal) / 36 px (yoğun; kullanıcı seçer, saklanır). Başlık: 12 px, 600, muted, yapışkan, alt hairline. Sayısal/para sütunlar sağa hizalı `tabular-nums`; kimlik/telefon mono. Ayırıcı yalnız hairline, zebra yok; hover `surface-sunken`; seçili satır `accent-soft` + sol 2 px çizgi. Tam satır `Link`; son sütunda hover'da beliren eylem menüsü (dokunmatikte hep görünür). Durum = `StatusBadge` (metin + nokta). Toplu seçim çubuğu altta yapışkan. Filtre kontratı: URL ↔ UI iki yönlü, sunucu sayfalama, üstte `FilterBar`, `saved-views`. Mobil <640: satır kart-listeye döner (başlık, 2 ikincil alan, durum); yatay kaydırma yalnız gerçek tablolarda. Boş durum: `empty-state-v3`, 20 px ikon, tek cümle neden, tek birincil eylem; filtre boşsa "Filtreleri temizle". İskelet: gerçek satır yüksekliğinde 6 satır.

## (g) Mikro etkileşim ve animasyon bütçesi
- Sayfa yüklemede toplam hareket **≤ 600 ms**, aynı anda en çok 8 animasyonlu öğe.
- **Sayaç:** yalnız B2 ve B3 sayıları, 600 ms ease-out, küçük istemci adası (`CountUp`, `IntersectionObserver`, ilk görünümde bir kez). SSR HTML'de gerçek rakam bulunur (JS'siz doğru; `tabular-nums` ile zıplama yok). Reduced-motion: anında.
- **Skeleton:** Suspense fallback'leri blok boyutunda, CLS 0; 1.4 s opacity pulse (reduced-motion: statik).
- **Geçişler:** kart hover 140 ms (gölge+kenar), düğme basma `scale(.98)` 80 ms, palet açılışı 120 ms fade + 4 px, sayfa geçişi yok. Grafik çubukları 280 ms `scaleY` giriş, yalnız ilk yükleme.
- Bildirim: `toast-provider`, 4 s. Yasak: parıldayan dekor, sonsuz döngü (canlı nokta hariç; reduced-motion'da statik), parallax.

## (h) Performans ve erişilebilirlik
- Bütçe: LCP <2.0 s, CLS <0.05, INP <200 ms, ana sayfa ek istemci JS ≤ 25 KB gzip. Grafikler sunucuda saf SVG; `recharts` yalnız zaten lazy raporlarda. `CityNight` çıkınca SVG ağırlığı düşer.
- Veri: yalnız `_home/data.ts` `cache()` loader'ları; yeni sorgu yok. Akış: B0/B1/B2 önce, kalanı Suspense ile.
- Kontrast: metin ≥4.5:1, UI/grafik çizgisi ≥3:1 (açık, koyu, her vurgu); `design-tokens-contract.test.ts` yeni yüzeyleri (overlay, sunken) kapsayacak biçimde genişletilir. Renk tek bilgi taşıyıcı değil.
- Klavye: tüm kartlar odaklanabilir `Link`, çift halkalı `focus-ring`; "Ana içeriğe geç" bağlantısı; `nav/main/header` landmark'ları; palet/çekmece odak tuzağı. Grafiklere `role="img"` + özet etiket (mevcut `seriesLabel`) ve `sr-only` veri tablosu.
- Dokunmatik hedef ≥44 px (mobil), 390 px'te yatay kaydırma yok, 16 px gutter. `prefers-reduced-motion` ve `prefers-contrast` desteği. Zaman yalnız `src/lib/clock.ts`.

## (i) Uygulama ajanı için somut öneriler

**CSS değişkenleri** (`tokens.css` + `theme-dark.css`):
```css
:root{
  --surface-overlay:#fff; --surface-sunken:#eef2f9;
  --radius-panel:16px;
  --gap-bento:1rem; --row-h:44px; --row-h-dense:36px;
  --sidebar-w:248px; --sidebar-w-collapsed:64px; --topbar-h:56px;
  --ease-out:cubic-bezier(.2,.7,.2,1); --dur-1:120ms; --dur-2:160ms; --dur-3:280ms;
}
html[data-theme="dark"]{ --surface-overlay:#1b2a48; --inner-top:inset 0 1px 0 rgba(255,255,255,.06); }
```
**Sınıflar** (yeni `src/app/console.css`, `premium.css`'in yerini aşamalı alır): `.bx` (bento kutusu: `rounded-[var(--radius-panel)] border border-[var(--hairline)] bg-surface p-4 sm:p-5`), `.bx-hover`, `.num` (`tabular-nums font-[family-name:var(--font-manrope)] font-bold tracking-tight`), `.eyebrow`, `.row` (44 px). Tailwind örnekleri: ızgara `grid grid-cols-1 gap-4 md:grid-cols-6 xl:grid-cols-12`; blok `md:col-span-6 xl:col-span-5 xl:row-span-2`; kuyruk satırı `flex min-h-11 items-center gap-3 rounded-[var(--radius-control)] px-3 hover:bg-[var(--surface-sunken)] focus-ring`; sayı `num text-[1.75rem] leading-8`; menü `w-[var(--sidebar-w)] data-[collapsed=true]:w-[var(--sidebar-w-collapsed)] transition-[width] duration-150`.

**Dosya yapısı:**
```
src/components/ui/console/
  bento.tsx        # <Bento>, <Bx span> (sunucu)
  stat-hero.tsx    # B2 birincil KPI + grafik
  stat-compact.tsx # B3 kart (KpiCard geriye uyumlu kalır)
  queue-list.tsx   # B1 satır
  count-up.tsx     # tek istemci adası
  ring.tsx bars.tsx  # saf SVG
src/components/app/sidebar-shell.tsx  # daraltma durumu (istemci adası); app-sidebar sunucu kalır
src/app/app/_home/layout-bento.tsx    # page.tsx'in yeni kompozisyonu
```
**Aşamalar:** (1) token + `.bx` + yüzey kademesi (düşük risk); (2) kabuk: menü daraltma, üst çubuk, breadcrumb; (3) `/app` bento B0-B3; (4) kalan bloklar; (5) `/admin` rol panelleri; (6) tablo standardı. Her aşamada `npm run type-check`, `lint`, `test` (kontrast sözleşmesi), açık/koyu x vurgu teması görsel kontrol, 390/768/1440 ekran görüntüsü.

**Kabul ölçütleri:** ilk ekranda en çok 1 büyük sayı + 4 kompakt + 1 kuyruk; sıfır sahte değer (her sayı bir loader'dan ve `href`'li); hero gradient yok; kart hover'da hareket yok; menü daraltılabilir ve durum kalıcı; reduced-motion'da hareket yok.

## Kaynaklar
- https://improvado.io/blog/dashboard-design-guide
- https://www.saasframe.io/blog/designing-bento-grids-that-actually-work-a-2026-practical-guide
- https://www.orbix.studio/blogs/bento-grid-dashboard-design-aesthetics
- https://linear.app/now/how-we-redesigned-the-linear-ui
- https://linear.app/now/behind-the-latest-design-refresh
- https://stripe.com/blog/accessible-color-systems
- https://www.925studios.co/blog/stripe-dashboard-design-breakdown
- https://vercel.com/changelog/dashboard-navigation-redesign-rollout
- https://www.saasui.design/application/attio
- https://www.themasterly.com/blog/fintech-dashboard-design-guide
- https://adminlte.io/blog/fintech-dashboard-design-examples/
- https://blog.superhuman.com/how-to-build-a-remarkable-command-palette/
- https://www.setproduct.com/blog/command-palette-ui-design-guide
- https://www.selecthub.com/real-estate-crm-software/kvcore-vs-follow-up-boss/
- https://superdesign.dev/styles/dark-mode
- https://www.aydesign.ai/blog/dark-mode-dashboard-design-patterns-2026
