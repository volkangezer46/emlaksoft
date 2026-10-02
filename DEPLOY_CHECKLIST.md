# Production Deploy Checklist

Bu dosya hızlı yayın kapısıdır. Ayrıntılı ortam matrisi için
[`docs/DEPLOY_CHECKLIST.md`](docs/DEPLOY_CHECKLIST.md), olay ve geri dönüş
prosedürleri için [`docs/runbooks/`](docs/runbooks/) kullanılır.

## 1. Değişiklik ve güvenlik kapıları

- [ ] Çalışma ağacındaki beklenmeyen dosyalar gözden geçirildi.
- [ ] `npm ci` lockfile ile temiz tamamlandı.
- [ ] `npm run check:links`
- [ ] `npm run check:migrations`
- [ ] `npm run check:cron`
- [ ] `npm run audit:actions`
- [ ] `npm run audit:deps`
- [ ] `npm run type-check`
- [ ] `npx eslint . --max-warnings=0`
- [ ] `npm test`
- [ ] `npm run test:e2e:public`
- [ ] `npm run build`
- [ ] CI tam Git geçmişinde gitleaks taramasını geçti.

## 2. Ortam ve sırlar

- [ ] Supabase URL, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` ve bağımsız döndürülebilir
      `SUPABASE_SECRET_KEY` Production scope'ta tanımlı; legacy `anon/service_role` kapalı.
- [ ] `NEXT_PUBLIC_APP_URL` gerçek HTTPS origin'i gösteriyor.
- [ ] `PLATFORM_ADMIN_EMAILS` en az iki kontrollü yönetici içeriyor.
- [ ] `CRON_SECRET` güçlü ve yalnız sunucu ortamında.
- [ ] `HEALTHCHECK_SECRET` en az 32 karakter; ayrıntılı readiness verisi yalnız izleme sisteminde.
- [ ] `OTP_HMAC_SECRET` bağımsız, en az 32 byte ve yalnız sunucu ortamında; cookie/media
      imza anahtarlarıyla paylaşılmıyor.
- [ ] `PROPERTY_MEDIA_SIGNING_SECRET` bağımsız, en az 32 karakter ve yalnız sunucu ortamında.
- [ ] `ENABLE_DEMO_LOGIN`, `ALLOW_PAYMENT_LINK_DEMO` ve
      `ALLOW_BILLING_DEMO` production'da kapalı/tanımsız.
- [ ] Live ödeme kullanılacaksa iyzico live URL ve anahtarları doğrulandı.
- [ ] Public isimli hiçbir environment variable sır içermiyor.
- [ ] Son migration kimliği üretildi ve deploy ortamına kopyalandı:

```bash
npm run check:migrations -- --release
```

`next build` ve `next start`, production aşamasında Supabase URL + public/admin
anahtarları, güçlü `OTP_HMAC_SECRET`, HTTPS uygulama origin'i, güçlü
`HEALTHCHECK_SECRET` ve geçerli release migration çifti eksikse başlamaz.
Ödeme/webhook/AI gibi opsiyonel sağlayıcılar bu evrensel boot kapısına dahil değildir.

## 3. Veritabanı

- [ ] Otomatik yedek/PITR durumu ve son başarılı yedek zamanı doğrulandı.
- [ ] `npm run db:migrate -- --dry-run` yalnız beklenen dosyaları gösteriyor.
- [ ] Bakım penceresinde `npm run db:migrate` tamamlandı.
- [ ] `npm run check:migrations -- --database` checksum ve readiness kapısını geçti.
- [ ] `npm run db:rls-audit` transaction rollback ile temiz tamamlandı.
- [ ] Yeni storage bucket/policy ve Realtime publication sözleşmeleri doğrulandı.

Migration'lar forward-only'dir. Uygulanmış SQL dosyası değiştirilmez ve normal
rollback sırasında tablo/kolon silinmez; düzeltme yeni migration ile yapılır.

## 4. Yayın ve duman testi

- [ ] Vercel deploy SHA'sı beklenen commit ile aynı.
- [ ] Public `/api/health` HTTP 200 ve `status=ready` döndürüyor; bearer
      `HEALTHCHECK_SECRET` ile yapılan yetkili kontrol doğru release SHA ve
      migration readiness değerlerini döndürüyor.
- [ ] Public smoke remote deploy üzerinde geçti.
- [ ] Tüm cron rotaları secret olmadan 401 döndürüyor:

```bash
APP_URL=https://app.example.com npm run cron:smoke -- --auth-only
```

- [ ] Giriş, şifre sıfırlama, tenant izolasyonu ve platform admin erişimi kontrol edildi.
- [ ] Ticket liste/detay, mesaj, ek indirme ve SLA görünümü kontrol edildi.
- [ ] Ödeme/webhook kullanılıyorsa imza doğrulama ve tek test işlemi tamamlandı.
- [ ] `/admin/sistem` tüm planlı işleri gösteriyor; heartbeat eşikleri iş sıklığına uygun.

`npm run cron:smoke` varsayılan olarak bütün işleri gerçekten tetikler ve veri
değiştirebilir. Yalnızca açıkça onaylanmış post-deploy doğrulamasında çalıştırın.

## 5. Gözlem ve karar

- [ ] İlk 30 dakika error log, DB bağlantısı, auth ve cron heartbeat izlendi.
- [ ] Release sahibi, izleme sahibi ve rollback karar yetkilisi belli.
- [ ] Başarısızlık halinde kod rollback'i için
      [`docs/runbooks/ROLLBACK.md`](docs/runbooks/ROLLBACK.md) açıldı.
- [ ] Veri bütünlüğü etkilenmişse incident ilan edilip
      [`docs/runbooks/RESTORE.md`](docs/runbooks/RESTORE.md) izlendi.
