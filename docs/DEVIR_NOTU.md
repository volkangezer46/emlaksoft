# DEVİR NOTU — Başka bilgisayarda devam etme rehberi

**Tarih:** 2026-07-27 · Bu belge, Claude Code oturumlarının tüm birikimini yeni bir makinede
kaldığı yerden sürdürebilmek için yazıldı. Yeni oturumda Claude'a "docs/DEVIR_NOTU.md oku" demen yeterli.

---

## 1) Sistemin bugünkü durumu

- **CANLI:** https://emlaksoft.vercel.app (Vercel projesi `emlaksoft`, hesap: volkangezer46)
- **DB:** Supabase `vbtuexdbhvcetswdtzts` (eu-central-1) — **107 migration'ın tamamı uygulı** (`supabase/migrations/`)
- **Ölçek:** 120 rota · 17 cron (`vercel.json`) · 188 birim test (vitest) · 38 E2E (playwright)
- **Son tam doğrulama (2026-07-27, deploy öncesi):** tsc ✔ lint ✔ 188 test ✔ link kontratı ✔
  npm audit 0 açık ✔ RLS denetimi "BULGU YOK" ✔ build ✔ E2E ✔
- Demo tenant: `demo-ofis` — girişler `sahip@ / mudur@ / danisman@demo.emlaksoft.test`, şifre `Demo1234!`
  (yalnız dev'de `ENABLE_DEMO_LOGIN=1` ile hızlı giriş). E2E kullanıcısı: `npx tsx scripts/e2e-user.ts`.

## 2) Oturum geçmişi — ne yapıldı (dalga dalga)

Kapsamlı özellik dökümü ve dalga geçmişi: **`docs/OZELLIK_MASTER_LISTESI.md`** (sondaki
"DURUM GÜNCELLEMESİ" bölümleri kronolojik devir kaydıdır — mutlaka oku).
Kısa özet: ~14 dalga / ~110 paralel ajanla audit'ten tam platforma dönüştürüldü:
tıklanabilirlik kontratı (check:links aracı), liste standardı (sunucu filtre + sayfalama + toplu işlem),
güvenlik (SMS 2FA, RLS sertleştirme, izin istisnaları), Realtime + AI asistan + PWA,
modüller (Kiralama, Projeler, MLS ağı, Gelen Kutusu, sunumlar, NPS, rota, duyurular,
evrak dosyası, segmentasyon, talep-arz haritası, ICS takvim, açık ev QR, vitrin v2...).

## 3) Kalıcı kararlar (User'ın kesin tercihleri — ASLA çiğneme)

1. **Dark mode YOK** — hiçbir zaman eklenmeyecek.
2. **Migration'lar full otomatik**: yazan ajan `npx tsx scripts/apply-one.ts <dosya>` ile HEMEN uygular, kanıt gösterir. Sıradaki numara: **108**.
3. UI **tamamen Türkçe**; ultra premium standart; mor renk yok (Ink #071A38 / Brand #1463FF / Mint / Amber).
4. Bileşen render'ında `Date.now()`/`new Date()` yasak → `src/lib/clock.ts`.
5. Görünen her sayı/kart tıklanabilir; link kontratı `npm run check:links` ile korunur.
6. Çalışma düzeni: paralel arka plan ajanlarıyla "dalga" sistemi (ayrık dosya alanları), her dalga sonrası
   tam doğrulama (tsc/lint/test/build/E2E/links) + kanıtlama ajanı (E2E + ekran görüntüsü QA).

Operasyonel kurallar: **`CLAUDE.md`** ve mimari: **`docs/MIMARI.md`**, **`AGENTS.md`** (Next.js 16 uyarısı).

## 4) Yeni makinede kurulum

```bash
git clone https://github.com/volkangezer46/emlaksoft.git && cd emlaksoft
npm install
npx playwright install chromium
# .env.local'i ESKİ MAKİNEDEN ELLE KOPYALA (git'te YOK — gizli anahtarlar içerir):
#   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
#   DATABASE_POOLER_URL, DATABASE_URL, NEXT_PUBLIC_APP_URL, PLATFORM_ADMIN_EMAILS,
#   ENABLE_DEMO_LOGIN, ALLOW_PLATFORM_DEMO
#   (değerler Supabase Dashboard → Project Settings → API/Database'den de alınabilir)
npm run dev            # geliştirme
npx vercel login && npx vercel link --yes --project emlaksoft   # deploy için
```

Doğrulama komutları: `npx tsc --noEmit` · `npm run lint` · `npm test` · `npm run build` ·
`npx playwright test` · `npm run check:links` · `npm run db:rls-audit`

## 5) Deploy durumu ve kalan işler

Deploy ayrıntısı: **`docs/DEPLOY_CHECKLIST.md`** (üstünde canlı durum notu var).
Vercel prod env'de yüklü: Supabase üçlüsü, `CRON_SECRET` (yeni üretildi, yalnız Vercel'de),
`PLATFORM_ADMIN_EMAILS`, `NEXT_PUBLIC_APP_URL=https://emlaksoft.vercel.app`. Demo kapıları kapalı.

**Kalan işler (öncelik sırasıyla):**
1. Supabase Auth → Site URL `https://emlaksoft.vercel.app` + Redirect `.../sifre-yenile` (panelden, 2 dk)
2. Vercel Pro plan (17 cron'un tam tarifesi; Hobby'de günde 1'e düşer)
3. Özel alan adı (bağlanınca `NEXT_PUBLIC_APP_URL` güncelle + redeploy)
4. Supabase PITR yedekleme + Auth e-posta şablonları Türkçeleştirme
5. Dış anahtarlar (kod hazır): OpenAI (AI/OCR) · Netgsm (2FA/SMS) · iyzico LIVE (+`IYZICO_BASE_URL=https://api.iyzipay.com`!) ·
   İYS entegratörü · VAPID (push) · portal API'leri · WhatsApp Business · CTI
6. Güvenlik: Supabase service_role anahtar rotasyonu (dev'de kullanıldı) → sonra Vercel env güncelle;
   `PLATFORM_ADMIN_EMAILS`'e gerçek admin adresi
7. Vercel projesini bu GitHub repo'suna bağlamak (push = otomatik deploy): Vercel → Settings → Git

## 6) Sohbet kronolojisi (kullanıcı talimatları, sırasıyla)

Yeni oturumun "chat hafızası" budur — kullanıcının verdiği her ana talimat ve karşılığı:

1. "Sistemi full tara, eklenmesi gereken özellik listesi çıkar; dashboardlarda tüm kayıtlar tıklanabilir olsun; ultra premium tema listesi" → `docs/OZELLIK_MASTER_LISTESI.md` üretildi.
2. 35 bölümlük "Emlak İşletim Sistemi" vizyon metni yapıştırıldı → mantıklı olanlar master listeye işlendi.
3. **"dark mode istemiyorum, listeden çıkar; diğerlerinin hepsini hızlı uygula"** → kalıcı kural.
4. "otomatik uygula, işlemleri hızlı ve toplu yap" → paralel ajan dalgaları düzeni kuruldu.
5. **"canlıya alma en son; localde geliştir"** → deploy sona bırakıldı (27'sinde yapıldı, madde 15).
6. "devam et" ×N → dalgalar sürdü (A–K: liste standardı, 2FA, çöp kutusu, izin istisnaları,
   3D dashboard, AI asistan, Realtime, PWA, kanban, Kiralama, Projeler, MLS ağı, gelen kutusu,
   emsal motoru, birleştirme RPC, CSV import, vitrin analitik...).
7. "başka neler kaldı, tam liste" → kalanlar listelendi (lokal / dış hesap / mimari karar).
8. "hepsini eksiksiz tamamla; hız optimizasyonu en iyi seviye; dashboard 3D ultra premium;
   tüm kayıtlar tıklanabilir ve işlem yapılabilir; çok gelişmiş kullanıcı yönetimi" → uygulandı.
9. **"migration yasak değil, herşeyi full otomatik uygulayacaksın"** → kalıcı kural (CLAUDE.md'de).
10. "herşeyi geliştir yap devam et" → **Dalga L**: talep detay sayfası, açık ev QR check-in,
    eşleştirme ağırlıkları her tüketicide, bildirim arşivi, mobil saha çekimi.
11. "geliştir ve devam et" → **Dalga M**: talep-arz haritası, ICS takvim + çakışma freni,
    portföy sunum dosyaları, müşteri sıcaklık segmentasyonu, perf/cron dalgası.
12. "devam et geliştir" → **Dalga N**: anlaşma evrak kontrol listesi, NPS anketi + raporu,
    günün rotası, vitrin v2 (benzer/favori/fiyat alarmı), ofis duyuru panosu.
13. "şimdiye kadar yapılanları test et, canlıya al, kalan işleri listele" → tam test turu yeşil,
    RLS fix (107), Vercel'e deploy edildi, kalanlar raporlandı (bölüm 5).
14. "istediğin bilgi var mı, herşeyi otomatik tamamla" → env yükleme + deploy + duman testi bitirildi.
15. "yapılan tüm işleri ve chati git'e yükle, başka pc ile devam edeceğim" → bu depo + bu belge.
16. **"env local'ı her zaman koy, geliştirme aşamasındayız"** → `.env.local` repo'da tutuluyor
    (`.gitignore`'da `!.env.local` istisnası). Not: ham Claude sohbet transkriptlerinin repo'ya
    kopyalanması güvenlik katmanınca engellendi; bu kronoloji onun yerine geçer. Ham transkriptler
    eski makinede `C:\Users\Laptop\.claude\projects\c--Users-Laptop-Desktop-emlaksoft\*.jsonl`
    yolunda durur; istenirse kullanıcı elle kopyalayabilir.

17. **"panelde mobilde menüde görünmüyor ... tüm panel ekranlarını ultra premium yap, yarım kalanları devam ettir"**
    → **Dalga O (2026-07-27, yeni makine):** (a) Mobil kök neden: üst bar araması sağ menüyü ekran
    dışına itiyordu — kompakt arama + premium alt gezinme çubuğu (Ana ekran/Müşteri/Portföy/Randevu/Menü)
    eklendi; `network` modülü NAV_MODULES'e eklendi (sidebar'da kimseye görünmüyordu). (b) 8 paralel
    ajanla 35+ panel ekranı ultra premium'a çekildi (hero + gerçek verili tıklanabilir KPI + gelişmiş
    filtre + içgörü kartları). (c) ROADMAP_V2: D4 (kira getirisi), D5 (satış süresi tahmini), R8
    (franchise içerik) kapandı; X2 ruhunda kaçan fırsat radarı kayıp-satışta. (d) Kökten düzeltme:
    `use-app-api.ts` ilk render'da localStorage okuyup hidrasyon hatası üretiyordu — LS okuması
    effect'e taşındı (bellek cache'i korunarak). (e) Doğrulama: tsc/lint/188 test/build/check:links/E2E
    (21 geçti, 0 kaldı) + 390px'te 12+ ekran Playwright taraması (taşma 0, sayfa hatası 0).

## 7) 2026-07-29 durumu — Dalga S/T/V sonrası

**CANLI ve güncel:** https://emlaksoft.vercel.app · commit `9a6e055` · migration **126**'ya kadar dev DB'de uygulı.
Ölçek: ~140 rota · 19 cron · **396 birim test** · 40+ E2E. Doğrulama kapıları: `tsc`, `lint`, `npm test`,
`check:links`, `check-schema`, `db:rls-audit`, `audit:actions`, `build` — hepsi yeşil.

**Bu dalgada eklenenler:** tasarım sistemi v2 (`src/lib/icons.ts` ikon sözlüğü, `Badge/Skeleton/Tooltip/
ProgressRing`, mikro animasyon katmanı) · danışman dijital kartviziti (`/danisman/[slug]` + vCard + QR) ·
fotoğraf filigranı + toplu medya işlemleri (DnD sıralama, çoklu seçim) · ekip ligi & 12 rozet (`/app/lig`) ·
yatırımcı getiri paketi (`/app/yatirim`, 10 yıllık projeksiyon + IRR) · belge merkezi (`/app/belgeler`) ·
onay akışları (`/app/onaylar`) · alım maliyeti & kredi hesaplayıcı (`/app/hesaplayici`) · tavsiye programı ·
anahtar takibi · online randevu rezervasyonu · izin takvimi · WhatsApp şablonları · iş akışı (playbook)
motoru · döviz + yabancıya satış paketi · public yüzün ve admin panelinin premium yükseltmesi.

**Düzeltilen gerçek hatalar (P0):** kira anlaşması kazanılınca portföyün "Satıldı" olması (2 ayrı kod
yolu; artık "Kiralandı") · komisyon tahsilatının geri alınamaması · tekrar eden talebin mesajının
kaybolması (artık `communications` kaydı + bildirim) · vitrin değerleme talebinin `valuations` kaydına
dönüşmemesi · malik teklif kararında bildirim gitmemesi · dahili hesap dökümünün müşteri raporuna
sızabilmesi · anlaşma notlarında oturum çözülemeyince yetkinin yanlış açılması.

**Hayata bağlanan ölü özellikler:** müşteri/malik portalı link üretimi (ikisi de sıfır çağıranlıydı;
eşleştirmenin öğrenme döngüsü buna bağlıydı) · eşleştirmeden sunum/randevu/teklif köprüleri ·
kazanılan kira anlaşmasından kira sözleşmesine ön dolgu · randevu tamamlamanın geri alınması + sonuç
kaydı · kazanım sihirbazında memnuniyet anketi adımı.

## 8) SIRADAKİ İŞLER (denetimlerle kanıtlanmış, öncelik sırasıyla)

**A. Sabit tanımları DB'ye taşıma + 5 gerçek hata** (envanter: bu belgede değil, sohbet kaydında;
yeniden çıkarmak için `src/lib/definitions.ts` + `getDefinitions` çağrılarını tara):
1. ✅ **DÜZELTİLDİ (2026-07-29, mig 127):** `appointment_type` CHECK'e `signing`+`other` eklendi
   (contract korundu). Artık ayarlardaki tüm türler insert edilebilir. DB'de doğrulandı.
2. ✅ **DÜZELTİLDİ (2026-07-29, mig 128):** `expense_category` ENUM → `text`. Definitions'tan yeni
   gider kategorisi artık expenses'e yazılabilir. DB'de doğrulandı (data_type=text).
3. ✅ **DÜZELTİLDİ (2026-07-29):** `lead-score.ts` `SOURCE_WEIGHT` `lead-sources.ts` değerleriyle
   hizalandı (portal_sahibinden vb. → 15) + `portal*` öneki fallback. Portal talepleri artık doğru puan alır.
4. ✅ **DÜZELTİLDİ (2026-07-29):** `DEFAULT_COMMISSION_RATE` tek kaynağa çekildi — `leak-shield.ts`
   artık `commission.ts`'ten import ediyor (ikisi de 3). Kayıp-kaçak tahmini komisyon defteriyle tutarlı.
5. Taşınacaklar (HÂLÂ AÇIK): oranlar (`purchase-costs.ts DEFAULT_RATES`, `investment.ts`, `gamification.ts SCORE_RULES`,
   `approvals.ts SLA_HOURS`), şablonlar (evrak/mesaj/kampanya/playbook), periyodik veri
   (`price-health.ts PROVINCE_SQM_PRICE`, `tufe.ts` — 2026 verisi YOK, güncellenmeli).
   Taşınamazlar (yalnız etiket/renk özelleştirilebilir): DB CHECK/ENUM'a veya `if (x === '…')`
   dallanmasına bağlı olanlar — `deals stage`, `permissions.ts` matrisi, güvenlik parametreleri.

**B. Ekran standart yetenek eksikleri** (82 ekran denetlendi):
- **Sessiz veri kaybı**: ~28 ekran filtreyi bellekte uygulayıp sorguyu `limit(N)` ile kesiyor →
  kullanıcı "sonuç yok" görüyor, oysa kayıt tavanın üstünde. **En yüksek öncelik.**
  - **2026-07-29 dalgası — 8 çekirdek ekran DÜZELTİLDİ** (referans `musteriler` deseni:
    sunucu filtresi + `range()` + `count:"exact"` + `?sayfa=` gerçek pager, KPI'lar head-count'tan):
    `portfoyler` · `portallar` · `talepler` · `randevular` (tarih pencereli, takvim korundu) ·
    `gorevler` · `aidat` (liste) · `destek` · `kayip-kacak` (kapanış listesi). `teklifler`/`sozlesmeler`
    zaten sunucu-filtreliydi, yalnız gerçek pager eklendi. `belgeler` zaten doğruydu.
    Runtime duman testi: 10 ekran 200, hata sınırı yok, `?sayfa=2` çalışıyor.
  - **Ertelenenler (RPC/migration gerektirir — bu dalgada migration yasaktı):** `kiralama` filtreleri
    (durum/arıza/evre `rent_charges`+`maintenance_requests`'ten türetiliyor, `rentals`'ta `.eq` yok) ·
    `aidat` KPI tutar SUM'ları (havuz 2000'e çıkarıldı, tam çözüm için RPC) · `kayip-kacak` para
    toplamları/trend (agregat havuz). Kalan liste ekranları da benzer taramayla sürdürülmeli.
- Gerçek sayfalama yalnız 8/82 ekranda (`range()` + `count:"exact"`); 5 ekranda `?sayfa=` var ama
  bellekte `slice()` ile sahte.
- Kullanıcı seçmeli sıralama yalnız `musteriler/page.tsx`'te (referans uygulama).
- Segment düzeyi `error.tsx` yok (tüm panelde tek kök hata sınırı) · `loading.tsx` 21 rotada eksik ·
  CSV ~25 listede yok · `EmptyState` 55 sayfada yok, olanların yarısında yönlendirici aksiyon yok.

**C. Akış kopuklukları** (uçtan uca denetim, kalanlar):
- Proje birim satışı `deals`/`commissions`'a bağlanmıyor → ciro/komisyon/lig raporlarında görünmüyor.
- Ofisler arası ağda `commission_share_pct` kabul edilse de komisyon paylaşımına yazılmıyor.
- Kira sözleşmesi başlayınca/bitince portföy durumu yönetilmiyor; depozito iadesi yok.
- Kayıp-kaçak ekranı salt okunur (kurtarma aksiyonu yok; kayıp-satışta var).
- Ekip çıkışında portföy devri yok (müşteri devri var).
- Silinen kayıtlar için geri yükleme ekranı yok; `won/lost` anlaşma ve müşteri birleştirme geri alınamaz.

**D. Ölü veri denetimi yarım kaldı** — yazılıp okunmayan tablo/kolonlar, hiçbir yerden linklenmeyen
ekranlar, çağrılmayan action'lar, cron çıktısının ekranda görünmediği yerler. Yeniden koşulmalı.

**E. Sidebar'da görünmeyen yeni sayfalar** (doğrudan URL veya ilgili sayfadan erişiliyor):
`/app/lig` · `/app/yatirim` · `/app/belgeler` · `/app/onaylar` · `/app/ekip/kartvizitim` ·
`/app/ekip/izinler` · `/app/portfoyler/anahtarlar` · `/app/portfoyler/sunumlar` · `/app/yabanci-satis` ·
`/app/ayarlar/{filigran,mesaj-sablonlari,is-akislari,duyurular}`. Menüye eklenmeleri değerlendirilmeli
(sidebar zaten uzun — belki gruplama/arama gerekir).

## 9) Bilinen davranışlar / tuzaklar

- E2E'de 2-3 test hidrasyon yarışıyla flaky olabilir → `retries: 1` tasarımı bunu karşılar; build ile
  aynı anda E2E koşturma (CPU çekişmesi kırmızı yaratır).
- `scripts/apply-migrations.ts` KULLANMA (eksik liste) — her zaman `apply-one.ts`.
- Enum ADD VALUE + kullanımı aynı migration dosyasında olamaz (087/087b deseni).
- Yeni modül eklerken 4 kayıt yeri: permissions.ts + NAV_MODULES + sidebar + roller ekranı (CLAUDE.md).
- Geçersiz token'lı public sayfalar HTTP 200 + 404 içerik döner (Next.js streaming) — bilinçli.
- Hosted DB'ye seed/script koşarken `SEED_CONFIRM=1` freni var.
