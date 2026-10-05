@AGENTS.md

# EmlakSoft

Türk emlak ofisleri için multi-tenant SaaS (Next.js 16 App Router + Supabase + Vercel).
Müşteri/talep/portföy/randevu/anlaşma/komisyon omurgası + kayıp-kaçak kalkanı, değerleme
(emsal motoru), otomasyonlar, sözleşmeyle doğrulanan cron envanteri (bkz. `vercel.json`), AI asistan,
vitrin ve token'lı public portallar.
Tamamı Türkçe. Canlıda (Vercel `main` → production); deploy sırası ve zorunlu ortam değişkenleri `docs/DEPLOY.md`.

## Komutlar

```bash
npm run dev            # geliştirme
npm run build          # prod build (deploy öncesi yeşil olmalı)
npm run type-check     # tsc --noEmit
npm run lint           # eslint
npm run test           # vitest (birim)
npm run test:e2e:public # playwright (salt-okunur public smoke)
npm run db:rls-audit   # RLS denetimi
npm run check:migrations -- --database # salt-okunur ledger/checksum kontrolü
npm run db:migrate -- --dry-run         # salt-okunur migration önizleme
```

Migration POLİTİKASI: uygulanmış dosyalar forward-only ve değiştirilemezdir. Yeni dosya
önce statik + DB ledger/checksum denetiminden ve gerçekten salt-okunur dry-run'dan geçer.
Canlı uygulama yalnız restore edilebilir backup/PITR doğrulandıktan sonra kontrollü
`npm run db:migrate` ile yapılır; ledger drift varsa yazma yapılmaz. Enum ADD VALUE +
kullanımı aynı dosyada olamaz (ayrı dosya, örn. 087/087b deseni).
Demo veri: `npm run seed:demo` (demo-ofis tenant'ını tüm modüllerde doldurur, idempotent);
hızlı demo girişleri `src/lib/demo-personas.ts` + `ENABLE_DEMO_LOGIN=1` (yalnız dev).
Oturumlu E2E yalnız izole test DB'de, açık `E2E_MUTATION_ALLOWED=true` ve benzersiz
`E2E_USER_EMAIL`/`E2E_USER_PASSWORD` ile çalıştırılır.

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
- **UI:** tamamen Türkçe ("lead" değil "talep/başvuru"); **koyu tema yalnız /app ve /admin'de** (`html[data-theme="dark"]`, `src/app/theme-dark.css`, tercih: sistem/açık/koyu; public vitrin ve portallar her zaman açık kalır);
  ultra premium standart (animasyon, anlamlı boş durum).
- **Menü ve paketler:** /app menüsü 9 iş başlığıdır, tek kaynak `src/lib/nav-config.ts` (sayfa yolları değişmez,
  yeni sayfa buraya eklenir). Paket kilidi sayfa bazlıdır: `src/lib/billing/page-gates.ts` +
  `requireModulePage(mod, href)`; yeni/değişen paket kuralı orada ve `src/lib/billing/plans.ts`'te yapılır.
  Yeni tasarım bileşenleri `src/components/ui` (PageHeader, Card, StatRow, FilterBar...), kılavuz `docs/DESIGN_SYSTEM.md`.
- **AI:** OpenAI çağrıları yalnız `src/lib/ai/openai-client.ts` üzerinden gider ve kişisel veri (telefon, TC, e-posta,
  IBAN, kart) `src/lib/ai/redact.ts` ile maskelenir; doğrudan `api.openai.com` çağrısı yazma (sözleşme testi bunu yakalar).
- **service_role:** `createAdminClient` kullanımı `src/lib/admin-client-allowlist.ts` kabul listesindedir; yeni kullanım
  testi kırar (`npx tsx scripts/audit-admin-client.ts --write` ile envanter ve kabul listesi yenilenir). Envanter: `docs/security/`.
- **İletişim alanları (TEK MERKEZ):** her telefon girişi `PhoneInput` (`src/components/ui/phone-input.tsx`, ülke seçici,
  varsayılan TR), her e-posta girişi `EmailInput` olmak zorundadır. Ülke kuralları TEK kaynaktan gelir:
  `src/lib/phone-rules.ts` (libphonenumber-js/min, sabit sürüm). Her ülke kendi biçimine göre girilir: yazarken ülkeye göre
  biçimlenir, ülkenin en uzun olası uzunluğunun üstüne rakam YAZILMAZ (TR: ulusal 10 hane, `0` hariç; fazlası kırpılır +
  hafif uyarı), harf/sembol atılır, ülke değişince numara silinmez ama uyumsuzsa uyarılır, `+49…` yapıştırınca ülke seçilir.
  Saklama: TR `05XXXXXXXXX` / sabit `0XXXXXXXXXX`, yabancı `+<E.164>` (değişmez). SUNUCUDA telefon kaydeden her action
  `parsePhoneStrict` (`@/lib/phone-rules`) veya `phoneSchema`/`optionalPhoneSchema` (`src/lib/validation/contact.ts`) kullanır;
  hafif `parsePhone` yalnız istemci önizleme/karşılaştırma içindir. İstemci dosyası `phone-rules`'u STATİK import etmez
  (paket bütçesi; yalnız PhoneInput dinamik yükler). Ham `<input type="tel|email">` yazma.
  **Yeni telefon girişi kontrol listesi:** (1) form: `PhoneInput`; (2) action: `parsePhoneStrict`/`phoneSchema` ile doğrula,
  `stored` değerini yaz; (3) içe aktarma/webhook/public form dahil ham telefon string'i DB'ye gitmez;
  (4) `src/lib/contact-input-contract.test.ts` yeşil (istisna gerekiyorsa gerekçeli listeye); (5) gösterim `formatPhoneDisplay`.
- **PostgREST gömmeleri:** `properties`/`customers` gibi iki FK'lı tablolara gömme her zaman FK adıyla yazılır
  (`alias:properties!<tablo>_property_id_fkey(...)`); ipucusuz gömme listeyi sessizce boş bırakır
  (`src/lib/postgrest-embed-hint-contract.test.ts`).
- **SEO:** public sayfa metadata'sı yalnız `buildMetadata(path)` (`src/lib/seo/store.ts`); sayfa envanteri `src/lib/seo/registry.ts`, yönetim `/admin/seo` (modül `seo`),
  sitemap/robots/yönlendirme/JSON-LD/robot tek yerde. Token'lı yüzeyler sitemap'e ASLA girmez. Yeni public sayfa kontrol listesi: `docs/MIMARI.md` "SEO sistemi".
- **Cron:** 35 route `src/app/api/cron/*` + `vercel.json` (sayı `npm run check:cron` ile doğrulanır); hepsi `CRON_SECRET` Bearer doğrular
  ve `recordHeartbeat` yazar.

**PROJE HAFIZASI (önce bunu oku, durumu sıfırdan tarama): `docs/HAFIZA.md`** — yayın durumu, migration sırası, açık işler, kararlar,
tek-kaynak haritası, çalışma/doğrulama yöntemi.

Ayrıntı: `docs/MIMARI.md` · yol haritası: `docs/ROADMAP.md` · güncel durum: `docs/DURUM.md` · deploy: `docs/DEPLOY.md`.
Eski devir/sprint belgeleri: `docs/arsiv/`. CANLI: https://emlaksoft.vercel.app
