# 🏢 EmlakSoft — Premium Plus

**Modern türk emlak CRM & operasyon platformu**  
*HGDekor işletim DNA'sı · iyzico tahsilat · realtime refresh · müşteri 360 · audit trails · leak shield · modül yetkileri*

---

## 🎯 Öne çıkan özellikler

**CRM & Satış**
- 📞 **Arama konsolu** · CTI-ready · talep/eşleşme sayacı · kaydet+bildir+ata
- 👥 **Müşteri 360** · talepler · anlaşmalar · aktiviteler · rızalar · dosyalar
- 🤝 **Anlaşma yönetimi** · kanban board · status transition bar · komisyon hesaplama
- 📋 **Portföy & Talepler** · ilan + talep eşleştirme · otomatik bildirimler

**Operasyon & Uyum**
- 🔐 **Modül yetkileri** · sayfa seviyesi erişim kontrolü (`requireModulePage`)
- 🛡️ **Leak Shield** · proaktif SLA uyarıları (7/14/30 gün) · severity skoru
- 📜 **Denetim** · diff'li audit trail · aktör resolve · CSV export
- ✅ **Uyum paneli** · IYS · EİDS · KVKK · veri silme

**Portal & Yayın**
- 🌐 **Portal entegrasyonu** · sahibinden · hepsiemlak · zingat
- 📊 **Portal performans** · görüntülenme · favorileme · listing takibi
- 🔄 **Senkronizasyon** · otomatik ilan güncelleme · çoklu portal desteği

**Ödemeler**
- 💳 **iyzico entegrasyonu** · abonelik + ödeme linki · Checkout Form
- 🔗 **Token'lı tahsilat** · müşteri ödemesi · callback + webhook
- 📈 **Abonelik yönetimi** · plan upgrade · trial · otomatik yenileme

**Teknik altyapı**
- ⚡ **useApi hook** · client-side cache · focus refresh · error handling
- 🔄 **Realtime refresh** · Supabase broadcast · soft route refresh
- 🎨 **HGDekor UI** · Phone OS-inspired · gradient depth · premium design
- 🧪 **Smoke test** · auth + DB health check · migration guard
- 🚨 **Error boundary** · global React error handler · dev stack trace

---

## 🛠️ Tech Stack

| Layer | Stack |
|-------|-------|
| **Frontend** | Next.js 16 (App Router) · React 19 · TypeScript 6 · Tailwind 4 |
| **Backend** | Supabase (PostgreSQL + Auth + Storage + Realtime) |
| **Payments** | iyzico Checkout Form · Webhook |
| **Deployment** | Vercel · Cron Jobs |
| **Testing** | TypeScript strict mode · Permission contract tests |

---

## 📦 Kurulum

### 1) Gereksinimler
- Node.js 20+
- npm/pnpm/bun
- Supabase projesi (eu-central-1 önerilir)
- iyzico merchant hesabı (opsiyonel)

### 2) Projeyi klonla ve bağımlılıkları yükle
```bash
git clone https://github.com/your-org/emlaksoft.git
cd emlaksoft
npm install
```

### 3) `.env.local` oluştur
```bash
cp .env.example .env.local
```

`.env.local` içinde doldur:
```env
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
NEXT_PUBLIC_APP_URL=http://localhost:3000
CRON_SECRET=your-long-random-token

# iyzico (opsiyonel)
IYZICO_API_KEY=...
IYZICO_SECRET_KEY=...
IYZICO_BASE_URL=https://sandbox-api.iyzipay.com
IYZICO_MERCHANT_ID=...
```

### 4) Veritabanı migration'ları uygula

**Supabase Dashboard SQL Editor'den çalıştır:**
```bash
supabase/apply_premium_plus.sql
```

Detaylı adımlar için `MIGRATION_GUIDE.md` dosyasına bakın.

### 5) Supabase Storage ayarları

**Dashboard → Storage → New Bucket:**
- Name: `customer-files`
- Public: ❌ Private
- Allowed MIME: `image/*,application/pdf,application/msword,...`
- Max file size: 10 MB

**RLS Policy (manuel ekle):**
```sql
create policy "Tenant users read own files"
  on storage.objects for select
  using (
    bucket_id = 'customer-files' 
    and (storage.foldername(name))[1] = (select auth.jwt()->>'tenant_id')
  );

create policy "Tenant users insert own files"
  on storage.objects for insert
  with check (
    bucket_id = 'customer-files'
    and (storage.foldername(name))[1] = (select auth.jwt()->>'tenant_id')
  );

create policy "Tenant users delete own files"
  on storage.objects for delete
  using (
    bucket_id = 'customer-files'
    and (storage.foldername(name))[1] = (select auth.jwt()->>'tenant_id')
  );
```

