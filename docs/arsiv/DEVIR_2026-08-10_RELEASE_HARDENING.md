> **ARŞİV — güncel kaynak: docs/ROADMAP.md** (durum: docs/DURUM.md, deploy: docs/DEPLOY.md). Bu belge tarihsel kayıttır; sayılar ve talimatlar eskimiş olabilir.

# EmlakSoft — 10 Ağustos 2026 Güvenli Devir Kaydı

> **Durum:** Kod ve kalite çalışmaları tamamlandı; yayın dış bağımlılıklar nedeniyle bilinçli olarak durduruldu.
> **Geçerli yerel dal:** `codex/release-hardening`
> **Temel commit:** `597be7b574d9ac6f117f6d3326c01239273357aa` (`HEAD`, `main` ve `origin/main` bu kayıtta eşitti)
> **Remote:** `https://github.com/volkangezer46/emlaksoft.git` (public; secret olayı nedeniyle dikkat)
> **Saat dilimi:** Europe/Istanbul
> **Gizlilik:** Bu belgede hiçbir anahtar, parola, token veya bağlantı parolası yoktur.

Bu belge, 10 Ağustos 2026'da tamamlanan uçtan uca sertleştirme çalışmasının yeni bir
bilgisayarda kayıpsız sürdürülmesi için **güncel kaynak**tır. Daha eski özellik geçmişi
`DEVIR_TESLIM.md` ve `docs/DEVIR_NOTU.md` içinde korunur; çelişki varsa bu belge geçerlidir.

## 1. Yeni oturumda ilk mesaj

Yeni Codex/agent oturumuna aşağıdaki metni ver:

```text
AGENTS.md, PROJECT_CONTEXT.md ve docs/DEVIR_2026-08-10_RELEASE_HARDENING.md
dosyalarını tamamen oku. codex/release-hardening çalışma ağacını koru; mevcut kullanıcı
değişikliklerini resetleme veya üzerine yazma. Gizli anahtar rotasyonu ve migration ledger
uzlaştırması tamamlanmadan commit, push, db:migrate veya deploy yapma. Önce Git durumu,
kalite kapıları ve salt-okunur canlı DB denetimini doğrula; sonra belgedeki sıradan devam et.
```

## 2. Devir anındaki kesin durum

- Yerel dal `codex/release-hardening`; dal henüz remote'a gönderilmedi.
- Dalın upstream'i yoktu.
- `HEAD`, yerel `main` ve `origin/main` aynı temel committeydi:
  `597be7b574d9ac6f117f6d3326c01239273357aa`.
- Bu devir belgesi eklendikten sonra `git status --porcelain` çıktısında **244 değiştirilmiş
  tracked kayıt + 163 untracked yol girdisi** vardı. `git ls-files --others --exclude-standard`
  ile dizinler açıldığında gerçek untracked dosya sayısı **174** idi. Bunlar kullanıcı
  çalışmaları ile bu sertleştirme turunun ortak sonucudur; hiçbirini topluca silme/resetleme.
- İzlenen metin diff'i yaklaşık **+10.641 / -5.239 satır** idi; status'taki tracked kayıtların
  tamamı ` M` durumundaydı, staged/silinen/yeniden adlandırılan kayıt yoktu.
- Hiçbir dosya stage edilmedi, commit oluşturulmadı, push yapılmadı.
- Canlı veritabanına hiçbir migration veya veri yazma işlemi yapılmadı.
- Canlı yayın yapılmadı.
- Yerel test sunucuları kapatıldı; 3100 portunda dinleyen süreç yoktu.
- Bozuk, yeniden üretilebilir `.next/dev` önbelleği silindi ve temiz production build ile
  yeniden doğrulandı.
- Dokuz geçici tarama/log dosyası kaldırıldı. Proje veya kullanıcı verisi silinmedi.

> **Önemli:** Yalnız `git clone` yapmak bu yüzlerce commitlenmemiş değişikliği yeni
> bilgisayara getirmez. “Yeni bilgisayara geçiş” bölümünü uygulamadan eski çalışma alanını
> kapatma veya silme.

### 2.1 Kalıcı ürün ve tasarım tercihleri

- Kullanıcıya görünen arayüz Türkçe olacak.
- Dark mode eklenmeyecek.
- Mevcut tema korunacak; diğer sayfalara gereksiz toplu görsel değişiklik yapılmayacak.
- Ticket listesi ve ticket detayındaki profesyonel/premium yön korunacak.
- Yeni özellikler şık, profesyonel ve üretim kalitesinde olacak; yalnız dekoratif karmaşa
  eklenmeyecek.
