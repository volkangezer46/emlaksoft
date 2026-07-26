# DEVİR NOTU — Başka bilgisayarda devam etme rehberi

**Tarih:** 2026-07-27 · Bu belge, Claude Code oturumlarının tüm birikimini yeni bir makinede
kaldığı yerden sürdürebilmek için yazıldı. Yeni oturumda Claude'a "docs/DEVIR_NOTU.md oku" demen yeterli.

---

## 1) Sistemin bugünkü durumu

- **CANLI:** https://emlaksoft.vercel.app (Vercel projesi `emlaksoft`, hesap: volkangezer46)
- **DB:** Supabase `vbtuexdbhvcetswdtzts` (eu-central-1) — **107 migration'ın tamamı uygulı** (`supabase/migrations/`)
- **Ölçek:** 120 rota · 17 cron (`vercel.json`) · 188 birim test (vitest) · 38 E2E (playwright)
- **Son tam doğrulama (2026-07-27, deploy öncesi):** tsc ✔ lint ✔ 188 test ✔ link kontratı ✔
  npm audit 0 açık ✔ RLS denetimi "BULGU YOK" ✔ build ✔ E2E ✔
- Demo tenant: `demo-ofis` — girişler `sahip@ / mudur@ / danisman@demo.emlaksoft.test`, şifre `Demo1234!`
  (yalnız dev'de `ENABLE_DEMO_LOGIN=1` ile hızlı giriş). E2E kullanıcısı: `npx tsx scripts/e2e-user.ts`.

## 2) Oturum geçmişi — ne yapıldı (dalga dalga)

Kapsamlı özellik dökümü ve dalga geçmişi: **`docs/OZELLIK_MASTER_LISTESI.md`** (sondaki
"DURUM GÜNCELLEMESİ" bölümleri kronolojik devir kaydıdır — mutlaka oku).
Kısa özet: ~14 dalga / ~110 paralel ajanla audit'ten tam platforma dönüştürüldü:
tıklanabilirlik kontratı (check:links aracı), liste standardı (sunucu filtre + sayfalama + toplu işlem),
güvenlik (SMS 2FA, RLS sertleştirme, izin istisnaları), Realtime + AI asistan + PWA,
modüller (Kiralama, Projeler, MLS ağı, Gelen Kutusu, sunumlar, NPS, rota, duyurular,
evrak dosyası, segmentasyon, talep-arz haritası, ICS takvim, açık ev QR, vitrin v2...).

## 3) Kalıcı kararlar (User'ın kesin tercihleri — ASLA çiğneme)

1. **Dark mode YOK** — hiçbir zaman eklenmeyecek.
2. **Migration'lar full otomatik**: yazan ajan `npx tsx scripts/apply-one.ts <dosya>` ile HEMEN uygular, kanıt gösterir. Sıradaki numara: **108**.
3. UI **tamamen Türkçe**; ultra premium standart; mor renk yok (Ink #071A38 / Brand #1463FF / Mint / Amber).
4. Bileşen render'ında `Date.now()`/`new Date()` yasak → `src/lib/clock.ts`.
5. Görünen her sayı/kart tıklanabilir; link kontratı `npm run check:links` ile korunur.
6. Çalışma düzeni: paralel arka plan ajanlarıyla "dalga" sistemi (ayrık dosya alanları), her dalga sonrası
   tam doğrulama (tsc/lint/test/build/E2E/links) + kanıtlama ajanı (E2E + ekran görüntüsü QA).

Operasyonel kurallar: **`CLAUDE.md`** ve mimari: **`docs/MIMARI.md`**, **`AGENTS.md`** (Next.js 16 uyarısı).

## 4) Yeni makinede kurulum

```bash
git clone https://github.com/volkangezer46/emlaksoft.git && cd emlaksoft
npm install
npx playwright install chromium
# .env.local'i ESKİ MAKİNEDEN ELLE KOPYALA (git'te YOK — gizli anahtarlar içerir):
#   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
#   DATABASE_POOLER_URL, DATABASE_URL, NEXT_PUBLIC_APP_URL, PLATFORM_ADMIN_EMAILS,
#   ENABLE_DEMO_LOGIN, ALLOW_PLATFORM_DEMO
#   (değerler Supabase Dashboard → Project Settings → API/Database'den de alınabilir)
npm run dev            # geliştirme
npx vercel login && npx vercel link --yes --project emlaksoft   # deploy için
```

Doğrulama komutları: `npx tsc --noEmit` · `npm run lint` · `npm test` · `npm run build` ·
`npx playwright test` · `npm run check:links` · `npm run db:rls-audit`

## 5) Deploy durumu ve kalan işler

Deploy ayrıntısı: **`docs/DEPLOY_CHECKLIST.md`** (üstünde canlı durum notu var).
Vercel prod env'de yüklü: Supabase üçlüsü, `CRON_SECRET` (yeni üretildi, yalnız Vercel'de),
`PLATFORM_ADMIN_EMAILS`, `NEXT_PUBLIC_APP_URL=https://emlaksoft.vercel.app`. Demo kapıları kapalı.

**Kalan işler (öncelik sırasıyla):**
1. Supabase Auth → Site URL `https://emlaksoft.vercel.app` + Redirect `.../sifre-yenile` (panelden, 2 dk)
2. Vercel Pro plan (17 cron'un tam tarifesi; Hobby'de günde 1'e düşer)
3. Özel alan adı (bağlanınca `NEXT_PUBLIC_APP_URL` güncelle + redeploy)
4. Supabase PITR yedekleme + Auth e-posta şablonları Türkçeleştirme
5. Dış anahtarlar (kod hazır): OpenAI (AI/OCR) · Netgsm (2FA/SMS) · iyzico LIVE (+`IYZICO_BASE_URL=https://api.iyzipay.com`!) ·
   İYS entegratörü · VAPID (push) · portal API'leri · WhatsApp Business · CTI
6. Güvenlik: Supabase service_role anahtar rotasyonu (dev'de kullanıldı) → sonra Vercel env güncelle;
   `PLATFORM_ADMIN_EMAILS`'e gerçek admin adresi
7. Vercel projesini bu GitHub repo'suna bağlamak (push = otomatik deploy): Vercel → Settings → Git

## 6) Bilinen davranışlar / tuzaklar

- E2E'de 2-3 test hidrasyon yarışıyla flaky olabilir → `retries: 1` tasarımı bunu karşılar; build ile
  aynı anda E2E koşturma (CPU çekişmesi kırmızı yaratır).
- `scripts/apply-migrations.ts` KULLANMA (eksik liste) — her zaman `apply-one.ts`.
- Enum ADD VALUE + kullanımı aynı migration dosyasında olamaz (087/087b deseni).
- Yeni modül eklerken 4 kayıt yeri: permissions.ts + NAV_MODULES + sidebar + roller ekranı (CLAUDE.md).
- Geçersiz token'lı public sayfalar HTTP 200 + 404 içerik döner (Next.js streaming) — bilinçli.
- Hosted DB'ye seed/script koşarken `SEED_CONFIRM=1` freni var.
