# CHANGELOG.md — EmlakSoft

> [Keep a Changelog](https://keepachangelog.com/) biçimini gevşek takip eder. Yeni bir
> özellik/düzeltme yaptığında **kendi commit'inle birlikte** buraya bir satır ekle —
> geriye dönük tam bir tarihçe çıkarmaya çalışma, yalnız bundan sonrasını tut.
> Otomatik/toplu üretilmiş uzun listeler yerine kısa, okunabilir maddeler tercih edilir.

## [Unreleased]

### Güvenlik / güvenilirlik sertleştirme dalgası
- Kimlik/oturum: 2FA doğrulanmış oturum takibi, impersonation session snapshot'ı,
  SQL tarafında `current_active_tenant_id()`/`has_effective_permission()` ile RLS'e
  bağlanan izin modeli.
- Public/webhook: `public-request-security.ts` (gövde-boyutu sınırı, CORS allowlist,
  opak rate-limit anahtarları), `rate-limit.ts`'te `failurePolicy: "allow"|"deny"`.
- Faturalama: atomik `fulfill_billing_payment` (iyzico webhook/callback idempotency),
  plan entitlement/limit sistemi.
- Destek-talebi (ticket) sistemi genişletildi: SLA ilk-yanıt/çözüm hedef tarihleri +
  ihlal takibi, olay/audit-trail (`support_ticket_events`), güvenli dosya eki
  (magic-byte + MIME + SHA-256 doğrulama), müşteri memnuniyeti anketi (CSAT), ticket
  numarası/versiyon/yeniden-açma sayacı.
- Raporlama: `tenant_reporting_aggregates` / `tenant_commission_aggregates` /
  `platform_reporting_aggregates` — sayfalama/limitten bağımsız, tam kapsamlı SQL
  aggregate KPI'lar.

### Admin destek kuyruğu (`/admin/tickets`) yeniden tasarımı
- 3D/gereksiz animasyon kaldırılıp kompakt, yoğun, hızlı bir kuyruk arayüzüne
  geçildi; Radix `Select` tabanlı yeni-nesil row aksiyonları.
- Detay sayfası profesyonel bir düzene kavuştu (İşlem paneli, Özellikler, İşlem
  geçmişi, CSAT).

### Düzeltmeler (2026-08-02 denetim dalgası)
- Demo seed verisi ticket bütünlük kuralını ihlal ediyordu → düzeltildi.
- Ticket kuyruğunda sayfa değişince eski seçimin kalıp yanıltıcı toplu-işlem
  çubuğu göstermesi → düzeltildi.
- CSAT skoru hiçbir admin ekranında görünmüyordu → detay sayfasına eklendi.
- Komisyon/raporlama "bu ay" hesapları UTC yerine artık `Europe/Istanbul`'a göre.
- Meta webhook: gövde-boyutu sınırı + timing-safe GET token karşılaştırması eklendi.
- Kampanya formunda gönderilemeyen "E-posta" kanalı artık devre dışı + açıklayıcı not.

## Nasıl katkı eklenir

Yeni bir `[Unreleased]` maddesi eklerken: ne değişti (kullanıcının/geliştiricinin
göreceği şekilde), neden (varsa 1 cümle). Dosya/satır referansı gerekmez — o zaten
git geçmişinde var.