- Görünen ölçüm ve kartlar anlamlı, filtrelenmiş bir hedefe tıklanabilir olacak.
- Geliştirme süresince demo giriş tek tuşla olacak; production'da kapalı kalacak. Nihai giriş
  deneyimi proje sonunda ayrıca ele alınacak.

## 3. Bu turda tamamlanan işlemler

### 3.1 Git ve yayın güvenliği

- Remote güncellendi ve çalışmaya başlamadan önce `HEAD/main/origin/main` eşitliği doğrulandı.
- Tüm çalışma `codex/release-hardening` dalında sürdürüldü.
- Kullanıcının önceden var olan değişiklikleri korundu; `reset --hard`, checkout ile geri alma
  veya toplu silme yapılmadı.
- CI, release SHA, migration checksum, action/link/cron ve bağımlılık kapıları sertleştirildi.
- Production'da demo bayrağı açıksa build/start fail-closed olur.
- `.gitleaks.toml` satır aşan yanlış pozitif üretmeyecek şekilde düzeltildi.
- Güncel çalışma ağacı secret taramasından temiz geçti; Git geçmişi ayrı kritik bulgu verdi.

### 3.2 Kimlik, yetki ve tenant sınırları

- Platform admin erişimi AAL2/TOTP ve aktif personel sınırlarıyla güçlendirildi.
- Arama sonuçları ve komut paleti rol/modül izinlerine göre filtrelendi.
- Export akışlarının tüm sorgularına açık `tenant_id` ve danışman/veri kapsamı eklendi.
- Public token/portal/share/referral/survey/booking/open-house akışlarına tenant-parent
  doğrulaması ve composite FK/RLS sınırları eklendi.
- Service-role kullanan public okumalar ID + tenant ile bağlandı.
- Demo ofise dönüşüm atomik hale getirildi; personele kalıcı/geçici parola gösterilmesi
  kaldırıldı, tek kullanımlık parola belirleme daveti kullanıldı.
- Demo hızlı giriş yalnız local geliştirmede `ENABLE_DEMO_LOGIN=true` ile çalışır; production
  bu ve diğer demo kaçış bayraklarında kapanır.

Önemli migration:

- `20260802000300_identity_session_authorization_hardening.sql`
- `20260802000400_atomic_demo_conversion.sql`
- `20260803000020_capability_tenant_boundary.sql`

### 3.3 PWA ve tarayıcı gizliliği

- Service worker v6, `/app`, `/admin` ve token'lı/private navigasyonları önbelleğe almayan
  fail-closed modele geçirildi.
- Eski v4 cache/controller kalıntısının açık oturumda kalmaması için zorunlu aktivasyon ve
  eski cache temizliği eklendi.
- Private HTML paylaşılan cihaz cache'inde kalmıyor.

Ana dosyalar: `public/sw.js`, `src/components/app/sw-register.tsx`.

### 3.4 Billing ve iyzico

- IYZWSv2 imzası resmi formüle göre `randomKey + uri.path + body` üzerinden üretildi.
- Callback/retrieve imza doğrulaması sabit-zamanlı karşılaştırma, tam alan sırası ve token
  eşitliğiyle fail-closed yapıldı.
- `paymentStatus=SUCCESS` tek başına yeterli değil; fulfillment için `fraudStatus=1` zorunlu.
- Sahte kimlik/telefon/adres fallback'leri kaldırıldı; gerçek ve doğrulanmış fatura bilgileri
  yoksa checkout bloklanır.
- Tutar, KDV, para birimi, conversation ID, payable state ve tenant/plan beklentileri DB'de
  atomik doğrulanır.
- Downgrade kapasite ön kontrolü, doğru dönem yenileme, idempotent capture ledger ve
  provider reconciliation eklendi.
- Başarılı provider tahsilatının yerel iş kuralı değişikliği nedeniyle kaybolmaması için
  lease/retry/dead-letter mutabakat kuyruğu ve cron eklendi.
- Payment-link customer/commission/creator ilişkileri tenant sınırına bağlandı.

Ana dosyalar:

- `src/lib/billing/iyzico.ts`
- `src/lib/billing/fulfillment.ts`
- `src/lib/billing/reconciliation.ts`
- `src/app/actions/billing.ts`
- `src/app/actions/payment-links.ts`
- `20260731000138_atomic_billing_fulfillment.sql`
- `20260810000100_billing_checkout_reconciliation.sql`
- `20260810000950_billing_reconciliation_leases.sql`

### 3.5 Dosya ve Storage yaşam döngüsü

