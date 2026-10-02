# DEVİR NOTU — Başka bilgisayarda devam etme rehberi

**Tarih:** 2026-07-27 · Bu belge tarihsel ürün/devir geçmişidir.

> [!IMPORTANT]
> **Güncel operasyon kaydı:** `docs/DEVIR_2026-08-10_RELEASE_HARDENING.md`.
> Public Git geçmişinde credential sızıntısı ve canlı DB'de migration checksum drift'i vardır.
> Eski `.env.local` başka bilgisayara kopyalanmayacak; yalnız döndürülmüş yeni sırlar güvenli
> secret manager üzerinden kurulacak. Rotasyon ve ledger uzlaştırması bitmeden commit, push,
> migration veya deploy yapılmayacak. Aşağıdaki sayaçlar/talimatlar tarihsel olabilir.

---

## 1) Sistemin bugünkü durumu

- **CANLI:** https://emlaksoft.vercel.app (Vercel projesi `emlaksoft`, hesap: volkangezer46)
- **DB:** Hedef Supabase ortamını ada bakarak varsaymayın. Canlı durum yalnız
  `npm run check:migrations -- --database` salt-okunur ledger kontrolüyle belirlenir.
- **Ölçek:** Rota, cron, migration ve test sayıları sürekli değişir; güncel envanter
  statik kapılar ve test çıktısından alınır, bu belgede sabit sayaç tutulmaz.
- **Yayın kanıtı:** TypeScript, lint, unit/contract, link/action/cron/migration,
  dependency audit, production build ve salt-okunur public E2E birlikte geçmelidir.
