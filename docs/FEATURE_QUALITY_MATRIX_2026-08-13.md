# EmlakSoft özellik kalite ve yayın hazırlığı matrisi

**Kesit tarihi:** 13 Ağustos 2026
**Kapsam:** mevcut yerel çalışma ağacı; canlı veritabanına yazma, secret okuma/yazma,
Git işlemi veya deployment yapılmadı.

Bu belge “özellik ekranda görünüyor” ile “özellik profesyonel biçimde hazır” kavramlarını
ayırır. Bir özelliğin **hazır** sayılması için aynı anda şu koşullar aranır:

1. Yetki ve tenant sınırı sunucuda uygulanıyor.
2. Girdi doğrulanıyor; çok satırlı iş kuralı tek commit noktasına sahip.
3. Yüklenme, boş, beklenen hata ve beklenmeyen hata durumları kullanıcıya dürüstçe gösteriliyor.
4. Klavye, ekran okuyucu ve mobil kullanım kanıtı var.
5. Kritik değişiklik denetim izine ve operasyonel gözleme giriyor.
6. Saf mantık/regresyon testi ile kritik kullanıcı akışı testi var.
7. Harici sağlayıcı gerekiyorsa sözleşme, gerçek kimlik, sandbox/canlı kabul ve hata senaryosu
   kanıtlanmış; yalnız adaptörün varlığı “hazır” sayılmıyor.

## 1. Kanıtlanmış envanter

Bu kesitte otomatik dosya envanteri:

| Yüzey | Sayı | Kanıt |
|---|---:|---|
| Kullanıcıya açık `page.tsx` | 141 | 87 oturumlu ürün, 21 platform yönetimi, 33 public/legal/token sayfası |
| Route Handler | 51 | Bunun 27'si cron rotası |
| Server Action dosyası | 101 | `src/app/actions` |
| Loading boundary | 112 | Her 87 ürün sayfası kendi veya üst segment loading boundary'sine sahip |
| Error boundary | 5 | Kök, ürün, admin ve iki dar destek sınırı |
| Vitest dosyası | 146 | Keşfedilen toplam 1.188 test; tam küme bu kesitte yeşil |
| Playwright test kaydı | 46 | 7 public + açık onaylı disposable ortamda çalışan 38 oturumlu/mutasyonlu + 1 auth setup |
| SQL migration | 175 | Workflow scaffold ve invariant migrationları dahil |

Ek otomatik sözleşme `src/lib/feature-quality-inventory-contract.test.ts` şunları kilitler:

- 87/87 oturumlu ürün sayfasında açık sayfa/session kapısı;
- 87/87 ürün sayfasında ancestor dahil loading boundary;
- kök, ürün ve admin hata ekranlarında hata raporu + erişilebilir focus transferi;
- gider ilişki sahipliği, sıfır-satır mutasyon ve hata geri bildirimi sözleşmesi.

Önceki 131 dosya/1.070 Vitest sonucu güncel yayın kanıtı değildir. Mevcut 146 dosya/1.188 testin
tamamı workflow scaffold/invariant ayrımı sonrasında yeşildir. Bununla birlikte typecheck, sıfır
uyarılı lint, production build, dependency audit ve public E2E de aynı release SHA üzerinde yeniden
yeşil olmalıdır; tek başına Vitest sonucu yayın kabulü sayılmaz.

## 2. Durum anahtarı

- **Y** — yerel kod ve test kanıtı yeterli.
- **K** — temel yetenek var; belirtilen kabul/operasyon kanıtı olmadan tamam sayılmaz.
- **B** — yayın veya yeteneğin açılması için blocker.
- **—** — o eksen için harici bağımlılık yok veya uygulanamaz.

Sütunlar: **YT** yetki/tenant, **DA** doğrulama/atomicity, **UX** loading/empty/error,
**AM** a11y/mobil, **DO** denetim/observability, **T** test, **HD** harici doğruluk.

## 3. Modül bazlı hazırlık matrisi