- Müşteri dosyası ve portföy medyası büyük binary Server Action gövdesinden çıkarıldı.
- Signed direct-upload prepare/finalize akışı eklendi; tenant-parent-permission yeniden
  doğrulanıyor, random path ve `upsert:false` kullanılıyor.
- Finalize aşamasında provider metadata, gerçek boyut, MIME ve magic byte kontrol ediliyor.
- Replay idempotent; başarısız/terk edilmiş yüklemeler kalıcı outbox ve cleanup cronuna gider.
- Silme storage-first olmaktan çıkarıldı; DB transaction outbox üretiyor, worker hâlâ referanslı
  nesneyi silmiyor.
- `uploaded_by = auth.uid()` RLS sınırı kapatıldı.
- Logo ve profil fotoğrafı dışında binary Server Action yüzeyi bırakılmadı; 4 MB Next limiti
  contract testiyle korunuyor.
- `scan_status=signature_verified` yalnız dosya imzası doğrulamasıdır; malware-clean iddiası
  değildir.

Ana dosyalar:

- `src/lib/direct-file-uploads.ts`
- `src/lib/direct-file-upload-server.ts`
- `src/lib/direct-file-upload-client.ts`
- `src/lib/direct-file-upload-cleanup.ts`
- `src/lib/file-validation.ts`
- `20260810000900_storage_object_lifecycle.sql`
- `20260810000940_direct_file_upload_sessions.sql`

### 3.6 Mesajlaşma, kampanya ve Meta/WhatsApp

- Kampanya + uygun alıcı snapshot'ı tek transaction/RPC ile oluşturuluyor; 1000 kayıt
  PostgREST truncation riski kaldırıldı.
- SMS/WhatsApp göndereni tenant'a özel `tenant_integrations` + secret tablosundan çözülüyor.
- Global mesajlaşma fallback varsayılan kapalı; yalnız bilinçli sözleşmede
  `ALLOW_PLATFORM_MESSAGING_FALLBACK=true` ile açılabilir.
- IYS/müşteri kanal izni yoksa marketing teslimatı fail-closed atlanır.
- WhatsApp kampanyaları yalnız onaylı template adı + dil (+ kontrollü parametre) ile gönderilir;
  serbest metin marketing gönderimi yoktur.
- Meta webhook raw-body HMAC, strict UTF-8/JSON/cardinality/boyut kontrolleri, event claim,
  retry lease ve PII'siz logging ile güçlendirildi.
- Inbound/status yönlendirme yalnız Meta Graph ile doğrulanmış exact WABA + Phone Number ID,
  healthy binding ve SHA-256 fingerprint eşleşmesinde yapılır.
- Phone Number ID sahipliği Meta Graph `phone_numbers` ve phone detail üzerinden gerçekten
  doğrulanmadan entegrasyon aktif olmaz.
- Provider POST isteğinin kabul edilip cevabın kaybolmuş olabileceği belirsiz sonuçlar
  `unknown_provider_outcome` olarak dead-letter olur; otomatik tekrar gönderilmez.
- Campaign-delivery cron, template UI/provisioning ve manuel fail-closed fallback eklendi.

Ana dosyalar:

- `src/lib/campaign-delivery.ts`
- `src/lib/messaging/tenant-providers.ts`
- `src/lib/messaging/whatsapp-cloud.ts`
- `src/lib/messaging/whatsapp-contract.ts`
- `src/lib/webhooks/meta-inbound.ts`
- `src/app/api/webhooks/meta/route.ts`
- `src/app/actions/tenant-integrations.ts`
- `src/app/app/ayarlar/integrations-form.tsx`
- `20260810000920_campaign_delivery_compliance.sql`
- `20260810000960_whatsapp_cloud_provisioning.sql`
- `20260810000980_whatsapp_binding_verification.sql`

### 3.7 Public rezervasyon/teklif/teyit bütünlüğü

- Public rezervasyonun availability kontrolü, customer ve appointment insertleri tek DB
  transactionında ve row lock altında yapılıyor.
- Malik teklif cevabı ve randevu teyidi compare-and-set/idempotent outcome kullanıyor.
- State değişimi, audit ve notification intent aynı transaction içindeki outbox ile bağlandı.
- State başarılı olduğu halde effect/outbox üretilemiyorsa `40001` ile tüm transaction rollback.
- Eski `*_state_v1` helper RPC'lerinin `service_role` dahil doğrudan EXECUTE yetkileri kaldırıldı.
- Notification deterministic-key zehirleme yolu kapatıldı: authenticated INSERT kaldırıldı ve
  dedupe conflict'te exact hedef/payload doğrulanıyor.
- Worker lease/CAS, retry, dead-letter, retention ve no-tenant-wide-fallback kuralları eklendi.
- Stale preflight verisi yerine authoritative RPC sonucu kullanılıyor.

