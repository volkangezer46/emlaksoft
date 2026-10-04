# Organik büyüme planı (ChatGPT önerisinin uygulanabilirlik denetimi)

Tarih: 2026-10-04 · Durum: yalnız tasarım; kod ve canlı DB değişmedi. Migration taslakları `supabase/proposed/` altındadır (uygulanmadı).
Kaynak: `docs/design/CHATGPT_ONERI_LISTESI.md` ile aynı sohbetin organik büyüme yanıtı (sahibin özeti). ChatGPT'nin sayıları, atıfları ve mevzuat iddiaları DOĞRULANMAMIŞTIR; bu belge hiçbirini hukuki gerçek olarak kullanmaz. "Hukukçu/mali müşavir teyidi gerekir" işareti, o maddede kodlamadan önce uzman görüşü alınacağı anlamındadır.
Çakışma kuralı: K2 ajanının plan/kupon/Founders kampanyası alanı yeniden tasarlanmadı, yalnız bağlanıldı (bölüm 3.0). Uzmanlık/havuz/demo, Modüller (aç/kapa), AI kredi ölçümü, telefon girişi, TV modu, K1/K3/K4/K6 alanlarına dokunulmadı.

## 1. Mevcut durum (kanıtlı envanter)

| Konu | Bulgu | Kanıt |
|---|---|---|
| Ofisten ofise referral / affiliate / ortak | YOK. Koddaki "referral" yalnız MÜŞTERİ tavsiye programı (NPS destekçisi müşteri, ofise yeni müşteri getirir). Karıştırma: bu ayrı bir kavram | `supabase/migrations/20260727000111_referrals.sql` (`referral_links`), `src/app/tavsiye/[token]`, `src/app/app/tavsiyeler`, `src/app/actions/referrals.ts` |
| Kupon / kampanya / UTM / ref kodu yakalama | YOK (migrations'ta partner/kupon/utm eşleşmesi yalnız komisyon planı ve tavsiye tablosunda) | grep: `supabase/migrations`, `src/app/kayit`, `registration-plan.ts` yalnız plan/cycle okur |
| Kayıt akışı | VAR. `/kayit?plan=&cycle=` ile `register-form.tsx`; KVKK onay kutusu; atomik RPC ile ofis + sahip profili + 14 gün deneme aboneliği; `registration_consents` tablosu. Kaynak/ref alanı yok | `src/app/kayit/page.tsx`, `20260731000140_atomic_registration_provisioning.sql` |
| Platform satış hunisi | VAR. `demo_requests` + `/admin/satis` + `convertDemoToTenant` (atomik demo dönüşümü). Kaynak alanı yok | `src/app/actions/platform-sales.ts`, `20260802000400_atomic_demo_conversion.sql` |
| Faturalama / planlar | VAR (`admin/billing`, `lib/billing/plans.ts`, iyzico webhook). Plan/kupon/kampanya alanları K2'de çalışılıyor | `src/app/api/iyzico`, `src/app/admin/billing` |
| Hesap kredisi defteri / AI kredisi | YOK (credit/ledger kelimesi migrations'ta geçmiyor). AI kredi ölçümü "ileride" ve başka ajanın alanı | grep |
| Danışman dijital kartvizit | VAR ve zaten OPT-IN: `profiles.is_public boolean default false` + `public_slug`; kapalıyken 404; sayfa bilerek indekslenebilir; sitemap'e yalnız yayındaki aktif profiller girer | `src/app/danisman/[slug]/page.tsx`, `20260728000118_agent_public_profile.sql` |
| Ofis vitrini | VAR (`/vitrin/[slug]`). Sitemap'e TÜM aktif/deneme/past_due ofisler ve canlı ilanları girer; ofis düzeyinde "indekslensin mi" anahtarı bulunmadı (doğrulanmalı) | `src/app/sitemap.ts` |
| "Powered by EmlakSoft" | KISMEN. Metin ve `/` bağlantısı var: token portal çerçevesi, vitrin altbilgisi, değerleme raporu. Kaynak çerezi/`ref` yok, paket farkı veya kaldırma ayarı yok, PDF/sunum durumu doğrulanmadı | `src/components/public/token-page.tsx:88`, `vitrin/[slug]/page.tsx:573`, `degerleme-raporu/[token]/page.tsx:373` |
| Ücretsiz araç yardımcıları | HAZIR (saf fonksiyon): `commission.ts`, `purchase-costs.ts` (`computePurchaseCosts`, `computeLoanPlan` taksit + amortisman tablosu), `roi-calculator.ts` (EmlakSoft ROI, ürün satışı için), `tufe.ts`. /app içinde `hesaplayici`, `kira-artis` var; public karşılığı YOK (`src/app/araclar` yok) | `src/lib/*`, `src/app/app/{hesaplayici,kira-artis}` |
| TÜFE verisi | Tablo 2024-01..2025-12; 2026-01..07 "bekleyen" (otomatik oran uygulanmaz). Veri sahibin doğrulamasını bekliyor; public araçta uyarı zorunlu | `src/lib/tufe.ts` |
| Konut kredisi varsayılanı | `DEFAULT_MONTHLY_RATE_PCT = 2.79` sabit; güncel piyasa oranı değil, "örnek" olarak etiketlenmeli | `purchase-costs.ts:136` |
| Onboarding / yardım | VAR: `/app/baslangic` (kurulum), `onboarding-checklist.ts`, `onboarding-state.ts` (gerçek ilerleme), product-tour, `/app/yardim`. Academy/sertifika YOK | `src/lib/onboarding-*.ts` |
| İçe aktarma | VAR (`/app/ice-aktarma`, `actions/import-data.ts`, `import-rollback.ts`) | |
| Destek bileti | VAR, kategori doğrulamalı (`validateTicketCategory`); "taşıma talebi" kategorisi eklenebilir | `src/app/actions/tickets*` |
| Ofisler arası ağ | VAR: `/app/ag` (portföyü başka ofis talebine aç, komisyon paylaşımlı iş birliği) → "lead exchange" büyük ölçüde mevcut | `src/app/app/ag` |
| Franchise analitiği | VAR: `/app/franchise` (şube/ofis ağı raporu) | |
| Benchmark | KISMEN: `/app/ekip/kiyas` (ofis İÇİ danışman kıyası). Ofisler arası agregat YOK | |
| Menü | /app menüsü tek kaynak `nav-config.ts`; Ayarlar kartları `src/app/app/ayarlar/page.tsx` içinde (yeni "Davet et ve kazan" buraya kart olarak girer, ana menü öğesi eklenmez) | |
| Diğer tasarım belgeleri | `FEATURE_BACKLOG.md`, `PIYASA_VE_FARK_YARATAN_OZELLIKLER.md` var; `ONERI_LISTESI_KARSILASTIRMA` ve `DANISMAN_UZMANLIK_HAVUZ_DEMO_SPEC` bu dalda YOK (başka ajanlarda olabilir) | |

## 2. Sınıflandırma (her öneri)

Kısaltmalar: **V-now** ürün kodlanır; **V-later** kodlanır, sonra; **BD** iş geliştirme eylemi; **RİSK** hukuki-mali-etik riskli; **ELE**. Mevcut: VAR/KISMEN/YOK. Mükerrer: aynı işi başka madde de yapıyor mu. Şema: yeni tablo gerekir mi.
ChatGPT "60 madde" dedi; özetteki başlıklar aşağıda 40 satırda birleştirildi (alt maddeler ilgili satırda).

| # | Öneri | Sınıf | Mevcut | Neden | Mükerrer | Şema |
|---|---|---|---|---|---|---|
| 1 | Ortak programı, `/p/<kod>`, kayıt/ödeyen/komisyon takibi | V-now (paket B) | YOK | Tüm kanalların (eğitmen, ajans, mali müşavir, influencer) ortak altyapısı | #3, #4, #21, #22, #27 aynı motor | Evet |
| 2 | Ofis → ofis referral, kredi ödülü | V-now (paket A) | YOK (tavsiye = müşteri programı, ayrı) | Düşük maliyet, ofis sahipleri arası güven; deneme→ödeme dönüşünce ödül | #1 ile ortak kod/atıf tabloları | Evet |
| 3 | Recurring affiliate (ilk 12 ay %20) | V-now kural motoru, RİSK ödeme tarafı | YOK | Kural alanı (yüzde, süre ay) admin'den düzenlenir; ilk sürüm yalnız bakiye/kredi | #1 ile aynı kural tablosu | Evet |
| 4 | Eğitmen ortaklığı (ücretsiz PRO, landing, öğrenci indirimi) | BD + ürün kodu: partner kodu, V-later kurum kodu | YOK | Ürün tarafı yalnız partner/kurum kodu; ilişki sahibin işi | #1 | Hayır (#1 kullanır) |
| 5 | MYK belgelendirme (belge alana 3 ay ücretsiz) | BD; V-later toplu kod | YOK | "3 ay" K2 kampanya alanıyla yapılır; belge doğrulaması bizde yok, kurum kodu ile sınırlı | #4, #6 | V-later |
| 6 | Ticaret odası, TÜGEM, GYODER, dernek işbirlikleri | BD; V-later kurum kodu | YOK | Aynı kurum kodu mekanizması | #5 | V-later |
| 7 | Franchise markaları | BD; V-later (çoklu ofis hesap/fatura) | KISMEN (`/app/franchise` analitik) | Önce görüşme, ürün talebi görüşmeden çıkar | #8 | V-later |
| 8 | White-label / marka kaldırma | V-later, RİSK marka | KISMEN (tenant logosu, `platform-brand`) | "Powered by" kaldırma paket farkı olabilir (paket D); tam white-label ayrı iş | #23 | Hayır/plan alanı |
| 9 | Portal lead entegrasyonu (Hepsiemlak/Sahibinden → CRM) | V-later, RİSK kullanım şartı | YOK | Resmi API/anahtar ile ve ofisin kendi hesabı üzerinden olursa mantıklı; scraping yok. `FEATURE_BACKLOG.md` Rekabet Kurulu kararını anıyor (doğrulanmadı) | `FEATURE_BACKLOG` | Evet |
| 10 | EİDS / mevzuat merkezi | V-later (başka ürün işi) | YOK | Organik büyümeden çok ürün özelliği; mevzuat metni yazmak RİSK | `FEATURE_BACKLOG` | Evet |
| 11 | Mali müşavir / hukuk bürosu ortaklığı, "Emlaksoft Legal" şablonları | Ortaklık V-now (partner türü), şablon RİSK | YOK | Mali müşavir partner türüdür. Hukuki şablon metni üretmek hukukçu teyidi gerektirir | #1 | Hayır |
| 12 | E-imza / SMS / WhatsApp BSP / santral gelir paylaşımı | BD, RİSK | KISMEN (SMS imza var) | Sağlayıcı sözleşmesi, gelir paylaşımı ve BSP kuralları sahibin işi; ürün kodu yok | #26 | Hayır |
| 13 | Marketplace (foto, drone, 360, ekspertiz, sigorta, taşıma, dekorasyon, kredi) | V-later; BD | YOK | Ağ etkisi ve sağlayıcı havuzu gerekir; komisyon/ödeme tutmak RİSK | #19 | Evet |
| 14 | Emlaksoft Developer (müteahhit proje CRM) | V-later | KISMEN (`/app/projeler`) | Mevcut proje modülü genişletilir, ayrı ürün değil | | Evet |
| 15 | "Verified Office" rozeti + backlink | RİSK, ELE (hali) | YOK | Doğrulama süreci yok. Yerine "Emlaksoft üyesi" (bölüm 4.4) | #17 | Hayır |
| 16 | Danışman profil sayfaları | V-now (paket D, geliştirme) | VAR (opt-in) | Zaten var; eksik: indeksleme anahtarı, ibare, kaynak ref | | Küçük |
| 17 | Ofis ve şehir/bölge SEO dizinleri | Ofis sayfası V-now (opt-in anahtarı), şehir dizini V-later (N eşik) | KISMEN | Vitrin var ama sitemap opt-in değil | | Küçük |
| 18 | Emlakfiyati SEO → satıcı lead → danışman | V-later, RİSK kişisel veri | KISMEN (ofis vitrininde değerleme) | Lead üçüncü kişiye gidiyorsa açık rıza, ofis eşleştirme politikası gerekir | #9 | Evet |
| 19 | Lead exchange / referral network (şehirler arası) | V-later, RİSK komisyon paylaşımı | KISMEN (`/app/ag`) | Mevcut ağ ofis arası; şehirler arası ve ücret paylaşımı sözleşme ister; Emlaksoft para tutmaz | #13 | Evet |
| 20 | Academy + sertifika | V-later | YOK | İçerik üretimi gerekir; sertifika adı resmi belge izlenimi vermemeli (RİSK: MYK ile karışma) | #5 | Evet |
| 21 | Üniversite hesapları | BD + kurum kodu | YOK | Aynı kurum kodu | #4, #5 | V-later |
| 22 | YouTube/Instagram mikro influencer affiliate | V-now (partner türü), RİSK reklam bildirimi | YOK | Partner türü "içerik üreticisi"; reklam ibaresi sözleşmeye yazılır | #1 | Hayır |
| 23 | "Powered by Emlaksoft" imzası | V-now (paket D) | KISMEN | Metin var; ref çerezli bağlantı ve kaldırma ayarı eksik | #8 | Küçük |
| 24 | Ücretsiz araçlar (komisyon, kira getirisi, tapu masrafı, amortisman, kredi, m² fiyat, sözleşme oluşturucu, QR, AI ilan, sosyal medya) | Hesaplayıcılar V-now (paket C); sözleşme oluşturucu RİSK; AI ilan metni/QR/sosyal gönderi V-later | KISMEN (saf fonksiyonlar var, public sayfa yok) | SEO ve CTA için en ucuz kanal | | Hayır |
| 25 | Chrome extension (portal veri çekme dahil) | ELE | YOK | Portal kullanım şartı ve veri çekme hukuki riski; bakım yükü | | |
| 26 | API partner programı | V-later | YOK | Önce ürün olgunluğu; anahtar yönetimi, rate limit | #12 | Evet |
| 27 | Partnere gelir bırakma | #3 ile mükerrer | | | #3 | |
| 28 | Şehir temsilciliği | BD; V-later panel; RİSK bayilik | YOK | Temsilcilik sözleşmesi ve vergi hukukçu işi | #1 | V-later |
| 29 | Şehir dominasyonu (Kahramanmaraş önce) | BD strateji (bölüm 5) | | Gerçek veriye göre karar | | |
| 30 | Ücretsiz migration garantisi | V-now (paket E) | KISMEN (`ice-aktarma` var) | Garanti = taşıma talebi formu + admin kuyruğu + SLA; "garanti" kelimesi kapsam sınırı ister | | Küçük |
| 31 | 30 günlük başarı programı | V-now (paket E) | KISMEN (kurulum sihirbazı, checklist) | Zamanlı e-posta/bildirim serisi gerçek ilerlemeye göre | | Küçük |
| 32 | Başarı hikâyeleri | V-now şablon, RİSK içerik | YOK | Yalnız yazılı izinli gerçek müşteri; boşsa gizli | | Evet |
| 33 | Aylık benchmark | V-now (paket G), RİSK agregat | KISMEN (ofis içi kıyas) | Yalnız ≥10 ofis ve opt-in | | Küçük |
| 34 | "Emlaksoft Endeksi" + basın | ELE şimdilik, V-later koşullu, RİSK | YOK | Yeterli gerçek veri yok; sahte endeks yasak | #33 | |
| 35 | Etkinlikte AI Lab | BD | | Demo hesabı + `/demo` var | | |
| 36 | Co-marketing | BD | | | | |
| 37 | "İş Ortakları" menüsü | V-now, DEĞİŞTİRİLMİŞ | | Yeni ana menü yok: ofis için Ayarlar kartı, admin için /admin bölümü | | |
| 38 | Network effect | Strateji, ayrı kod yok | | `/app/ag`, #2, #17 üzerinden gerçekleşir | | |
| 39 | Referral kredisinin abonelik/AI/değerleme/SMS için harcanması | V-now yalnız abonelik indirimi; AI kredisi V-later | YOK | AI kredi paketi başka ajanın; defter ortak (bölüm 3.1) | | Evet |
| 40 | Kaynak/UTM yakalama + dönüşüm raporu | V-now (paket H) | YOK | Tüm kanalları ölçmek için ön koşul, ilk yapılacak iş | | Evet |

**Sayım (40 satır, birincil sınıfa göre):** V-now 15 (1, 2, 3, 16, 17, 22, 23, 24, 30, 31, 32, 33, 37, 39, 40) · V-later 11 (7, 8, 9, 10, 13, 14, 18, 19, 20, 26, 28) · BD 8 (4, 5, 6, 12, 21, 29, 35, 36) · RİSK 3 (11, 15, 34) · ELE 1 (25) · mükerrer/birleşik 2 (27, 38). Kodlamadan önce uzman teyidi gereken alt maddeler: 3 (ödeme), 11 (şablon), 12, 15, 18, 19, 24 (sözleşme oluşturucu), 28, 32, 34.
Not: bir satır birden çok sınıfa değebilir; sayım ilk yazılan (birincil) sınıfa göredir.

## 3. V-now paketleri (yeni klasörler, ana menü artmaz)

### 3.0 K2 ile sınır
K2: plan fiyatı, kupon, Founders kampanyası, bitiş/kota. Bu plan yalnız şunu varsayar: bir abonelik faturası oluşurken "indirim satırı" eklenebilir. Referral/partner kredisi K2'nin kuponuyla AYNI şey değildir: kupon fiyatı düşürür (ön indirim), kredi kazanılmış bakiyeyi faturadan düşer (sonradan). İkisi birlikte uygulanırsa sıra ve üst sınır (ör. fatura tutarının %X'i) K2 sahibiyle birlikte netleştirilir (sahibin kararı #5).

### 3.1 Ortak altyapı: tek hesap kredisi defteri
- `account_credit_ledger`: ekleme-yalnız (append-only), `tenant_id`, `unit` ('try' = abonelik kredisi, TL değerinde; 'ai' = ileride AI kredi ölçümü), `entry_type` (grant/hold_release/spend/expire/adjust/reverse), `amount`, `source` (referral/partner/manual/campaign), `source_id`, `idempotency_key` UNIQUE, `available_at`, `expires_at`, `created_by`. Bakiye = SUM(...) görünümü; negatif bakiye yok (kısıt).
- Neden tek defter: AI kredi paketi geldiğinde ayrı tablo yazılmaz; `unit` ayrımıyla aynı defter kullanılır. AI ajanı farklı bir defter tasarlarsa `unit='ai'` kısmı onunla birleştirilir, 'try' kısmı bu şemada kalır. Taslak: `supabase/proposed/20260819000100_growth_referral_partner_attribution.sql` (UYGULANMADI).
- Ödül kuralı admin'de: `growth_reward_rules` (tür referral|partner, ödül tipi sabit TL | yüzde, tutar, süre ay, bekleme günü, tavan, aktif, geçerlilik tarihleri). Kod içine sabit oran yazılmaz.
- Ödül tetikleyici: abonelik ilk başarılı ücretli ödemeden sonra BEKLEME gün (öneri 30; iade/itiraz riski) geçince `hold_release`. Deneme kaydı ödül vermez.
- Denetim: her yazım `platform_audit_logs`'a (mevcut) düşer; defter satırı silinmez/güncellenmez (düzeltme ters kayıtla).

### 3.2 Paket A: Referral (ofis → ofis)
- Ofis sahibi `/app/ayarlar/davet-et` ("Davet et ve kazan" kartı, Ayarlar sayfasına): kişiye özel kod ve bağlantı (`/kayit?ref=KOD`), paylaş (WhatsApp/kopya), "kaç tıklama, kaç kayıt, kaç ödeyen, kredi bakiyesi" (sıfır çıkmaz kuralı: sayılar filtreli listeye gider; liste yalnız kendi davetleri ve ofis adını göstermez ya da kısaltır, bölüm 4.3).
- Kod yakalama: `/kayit?ref=` ve `/r/<kod>` (kısa) → httpOnly olmayan değil, **birinci taraf çerez** `es_ref` (öneri 30 gün, ilk dokunuş kazanır) + kayıt formunda gizli alan; atomik kayıt RPC'sine `p_ref` parametresi eklenir (mevcut RPC değişikliği taslakta not; ayrı migration, UYGULAMA YOK). Kullanıcı kodu elle de girebilir (çerezsiz mobil tarayıcı).
- Kötüye kullanım kuralları (ödül `hold`ta kalır, otomatik red değil, admin kuyruğunda): (1) aynı ofis/aynı `tenant_id` zinciri, (2) aynı e-posta alan adı (ücretsiz posta hariç) veya aynı telefon, (3) aynı IP/cihaz izi (hash) kısa sürede çoklu kayıt, (4) davet eden ile davet edilen aynı vergi kimliği/yetki belgesi/IBAN/ödeme kartı hash'i (mevcutsa), (5) davetli ofis X gün içinde iptal/iade, (6) bir ofis için ödül tavanı/ay, (7) davet edenin kendi aboneliği ödeme yapmıyor (askıda) ise ödül yok. Bu bir ön eleme; kesin karar admin'indir ve itiraz yolu vardır. KVKK: IP/cihaz hash'i yalnız kötüye kullanım amaçlı, saklama süresi kısa, aydınlatma metnine yazılır (hukukçu teyidi gerekir).
- Admin: `/admin/ortaklar/referral` kural ayarı + ödül kuyruğu + reddet/onayla.

### 3.3 Paket B: Ortaklar (affiliate)
- Admin `/admin/ortaklar` (yeni menü öğesi değil, mevcut admin yan menüsüne bölüm; admin menüsü 40 öğelik uygulama menüsünden ayrı olduğu için tek satırdır): ortak tanımı (ad, tür: eğitmen/ajans/mali müşavir/içerik üreticisi/kurum, kod, komisyon kuralı = `growth_reward_rules` bağlantısı, durum: taslak/aktif/askıda/bitti, sözleşme imzalandı mı bayrağı + not).
- `/p/<kod>`: sade yakalama sayfası (ortak adı + 3 satır değer önerisi + kayıt CTA). Çerez `es_ref` aynı mekanizma; `ref_kind='partner'`. Kod bilinmeyen/pasif ise sessizce `/kayit`'a düşer.
- Partner paneli kararı: **token'lı salt-okunur rapor bağlantısı** (`/ortak/<token>`), hesap sistemi DEĞİL. Gerekçe: ortakların çoğu (influencer, eğitmen) uygulama kullanıcısı değil; mevcut token'lı portal desenleriyle (`token-page`) aynı güvenlik modeli; yeni kimlik/RLS yüzeyi açılmaz; token hash'li saklanır, yenilenebilir/iptal edilebilir, `noindex`, hız sınırlı. Yalnız sayılar: tıklama, kayıt, ödeyen, bekleyen/kullanılabilir bakiye. KİŞİSEL VERİ YOK, ofis adı da YOK (agregat; ilk sürümde gerekirse "ofis #1, #2" takma numara; sahibin kararı #8).
- Ödeme: ilk sürümde nakit yok. Bakiye `account_credit_ledger` `unit='try'` ile ortağın kendi Emlaksoft hesabına kredi (ortağın bir ofisi varsa) veya `partner_payouts` tablosunda admin'in elle "ödendi" işaretlediği kayıt (dış ödeme, makbuz/fatura belge no ve tarih alanı). Entegrasyon yok. Vergi bölümü 4.1.
- Taslak: aynı migration dosyasında `growth_partners`, `growth_partner_payouts`.

### 3.4 Paket C: Ücretsiz araçlar (`src/app/araclar/[slug]`)
Mevcut saf fonksiyonlar kullanılır; yeni formül yazılmaz.
| Slug | Kaynak | Not |
|---|---|---|
| komisyon-hesaplama | `commission.ts` | Oran girdisini kullanıcı verir; "yasal/ortalama oran" iddiası yok |
| tapu-masrafi-hesaplama | `purchase-costs.ts` `computePurchaseCosts` | Oranlar `DEFAULT_RATES`; "yaklaşık" uyarısı `APPROX_DISCLAIMER`; harç oranlarının güncelliği doğrulanmalı (sahibin kontrolü) |
| konut-kredisi-taksit | `computeLoanPlan` (amortisman tablosu dahil) | 2.79 aylık faiz varsayılanı güncel değil; "örnek" etiketi, kullanıcı değiştirir |
| kira-getirisi | `roi-calculator` DEĞİL (o EmlakSoft ROI'si); getiri formülü `investment-panel` ile aynı mantık, yeniden kullanım için ortak fonksiyon çıkarılması gerekebilir (uygulamada kontrol) | brüt/net getiri, geri dönüş yılı; "yatırım tavsiyesi değildir" |
| kira-artis-hesaplama | `tufe.ts` | Veri doğrulanmamış: sayfada "oran TÜİK 12 aylık ortalamaya göre ve resmi veriyle doğrulanmalıdır" uyarısı ve bekleyen aylarda elle giriş; sahibin tablo doğrulaması bitene kadar sayfa yayına AÇILMAZ (kapı: sahibin kararı #9) |
- Ortak başlık: başlık/H1, açıklama, kullanım, "nasıl hesaplanır" metni, SSS (JSON-LD `FAQPage` yalnız gerçekten sayfada görünen SSS için), `WebApplication` JSON-LD (fiyat 0, `applicationCategory: BusinessApplication`), OG görseli, `sitemap.ts`'e ekleme, sonda "Emlaksoft'ta otomatik" CTA → `/kayit?ref=arac-<slug>` (kaynak raporuna `utm_source=arac`).
- Giriş verisi sunucuya GİTMEZ (istemci hesabı); analitik yalnız sayfa görüntüleme. KVKK ek yükü yok.
- Sahte değer yok: örnek sonuç gösteriliyorsa "örnek hesaptır" etiketi.
- Sözleşme oluşturucu (ChatGPT): RİSK, bu pakette YOK.

### 3.5 Paket D: Herkese açık danışman/ofis sayfaları ve "Powered by"
- Danışman sayfası zaten opt-in; eklenecekler: (1) `is_public` açarken danışmanın kendi rızası (yalnız sahip değil: ofis sahibi anahtarı + danışmanın "profilimin yayınlanmasını kabul ediyorum" onayı, tarihli kayıt), (2) `index_allowed` ayrı anahtar (yayın açık, arama motoru kapalı mümkün), (3) sayfada küçük ibare: "Bilgiler ofis/danışman tarafından beyan edilmiştir; Emlaksoft üyesidir", (4) kaldırma/silme: danışman ayrılınca ya da talep edince 1 tık kapat, sitemap anında düşer, `410`/noindex.
- Ofis vitrini: sitemap şu an tüm aktif ofisleri alıyor; opt-in'e çevrilmesi KVKK/ticari izin açısından ayrı karardır (mevcut davranış canlıda; sahibin kararı #6). Önerilen: `tenants.vitrin_indexable` varsayılan mevcut davranışı bozmamak için açık göç + yeni ofislerde onaylı; hukukçu teyidi gerekir.
- Şehir/bölge dizini: yalnız opt-in edenlerden, bir sayfada en az N (öneri 5) kayıt olunca `index`, altında `noindex`. V-later.
- "Powered by EmlakSoft": bugün her yerde sabit. Yapılacak: bağlantıyı `/?ref=powered` yerine `/r/powered-<tenant_kodu>` kısa ref'e çevirmek (hangi ofis sayfası getirdi, referral zinciri değil; ofis ayrıca ödül almaz ilk sürümde, istenirse referral koduyla birleşebilir); PDF/sunum/malik portalı kapsamı kodda doğrulanacak; paket farkı: üst pakette ofis ayarıyla "Powered by" gizlenebilir (`tenants` ayar alanı, K2 plan alanlarına bağlı, plan sahibiyle koordinasyon; sahibin kararı #7). Kaldırma varsayılanı ücretsiz değil önerisi bizim; sahibin tercihi.

### 3.6 Paket E: 30 günlük başarı programı ve taşıma
- Seri: gün 0, 1, 3, 7, 14, 21, 30; bildirim + e-posta, içerik `onboarding-state` gerçek ilerlemesine göre (ör. "henüz portföy eklemediniz → şunu yapın", yapılmışsa o adım atlanır). Yeni sihirbaz yazılmaz. E-posta ticari ileti kapsamına girebilir (İYS/ETK); işlemsel/onboarding ile pazarlama ayrımı için hukukçu teyidi gerekir, ilk sürüm uygulama içi bildirim + işlemsel e-posta.
- "Ücretsiz taşıma": `/app/ice-aktarma` içinde "taşıma talebi" formu → `support_tickets` kategorisi `migration` (kategori doğrulayıcı güncellenir), admin kuyruğu, hedef süre. Garanti dili: "kapsam: müşteri, portföy ve belge içe aktarımı; kaynak veri dosyasının sağlanması gerekir" (kapsam sınırı yazılı).

### 3.7 Paket F: Başarı hikâyesi şablonu
Admin içeriği (`success_stories`: ofis adı, alıntı, rakam alanı + kaynak notu, yazılı izin tarihi/dosya referansı, yayın durumu). Public sayfa `/basari-hikayeleri`; kayıt yoksa sayfa 404 ve menüde link yok. İzin kaydı olmayan kayıt yayına alınamaz (DB kısıtı). Rakamlar "ofisin beyanı" olarak etiketlenir.

### 3.8 Paket G: Agregat benchmark
Ofis sahibine, ofisin kendi metriğinin "Emlaksoft ofisleri ortalaması"yla kıyası (Türkiye ortalaması denmez). Kurallar: ≥10 ofis (eşik altında kart hiç gösterilmez), ofis opt-in (varsayılan kapalı; kapatınca kendi verisi havuzdan çıkar), yalnız agregat (medyan/çeyreklik), tek ofis ayırt edilemez (en uç değerler budanır), metrik tanımı sayfada. Materialized görünüm + cron (mevcut cron envanteri sözleşmesine eklenir: `check:cron`). Yer: mevcut `/app/ekip/kiyas` yanına sekme. Hesap ofis RLS dışına çıkar (agregat), bu yüzden yalnız service_role ile ve allowlist güncellemesiyle (denetçi ajan kontrol etmeli).

### 3.9 Paket H: Kaynak/UTM yakalama ve rapor
Çerez/formdan `utm_source, utm_medium, utm_campaign, ref, landing_path, first_seen_at` → `signup_attributions` (tenant başına tek kayıt, ilk dokunuş). `demo_requests` aynı alanları alır. Admin `/admin/raporlar` içinde kaynak bazlı: ziyaret yok (analitik aracı ayrı), kayıt, deneme→ödeme, ilk ödeme süresi. Çerez bildirimi: birinci taraf, işlevsel/pazarlama ayrımı `cerez-politikasi` ile uyumlu olmalı (hukukçu teyidi gerekir).

## 4. Risk analizi (hukuki iddia yok; teyit işareti var)

### 4.1 Ortak/affiliate komisyonu ödemesi
- Ödeme nakit olursa: ortak gerçek kişiyse ödeme türü (serbest meslek makbuzu, gider pusulası, fatura), stopaj ve KDV, tüzel kişiyse fatura; Emlaksoft'un muhasebe yükümlülükleri. **Mali müşavir teyidi gerekir.**
- İlk sürüm kararı (önerim): nakit ödeme YOK. Ödül yalnız (a) Emlaksoft abonelik kredisi/indirimi (referral ve ofis ortakları), (b) ortak tipi içerik üreticisi/eğitmen için ürün hesabı kredisi. Kredi devredilemez ve nakde çevrilmez, süreli (`expires_at`). Bu bile "ücretsiz hizmet/hediye" vergisel sonucu doğurabilir: **teyit gerekir**.
- Nakit gerekirse: ortak tarafından kesilen belge numarası + tarih olmadan `partner_payouts.status='paid'` yapılamaz; Emlaksoft ödeme yöntemi dışarıda (havale), sistem para tutmaz.
- Tek taraflı değişiklik riski: kural oranını sonradan düşürme; kural sürümü ve geçerlilik tarihi kayıtta tutulur, eski kayıtlar eski kuralla ödenir.

### 4.2 Referral kötüye kullanım
Kurallar 3.2'de. Ek: ödül ancak ödeme sonrası + bekleme gününden sonra; tek referans tek ödül; geri alma ters kayıtla; admin kuyruğunda neden kodları (`same_domain`, `same_phone`, `same_ip`, `refund`); itiraz yolu kullanım şartlarına yazılır (hukukçu).

### 4.3 Kişisel veri ve KVKK
- Partner/referrer'a ofis kişisel verisi veya müşteri/lead verisi GİTMEZ; yalnız agregat sayılar. Davet eden ofis, davet ettiği ofisin adını görürse bu bir üçüncü kişiye ifşa olabilir: ilk sürümde davetliyi ad göstermeden "1. davet: kayıtlı/ödeyen" olarak göster (sahibin kararı #8).
- Kayıtta ref kodu ve cihaz/IP hash'i: aydınlatma metni güncellemesi, saklama süresi (öneri 180 gün). Teyit gerekir.
- Lead (Emlakfiyati) danışmana yönlendirmesi: lead'in açık rızası olmadan üçüncü kişiye aktarım YOK (madde 18 V-later bu yüzden).
- Danışman fotoğraf/telefon yayını: danışman rızası kayıtlı olacak (3.5).

### 4.4 "Verified Office" rozeti
- Bugün resmi doğrulama sürecimiz yok. Yetki belgesi numarası girişi "beyan"dır, resmi doğrulama değil. "Doğrulanmış" iddiası YASAK (yanıltıcı reklam riski; teyit gerekir).
- Dürüst alternatif: "Emlaksoft üyesi" rozeti (nesnel: hesap aktif) + "Bilgiler ofis tarafından beyan edilmiştir". İleride resmî bir kamu kaydıyla programatik doğrulama imkânı (ör. kamunun sunduğu sorgu) incelenir; imkân yoksa sahibin "belgeyi elle inceledik" süreci tanımlanmadan "incelendi" de denmez.

### 4.5 Herkese açık sayfalar
Opt-in, indeksleme anahtarı, silme/kaldırma yolu (3.5). Mevcut ofis vitrini sitemap'te opt-in DEĞİL: ticari ofis bilgisi olduğu için KVKK dışı olabilir ama danışman adı/foto gibi veriler içeriyorsa kontrol gerekir (doğrulanmalı).

### 4.6 "Powered by"
Kaldırılabilir olması paket farkı olabilir; kaldırılması marka sözleşmesiyle (kullanım şartları) uyumlu yazılmalı. Bağlantı `rel` ayarı ve ofisin müşteri-yüzü sayfalarında dürüst ifade ("EmlakSoft ile hazırlandı") yeterli.

### 4.7 Benchmark ve endeks
Agregat + ≥10 ofis + opt-in + kendi ofisi dışında kimlik yok. "Emlaksoft Endeksi": yeterli GERÇEK ve çeşitli veri olmadan yayınlanmaz; önerilen koşul (sahibin kararı #10): en az 30 aktif ofis ve 3 ay veri, metodoloji sayfası, sahte/dolgu veri yok. Basına çıkmadan önce hukuki teyit.

### 4.8 Başarı hikâyesi
Yazılı izin (tarih + dosya), alıntıyı müşteri onaylar, rakam müşterinin beyanı etiketi; izinsiz kayıt yayına alınamaz (kısıt). Sahte/derlenmiş rakam yasak.

### 4.9 MYK/TÜGEM/oda kampanyaları
Ürün tarafı yalnız "kurum kodu" (indirim/ek deneme, bitiş, kota; K2 alanları). Kurumla marka birlikteliği ve "resmi iş birliği" iddiası sözleşme olmadan kullanılmaz (RİSK: etik). Üyelik/belge doğrulaması kurumundur; biz yalnız kodu sorgulamayız.

### 4.10 Chrome extension ve veri çekme: ELE
Portalların kullanım şartları ve veri çekme hukuki riski, bakım yükü, mağaza onay süreçleri. Portal entegrasyonu yalnız resmi API/ofisin kendi anahtarıyla (V-later).

### 4.11 Lead exchange ve network
Komisyon paylaşımı iki ofis arasındaki sözleşmedir; Emlaksoft para tutmaz, yalnız kayıt/mutabakat gösterir. Mevcut `/app/ag` bunu bu çerçevede yapıyor (doğrulanmalı). Şehirler arası genişleme V-later.

### 4.12 Bayilik/şehir temsilciliği
Franchise/bayilik/aracılık sözleşmesi ve vergi sonuçları hukukçu işidir. İlk adım "yerel ortak" = Paket B partner türü (komisyon kredisi); sözleşmeli temsilcilik ancak veri gelince.

## 5. İş geliştirme eylemleri (sahibin yapacağı) — ilk 90 gün

Her görüşmeye hazır paket: (1) tek sayfa teklif, (2) ürün tarafı kod/kampanya, (3) başarı ölçütü. Öncelik sırası bizim (ChatGPT'ninkinden farklı: ölçülebilirlik ve risk):

| Sıra | Hedef | Paket | Ürün tarafı | Başarı ölçütü (90 gün) | Taslak teklif özeti |
|---|---|---|---|---|---|
| 0 (1-3. hafta) | Kendi müşterilerimiz (referral) | Paket A | Referral + ölçüm (H) | Aktif ofislerin ≥%20'si kodu paylaştı; K-faktörü ≥0,2 | "Bir ofis getir, sen 1 ay kazan" (miktar sahibin) |
| 1 (2-6. hafta) | 3-5 eğitmen/içerik üreticisi | Paket B partner | `/p/<kod>`, ücretsiz kredi | Her biri ≥10 kayıt; kayıt→ödeme ≥%10 | "Öğrencilerine/izleyicilerine özel 30 gün + senin bakiyen" |
| 2 (4-8. hafta) | MYK sınav/belgelendirme merkezi (1-2 merkez) | Kurum kodu (V-later; ilk aşamada partner kodu + K2 kampanya) | `/p/<merkez>` | 1 grup sunumu → ≥30 kayıt | "Belge alan adaya 3 ay ücretsiz deneme" (3 ay K2 kampanyası) |
| 3 (6-10. hafta) | Mali müşavir/muhasebeci (3 kişi) | Partner türü mali müşavir | Kredi | 3 ofis getirdi | Komisyon takibi için paket sunumu |
| 4 (8-12. hafta) | Ticaret odası emlak komitesi / TÜGEM / dernek | Kurum kodu + sunum | `/p/<kurum>` | Bir etkinlikte sunum, ≥20 kayıt | Üyelere özel koşul |
| 5 (10-13. hafta) | Franchise markası (1 pilot) | Çoklu ofis (V-later) | `/app/franchise` demo | 1 pilot ağ konuşması | Önce ücretsiz pilot, sonra paket |
Portal entegrasyonu görüşmeleri ve e-imza/BSP gelir paylaşımı bu 90 günde YOK: önce sağlayıcıyla yazılı koşul ve hukuk teyidi.

**Şehir odağı (benim görüşüm):** Ağ etkisi şehir bazlıdır (ofisler arası ağ, dizin, odalar). Fakat yalnız Kahramanmaraş (görece küçük pazar) ürünün doğru ölçeğini kanıtlamaz. Öneri: bir "çapa şehir" (sahibin yakından tanıdığı, 40-80 ofislik, sahibin sosyal sermayesinin olduğu yer; Kahramanmaraş bu koşula uyuyorsa uyumlu ve doğru) + organik gelen ikinci/üçüncü şehir için tek şehir hedefi yok. Ölçüt: şehirde ≥15 ofis aktif olunca `/app/ag` talep/arz eşleşmesi görünür olur; ondan sonra şehir dizini V-later açılır. Veriyle (kayıt kaynağı raporu, bölge dağılımı) doğrulanır; önceden "dominasyon" varsayımı yapılmaz.

**Ölçüm panosu:** kayıt kaynağı (ilk dokunuş), kaynak başına deneme kaydı, deneme→ödeme dönüşümü ve süresi, 30. gün aktivasyon (onboarding-state adımlarının %'si), referral K-faktörü (= kişi başı davet × davet→ödeme), ortak başına kayıt/ödeyen/bakiye, ödül tutarı / kazanılan MRR (CAC benzeri), iptal oranı (referral vs organik), nihai olarak kaynak başı LTV.

## 6. Kendi önerilerim (ChatGPT'de olmayan, en çok 5)

1. **Kaybetme anı referralı:** ofis iptal ederken (bu bir "çıkmaz değil dönüş" noktası) "ekibini/portföyünü dışa aktar + bir meslektaşına devret" akışı; çıkış anketi verisi gerçek ürün iyileştirmesi sağlar. Neden: iptal edenler sessiz kalır; geri dönüş ve öneri nedenlerini toplar. Sahte vaat yok.
2. **"Ofisim ağda" görünürlük kartı** (`/app/ag` içinde): ağdaki gerçek talep/arz eşleşmesi sayısı ofisin ağ değerini kanıtlar; yeni ofis davet etmenin kişisel nedeni olur (yalnız gerçek sayı).
3. **Müşteri portalı/değerleme raporu ucundan "meslektaşına öner"**: son müşteri değil, o ofisin tavsiye ettiği ofise değil; portal altbilgisindeki `ref` bağlantısına bağlı ofis geri bildirimi (Paket D ile birleşik, ek şema yok).
4. **Teknik SEO "yerel rehber" sayfaları**: gerçek ofis verisi yerine kaynaklı kamu verileriyle (ör. harç/masraf takvimi, kira artış rehberi) içerik; araçlarla iç bağlantı. Yalnız doğrulanmış veri ve güncelleme tarihi. Uzman yazar gerektirir.
5. **İlk ofis/ilk iş "ilk komisyon" kutlaması ve paylaşım kartı**: ürün içi başarı anı (ilk anlaşma kapandığında) → "ekibine/meslektaşlarına gösterilebilir" şık kart, isteğe bağlı, rakam yalnız ofisin kendi verisi (paylaşım ofisin kararı). Organik paylaşım doğal tetikleyicisi.

## 7. Sahibin kararı gerekenler

1. Ödül miktarları (referral: sabit TL mi 1 ay mı; partner yüzde, süre ay; öneri başlangıç: referral 1 ay hizmet bedeli, partner %20/12 ay ama bakiye kredi olarak).
2. Ödeme şekli/vergi: ilk sürümde yalnız kredi mi, nakit ne zaman; mali müşavir görüşü (4.1).
3. Partner/referral sözleşmesi ve kullanım şartları ekleri (hukukçu).
4. Bekleme günü (öneri 30), çerez ömrü (öneri 30-60), kredi son kullanma süresi, aylık ödül tavanı.
5. K2 kuponuyla birlikte kullanım ve kredi harcama üst sınırı (fatura %?).
6. Ofis vitrininin sitemap'ten opt-in'e geçişi ve "danışman rızası" metni.
7. "Powered by" kaldırma: hangi pakette, ücretli mi.
8. Partner/davet eden ofise davetli ofisin adı gösterilsin mi (öneri: hayır).
9. TÜFE tablosunun doğrulaması bitmeden kira artışı aracı yayınlanmaz kararı; kredi faiz/harç oranlarının güncel doğrulaması.
10. "Emlaksoft Endeksi" yayın koşulu (öneri ≥30 ofis, 3 ay).
11. Marka kullanımı: kurum/odalarla ortak marka, "resmi iş birliği" ifadesi.
12. Çapa şehir seçimi (bölüm 5).
13. Başarı hikâyesi izin formu metni.

## 8. Elenenler ve nedeni

- Chrome extension / portal veri çekme (kullanım şartı, hukuki risk, bakım).
- "Emlaksoft Verified Office" (doğrulanmış iddiası): yerine "Emlaksoft üyesi".
- "Emlaksoft Endeksi" ve basın bültenleri: gerçek veri yok; koşullu V-later.
- Hukuki sözleşme/şablon üretimi ("Emlaksoft Legal"): hukuki sorumluluk; alan/yer tutucu dışında kod yok.
- Ücretsiz sözleşme oluşturucu: aynı neden.
- E-imza/SMS/BSP/santral gelir paylaşımı: sağlayıcı sözleşmesi ve düzenleme ağırlıklı; ürün kodu gerektirmez, BD görüşmesi yeterince net olunca.
- Nakit ortak ödemesi (ilk sürüm): vergi ve ödeme altyapısı yükü.
- Marketplace (komisyon tahsilatı): Emlaksoft para tutmaz.
- Şehir temsilciliği sözleşmesi, mükerrer maddeler (#27, #38).
- Otomatik "Türkiye ortalaması" benchmark adı: yalnız "Emlaksoft ofisleri ortalaması".

## 9. Uygulama sırası (kodlama için öneri)

1. Paket H (kaynak yakalama) + ortak şema (bu belgenin migration taslağı).
2. Paket A referral (kod, çerez, ödül kuyruğu, admin kuralları).
3. Paket B partner (`/p/<kod>`, token'lı rapor, manuel ödeme kaydı).
4. Paket C ücretsiz araçlar (TÜFE doğrulaması bekleyen hariç) + sitemap.
5. Paket D + E + F + G.
Her adımda: `requirePermission`, RLS, `admin-client-allowlist` envanteri, `check:cron` (benchmark cron'u), Türkçe metin, koyu tema yalnız /app ve /admin.

## 10. Migration taslağı notu
`supabase/proposed/20260819000100_growth_referral_partner_attribution.sql` ve `rollbacks` karşılığı taslaktır; `supabase/migrations`'a TAŞINMADI çünkü `db:migrate` ve ledger/checksum denetimi `migrations` klasörünü uygulanabilir sayar ve paralel ajanların numara çakışması riski vardır. Uygulamadan önce: numara güncellenir, `check:migrations` + dry-run, restore edilebilir yedek, mevcut kayıt RPC'sine `p_ref` eklemesi ayrı dosya.