| # | Özellik alanı ve kullanıcı rotaları | YT | DA | UX | AM | DO | T | HD | Genel |
|---:|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| 1 | Kimlik: `/giris`, doğrulama, MFA, kayıt, parola sıfırlama | Y | Y | Y | Y | K | Y | B | B |
| 2 | Ürün kabuğu: `/app`, brifing, arama, bildirim, komut paleti, PWA | Y | Y | Y | K | Y | K | — | K |
| 3 | CRM: müşteriler, 360, dosyalar, çift kayıt, akıllı listeler, tavsiyeler, içe aktarma | Y | K | Y | K | K | K | — | K |
| 4 | Talep ve eşleştirme: `/app/talepler`, `/app/eslestirme`, ağ eşleşmeleri | Y | K | Y | K | K | K | K | K |
| 5 | Portföy: liste/detay, medya, anahtar, sunum, açık ev, vitrin | Y | K | Y | K | K | K | K | K |
| 6 | Satış çekirdeği: teklifler, anlaşmalar, sözleşmeler, imza, onay, komisyon | Y | K | Y | K | K | K | K | K |
| 7 | İletişim: arama, gelen kutusu, SMS/WhatsApp, kampanya | Y | K | Y | K | K | K | B | B |
| 8 | İş planlama: görev, randevu, rota, booking/teyit, ICS | Y | K | Y | K | K | K | K | K |
| 9 | Finans: komisyon, cüzdan, gider, aidat, abonelik, ödeme linki | Y | K | Y | K | K | K | B | B |
| 10 | Kiralama/mülk yönetimi: kontrat, tahakkuk, depozito, bakım | Y | K | Y | K | K | K | — | K |
| 11 | Proje, yabancı satış, yatırım, değerleme, bölge analizi | Y | K | Y | K | K | K | K | K |
| 12 | Portal kontrol/yayın ve ofisler arası ağ | Y | K | Y | K | K | K | B | B |
| 13 | Uyum ve belgeler: KVKK, İYS kaydı, EİDS hazırlığı, denetim dosyası | Y | K | Y | K | Y | K | B | B |
| 14 | Otomasyon ve AI asistan | Y | K | Y | K | K | K | K | K |
| 15 | Raporlama/yönetim: rapor, KPI, hedef, lig, ekip, franchise, TV pano | Y | K | Y | K | Y | K | — | K |
| 16 | Destek: ofis ticket, ek, SLA; platform ticket operasyonu | Y | K | Y | K | Y | K | — | K |
| 17 | Ayarlar: rol/izin, güvenlik, tanım, şablon, entegrasyon, çöp kutusu | Y | K | Y | K | K | K | K | K |
| 18 | Platform admin: ofis, üye, personel, satış, billing, geo, sistem, hata | Y | K | Y | K | Y | K | — | K |
| 19 | Public yüzeyler: landing, demo, danışman, vitrin, portal/token formları | Y | K | Y | K | Y | Y | K | K |
| 20 | Operasyon: webhook, cron, storage, health, migration, release | Y | K | Y | — | Y | Y | B | B |

## 4. Modül kanıtı ve gerçek kalan işler

### 4.1 Kimlik ve oturum

**Kanıt:** Server-side session/tenant kapıları, SMS tabanlı MFA, iki aşamalı giriş, giriş geçmişi,
versiyonlu ve purpose/subject ayrımlı OTP HMAC, production secret ayrılığı ve rate-limit testleri var.

**Kalan:** Public Git geçmişindeki hâlâ geçerli olduğu önceki salt-okunur denetimde doğrulanan
Supabase/DB kimlikleri döndürülmeden production güvenli değildir (**P0**). E-posta/SMS teslimi,
MFA recovery ve yeni anahtarlarla eski anahtar reddi gerçek production kabulü gerektirir (**P0**).

### 4.2 Ürün kabuğu, navigasyon ve geri bildirim

**Kanıt:** En uzun aktif rota eşleşmesi, izin filtreli sidebar/quick-create, tablet drawer, mobil alt
navigasyon, skip target, toast live-region, loading boundary ve hata raporlama bulunuyor.

**Kalan:** Mevcut release turunda yalnız 7 public Playwright senaryosu çalıştırıldı. Depoda 38
oturumlu/mutasyonlu senaryo var ancak güvenli disposable staging + `E2E_MUTATION_ALLOWED=true`
olmadan bilinçli olarak koşmuyor (**P1**). Playwright yalnız Desktop Chrome profili kullanıyor;
mobil Safari/Android ve axe tabanlı erişilebilirlik kabul kapısı yok (**P1**).

### 4.3 CRM, portföy ve dosya yaşam döngüsü

**Kanıt:** Müşteri/portföy CRUD, 360 görünüm, soft-delete/çöp kutusu, duplicate merge, CSV import,
dosya imza/MIME kontrolü, private download, direct-upload session ve storage deletion outbox var.
Tenant-owned 150 ilişkinin taraması ve 83 yeni composite FK yerel migrationlarda kayıtlı.