Ana dosyalar:

- `src/app/actions/booking-public.ts`
- `src/app/actions/owner-portal-offers.ts`
- `src/app/actions/appointments-confirm.ts`
- `src/lib/public-mutation-outbox.ts`
- `src/app/api/cron/public-mutation-outbox/route.ts`
- `20260810000970_public_atomic_mutations.sql`
- `20260810000990_public_mutation_outbox.sql`

### 3.8 Harici servis çağrıları

- Server-side test dışı outbound fetch tek `src/lib/external-fetch.ts` sınırında toplandı.
- Exact HTTPS origin/host allowlist, `redirect:'error'`, timeout, response boyut sınırı,
  non-2xx body discard ve body/PII içermeyen hata metadata'sı uygulandı.
- OpenAI, calendar, TCMB, iyzico, e-fatura, Endeksa, Tapusor, portallar, Netgsm ve WhatsApp
  bu sınırdan geçiyor.
- iyzico yalnız resmi sandbox ve production originlerini kabul ediyor.
- QR üretimi trusted helper'a taşındı; generic browser URL hook'unun aktif çağıranı yok.

### 3.9 UI, metadata ve tarayıcı QA

- Ana sayfa, giriş, auth yönlendirmeleri, admin ticket rotası ve yasal sayfalar production
  server üzerinde tarayıcıyla kontrol edildi.
- Kırık görsel, yatay taşma veya console warning/error görülmedi.
- `/app` ve `/admin/tickets` oturumsuzken doğru `next` parametresiyle `/giris`e yönlendi.
- Production giriş ekranında demo/tek tuş butonu görünmedi.
- Root metadata template'iyle iki kez yazılan `| EmlakSoft` başlığı yedi yasal sayfada düzeltildi.
- `src/lib/metadata-title-contract.test.ts` ile regresyon testi eklendi.

### 3.10 Destek talebi (ticket) ürünü

- Admin ticket kuyruğu premium dashboard, durum/öncelik/kategori/SLA filtreleri, sıralama,
  çözüm performansı ve bulk toolbar ile zenginleştirildi.
- Atama, öncelik, kategori ve durum değişiklikleri optimistic concurrency/version kontrolü,
  rate limit ve audit ile güvenli hale getirildi.
- En fazla 50 kayıt için toplu durum/öncelik/kategori/personel işlemleri eklendi; terminal
  duruma toplu geçiş çözüm metni olmadan engelleniyor.
- Internal note, cevap makroları, admin tarafından yeni ticket oluşturma, error/loading
  durumları ve tenant ticket kontrolleri tamamlandı.
- Ticket ekleri signed/finalize akışı, erişim kontrolü, yaşam döngüsü cleanup cronu ve testlerle
  eklendi.
- Tenant tarafına ek listesi, CSAT formu, güvenli cevap thread'i ve profesyonel detay sayfası
  eklendi.
- SLA hesaplama/rozet, ihlal cron'u ve ticket attachment cleanup cron'u eklendi.
- Başlıca migration'lar:
  `20260731000142_support_ticket_operations.sql`,
  `20260731000145_support_ticket_attachments.sql`,
  `20260802000146_security_and_support_lifecycle_hardening.sql`.
- Başlıca dosyalar: `src/app/admin/tickets/`, `src/app/app/destek/`,
  `src/app/actions/admin-ticket-ops.ts`, `src/app/actions/ticket-attachments.ts`,
  `src/lib/ticket-attachments.ts`, `src/lib/support/ticket-contract.ts`.

## 4. Son kalite kanıtları

| Kapı | Son başarılı sonuç |
|---|---:|
| Vitest | 109 dosya / 961 test |
| TypeScript | PASS |
| ESLint | PASS (tam tarama + son değişen dosya taraması) |
| Production build | PASS — Next 16.2.11, 135 statik sayfa |
| Public Playwright E2E | 7/7 PASS |
| Migration offline contract | 169 dosya PASS |
| Cron contract | 26 rota PASS |
| Action-gate audit | 423 dışa açık action, bulgu yok |
| Link contract | 251 link / 236 parametre / 141 rota, uyumsuzluk yok |
| Dependency audit | 0 production açığı |
| `npm audit` | 0 prod + dev açığı, 648 dependency |
| `git diff --check` | PASS; yalnız Windows CRLF uyarıları |
| Güncel kaynak secret scan | PASS, bulgu yok |

Tarayıcı QA sonrası production server kapatıldı. İlk otomatik E2E server kapanışı zaman aşımına
uğradı ancak yedi test de geçmişti; hazır production server'a karşı tekrar çalıştırılan E2E
normal exit code 0 ile 7/7 geçti.