- Demo tenant: `demo-ofis` — girişler tek-tuş demo akışından hazırlanır; ortak veya belgelenmiş parola yoktur.
  (yalnız dev'de `ENABLE_DEMO_LOGIN=true` ile hızlı giriş). Oturumlu E2E; açık
  `E2E_MUTATION_ALLOWED=true`, benzersiz kimlik bilgileri ve izole test DB ister.

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
2. **Migration'lar forward-only ve kontrollü**: uygulanmış dosya değiştirilmez.
   Önce checksum/ledger dry-run, restore edilebilir backup/PITR ve bakım penceresi;
   ardından `npm run db:migrate`. Ledger drift varsa canlıya hiçbir şey yazılmaz.
3. UI **tamamen Türkçe**; ultra premium standart; mor renk yok (Ink #071A38 / Brand #1463FF / Mint / Amber).
4. Bileşen render'ında `Date.now()`/`new Date()` yasak → `src/lib/clock.ts`.
5. Görünen her sayı/kart tıklanabilir; link kontratı `npm run check:links` ile korunur.
6. Çalışma düzeni: paralel arka plan ajanlarıyla "dalga" sistemi (ayrık dosya alanları), her dalga sonrası
   tam doğrulama (tsc/lint/test/build/E2E/links) + kanıtlama ajanı (E2E + ekran görüntüsü QA).

Operasyonel kurallar: **`CLAUDE.md`** ve mimari: **`docs/MIMARI.md`**, **`AGENTS.md`** (Next.js 16 uyarısı).

## 4) Yeni makinede kurulum

```bash
git clone https://github.com/volkangezer46/emlaksoft.git && cd emlaksoft
npm ci
npx playwright install chromium
# ESKİ .env.local KOPYALANMAZ. .env.example temel alınır; Supabase/Vercel/DB
# panellerinde döndürülmüş yeni değerler güvenli secret manager üzerinden kurulur.
npm run dev            # geliştirme
# Deploy bağlantısı ancak docs/DEVIR_2026-08-10_RELEASE_HARDENING.md içindeki
# secret + migration engelleri kapatıldıktan sonra kurulur.
```

Doğrulama komutları: `npm run type-check` · `npm run lint` · `npm test` · `npm run build` ·
`npm run test:e2e:public` · `npm run check:links`. `npm run db:rls-audit` gerçek INSERT
denemeleri yaptığı için production'da değil, yalnız izole clone/staging DB'de çalıştırılır.

## 5) Deploy durumu ve kalan işler

Deploy ayrıntısı: **`docs/DEPLOY_CHECKLIST.md`** (üstünde canlı durum notu var).
Vercel prod env'de yüklü: Supabase üçlüsü, `CRON_SECRET` (yeni üretildi, yalnız Vercel'de),
`PLATFORM_ADMIN_EMAILS`, `NEXT_PUBLIC_APP_URL=https://emlaksoft.vercel.app`. Demo kapıları kapalı.

**Kalan işler (öncelik sırasıyla):**
1. Supabase Auth → Site URL `https://emlaksoft.vercel.app` + Redirect `.../sifre-yenile` (panelden, 2 dk)
2. Vercel Pro plan (sözleşmeyle doğrulanan cron envanterinin tarifesi için)
3. Özel alan adı (bağlanınca `NEXT_PUBLIC_APP_URL` güncelle + redeploy)
4. Supabase PITR yedekleme + Auth e-posta şablonları Türkçeleştirme
5. Dış anahtarlar (kod hazır): OpenAI (AI/OCR) · Netgsm (2FA/SMS) · iyzico LIVE (+`IYZICO_BASE_URL=https://api.iyzipay.com`!) ·
   İYS entegratörü · VAPID (push) · portal API'leri · WhatsApp Business · CTI
6. **SEV-1 güvenlik:** Public Git geçmişine girmiş legacy `service_role` anahtarını aktif kabul et.
   Önce yeni bağımsız `SUPABASE_SECRET_KEY` üret, yerel/Vercel ortamlarını güncelle ve legacy anahtarı
   devre dışı bırak; eski anahtarın artık çalışmadığını doğruladıktan sonra koordineli geçmiş temizliği yap.
   Ayrıca DB parolasını döndür ve `PLATFORM_ADMIN_EMAILS`'e gerçek admin adresi ekle.
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
9. **Tarihsel talimat:** "migration yasak değil, herşeyi full otomatik uygulayacaksın".
   Bu ifade artık operasyon yetkisi değildir; 10 Ağustos belgesindeki backup/PITR, ledger
   bütünlüğü ve açık onay kuralları tarafından geçersiz kılınmıştır.
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
16. **Tarihsel ve artık güvensiz talimat:** "env local'ı her zaman koy". Bu talimat açıkça
    yürürlükten kaldırılmıştır. `.env.local` track edilmez veya başka bilgisayara kopyalanmaz;
    yalnız döndürülmüş yeni sırlar güvenli secret manager üzerinden kurulur. Ham sohbet
    transkriptleri de repo/devir paketine eklenmez; bu sanitize edilmiş kronoloji onların yerini alır.

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

## 6.5) 2026-07-29 (2. oturum) — Dalga W: akış kopuklukları + denetim + perf

Migration **130**'a kadar dev DB'de uygulı (127 appointment CHECK · 128 expense enum→text ·
129 kira yaşam döngüsü · 130 aidat_kpi RPC). Bu oturumda kapatılanlar:
- **A.1–A.4**: appointment_type CHECK, expense_category enum→text, lead-score kaynak hizalama,
  DEFAULT_COMMISSION_RATE tek kaynak.
- **B**: 8 çekirdek liste ekranı gerçek sayfalama; aidat KPI tam SUM (RPC).
- **C akış kopuklukları (5/6)**: proje satışı→deal+commission · kayıp-kaçak "Teyit et" kurtarma ·
  ekip iş yükü devri (müşteri+portföy) · kira portföy durumu+depozito · anlaşma won/lost geri alma.
  **C.2** (çapraz-ofis komisyon uzlaşma) bilinçli ertelendi.
- **Perf**: Vercel `fra1` bölgesi (Supabase eu-central komşusu) + admin sidebar prefetch + admin
  layout/dashboard `unstable_cache`. Tema: koyu-hero select popup + mor temizliği + admin export butonu.
- **E**: 5 gizli premium sayfa sidebar'a.
- **Tam denetim (4 ajan)**: tüm ekranlar işlev+hız tarandı — franchise konsolide toplam hatası,
  5 sıralı-await→paralel, ~13 clock-saflığı düzeltildi. projeler StatCard href.
- **Keşif (ölü veri + yeni liste)**: 7 ölü-yazım kolonu/tablo, 23 çağrılmayan action, 14 maddelik
  geliştirme listesi çıkarıldı → **Dalga W2** ile en yüksek etkililer uygulanıyor (ölü-yazım hayata
  bağlama, CSV export, portal kaldır/güncelle, yetki süresi, vitrin görüntülenme, lig tarihçesi).

**Kalan ağır (dedike dalga):** C.2 çapraz-tenant komisyon · A.5 sabit tanımları DB'ye (+TÜFE 2026
verisi) · müşteri birleştirme geri alma · kayıp-kaçak aggregate RPC · dead-action temizliği (~15).

## 7) 2026-07-29 durumu — Dalga S/T/V sonrası

**Tarihsel 29 Temmuz anlık görüntüsü:** https://emlaksoft.vercel.app · commit `9a6e055` ·
migration **126**'ya kadar dev DB'de uygulanmıştı. Güncel durum için 10 Ağustos devir belgesini oku.
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
- ✅ **DÜZELTİLDİ (2026-07-30):** Gerçek sayfalama taraması yeniden koşuldu — "5 sahte pager"
  rakamı eskimiş; 3 ekran (aktivite/gelen-kutusu/belgeler) zaten doğru çok-kaynak deseni, tek gerçek
  sahte `portfoyler/anahtarlar` idi → sunucu `.range()` + `count:"exact"` + durum SQL filtresi + ayrı
  head-count sayaçlar (`destek` deseni). `eslestirme` hesaplama motoru (kartezyen skor) — sayfalama
  hatası değil, ayrı performans notu.
- Kullanıcı seçmeli sıralama yalnız `musteriler/page.tsx`'te (referans uygulama).
- Segment düzeyi `error.tsx` yok (tüm panelde tek kök hata sınırı — kabul edilebilir).
  ✅ **DÜZELTİLDİ (2026-07-30):** `loading.tsx` eksik 15 `/app` segmentine eklendi (envanter yeniden
  koşuldu; admin tarafı zaten tam). Kalan: CSV ~25 listede yok · `EmptyState` bazı sayfalarda yok.