**Kalan:** 14 ilişki destek/ağ/billing semantiği için yapısal olarak ertelendi; canlıda mismatch
bulunmamış olsa da DB invariantı değildir (**P1**; kesin liste
`docs/tenant-relationship-audit-2026-08-13.json`). Dosya kontrolü imza/MIME doğrulamasıdır;
malware/antivirüs taraması değildir. Dışarıdan alınan ofis dosyaları için karantina + AV sağlayıcı
entegrasyonu yok (**P1**).

### 4.4 Talep → eşleşme → teklif → anlaşma → sözleşme → komisyon

**Kanıt:** Sayfa/modül kapıları, tenant reference validation, açıklanabilir eşleşme skoru, teklifler,
kanban anlaşma, onay kapıları, sözleşme OTP/imza ve komisyon kayıtları mevcut. Yeni
`20260813000000_core_workflow_invariants.sql` çok satırlı kritik geçişleri satır kilidi ve tek
DB commit noktasına taşımak üzere eklendi. Öncesindeki
`20260812000000_core_workflow_scaffold.sql` yalnız kolon/FK iskeletini açar; böylece invariantlar
devreye girmeden aggregate-only salt-okunur preflight ve kontrollü veri uzlaştırması yapılabilir.

**Kalan:** Canlı salt-okunur sınıflandırmada 26 blocker'ın tamamı demo tenant'ta bulundu. Buna ek
olarak 5 deterministik onarılabilir kayıt vardır: tur geçmişi olmayan 3 teklifin 2'si gerçek
tenant'ta `submitted`, 1'i demo tenant'ta `accepted`; 2 demo kiracıda `Kiracı` etiketi eksiktir.
Öngörülen duplicate gruplar 0'dır. Bu 5 onarım canlıda henüz yapılmadı; operatör aggregate
sayaçlarını doğruladıktan sonra faz-2 invariant migration bunları kendi transaction'ında
deterministik olarak uygular. Preflight bütün gerçek blocker sayaçlarında 0 vermeden
`20260813000000` uygulanamaz; migration ve rollback/yarış/idempotency smoke'u geçmeden workflow
atomicity production kanıtı sayılmaz (**P0 deployment gate**).

### 4.5 İletişim, kampanya ve portal yayınları

**Kanıt:** Tenant'a izole Netgsm/WhatsApp binding, izin kontrolü, bounded external fetch, webhook
signature/dedupe/quarantine, campaign queue/outbox ve sağlayıcı durumunu dürüst gösteren registry var.
Portal adaptörü API key yanında sözleşmedeki explicit HTTPS base URL'yi zorunlu tutuyor.

**Kalan:** Resmî İYS senkronu ve Meta Lead Ads registry'de açıkça `planned`; gerçek CTI/telefon
santrali yok. Netgsm, Meta/WhatsApp ve her portal için ayrı sağlayıcı sözleşmesi, test hesabı,
template/onay, callback ve canlı kabul yoksa özellik açılmamalı (**P0 özellik kapısı**). Generic
portal field mapping'i her sağlayıcının gerçek sözleşme şemasıyla contract test edilmelidir (**P1**).

### 4.6 Finans, abonelik ve tahsilat

**Kanıt:** iyzico callback/webhook doğrulaması, tutar/para birimi doğrulaması, idempotent fulfillment,
payment-link akışı, billing reconciliation lease ve fail-closed reporting aggregate sözleşmeleri var.

**Kalan:** Billing hardening/reconciliation migrationları canlıya uygulanmamış durumda. Gerçek merchant
hesabıyla success, duplicate callback, delayed webhook, refund/cancel, timeout ve mutabakat kabulü
yapılmadan tahsilat “tam” değildir (**P0**). E-Fatura/E-Arşiv registry'de dürüst biçimde `planned`;
mali müşavir/entegratör kabulü yok (**P1**).

Bu kesitte gider akışı ayrıca düzeltildi:

- caller-supplied `property_id` trusted tenant içinde yeniden çözülüyor;
- tutar, kuruş, DB üst sınırı, takvim tarihi, UUID, kategori ve metin sınırları sunucuda doğrulanıyor;
- update/delete sıfır satır veya DB hatasını başarıya çevirmiyor;
- liste sorgu hatasını sahte boş liste yerine error boundary'ye taşıyor;
- create/edit/delete bekleme, başarı ve hata geri bildirimi veriyor; edit alanları label'lı.

