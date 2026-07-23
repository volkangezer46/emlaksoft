# Production Deployment Checklist

**Tarih:** 2026-07-22  
**Sprint:** Premium Plus  
**Target:** Beta Launch

---

## ✅ Pre-Deploy

### Database
- [ ] Supabase production project oluşturuldu
- [ ] `supabase/apply_premium_plus.sql` çalıştırıldı
- [ ] Storage bucket `customer-files` (private) oluşturuldu
- [ ] Storage RLS policy eklendi
- [ ] JWT claims test edildi
- [ ] Demo users **disabled** (prod'da olmamalı)
- [ ] Geo data (provinces/districts) seed edildi

### Code
- [ ] `npx tsc --noEmit` → clean
- [ ] `npm run build` → başarılı
- [ ] `.env.example` güncel
- [ ] Sensitive data temizlendi
- [ ] Console.log'lar temizlendi (kritik olanlar hariç)

### Dependencies
- [ ] `npm audit` çalıştırıldı
- [ ] Critical vulnerabilities yok
- [ ] Package versions güncel

---

## 🔐 Environment Variables (Vercel)

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# App
NEXT_PUBLIC_APP_URL=https://app.emlaksoft.com

# Cron
CRON_SECRET=<generate-strong-random-token>

# iyzico (PROD KEYS!)
IYZICO_API_KEY=<prod-api-key>
IYZICO_SECRET_KEY=<prod-secret-key>
IYZICO_BASE_URL=https://api.iyzipay.com
IYZICO_MERCHANT_ID=<prod-merchant-id>

# Optional (prod'da 0)
ALLOW_PAYMENT_LINK_DEMO=0

# PWA Push (opsiyonel — D2)
NEXT_PUBLIC_VAPID_PUBLIC_KEY=<npx web-push generate-vapid-keys>
VAPID_PRIVATE_KEY=<...>
VAPID_SUBJECT=mailto:destek@emlaksoft.com.tr

# Değerleme veri ortakları (opsiyonel — C1, /admin/sistem'de durum görünür)
ENDEKSA_CLIENT_ID=<endeksa-kurumsal-client-id>
ENDEKSA_CLIENT_SECRET=<endeksa-kurumsal-secret>
TAPUSOR_API_KEY=<tapusor-kurumsal-api-key>
```

**Generate CRON_SECRET:**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 🚀 Vercel Setup

### 1. Project Creation
- Import from GitHub
- Framework: Next.js
- Root: `/`
- Build Command: `npm run build`
- Output: `.next`

### 2. Environment Variables
- Yukarıdaki tüm ENV'leri ekle
- Production + Preview separate values (opsiyonel)

### 3. Cron Jobs
- Settings → Cron Jobs
- `vercel.json` dosyasındaki cron'ları import et
- Her endpoint için Authorization header test et

### 4. Domain
- Custom domain ekle: `app.emlaksoft.com`
- SSL otomatik (Vercel)
- DNS: CNAME → `cname.vercel-dns.com`

---

## 🧪 Post-Deploy Testing

### Auth Flow
- [ ] Sign up → email confirmation
- [ ] Login → redirect /app
- [ ] Logout → redirect /giris
- [ ] Password reset
- [ ] JWT claims doğru (`tenant_id`)

### CRM Operations
- [ ] Müşteri ekle/düzenle/sil
- [ ] Talep ekle/güncelle
- [ ] Portföy ekle (price health)
- [ ] Eşleştirme skor hesaplama
- [ ] Dosya upload/download

### Payments
- [ ] Ödeme linki oluştur
- [ ] iyzico checkout form açılıyor
- [ ] Test kart ile ödeme
- [ ] Callback success
- [ ] Webhook test (Postman)
- [ ] Komisyon tahsilat

### Realtime
- [ ] Bildirim geldi mi (browser tab)
- [ ] Realtime refresh (2 tab aç, birinde değişiklik)
- [ ] Live office strip update

### Cron (A4 — otomatik)
Tüm `/api/cron/*` route'larını tek komutla doğrula (200 + `ok:true` + yetkisiz istek 401 kontrolü):
```bash
APP_URL=https://app.emlaksoft.com.tr CRON_SECRET=$CRON_SECRET npm run cron:smoke
```
Manuel tek route testi:
```bash
curl -X GET https://app.emlaksoft.com/api/cron/gunluk-ozet \
  -H "Authorization: Bearer $CRON_SECRET"
```

### Performance
- [ ] Lighthouse score > 90
- [ ] First Contentful Paint < 1.5s
- [ ] Time to Interactive < 3s
- [ ] No layout shift (CLS < 0.1)

---

## 📊 Monitoring

### Vercel Analytics
- Enable Web Analytics
- Enable Speed Insights

### Supabase
- Database health
- Storage usage
- Auth users growth
- API rate limits

### Error Tracking (opsiyonel)
- Sentry integration
- Console errors → alert

---

## 🔄 Rollback Plan

### Vercel
1. Deployments → Previous deployment
2. "Promote to Production"

### Database
- Migration rollback script hazır değil
- Manual revert gerekirse:
  ```sql
  alter table profiles drop column notification_prefs;
  drop table customer_files;
  alter table portal_closures drop column sla_warning_sent_at;
  alter table portal_closures drop column leak_severity;
  ```

---

## 📈 Post-Launch

### Week 1
- [ ] User feedback topla
- [ ] Error logs izle
- [ ] Performance metrics
- [ ] Cron job success rates

### Immediate Fixes
- iyzico webhook test (prod merchant ID)
- CRON_SECRET rotation policy
- Storage bucket size monitoring
- Database backup strategy

### Next Sprint
- A2: iyzico webhook sertleştirme
- C1-C3: Değerleme · İYS · EİDS entegrasyonları
- D1: Franchise rollup (eğer gerekirse)

---

## ✅ Launch Approval

- [ ] **Tech Lead:** Code review complete
- [ ] **QA:** Test scenarios passed
- [ ] **Product:** Feature parity confirmed
- [ ] **DevOps:** Infrastructure ready
- [ ] **Security:** Penetration test (opsiyonel)

**Go/No-Go Decision:** _____________

**Launch Date:** _____________

---

## 🎉 Launch Announcement

### Internal
- Team notification
- Deployment success message
- Monitoring dashboard links

### External (eğer varsa)
- Customer email
- Social media
- Blog post

---

**Hazırlayan:** AI Assistant  
**Sprint:** Premium Plus  
**Versiyon:** 1.0.0-beta