Bu Windows oturumunda `tsx` bazı uzun kapılarda `uv_os_get_passwd ENOMEM` verdi. Aynı TypeScript
scriptleri Node 24 `--experimental-strip-types` ile çalıştırıldığında geçti. Bu kod hatası değil,
host runtime sorunudur; yeni bilgisayarda normal `npm` scriptlerini önce dene.

## 5. Canlı veritabanının salt-okunur denetim sonucu

10 Ağustos 2026'da canlı DB'ye yalnız SELECT kullanan validator ile bağlanıldı:

- Diskte **169** migration var.
- `schema_migrations` ledger'ında **144** kayıt var.
- **26 checksum drift** var.
- **25 migration bekliyor**.
- Beklenen eski şema bileşenlerinde eksik yok.
- `tenant_id` taşıyan **95 tablonun tamamında RLS açık ve en az bir politika var**.
- Kod ve DB permission matrisi **391/391 birebir**.
- Hiçbir kalıcı DB yazması yapılmadı.

`scripts/apply-migrations.ts --dry-run` kalıcı yazma yapmadan aynı ilk checksum drift'te
fail-closed durdu. Bu komut kısa süreli session advisory lock alır; tam anlamıyla yalnız SELECT
değildir. `scripts/rls-audit.ts` transaction sonunda rollback etse de gerçek INSERT dener;
sequence/trigger/harici side-effect riski nedeniyle production'da çalıştırılmadı. Yalnız izole
clone/staging DB'de kullanılmalı.

### 5.1 Checksum drift olan 26 geçmiş migration

```text
20260724000036_hotpath_indexes.sql
20260724000037_rate_limits.sql
20260724000038_campaign_email_channel.sql
20260724000039_property_dues.sql
20260724000040_customer_counts_by_advisor.sql
20260724000041_customer_lead_signals.sql
20260725000042_definitions.sql
20260725000043_definitions_more.sql
20260725000044_definitions_demand_ticket.sql
20260725000045_customer360_indexes.sql
20260725000046_properties_latlng.sql
20260725000047_increment_visitor_count.sql
20260725000048_advisor_kpis.sql
20260725000049_property_price_history.sql
20260725000050_tcmb_rates.sql
20260725000051_comparables_engine.sql
20260725000052_fk_indexes.sql
20260725000053_region_analytics.sql
20260725000054_rls_tenant_helper_drift.sql
20260725000055_duplicate_customers.sql
20260725000056_fold_tr_dotted_i.sql
20260726000057_error_logs.sql
20260726000058_error_logs_grants.sql
20260726000058_kvkk_lifecycle.sql
20260726000059_kvkk_constraint_fixes.sql
20260731000138_atomic_billing_fulfillment.sql
```

### 5.2 Canlı DB'de bekleyen 25 migration

```text
20260802000146_security_and_support_lifecycle_hardening.sql
20260802000147_webhook_compliance_hardening.sql
20260802000300_identity_session_authorization_hardening.sql
20260802000320_plan_entitlements.sql
20260802000340_reporting_aggregates.sql
20260802000360_observability_privacy_hardening.sql
20260802000380_public_schema_security_boundary.sql
20260802000400_atomic_demo_conversion.sql
20260802000420_customer_document_security_boundary.sql
20260802000440_tenant_expense_aggregates.sql
20260802000460_permission_defaults_read_policy.sql
20260802000480_invoices_conversation_id_unique_index.sql
20260802000520_service_role_only_rls_policies.sql
20260802000540_support_ticket_optimistic_concurrency.sql
20260803000010_comparables_correction_factors.sql
20260803000020_capability_tenant_boundary.sql
20260810000100_billing_checkout_reconciliation.sql
20260810000900_storage_object_lifecycle.sql
20260810000920_campaign_delivery_compliance.sql
20260810000940_direct_file_upload_sessions.sql
20260810000950_billing_reconciliation_leases.sql
20260810000960_whatsapp_cloud_provisioning.sql
20260810000970_public_atomic_mutations.sql
20260810000980_whatsapp_binding_verification.sql
20260810000990_public_mutation_outbox.sql
```

### 5.3 DB için kesin stop kuralı

Şunlardan hiçbiri checksum drift çözülmeden yapılmayacak:

- `npm run db:migrate`
- `--baseline`
- `--only ...` ile uygulama
- ledger checksum güncelleme
- geçmiş migration dosyalarını “DB'ye uysun” diye topluca geri çevirme

