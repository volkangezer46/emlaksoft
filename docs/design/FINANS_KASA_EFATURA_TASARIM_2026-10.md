# Finans: Kasa/Banka, Hızlı Gelir-Gider, Otomatik Ödemeler, Kurulum ve e-Fatura Tasarımı (2026-10-10)

Durum: TASARIM. Uygulama kodu değişmedi, migration yazılmadı, commit yok. Mevzuat (KDV, e-fatura zorunluluğu) yalnız bilgi amaçlıdır; sistem uyarır, engellemez.

## 0. Mevcut durum (tekrar keşfedilmedi, kanıtlı özet)
- `expenses` (kiracı RLS; id, tenant_id, created_by, property_id, category text, title, amount, currency, expense_date, notes, receipt_url) + 000700 turunda `recurrence` (monthly/quarterly/yearly) ve `portal_key`. Tekrarlayan seri = aynı başlık+kategori+dönem, SAF `src/lib/finance/recurring-expenses.ts`; yenileme hatırlatması `insight-engine` içinde. Seri kaydı OTOMATİK OLUŞTURMAZ, yalnız hatırlatır.
- `expense_budgets`, portal ROI, danışman kârlılığı (`src/lib/finance/*`), kâr-zarar (`/app/raporlar/kar-zarar`), komisyon defteri (`/app/komisyon`), mülk yönetimi tahsilat/hakediş, bina aidatı (`building_payments`), kira tahakkuku (cron `kira-tahakkuk`).
- Gelir tarafında "serbest gelir" kaydı YOK: gelir yalnız komisyon, kira yönetim ücreti, aidat yönetim ücreti kaynaklarından türer. Para hesabı (kasa/banka) kavramı YOK.
- `src/lib/accounting/` yalnız PLATFORM (EmlakSoft'un kendi abonelik faturaları) muhasebesidir; ofisin muhasebesi değildir. Karıştırma, yeniden kullanma (yalnız `period.ts`, kuruş yardımcıları).
- Gizli anahtar deseni: `src/lib/platform-secrets.ts` (`sealPlatformSecret`, AES-GCM `v1.<iv>.<tag>.<ct>`, AAD = depo anahtarı) + `src/lib/settings/secrets.ts` (EmlakFiyati anahtarı bunu kullanır). Bu platform düzeyidir; kiracı anahtarı için AYNI şifreleyici, AAD farklı (bkz. e).
- Yetki: modül `expenses` (Giderler sayfası, muhasebe rolü yalnız VIEW), `earnings_all` (P12: başkasının kazancı). Menü: `Giderler` zaten çekirdek öğe (`nav-config.ts`); yeni öğe EKLENMEZ.

## 1. Araştırma özeti (web, 2026-10; "doğrulanmadı" = resmi dokümana erişilemedi)
**Muhasebe/e-fatura API'leri**
| Sağlayıcı | Herkese açık REST? | Kimlik doğrulama | Belge türleri | Not |
|---|---|---|---|---|
| Paraşüt API v4 (apidocs.parasut.com, OpenAPI) | Evet | OAuth2 (client_id/secret + şirket id; password grant, refresh token) | Satış faturası; alıcı mükellefse e-fatura, değilse e-arşiv (VKN/TCKN'den); e-SMM desteği doğrulanmadı | Kullanıcının zaten Paraşüt hesabı olmalı; test: Paraşüt deneme/sandbox hesabı |
| Nilvera (api.nilvera.com) | Evet (SDK'lar var) | API anahtarı (Bearer) | e-Fatura, e-Arşiv, e-İrsaliye, **e-Serbest Meslek Makbuzu**, e-Müstahsil | Doğrudan entegratör: muhasebe programı GEREKMEZ; test ortamı var, ayrıntı doğrulanmadı |
| BizimHesap (apidocs.bizimhesap.com) | Evet, dar (fatura ekleme `addinvoice`) | Firma anahtarı (header/gövde) | Satış/alış faturası kaydı; resmileştirme kendi içinde | Muhasebe kaydı için uygun, e-belge kapsamı sınırlı |
| Uyumsoft, Foriba/Sovos, QNB eFinans, Kolaysoft | Genelde SOAP/WCF ya da sözleşmeli REST; belgeler müşteriye açık | Kullanıcı adı+şifre / sözleşme anahtarı | e-Fatura, e-Arşiv, e-SMM bazıları | Entegratör sözleşmesi ister; v2'de adaptör |
| Logo İşbaşı, Mikro (Jump/Fly) | Kurulumlu/ lisanslı API; herkese açık dokümantasyon doğrulanamadı | Lisans/kullanıcı | ERP kaydı | v1 dışı |
Sonuç: v1'de iki yol. (1) **Nilvera** (doğrudan entegratör, e-SMM dahil, tek API anahtarı) = "muhasebe programım yok" ofis; (2) **Paraşüt** = "zaten Paraşüt kullanıyorum" ofis. Üçüncü bir sağlayıcı arayüz sayesinde sonradan eklenir.

**Emlak gelir türleri (bilgi):** satış/kiralama komisyonu ve hizmet bedeli (KDV genelde %20; konutta oran/istisna ofis muhasebecisine sorulur), kira yönetim ücreti (%20 KDV), danışmanlık/değerleme ücreti, reklam/ekspertiz, aidat yönetim ücreti. Danışman ofise bağlı çalışıyorsa faturayı ofis keser; bağımsız danışman kendi adına **e-SMM veya fatura** keser (karar ofis ayarı: `invoice_issuer` = ofis/danışman). KDV oranı alan olarak seçilir (0/1/10/20), sihirbaz uyarır ama zorlamaz.

**Kasa/banka modeli:** hesap türleri kasa (nakit), banka (vadesiz), kredi kartı, (ops.) POS bekleyen; hareket = para girişi/çıkışı; transfer = iki bacaklı hareket (kasa->banka, banka->danışman kasası); açılış bakiyesi tek hareket (`kind=opening`); bakiye = açılış + Σ hareket (saklanmaz, türer); mutabakat = hareketi ekstre satırıyla eşleyip "mutabık" işaretlemek. Banka ekstre içe aktarma: CSV (v1) ve OFX/MT940 (v2); TR'de açık bankacılık (BKM/TCMB, 2020 Ödeme Hizmetleri) bankaya ve lisanslı hizmet sağlayıcıya bağlıdır, ofis düzeyinde doğrudan erişim yok, v1 DIŞI (yalnız bilgi).

**Tekrarlayan işlem:** kuralda sıklık (aylık/yıllık), ödeme günü (1..31), ay sonu kuralı (31 seçili ay kısaysa ayın son günü), başlangıç/bitiş, tutar (sabit/tahmini), mod = "otomatik işle" (maaş/kira gibi kesin) veya "onaya sun" (fatura gibi değişken, bu ay tutarı gir). Hatırlatma: vade günü ve 3 gün önce.

## 2. (a) Basit kullanıcı akışları
**Tek form: "Gelir ekle" / "Gider ekle"** (Finans sayfasının üstünde iki düğme + her sayfada Hızlı ekle paletinde; mobil alt çubuk eylem sayfası).
1. Zorunlu 3 alan: **Tutar**, **Ne için** (kategori çipleri: gider için Kira, Aidat, Maaş, SGK, Muhasebe, Portal, Reklam, Ulaşım, Diğer; gelir için Komisyon, Hizmet bedeli, Kira yönetimi, Diğer; başlık otomatik dolar), **Hangi hesap** (varsayılan = son kullanılan ya da kasa).
2. Tarih = bugün (gizli, "Tarih değiştir" bağlantısı). "Ayrıntı ekle" açılır: KDV oranı (varsayılan yok), mülk/müşteri/anlaşma bağlantısı, fiş (https bağlantı, mevcut davranış), not, ödendi/ödenecek.
3. **"Her ay tekrarla" anahtarı**: açılınca ödeme günü (tarihten gelir) + "otomatik işle / bana sor" seçimi görünür. Kaydedince hem hareket hem kural oluşur.
4. Gelir ekleme komisyon kaydından AYRIDIR: komisyon tahsilatı mevcut komisyon akışında yapılır, orada "hangi hesaba girdi" alanı gelir (otomatik hareket üretir). Serbest gelir yalnız komisyon dışı gelir içindir (çift sayım yok, bkz. b).
**Kasa/Banka sekmesi**: hesap kartları (bakiye tıklanır -> hesap hareketleri), "Transfer", "Ekstre yükle (CSV)", "Mutabakat" (eşleşmeyen satırlar). Danışman yalnız KENDİ hesaplarını görür/yönetir; ofis sahibi ofis hesaplarını yönetir ve danışman hesaplarının kalemsiz özetini (P12 kuralıyla) görmez.
**Fatura**: gelir kaydında "Fatura kes" düğmesi (entegrasyon bağlıysa), yoksa "Entegrasyon bağla" yönlendirmesi.

## 3. (b) Veri modeli: tek defter + bağlama (mükerrer olmayan)
Karar: **"Para hareketi defteri" (`cash_entries`) yalnız PARANIN GERÇEKTEN GİRDİĞİ/ÇIKTIĞI hesabı tutar; iş kayıtları (expenses, komisyon, kira, aidat) kendi tablolarında KALIR ve ilgili hareketle `source` bağıyla ilişkilenir.** `expenses` gider gerçeğinin tek kaynağı olmaya devam eder (kâr-zarar, bütçe, portal ROI bozulmaz). Yeni serbest gelir için `incomes` tablosu açılmaz; `cash_entries` kind=income + `source_type='manual'` yeterli ve kâr-zararda "diğer gelir" olarak okunur.
Tablolar (yeni, hepsi `tenant_id` + RLS):
- `finance_accounts` (id, tenant_id, owner_scope `office|user`, owner_user_id null=ofis, kind `cash|bank|card`, name, iban_last4, currency, opening_balance numeric(14,2), opening_date, archived_at). Kısıt: `owner_scope='user'` iken owner_user_id zorunlu; ofis başına en fazla 1 varsayılan.
- `cash_entries` (id, tenant_id, account_id fk, direction `in|out`, amount>0, currency, entry_date, kind `income|expense|transfer|opening|adjust`, transfer_group_id null, category, title, expense_id null fk, source_type `manual|commission|rent|due|building|recurring|import`, source_id null, recurring_rule_id null, reconciled_at null, statement_line_id null, created_by, voided_at). Benzersizlik: `unique(tenant_id, source_type, source_id, account_id)` where source_id not null -> aynı komisyon tahsilatı iki kez hareket üretmez.
- `recurring_rules` (id, tenant_id, scope/owner_user_id, direction, title, category, amount, vat_rate null, account_id, frequency `monthly|quarterly|yearly`, pay_day 1..31, start_on, end_on null, mode `auto|approve`, last_run_period, paused_at, source_template `rent|sgk|accounting|portal|salary|manual`). Mevcut `expenses.recurrence` serileri ilk geçişte `recurring_rules`'a 1 kez kopyalanır (idempotent, `expenses.recurrence` sütunu kalır, okuma geriye uyumlu).
- `statement_imports` / `statement_lines` (CSV satırları: tarih, açıklama, tutar, hash; eşleşen `cash_entry_id`). Hash ile mükerrer yükleme engellenir.
- `einvoice_connections`, `einvoices` (bkz. e).
Yazma yalnız RPC (`record_cash_entry`, `transfer_between_accounts`, `void_cash_entry`; tek transaction, iki bacak, bakiye negatif olabilir ama uyarı) — bina yönetimi deseni gibi. `expenses` eklerken `account_id` verilirse RPC aynı transaction'da hareket üretir; verilmezse eski davranış (hesapsız gider geçerli; "Hesaba bağla" önerisi çıkar).
**Kapsam ve RLS:** `owner_scope='office'` satırları yalnız `expenses` ALL yetkisi olanlara (sahip/GM/yetkili) yazılabilir/okunabilir; `owner_scope='user'` satırları yalnız `owner_user_id = auth.uid()` ve ofis sahibine DEĞİL (kişisel; ofis sahibine sadece kullanıcı kendisi paylaşırsa özet). `cash_entries` politikası hesabın kapsamını alt-sorguyla miras alır (`exists (select 1 from finance_accounts a where a.id=account_id and (a.owner_user_id=(select auth.uid()) or (a.owner_scope='office' and has_effective_permission('expenses','create'))))`, initplan kuralına uyumlu `(select auth.uid())`). Yeni izin modülü AÇILMAZ: ofis hesapları `expenses`, kişisel hesaplar oturum sahibi (kendi verisi, ayrı izin gerekmez). Yeni modül olsaydı 4 kayıt yeri gerekirdi; gerekmiyor.
**P12 uyumu:** danışmanın kişisel kasası/komisyon kazancı başkasına `earnings_all` olmadan görünmez; ofis kasasına danışman komisyon payı hareketleri "ödenen hakediş" olarak ofis tarafında tutar-özet görünür (zaten hakediş ofis kaydı), danışman kendi payını kendi kişisel hesabına "gelir" olarak ekleyebilir (manuel; otomatik kopya YOK, çift sayım yok). Danışman kişisel gelir/gideri ofis kâr-zararına GİRMEZ (`owner_scope='user'` filtre dışı).
Tutarlar kuruş duyarlı numeric(14,2); saf hesaplar `src/lib/finance/cash/*` (bakiye, transfer doğrulama, ay sonu kuralı) birim testli.

## 4. (c) Otomasyon (yeni cron YOK, sözleşme 36 korunur)
- `kira-tahakkuk` cron'una **adım 4d "tekrarlayan kurallar"**: bugün `pay_day` olan (ay sonu kuralı: gün > ayın uzunluğu -> son gün) ve `last_run_period` != bu dönem kurallar için: `mode=auto` -> `cash_entries` + (gider ise) `expenses` kaydı RPC ile üretilir; `mode=approve` -> "Onay bekleyen" kaydı (`recurring_runs` durumu `pending`) + bildirim/görev ("Bu ay elektrik tutarını gir"). Idempotent: `unique(rule_id, period)`; geç kalan çalışmada dönem içindeki kaçırılan günler telafi edilir (en çok 31 gün).
- Hatırlatma: vade -3 gün bildirimi aynı adımda; mevcut `insight-engine` abonelik yenileme kuralı `recurring_rules` okuyacak şekilde genişler (`rules/finance.ts`), çift hatırlatma önlenir (eski seri kaynağı kuraldan düşer).
- Banka ekstre eşleşmesi önerisi (tutar+tarih ±3 gün) sayfa açılışında hesaplanır, cron gerekmez.
- e-Fatura durum sorgusu (`SENT` -> `ACCEPTED`): `otomasyon` cron'unun mevcut adımlarından birine eklenir, beklemede > 5 dk olanları sağlayıcıdan sorar.
- Her adım `recordHeartbeat` alt-sayacı yazar; cron sözleşme testi etkilenmez (route sayısı değişmez).

## 5. (d) Kurulum sihirbazı ek adımları
Mevcut `PROFILE_STEPS` (konum, iletişim, fatura, marka, odak, ekip) saf listeye **"Giderler ve kasa" (`finans`)** adımı eklenir (`profile-completion.ts`; tamamlanma gerçek veriden: kural veya hesap varsa dolu). Tamamen atlanabilir, "Sonra yaparım" ilerlemeyi bozmaz. Sorular (3-4 ekran, her biri tek soru):
1. **İşyeri**: "Kendi yerimiz (kira yok)" / "Kiralık": aylık veya yıllık, tutar, ödeme günü, (ops.) KDV/stopaj yok notu -> kural `rent` (kategori kira).
2. **Sabit giderler** (onay kutusu listesi, her birinde tutar+gün): muhasebeci ücreti, SGK/bağ-kur primi, internet/telefon, elektrik-su (mode=approve), sahibinden.com / Hepsiemlak / Emlakjet üyeliği (`portal_key` dolar, portal ROI ile bağlanır), yazılım/abonelik.
3. **Maaşlar**: ekip adımındaki kişiler listelenir; kişi başına maaş tutarı + gün (opsiyonel, hassas: yalnız sahip/GM görür, `expenses` ALL).
4. **Kasa ve banka**: "Ofis kasası" otomatik açılır; banka hesabı ekle (ad, IBAN son 4, açılış bakiyesi); danışmanlar kendi hesaplarını Finans'ta kendileri açar.
Tamamla: tek tıkla `recurring_rules` toplu RPC ile oluşur (başlangıç = bu ayın ilk uygun günü; geçmişe dönük kayıt üretmez), özet ekranı "12 aylık tahmini sabit gider" gösterir (tahmin etiketli). Kayıt (`/kayit`) kısa kalır; adım yalnız `/app/ayarlar/profil-tamamla` ve ana ekran kartında görünür.

## 6. (e) e-Fatura entegrasyon mimarisi
Dizin `src/lib/integrations/einvoice/`: `types.ts` (SAF), `adapter.ts`, `nilvera.ts`, `parasut.ts`, `registry.ts`, `redact.ts` (log maskeleme), `*.test.ts` (sahte HTTP).
```ts
interface EInvoiceAdapter {
  id: "nilvera" | "parasut";
  capabilities: { eFatura: boolean; eArsiv: boolean; eSmm: boolean; sandbox: boolean };
  testConnection(creds): Promise<Result<{ company: string }>>;
  lookupTaxpayer(vknOrTckn): Promise<Result<{ isEInvoiceUser: boolean; alias?: string }>>;
  createDraft(inv: InvoiceDraft): Promise<Result<{ externalId: string }>>;
  issue(externalId): Promise<Result<{ docType: "e-fatura"|"e-arsiv"|"e-smm"; number: string }>>;
  getStatus(externalId): Promise<Result<{ status: "draft"|"sent"|"accepted"|"rejected"|"cancelled"; reason?: string }>>;
  getPdf(externalId): Promise<Result<{ url?: string; bytes?: Uint8Array }>>;
  cancel?(externalId, reason): Promise<Result<void>>;
}
```
- `InvoiceDraft` SAF: alıcı (ad, VKN/TCKN, adres), kalemler (açıklama, adet, birim fiyat, KDV oranı), para birimi, düzenleme tarihi, kaynak bağı (komisyon/kira/serbest gelir `cash_entry`). Tür seçimi saf kural: alıcı e-fatura mükellefi -> e-fatura, değilse e-arşiv; `invoice_issuer=advisor` ve sağlayıcı e-SMM destekliyorsa e-SMM.
- Saklama: `einvoice_connections` (tenant_id, provider, label, `credentials_sealed` text, mode `sandbox|live`, created_by, last_test_at, last_test_ok). Şifreleme mevcut `sealPlatformSecret` ile; AAD = `einvoice:<tenant_id>:<provider>` (kiracılar arası çözme imkânsız). Anahtar ekranda bir daha GÖSTERİLMEZ (yalnız `secretFingerprint`); okuma yalnız sunucuda, UI'ya sızmaz. Şifreleme anahtarı yoksa (`secretsWritable()` yanlış) kaydetme reddedilir, düz metin ASLA yazılmaz. Bağlantıyı yalnız sahip/GM yönetir; kayıt denetim günlüğüne (anahtarsız) yazılır.
- `einvoices` (tenant_id, connection_id, source_type/source_id, status, doc_type, external_id, number, total/vat, issued_at, error, idempotency_key unique, pdf_path). Akış: Taslak (yerel) -> "Resmileştir" (onay penceresi, GERİ ALINAMAZ uyarısı, sandbox'ta rozet) -> sağlayıcı sonucu -> PDF/durum bağlantısı gelir satırında. Aynı kaynak iki kez faturalanmaz (idempotency_key = kaynak+bağlantı).
- Güvenlik: sağlayıcı HTTP çağrıları yalnız `src/lib/integrations/einvoice/*` içinden; kaynak sınırlı fetch (zaman aşımı, allowlist ana bilgisayar, SSRF için kullanıcı verilen URL YOK); `createAdminClient` kullanılırsa `admin-client-allowlist.ts` güncellenir; AI'ya kimlik/tutar gönderilmez (redact).
- Sağlayıcı önerisi: ilk **Nilvera** (muhasebe programı gerektirmez, e-SMM dahil, tek anahtar), ikinci **Paraşüt** (OAuth + token yenileme; refresh token şifreli saklanır). Kapsam dışı: Logo/Mikro ve diğerleri (dokümansız/lisanslı). Karar bekleyen: Nilvera/Paraşüt ile gerçek sandbox hesabı açıp alan eşlemesinin doğrulanması (bu araştırmada API şemaları resmi dokümandan doğrulanamadı; adaptör sözleşme testleri kayıtlı örnek yanıtla yazılır).
- Not: EmlakSoft muhasebe PROGRAMI olmaya çalışmaz: tam çift taraflı defter, bordro, e-defter kapsam dışıdır; "muhasebeci için dışa aktar" Rapor merkezi'nden gelir.

## 7. (f) Ekranlar ve menü
- Yan menüde yeni öğe YOK. `Giderler` sayfası içeriği "Finans" başlığına dönüşür (etiket değişimi `nav-config.ts`'te, yol `/app/giderler` kalır; kısayol/yer imi bozulmaz). Sayfa içi sekme şeridi (URL `?sekme=`, filtre kontratı: sunucu filtre + sayfalama): **Özet** (mevcut KPI + hesap bakiyeleri) · **Hareketler** (gelir/gider/transfer, hesap ve tarih filtresi) · **Kasa ve banka** · **Düzenli ödemeler** (kurallar + onay bekleyenler; mevcut Abonelikler kartı buraya taşınır) · **Faturalar** (e-fatura listesi/bağlantı) · **Bütçe** (mevcut).
- Ayarlar: bağlantı kurulumu `Ayarlar > Entegrasyonlar` içinde "Muhasebe ve e-fatura" kartı (yeni menü yok). Sayfa kapısı `requireModulePage("expenses", href)`; paket kilidi `page-gates.ts`: temel kasa/hareket tüm paketlerde, e-fatura entegrasyonu üst pakette (karar bekliyor).
- Tüm sayılar tıklanabilir (StatCard `href`): bakiye -> hesap hareketleri; "bu ay gider" -> Hareketler filtreli. Dışa aktarma düğmesi YOK; yeni raporlar rapor merkezi kataloğuna: `kasa-banka-hareketleri`, `hesap-ekstresi`, `duzenli-odemeler-takvimi`, `e-fatura-listesi` (kiracı sınırı + aktör kapsamı: kişisel hesaplar yalnız sahibine).
- Danışman görünümü: "Kasam" kartı, yalnız kendi hesapları; ofis hesapları ve diğer danışmanlar görünmez.
- Boş durumlar: "İlk hesabını aç (kasa 10 sn)" ve örnek veri etiketli demo seed (İstanbul ilçeleri; `seed:demo` genişler). Dark tema /app'te hazır; zaman yalnız `src/lib/clock.ts`.
- Telefon/e-posta alanları (alıcı fatura bilgisi) `PhoneInput`/`EmailInput`; sunucuda `parsePhoneStrict`.

## 8. (g) Uygulama iş paketleri (bağımsız, dosya bazlı, çakışmasız)
**Paket A: Hesap ve hareket defteri (temel)**
- Dosyalar: migration `finance_accounts` + `cash_entries` + RPC'ler + RLS (+ rollback, ayrı release çifti); `src/lib/finance/cash/*` (saf); `src/app/actions/finance-accounts.ts`; `src/app/app/giderler/_tabs/{ozet,hareketler,kasa-banka}`; hızlı ekle formu `quick-entry-form.tsx`; `expense-create-form.tsx`'e hesap seçici (isteğe bağlı).
- Kabul: kasa+banka+kişisel hesap oluşturulur; transfer iki bacağı tek transaction; bakiye = açılış+hareketler (birim test); danışman başka danışmanın/ofisin hesabını okuyamaz (RLS testi, `db:rls-audit` yeşil); komisyon tahsilatından hareket bir kez üretilir (benzersizlik testi); "gelir ekle/gider ekle" 3 alanla kaydedilir; sıfır-çıkmaz metrik kontrat testi geçer.
**Paket B: Düzenli ödemeler + kurulum sihirbazı**
- Dosyalar: migration `recurring_rules` + `recurring_runs`; `src/lib/finance/recurring-rules.ts` (ay sonu kuralı, dönem idempotensi, saf + test); `kira-tahakkuk` route'unda adım 4d (route sayısı 36 kalır, `check:cron` yeşil); `rules/finance.ts` kaynağı değişikliği; `profile-completion.ts` + `profil-tamamla` sihirbaz adımı; `_tabs/duzenli-odemeler`.
- Bağımlılık: A'daki `finance_accounts` (hesap seçimi); tablo erişimi A'dan sonra birleştirilir (ya da A migration'ı önce).
- Kabul: aylık kural ay sonunda doğru günde çalışır (31 Ocak -> 28/29 Şubat); aynı dönem iki kez üretilmez; `approve` kipi onaya düşer, bildirim gider; sihirbaz adımı atlanabilir ve geri dönülebilir; mevcut `expenses.recurrence` serileri kopyalanır, çift hatırlatma yok.
**Paket C: Banka ekstre içe aktarma ve mutabakat**
- Dosyalar: migration `statement_imports/lines`; `src/lib/finance/statement/{csv-parse,match}.ts` (saf; banka başlık eşleme sihirbazı); `_tabs/kasa-banka` içi "Ekstre yükle" ve "Mutabakat"; dosya boyut/satır sınırı, hash ile mükerrer engeli.
- Kabul: bir CSV yüklenir, eşleşme önerileri tutar+tarih kuralıyla (birim test), onaylanan satır `reconciled_at` işaretler; mükerrer dosya reddedilir; eşleşmeyen satırdan tek tıkla hareket oluşur. OFX/MT940 ve açık bankacılık sonraya.
**Paket D: e-Fatura entegrasyonu**
- Dosyalar: migration `einvoice_connections` + `einvoices`; `src/lib/integrations/einvoice/*`; `src/app/actions/einvoice.ts`; Ayarlar > Entegrasyonlar kartı; `_tabs/faturalar`; gelir satırında "Fatura kes"; `otomasyon` cron'una durum sorgu adımı; `admin-client-allowlist` güncellemesi (gerekirse); sözleşme testi: ağ çağrısı yalnız bu dizinde, anahtar loga/DB'ye düz yazılmaz.
- Bağımlılık: Paket A (gelir kaynağı bağı). B/C'den bağımsız.
- Kabul: sandbox anahtarıyla bağlantı testi geçer; taslak -> resmileştir -> durum -> PDF akışı sahte sağlayıcıyla testli; aynı kaynak ikinci kez faturalanamaz; anahtar yeniden gösterilmez, yanlış kiracı AAD'siyle çözülemez (test); canlı kipte onay penceresi zorunlu.
Sıra: A -> (B ‖ C ‖ D). A içinde migration numarası ardışık ve forward-only; her migration restore edilebilir yedek beyanı sonrası uygulanır.

## 9. Riskler ve açık sorular (kullanıcı kararı)
- e-Fatura paket kapısı hangi pakette? Nilvera mı Paraşüt mü ilk? (öneri: Nilvera).
- Danışman gelir/gideri ofis sahibine görünsün mü (öneri: hayır, yalnız danışman kendi paylaşırsa).
- Maaş kalemi hassas: görünürlük yalnız sahip/GM (öneri).
- Sağlayıcı API şemaları resmi dokümandan doğrulanmadı; Paket D başında 1 günlük keşif + sandbox hesabı gerekir.