Aidat akışı da aynı sözleşmeye taşındı: para/tarih/metin sınırları ile portföy tenant sahipliği
insert öncesi doğrulanıyor; tekil update/delete sıfır satırı başarı saymıyor; liste, KPI, gecikme
şeridi veya portföy sorgusu bozulursa ekran sahte sıfır/boş durum göstermiyor; tüm mutasyon sonuçları
erişilebilir form durumu ve toast/hata geri bildirimiyle kullanıcıya dönüyor.

**Kalan:** Gider/aidat ve izin/otomasyon gibi bazı finans/ayar mutasyonlarının audit kaydı ana mutasyonla
aynı transaction içinde değil veya hiç yok (**P1**).

### 4.7 Raporlama ve veri dürüstlüğü

**Kanıt:** Dashboard 33 sorguluk batch'i ve finansal aggregate RPC'leri sorgu hatasını sahte sıfıra
çevirmiyor. Tarih/tenant filtreleri server-side; export kapsam sözleşmeleri var. Değerleme motoru
tek liste fiyatını bağımsız piyasa kanıtı saymıyor: gözlemlenmiş emsal/sağlayıcı yayılımı yoksa yapay
alt-üst bant üretmiyor, kanıta dayalı muhafazakâr güven skoru kullanıyor ve sağlayıcı kesintisini
kalıcı kaynak uyarısı olarak rapora yazıyor. Fiyat kanıtı yoksa boş değerleme kaydı oluşturulmuyor.

**Kalan:** Aynı fail-closed result standardı tüm yardımcı listelere yayılmamış. Doğrulanmış örnekler:
`communications.ts`, `campaigns.ts` ve `notifications.ts` bazı sorgu hatalarını `[]`/`void`
olarak yutuyor; bazı delete/update yolları etkilenen satır sayısını doğrulamıyor (**P1**). Bu davranış
yetki hatası ile gerçek boş sonucu ayırt edemediği için modül modül standardize edilmelidir.

### 4.8 Otomasyon ve AI

**Kanıt:** AI aksiyonları doğrudan yazmıyor; öneri kartı + kullanıcı onayı kullanıyor. Tool girdileri
sunucuda sınırlandırılıyor; OpenAI yoksa arayüz bunun kural-tabanlı fallback olduğunu söylüyor.

**Kalan:** Altın veri kümesi/model eval, groundedness/regression veya prompt-version acceptance kapısı
bulunamadı (**P1**). AI çıktısı deterministik iş kuralı değildir; finansal/hukuki karar için insan
onayı korunmalıdır. OpenAI canlı anahtarıyla maliyet, rate-limit, timeout ve veri işleme kabulü gerekir.

### 4.9 Uyum ve hukuk

**Kanıt:** KVKK rıza/silme akışları, IYS kayıt kapısı, sözleşme ve public legal sayfalar, audit/export,
EİDS hazırlık kayıtları bulunuyor.

**Kalan:** Kod içi kayıt, resmî İYS/TKGM/TAKBİS/EİDS entegrasyonu veya hukuk görüşü yerine geçmez.
Registry TAKBİS ve İYS'yi doğru biçimde `planned` gösteriyor. Production metinleri ve saklama/silme
süreleri Türkiye'de yetkili hukuk/mali müşavir tarafından sürüm bazında onaylanmalı (**P1 external**).

### 4.10 Admin, support ve operasyon

**Kanıt:** Admin layout platform-staff kapılı; sayfalar rol modüllerine ayrılıyor. Ticket SLA,
optimistic concurrency, hata kayıtları, cron heartbeat, privacy-preserving health ve release checksum
kontrolü var. Admin error boundary bu kesitte focus transferi ve focus-ring aldı.

**Kalan:** 15 migration şemada mevcut/ledger'da eksik; bunlar DML/backfill, grant, policy ve fonksiyon
gövdesi dosya bazında kanıtlanıp seçici uzlaştırılmadan kör migrate/baseline yapılamaz (**P0**).
Ardından gerçekten bekleyen 16 forward migration sıralı uygulanır; 15. sıradaki workflow scaffold
sonrası preflight/uzlaştırma tamamlanıp sayaçlar 0 olmadan 16. sıradaki invariant migration'a
geçilmez. Backup/PITR zamanı, restore provası, post-deploy cron/webhook/health smoke ve ilk 30 dakika
gözlem yapılmalıdır (**P0**). Vercel CLI credential/oturumu bulunmadığı için production env scope ve
alias da henüz doğrulanmamıştır; bu turda Git push veya deploy yapılmadı.