**C. Akış kopuklukları** (uçtan uca denetim, kalanlar):
- ✅ **DÜZELTİLDİ (2026-07-30):** Sözleşme "İptal" (cancelled) durumu UI'da gösteriliyordu ama hiçbir
  buton `cancelContract`'a bağlı değildi → sözleşme detayına onaylı **"İptal et"** eklendi
  (draft/sent/rejected'te görünür; `ConfirmDialog` + `router.refresh()`; action detay+liste revalidate).
- ✅ **DÜZELTİLDİ (2026-07-30):** admin/tickets'e **"CSV indir"** butonu (`exportTicketsCsv` action vardı,
  UI bağı yoktu). Ölü-uç metrik & cron görünürlük denetimi TEMİZ çıktı (66 StatCard'ın hepsi href'li).
- ✅ **DÜZELTİLDİ (2026-07-29):** Proje birim satışı artık `deals`(won/sale) + `commissions`
  üretiyor (property'siz, deal_value=list_price, ofis varsayılan komisyonu, deal notunda proje/daire).
  `sellUnit` → `recordProjectSaleDeal`. DB rollback testiyle insert'ler doğrulandı. Ciro/komisyon/lig'de görünür.
- Ofisler arası ağda `commission_share_pct` kabul edilse de komisyon paylaşımına yazılmıyor.
- ✅ **DÜZELTİLDİ (2026-07-29, mig 129):** Kira yaşam döngüsü. `createRental` portföyü **'rented'**
  yapar (önceki durumu `prev_property_status`'a saklar), `endRental` portföyü geri yükler (saklanan
  durum, yoksa 'active'; yalnız hâlâ 'rented' ise). Depozito iadesi: `deposit_returned`/`_at` +
  `markDepositReturned` action + kira detayında iade kontrolü (client). DB rollback + UI render doğrulandı.
- ⏳ **ERTELENDİ (C.2):** Ofisler-arası ağda `commission_share_pct` kabul ediliyor ama komisyona
  yazılmıyor. Doğru çözüm ÇAPRAZ-TENANT uzlaşma (yeni settlement tablosu + iki tarafa komisyon yazımı +
  "iş birliği satışa döndü" adımı) → kendi dalgası + ürün kararı gerektirir; para-hassas, aceleye getirilmedi.
- ✅ **DÜZELTİLDİ (2026-07-29):** Kayıp-kaçak risk sıralamasına **"Teyit et"** kurtarma aksiyonu
  eklendi (mevcut `confirmPortalListing` action'ı; `portals:edit` olana görünür). İlan teyitlenip
  gecikmiş listeden düşer. Demo veride 3 buton render doğrulandı.
- ✅ **DÜZELTİLDİ (2026-07-29):** Ekip üyesi sayfasına **"İş yükünü devret"** paneli — üyenin TÜM
  aktif müşteri + portföyünü başka danışmana tek işlemde aktarır (`handoffMemberWorkload`, iki toplu
  update + denetim kaydı; `team:edit` olana). Onay adımlı client bileşen. Demo veride panel+select render doğrulandı.
- ~~Silinen kayıtlar için geri yükleme ekranı yok~~ → **ZATEN VAR** (`ayarlar/cop-kutusu`: silinen
  müşteri/portföy 90 gün geri yüklenebilir; `restoreCustomer`/`restoreProperty`).
- ✅ **DÜZELTİLDİ (2026-07-29):** `won/lost` anlaşma **geri alınabilir**. FLOW'a "Kazanmayı geri al" /
  "Yeniden aç" (won/lost → negotiation) geçişleri eklendi; `updateDealStage` won'dan çıkışta tahsil
  edilmemiş otomatik komisyonu siler + portföyü 'active'e döndürür (başka won yoksa). Tahsil edilmiş
  komisyon varsa engeller. DB rollback + UI (won kartında seçenek) doğrulandı.
- ⏳ Müşteri **birleştirme** geri alma hâlâ yok (merge öncesi snapshot gerektirir — ayrı iş).

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
- Migration'larda birincil güvenli yol: checksum/ledger denetimi, `npm run db:migrate -- --dry-run`,
  restore edilebilir backup/PITR doğrulaması ve ardından kontrollü `npm run db:migrate`.
  Ledger drift varsa uygulama durdurulur; uygulanmış migration dosyası değiştirilmez.
- Enum ADD VALUE + kullanımı aynı migration dosyasında olamaz (087/087b deseni).
- Yeni modül eklerken 4 kayıt yeri: permissions.ts + NAV_MODULES + sidebar + roller ekranı (CLAUDE.md).
- Geçersiz token'lı public sayfalar HTTP 200 + 404 içerik döner (Next.js streaming) — bilinçli.
- Hosted DB'ye seed/script koşarken `SEED_CONFIRM=1` freni var.
