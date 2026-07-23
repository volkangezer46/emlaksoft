# EmlakSoft — Premium Plus Sprint Özeti

**Tarih:** 2026-07-22  
**Oturum:** Premium Plus devamı

---

## Tamamlanan Özellikler

### A) Beta Kapısı
- ✅ **A1** Dashboard + Phone OS sahte KPI → canlı aggregate
- ✅ **A3** Ödeme linki iyzico Checkout + callback/webhook
- ✅ **A5** Sayfa seviyesi modül yetkisi (`requireModulePage`)

### B) HGDekor DNA
- ✅ **B1** StatusTransition deal kartında
- ✅ **B3** Realtime refresh hook (`RealtimeRefresh` + layout)
- ✅ **B4** Sidebar hover prefetch
- ✅ **B5** Denetim actor/diff/CSV export
- ✅ **B6** Bildirim tercihleri sunucu (`profiles.notification_prefs` + cron)
- ✅ **B8** Müşteri 360 dosya deposu (upload/download/delete + Storage)
- 🔄 **B10** Permission test iskelet (SQL migration `000011`)

### C) Emlak Farklılaştırıcıları
- ✅ **C4** Leak Shield proaktif SLA (7/14/30 gün uyarı + severity)
- ✅ **C5** Eşleştirme kaydet + bildir

---

## Yeni Migrations

| Dosya | Açıklama |
|-------|----------|
| `20260722000009_notification_prefs.sql` | `profiles.notification_prefs` jsonb |
| `20260722000010_customer_files.sql` | Dosya deposu + RLS |
| `20260722000011_permission_tests.sql` | Sembolik contract test |
| `20260722000012_leak_sla.sql` | `portal_closures` SLA tracking |

---

## Yeni API Endpoints

- `POST /api/customer-files/upload` → dosya yükleme
- `GET /api/customer-files/[id]/download` → indirme
- `GET /api/cron/leak-sla` → proaktif kayıp-kaçak SLA

---

## Yeni Actions

- `src/app/actions/customer-files.ts` → upload/delete
- `src/app/actions/notification-prefs.ts` → server-side prefs save
- `src/lib/billing/payment-link-fulfill.ts` → ödeme linki fulfillment

---

## Deploy Checklist

### Gerekli ENV (prod)
```bash
CRON_SECRET=<güçlü-token>
IYZICO_MERCHANT_ID=<iyzico-portal-merchant-id>  # webhook imza sıkı
ALLOW_PAYMENT_LINK_DEMO=0  # iyzico yoksa 1
```

### Supabase Storage Bucket
```sql
-- Supabase Dashboard → Storage → Create bucket
-- Bucket name: customer-files
-- Public: false
-- RLS: enabled

create policy "Authenticated tenant access"
on storage.objects for all
using (
  bucket_id = 'customer-files'
  and (storage.foldername(name))[1] = (auth.jwt()->>'tenant_id')::text
);
```

### Cron Jobs (Vercel/infrastructure)
```
# Mevcut
0 7 * * * /api/cron/gunluk-ozet
*/30 * * * * /api/cron/randevu-hatirlat
0 */6 * * * /api/cron/portal-teyit
0 0 * * * /api/cron/abonelik-kontrol

# Yeni
0 */12 * * * /api/cron/leak-sla
```

### Migration Sırası
1. `20260722000009_notification_prefs.sql`
2. `20260722000010_customer_files.sql`
3. `20260722000011_permission_tests.sql`
4. `20260722000012_leak_sla.sql`

---

## TypeScript Status
✅ `npx tsc --noEmit` → clean

---

## Kalan (Post-Beta)
- A2: iyzico webhook test + sertleştirme
- A4: Cron smoke deploy sonrası
- C1–C3: Değerleme · İYS · EİDS entegrasyonları
- C6–C7: CTI · QR/anahtar (vizyon)
- D1–D4: Franchise · PWA push · geo · offboarding

---

**Sprint Sonucu:** Beta kapısı güçlendirildi; HGDekor DNA genişletildi; proaktif leak + dosya deposu eklendi.