Önce restore edilebilir backup/PITR doğrulanmalı; 26 drift'in her biri tarihsel kaynak/DB
gerçeğiyle uzlaştırılmalı; düzeltme gerekiyorsa yeni forward migration kullanılmalı.

## 6. Kritik secret olayı — yayın engeli

Repo public Git geçmişinde geçmişte track edilmiş `.env.local` bulunuyor. Gitleaks history
taraması commit `9a6e055c49f2999e8b75db91fb71f8668bd9a1db` çevresinde beş redacted bulgu verdi:

- Legacy Supabase JWT türü anahtarlar
- Database pooler URL/parolası
- Database direct URL/parolası

Değerler ekrana veya bu belgeye yazılmadan yapılan karşılaştırmada mevcut yerel ayarlardaki
legacy anon, service-role ve DB URL değerlerinin tarihsel değerlerle eşleştiği doğrulandı.
Service-role anahtarı henüz süresi dolmamış durumdaydı. Tarihsel Vercel OIDC token ise sona
ermişti. Bu nedenle **sadece geçmişi temizlemek yeterli değildir; önce anahtar rotasyonu gerekir**.

Tarama Gitleaks `8.30.1` ile yapıldı. Çalışma ağacı `gitleaks dir`, geçmiş ise `gitleaks git`
ile `--redact=100` kullanılarak kontrol edildi. `.gitleaksignore` yalnız sentetik test fixture
fingerprint'i içerebilir; aktif veya tarihsel gerçek credential bulgularını bastırmak için
genişletilmeyecek.

### 6.1 Zorunlu güvenli sıra

1. Mümkünse repo geçici olarak private yapılır; bu yalnız containment'tır, rotasyonun yerine geçmez.
2. Supabase'te yeni `sb_publishable_` ve `sb_secret_` anahtarlar üretilir.
3. Yerel ve Vercel ortamları yeni değerlerle güncellenir.
4. Legacy anon/service-role/signing key devre dışı bırakılır veya resmi migrasyonla döndürülür.
5. Database parolası döndürülür; pooler/direct URL'ler yenilenir.
6. Eski anahtarların ve eski DB parolasının gerçekten reddedildiği test edilir.
7. Ancak bundan sonra Git geçmişi koordineli biçimde yeniden yazılır.
8. Tüm branch/tag/ref'ler force-push edilir; ekipteki eski klonlar silinip taze clone alınır.
9. GitHub cache/fork/PR görünürlüğü ayrıca kontrol edilir; gerekirse GitHub Support süreci izlenir.

Resmi kaynaklar:

