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
- 🌐 **İlan takibi** · ilan no/URL · periyodik teyit · kapanış nedeni
- 📊 **Portal performans kayıtları** · görüntülenme · favorileme · kaçak takibi
- 🔌 **Yetkili API adaptörleri** · yalnız portalın kurumsal sözleşmesi, doğrulanmış base URL'si ve anahtarıyla etkinleşir

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
- **Node.js 24** · minimum 22; doğrulanan yerel sürüm 24.11.1
  - Sürüm `.nvmrc` dosyasında sabit. macOS/Linux: `nvm use`
  - **Windows:** nvm-windows `.nvmrc` okumaz, sürümü açıkça vermek gerekir:
    ```powershell
    nvm install 24
    nvm use 24
    ```
    PowerShell 5.1'de `&&` çalışmaz — komutları ayrı satırda veya `;` ile verin.
- **npm 11.6.2** (`packageManager` ve CI ile sabit)
- Supabase projesi (eu-central-1 önerilir)
- iyzico merchant hesabı (opsiyonel)

### 2) Projeyi klonla ve bağımlılıkları yükle
```bash
git clone https://github.com/your-org/emlaksoft.git
cd emlaksoft
npm ci
```

### 3) `.env.local` oluştur
```bash
cp .env.example .env.local
```

`.env.local` içinde doldur:
```env
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=... # sb_publishable_...; legacy anon yalnız geçiş fallback'i
SUPABASE_SECRET_KEY=... # sb_secret_...; legacy service_role yalnız geçiş fallback'i
NEXT_PUBLIC_APP_URL=http://localhost:3000
CRON_SECRET=your-long-random-token
OTP_HMAC_SECRET=your-independent-32-byte-minimum-otp-pepper
TWO_FACTOR_COOKIE_SECRET=your-independent-32-character-2fa-cookie-secret
PROPERTY_MEDIA_SIGNING_SECRET=your-independent-32-character-media-secret

# iyzico (opsiyonel)
IYZICO_API_KEY=...
IYZICO_SECRET_KEY=...
IYZICO_BASE_URL=https://sandbox-api.iyzipay.com
IYZICO_MERCHANT_ID=...
```

### 4) Veritabanı migration'larını doğrula ve uygula

Migration dosyaları forward-only'dir ve `schema_migrations` tablosunda
checksum ile izlenir:

```bash
npm run check:migrations
npm run db:migrate -- --dry-run
npm run db:migrate
```

Mevcut, daha önce migrate edilmiş bir veritabanını ledger'a ilk kez bağlamak
için yalnızca kontrollü bakım penceresinde `--baseline` kullanın. Ayrıntılar ve
checksum drift prosedürü için `MIGRATION_GUIDE.md` dosyasına bakın.

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
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - `SUPABASE_SECRET_KEY` (tercih edilen, bağımsız döndürülebilir sunucu anahtarı)
   - `OTP_HMAC_SECRET` (giriş ve imza OTP'leri için bağımsız, en az 32 byte HMAC pepper)
   - `TWO_FACTOR_COOKIE_SECRET` (2FA oturum kanıtı için bağımsız, en az 32 karakter)
   - `PROPERTY_MEDIA_SIGNING_SECRET` (bağımsız, en az 32 karakter)
   - `NEXT_PUBLIC_APP_URL`
   - `CRON_SECRET` ← **güçlü random token oluştur**
   - `HEALTHCHECK_SECRET` (bağımsız, en az 32 karakter)
   - `PLATFORM_ADMIN_EMAILS`
   - `RELEASE_MIGRATION` + `RELEASE_MIGRATION_CHECKSUM` (`npm run check:migrations -- --release`)
   - iyzico keys (eğer varsa)

3. Deploy:
```bash
npx vercel --prod
```

### Cron Jobs

Üretim zamanlamalarının tek deploy kaynağı `vercel.json` dosyasıdır. Route,
zamanlama, yetki kapısı, heartbeat ve `/admin/sistem` izleme kapsamı şu kapıyla
birlikte doğrulanır:

```bash
npm run check:cron
APP_URL=https://app.example.com npm run cron:smoke -- --auth-only
```

`npm run cron:smoke` komutunun varsayılan modu `CRON_SECRET` ile tüm işleri
gerçekten çalıştırır ve veri değiştirebilir; yalnızca bilinçli post-deploy
kontrolünde kullanın. Güncel rota/sıklık listesi doğrudan `vercel.json` ve
`/admin/sistem` ekranındadır.

### Deploy Checklist

Detaylı adımlar için `DEPLOY_CHECKLIST.md`; olay, rollback ve restore
prosedürleri için `docs/runbooks/` dizinine bakın.

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