### 4.11 Ayar tanımları

**Kanıt:** Ofise özel seçim listelerinde kategori, UUID ve metin sınırları sunucuda doğrulanıyor.
Sıra sorgusu bozulduğunda insert devam etmiyor; global veya kayıp bir kayda yönelen update/delete
sıfır satırı başarı saymıyor. Sayfa DB hatasını boş tanım listesine çevirmiyor; ekleme, gizleme,
yeniden adlandırma ve silme sonuçları erişilebilir hata alanı/toast ile kullanıcıya bildiriliyor.

## 5. Önceliklendirilmiş gerçek açık listesi

### P0 — yayın/özellik açma blocker'ları

1. Sızmış Supabase/JWT/DB kimliklerini döndür; eski kimliklerin reddedildiğini kanıtla; sonra Git
   geçmişini koordineli temizle.
2. 15 ledger-şema ayrışmasını PITR/bakım penceresinde dosya bazında attestation ile seçici uzlaştır;
   16 gerçekten forward migration'ı sırala. `20260812000000_core_workflow_scaffold.sql` sonrasında
   salt-okunur preflight + açık veri uzlaştırması yap; bütün blocker sayaçları 0 olmadan
   `20260813000000_core_workflow_invariants.sql` dosyasını uygulama.
3. Yeni release identity ile temiz CI/build; health ready; deploy sonrası auth/tenant/billing/webhook/
   cron smoke ve gözlem yap.
4. iyzico, SMS/WhatsApp ve portal yeteneklerini yalnız gerçek sağlayıcı kabul senaryosu yeşilse aç.

### P1 — “her özellik profesyonel” hedefi için zorunlu

1. 38 oturumlu/mutasyonlu Playwright senaryosunu disposable staging'de çalıştır; role/tenant negatif
   senaryoları ve paralel istek yarışlarını ekle.
2. Desktop Chrome dışına mobile Safari/Android kabulü, axe erişilebilirlik kapısı ve klavye-only
   walkthrough ekle.
3. Kalan 14 tenant ilişkisini semantiğine göre composite FK veya trigger ile kapat.
4. Tüm list/query yardımcılarında `data ?? []` sessiz hata desenini typed fail-closed result ile değiştir;
   tüm update/delete yollarında DB hatası + etkilenen satır doğrulaması yap.
5. İzin, otomasyon, kampanya, finans ve dosya ayarı değişikliklerini mutation ile aynı transaction'da
   audit et; bağımsız sonradan audit yazısını kritik işlem kanıtı sayma.
6. Dosya yüklemelerinde malware tarama/karantina; AI için golden-set eval ve sürüm kapısı kur.
7. Hukuk/mali müşavir ile KVKK, ileti izni, sözleşme, fatura, iade ve saklama kabul tutanağı oluştur.

### P2 — premium süreklilik ve ölçüm

1. CI'a Lighthouse/Core Web Vitals ve JS/CSS/image budget ekle; şu anda performans bütçesi yok.
2. Görsel regression için temsilî desktop/tablet/mobile snapshot seti ekle.
3. Kalan native `confirm/prompt/alert` ve özel overlay'leri ortak erişilebilir Dialog/toast/copy fallback
   desenine geçir; nihai sayı eşzamanlı UX dalgası tamamlandıktan sonra tekrar taranmalı.
4. Özellik bazlı SLO tanımla: login, müşteri arama, dosya, portal publish, payment fulfillment,
   campaign delivery ve cron gecikmesi için p95 + error-rate alarmı.

## 6. “Hazır” kararının değişmez kabul kapısı

Bir satır ancak aşağıdaki kanıtların tümü aynı release SHA üzerinde üretildiğinde **Y** olabilir:

1. Typecheck, zero-warning lint, full Vitest ve production dependency audit.
2. Production build ve public E2E.
3. Disposable staging'de 38 authenticated/mutating E2E + tenant/role negatif testleri.
4. Desktop, tablet, iOS/Android smoke; axe ve klavye-only kabul.
5. Migration checksum/ledger ready + backup/PITR + restore kanıtı.
6. Harici sağlayıcıların imzalı success/failure/retry/idempotency kabul tutanağı.
7. Deploy sonrası health, auth, billing, webhook, cron ve observability gözlemi.

Bu kapı geçmeden “%100 çalışıyor” ifadesi kullanılmamalıdır; doğru ifade “yerel kod hazır”,
“sağlayıcı kabulü bekliyor” veya “production kanıtı tamamlandı” olmalıdır.