### 6) Smoke test çalıştır
```bash
npm run test:smoke
```

Beklenen çıktı:
```
✅ Anon key bağlantısı
✅ Service role bağlantısı
✅ Table: tenants
✅ Table: profiles
✅ Table: customers
✅ Table: customer_files
✅ Table: notifications
✅ Storage bucket: customer-files

📊 Sonuç: 8 passed, 0 failed
🎉 Tüm smoke testler geçti!
```

### 7) Dev server başlat
```bash
npm run dev
```

Tarayıcıda aç: [http://localhost:3000](http://localhost:3000)

---

## 🚀 Production deployment

### Vercel Deploy

1. Vercel hesabına bağlan:
```bash
npx vercel link
```

2. Environment variables ekle (Vercel Dashboard):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `NEXT_PUBLIC_APP_URL`
   - `CRON_SECRET` ← **güçlü random token oluştur**
   - iyzico keys (eğer varsa)

3. Deploy:
```bash
npx vercel --prod
```

### Cron Jobs

`vercel.json` içinde tanımlı cron'lar:
- `/api/cron/gunluk-ozet` · her sabah 09:00
- `/api/cron/randevu-hatirlatma` · her saat
- `/api/cron/portal-listeleme-onay` · her saat
- `/api/cron/abonelik-kontrol` · günde 1x
- `/api/cron/leak-sla` · her gün 10:00

Vercel Dashboard'dan `Authorization: Bearer <CRON_SECRET>` header'ı ile test et.

### Deploy Checklist

Detaylı adımlar için `DEPLOY_CHECKLIST.md` dosyasına bakın.

---

## 📊 Modül yetkileri matrisi

| Sayfa | Admin | Manager | Advisor |
|-------|-------|---------|---------|
| Dashboard | ✅ | ✅ | ✅ |
| Müşteriler | ✅ | ✅ | ✅ |
| Talepler | ✅ | ✅ | ✅ |
| Portföy | ✅ | ✅ | ✅ |
| Anlaşmalar | ✅ | ✅ | ❌ |
| Komisyon | ✅ | ✅ | ❌ |
| Portallar | ✅ | ✅ | ❌ |
| Arama | ✅ | ✅ | ✅ |
| Eşleştirme | ✅ | ✅ | ✅ |
| Randevular | ✅ | ✅ | ✅ |
| Uyum | ✅ | ✅ | ❌ |
| Denetim | ✅ | ❌ | ❌ |
| Değerleme | ✅ | ✅ | ❌ |
| Kayıp-Kaçak | ✅ | ✅ | ❌ |
| Raporlar | ✅ | ✅ | ✅ |
| Ekip | ✅ | ✅ | ❌ |
| Abonelik | ✅ | ❌ | ❌ |

---

## 🔧 Geliştirme komutları

```bash
# Dev server
npm run dev

# Type check
npm run type-check

# Smoke test
npm run test:smoke

# Geo sync (local)
npm run geo:sync
```

---

## 📚 Dokümantasyon

| Dosya | İçerik |
|-------|--------|
| `README.md` | Ana proje dokümantasyonu (bu dosya) |
| `docs/PREMIUM_PLUS.md` | Premium Plus özellik envanteri |
| `docs/MASTER_PLAN.md` | Ürün vizyonu & roadmap |
| `docs/SPRINT_FINAL.md` | Sprint retrospektifi |
| `MIGRATION_GUIDE.md` | Veritabanı migration rehberi |
| `DEPLOY_CHECKLIST.md` | Production deploy kontrol listesi |

---

## 🧪 Test stratejisi

1. **Type safety**: TypeScript strict mode (`npm run type-check`)
2. **Smoke test**: Auth + DB bağlantısı (`npm run test:smoke`)
3. **Permission contract**: `000011_permission_tests.sql` (sembolik)
4. **Manual QA**: Her sprint sonrası staging testleri

---

## 🤝 Katkı

1. Feature branch oluştur: `git checkout -b feature/amazing-feature`
2. Commit: `git commit -m 'feat: add amazing feature'`
3. Push: `git push origin feature/amazing-feature`
4. Pull Request aç

---

## 📄 Lisans

Tescilli yazılım © 2026 EmlakSoft

---

## 🎉 Sprint tamamlandı!

✅ **10+ yeni özellik**  
✅ **3 yeni migration**  
✅ **iyzico live tahsilat**  
✅ **Müşteri 360 + dosyalar**  
✅ **Leak Shield proaktif uyarı**  
✅ **useApi + ErrorBoundary**  
✅ **Smoke test + docs**

**Sıradaki adımlar:** `docs/PREMIUM_PLUS.md` → kalan özellikler

---

Sorular için: [your-email@emlaksoft.com](mailto:your-email@emlaksoft.com)