- [Supabase anahtar döndürme](https://supabase.com/docs/guides/troubleshooting/rotating-anon-service-and-jwt-secrets-1Jq6yd)
- [Supabase signing keys](https://supabase.com/docs/guides/auth/signing-keys)
- [GitHub hassas veriyi geçmişten kaldırma](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository)

History rewrite ve force-push yıkıcı/koordinasyon gerektiren işlemlerdir; açık kullanıcı onayı
ve yeni anahtarların çalıştığı kanıtı olmadan yapılmayacak.

Açık onaydan sonra resmi GitHub rehberi izlenerek **fresh mirror** üzerinde hedeflenen komut
`git filter-repo --sensitive-data-removal --invert-paths --path .env.local` olacaktır. Komut
doğrudan mevcut dirty çalışma ağacında çalıştırılmayacak; tüm branch/tag/ref kapsamı ve ekipteki
eski clone'ların iptali önceden planlanacak.

## 7. Yeni bilgisayara güvenli geçiş

### 7.1 Ne taşınmalı

Henüz commitlenmemiş yüzlerce kaynak dosyası olduğu için yalnız remote clone yeterli değildir.
İki güvenli seçenek vardır:

1. **Tercih edilen:** Secret rotasyonu + history temizliği + inceleme sonrası kontrollü commit/push,
   ardından yeni bilgisayarda temiz clone.
2. Bunun hemen yapılamadığı durumda: mevcut çalışma klasörünü güvenilen, şifreli yerel medya ile
   taşı. `.git` ve tüm tracked/untracked kaynaklar korunmalı; aktarım public buluta yüklenmemeli.

### 7.2 Kesinlikle taşınmayacaklar

- Eski `.env.local` ve herhangi bir gerçek anahtar/parola/token
- `node_modules/`
- `.next/`
- `test-results/`, `playwright-report/`
- `.tmp*` dosyaları
- Yerel loglar ve indirilen tarama binary'leri

Yeni bilgisayarda `.env.example` temel alınır ve **yalnız döndürülmüş yeni sırlar** güvenli secret
manager/panellerden sağlanır. Sırları sohbet, doküman, commit veya patch içine yazma.

### 7.3 Yeni bilgisayardaki ilk kontroller

Gereksinim: Node `>=22`, npm `>=11.6.2`. Son doğrulanan makine Node `v24.11.1`,
Next `16.2.11`, React `19.2.4` kullanıyordu.

```powershell
git branch --show-current
git rev-parse HEAD
git status --short
node --version
npm --version
npm ci
npx playwright install chromium
```

Beklenen dal `codex/release-hardening`, temel commit `597be7b...` ve çok sayıda korunmuş working
tree değişikliğidir. Sayılar birebir uyuşmazsa **resetleme**; önce eksik/fazla dosyaları karşılaştır.

## 8. Yeni bilgisayarda kalite kapıları

Önce yalnız local/offline kapılar:

```powershell
npm run type-check
npm run lint
npm test
npm run check:migrations
npm run check:cron
npm run audit:actions
npm run check:links
npm run audit:deps
npm audit
npm run build
npm run test:e2e:public
git diff --check
```

Rotasyon sonrası yalnız SELECT kullanan canlı ledger kontrolü:

```powershell
npm run check:migrations -- --database
```

`npm run db:migrate -- --dry-run` kalıcı yazma yapmaz ancak kısa süreli advisory lock alır.
Migration drift sürüyorsa yalnız raporlanmalı; gerçek migrate yapılmamalı.

Production'da `npm run db:rls-audit` çalıştırma. Bu script rollback etse de INSERT dener; yalnız
restore edilebilir izole DB clone/staging üzerinde kullan.

## 9. Dış entegrasyon gereksinimleri

- Production demo bayrakları false/unset kalmalı.
- `ALLOW_PLATFORM_MESSAGING_FALLBACK` varsayılan false kalmalı.
- iyzico live kullanımında gerçek doğrulanmış tenant fatura kimliği/adresi ve resmi live anahtarlar gerekir.
- WhatsApp için tenant'a ait WABA ID, Phone Number ID, allowlisted Graph sürümü ve gerekli
  WhatsApp Business izinlerine sahip kalıcı token gerekir. Uygulama Meta Graph sahiplik
  doğrulaması başarısızsa entegrasyonu aktif etmez.
- Vercel cronları için yeni `CRON_SECRET`, health için ayrı `HEALTHCHECK_SECRET` kullanılmalı.
- `.env.example` isimlerin tek referansıdır; eski `.env.local` kopyalanmayacak.

## 10. Kaldığın yerden devam sırası

1. Bu belge, `AGENTS.md`, `PROJECT_CONTEXT.md`, `CLAUDE.md` ve `MIGRATION_GUIDE.md` tamamen okunur.
2. Eski bilgisayar silinmeden çalışma ağacının güvenli aktarımı doğrulanır.
3. Supabase API anahtarları ve DB parolası döndürülür; Vercel/local env güncellenir.
4. Eski credential'ların reddedildiği kanıtlanır.
5. Açık onayla Git history rewrite/force-push planı uygulanır.
6. 26 migration checksum drift'i restore edilebilir backup/PITR altında tek tek uzlaştırılır.
7. 25 forward migration önce staging/clone DB'de uygulanır ve smoke/E2E yapılır.
8. Tüm kalite kapıları yeniden çalıştırılır.
9. Büyük dirty tree mantıksal commitlere ayrılır; kullanıcı değişiklikleri yanlışlıkla dışlanmaz.
10. Code review sonrası branch push/PR yapılır.
11. Kontrollü production migration, Vercel deploy ve post-deploy health/smoke çalıştırılır.
12. Bu belge gerçek sonuçlarla güncellenir; “tamamlandı” ancak eski credential reddi, DB ledger
    bütünlüğü ve canlı smoke kanıtlandıktan sonra yazılır.

## 11. Kesinlikle yapılmayacaklar

- `git reset --hard`, geniş `git checkout --`, toplu clean veya eski değişiklikleri silme
- Eski `.env.local` dosyasını başka bilgisayara/mesaja/repo'ya kopyalama
- Secret değerlerini loglama veya devir belgesine yazma
- Drift varken `db:migrate`, `--baseline` veya ledger checksum düzenleme
- Anahtarları döndürmeden yalnız history rewrite ile “çözüldü” kabul etme
- Belirsiz WhatsApp provider sonucunu otomatik tekrar gönderme
- Doğrulanmamış WhatsApp Phone Number ID'yi tenant'a bağlama
- Production'da demo login veya ödeme demo bayraklarını açma
- Production üzerinde rollback'li olsa bile write-probe RLS audit çalıştırma

---

Bu dosya yeni bilgisayardaki ilk oturumda güncellenmeli; dal/commit, çalışma ağacı sayıları,
credential rotasyon kanıtı, migration uzlaştırma sonucu ve son deploy SHA burada tutulmalıdır.

## 12. 11 Ağustos 2026 — il bazlı coğrafya taraması

Kullanıcının son isteği doğrultusunda son değişiklikler yeniden okundu; coğrafya veri yüzeyi, kaynak sağlayıcı, cron'lar ve yönetim ekranı uçtan uca tarandı.

### 12.1 Kaynak ve ilk sonuç

- Repoda Bright/Bright Data entegrasyonu, anahtarı, çalışanı veya kuyruğu yoktur. Durdurulabilecek gerçek bir Bright işi bulunmadı; varmış gibi durum üretilmedi.
- Ödeme, mesajlaşma, dosya yaşam döngüsü ve diğer ürün cron'ları coğrafya işi olmadığı için durdurulmadı.
- Kahramanmaraş (46) canlı DB ile TurkiyeAPI v2 arasında salt okunur karşılaştırıldı: `11/11` ilçe, `721/721` mahalle, eksik `0`, fazla `0`, adı/ebeveyni değişmiş `0`. Yazma gerekmedi.
- Güncel global kaynakta aynı ilçe ve normalize ada sahip farklı kaynak kimlikleri ayrıca denetlendi: 244 ad grubu / 576 satır / 40 il. Mevcut DB `(district_id, name)` sözleşmesini bozmak yerine en yüksek source ID canonical, diğerleri görünür conflict ve `partial` sonucudur.

### 12.2 Eklenen ürün yüzeyi

- Yeni forward migration: `20260811000010_geo_province_sync_jobs.sql`.
- Service-only kuyruk, il başına tek aktif iş, sistem genelinde tek çalışan, advisory lock + `FOR UPDATE SKIP LOCKED`, lease CAS, stale recovery, retry/backoff, dead-letter ve son durum view'ı eklendi.
- Seçilen il kuyruğa alınırken diğer bekleyen coğrafya işleri `paused` olur; çalışan iş zorla kesilmez. Bekletilen il kendi satırındaki düğmeyle tekrar öne alınabilir.
- Kaynak katmanı fixed TurkiyeAPI HTTPS origin, redirect reddi, 20 saniye timeout, 1 MiB/yanıt cap, şema/sürüm/sayfalama/ebeveyn/sayı/kimlik doğrulaması kullanır.
- Apply tek transaction'dır. Kaynakta bulunmayan yerel kayıt silinmez/pasifleştirilmez; pasif kayıt açılmaz. Pasif il enqueue ve apply aşamalarında reddedilir.
- `/admin/geo` her il için **Tara ve tamamla** düğmesi, kuyruk/çalışıyor/bekletildi/tamamlandı/inceleme/hata rozetleri, sonuç sayıları ve aktif işte otomatik yenileme sunar.
- Kahramanmaraş düğmesi 1000 öncelik, diğer iller 100 öncelik alır.
- Eski geo CRUD action'larının tamamı genel platform personeli yerine `requirePlatformModule("geo")` ile sınırlandı; il güncellemesi ortak geo cache etiketini de yeniler.
- `/admin/sistem` eski toplu CLI önerisi yerine il bazlı güvenli yönetim akışını anlatır.
- Operasyon/runbook: `docs/runbooks/GEO_PROVINCE_SYNC.md`.

### 12.3 Son yerel durum ve doğrulama

- Dal: `codex/release-hardening`
- HEAD ve `origin/main`: `597be7b574d9ac6f117f6d3326c01239273357aa`
- Bu kayıt anında working tree: 247 modified + 172 untracked = 419 giriş. **Reset/clean yapılmayacak.**
- Geo odaklı Vitest: 4 dosya / 39 test geçti.
- Tam Vitest: 112 dosya / 980 test geçti.
- Tam ESLint geçti.
- TypeScript tam type-check geçti.
- Action gate: 424 dışa açık server action, bulgu yok.
- Migration validator: 170 migration geçti.
- Cron contract: 27 rota geçti.
- Geo değişiklikleri için `git diff --check` geçti; yalnız Windows LF/CRLF bilgilendirme uyarıları var.

Yeni migration canlı DB'ye uygulanmadı; cron/deploy yapılmadı; Git commit/push yapılmadı. Önceki güvenlik olayındaki credential rotasyonu ve canlı migration ledger/checksum uzlaştırması tamamlanmadan üretim yazması yapılmayacak. Yeni migration ile canlıda bekleyen forward migration sayısı önceki 25'ten 26'ya çıkmıştır.
