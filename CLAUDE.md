@AGENTS.md

# EmlakSoft

Türk emlak ofisleri için multi-tenant SaaS (Next.js 16 App Router + Supabase + Vercel).
Müşteri/talep/portföy/randevu/anlaşma/komisyon omurgası + kayıp-kaçak kalkanı, değerleme
(emsal motoru), otomasyonlar, 13 cron, AI asistan, vitrin ve token'lı public portallar.
Tamamı Türkçe; deploy bilinçli olarak en sona bırakıldı (`docs/DEPLOY_CHECKLIST.md`).

## Komutlar

```bash
npm run dev            # geliştirme
npm run build          # prod build (deploy öncesi yeşil olmalı)
npm run type-check     # tsc --noEmit
npm run lint           # eslint
npm run test           # vitest (birim)
npm run test:e2e       # playwright (public smoke)
npm run db:rls-audit   # RLS denetimi
npx tsx scripts/apply-one.ts supabase/migrations/<dosya>.sql  # migration TEK TEK, sırayla
```

Migration için `apply-migrations.ts` KULLANMA (sabit/eksik liste) — her zaman `apply-one.ts`.
Migration POLİTİKASI: yeni migration dosyası yazan, onu `apply-one.ts` ile HEMEN dev DB'ye
uygular (kullanıcı kararı: "full otomatik"). Enum ADD VALUE + kullanımı aynı dosyada olamaz
(ayrı dosya, örn. 087/087b deseni).
Demo veri: `npm run seed:demo` (demo-ofis tenant'ını tüm modüllerde doldurur, idempotent);
hızlı demo girişleri `src/lib/demo-personas.ts` + `ENABLE_DEMO_LOGIN=1` (yalnız dev).
E2E kullanıcısı: `npx tsx scripts/e2e-user.ts` (e2e-test tenant'ı, owner).

## Mimari kilit noktaları

- **Multi-tenant RLS:** her tablo `tenant_id` + RLS; SQL tarafı `public.current_tenant_id()`
  (JWT claim). Admin client (`service_role`) yalnız server'da; cache/realtime'da tenant izolasyonu şart.
- **Yetki kapıları:** her server action `requirePermission(mod, action)`; her `/app` sayfası
  `requireModulePage(mod)`. Varsayılan matris `src/lib/permissions.ts`, DB kopyası
  `permission_defaults`, kullanıcı istisnaları `user_permission_overrides` (etkin izin:
  `permissions-effective.ts`).
- **Yeni modül = 4 kayıt yeri:** (1) `src/lib/permissions.ts` (AppModule + MATRIX),
  (2) `NAV_MODULES` (`src/app/app/layout.tsx`), (3) sidebar (`src/components/app/app-sidebar.tsx`),
  (4) roller ekranı MODULES listesi (`src/app/app/ayarlar/roller/`) + `permission_defaults`
  seed migration'ı. Birini atlarsan modül ya görünmez ya kapısızdır.
- **Sıfır çıkmaz metrik:** görünen her sayı/kart/satır tıklanabilir olmalı ve filtrelenmiş
  hedefe götürmeli (StatCard `href`). Sahte skor/boş vaat yasak.
- **Filtre kontratı:** liste sayfaları searchParams'ı iki yönlü işler — URL'deki filtre
  sunucu sorgusuna yansır, UI kontrolleri URL'i günceller (sunucu filtre + gerçek sayfalama).
- **Zaman:** bileşenlerde `Date.now()` / `new Date()` doğrudan YASAK — `src/lib/clock.ts`
  yardımcıları (`now()`, `daysAgoIso()`, `isPast()` ...) kullanılır (React Compiler saflık kuralı).
- **UI:** tamamen Türkçe ("lead" değil "talep/başvuru"); **dark mode YOK** — eklenmeyecek;
  ultra premium standart (animasyon, anlamlı boş durum).
- **Cron:** 13 route `src/app/api/cron/*` + `vercel.json`; hepsi `CRON_SECRET` Bearer doğrular
  ve `recordHeartbeat` yazar.

Ayrıntı: `docs/MIMARI.md` · plan: `docs/MASTER_PLAN.md` · kalanlar: `docs/OZELLIK_MASTER_LISTESI.md`.
Devir/oturum geçmişi (yeni makinede buradan başla): `docs/DEVIR_NOTU.md`. CANLI: https://emlaksoft.vercel.app
