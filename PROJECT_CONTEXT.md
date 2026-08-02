# PROJECT_CONTEXT.md — EmlakSoft

> Herhangi bir AI aracı (Claude Code, Cursor, ChatGPT Codex, ...) yeni bir oturumda
> önce bu dosyayı, sonra `AGENTS.md`'yi okumalı. İkisi birlikte "bu proje ne, kurallar
> ne" sorusunu birkaç dakikada cevaplar. Daha derin bilgi için altındaki "Daha fazlası"
> bölümündeki dosyalara bakılır.

## Proje nedir

**EmlakSoft** — Türk emlak ofisleri için çok-kiracılı (multi-tenant) SaaS.
Müşteri/talep/portföy/randevu/anlaşma/komisyon omurgası + kayıp-kaçak kalkanı,
değerleme (emsal motoru), otomasyonlar, cron işleri, AI asistan, vitrin (public ofis
sitesi) ve token'lı public portallar (malik/müşteri/imza/ödeme).

- **Dil/arayüz:** Tamamen Türkçe ("lead" değil "talep/başvuru").
- **Yığın:** Next.js (App Router) + Supabase (Postgres + RLS) + Vercel.
- **Canlı:** https://emlaksoft.vercel.app
- **Repo yolu:** `c:\Users\volka\Projects\emlaksoft`

## Şu anki durum (bu dosyayı güncel tutmak için tarih: kontrol et)

Proje canlıda ve aktif geliştirme altında. Genellikle **birden fazla oturum/araç aynı
anda** bu depoda çalışıyor olabilir (ör. bir tarafta güvenlik sertleştirme migration'ları
yazılırken diğer tarafta UI işi yapılabilir) — çalışmaya başlamadan önce `git status` ve
`git log --oneline -20` ile gerçek durumu doğrula, bu dosyadaki özete körü körüne güvenme.

Kaba ölçek: 100+ rota, çok sayıda cron (`vercel.json`), yüzlerce birim/contract testi
(`npm run test`), Playwright E2E (`npm run test:e2e`). Migration'lar `supabase/migrations/`
altında sıralı; her biri yazılır yazılmaz `scripts/apply-one.ts` ile dev DB'ye uygulanır
(bkz. `AGENTS.md`/`CLAUDE.md` — `apply-migrations.ts` KULLANILMAZ).

## Hızlı komutlar

```bash
npm run dev            # geliştirme sunucusu
npm run build           # prod build (deploy öncesi yeşil olmalı)
npm run type-check      # tsc --noEmit
npm run lint            # eslint . --max-warnings=0
npm run test            # vitest (birim + contract testleri)
npm run test:e2e        # playwright (public smoke)
npx tsx scripts/apply-one.ts supabase/migrations/<dosya>.sql   # migration uygula (TEK TEK)
```

Demo giriş (yalnız dev, `ENABLE_DEMO_LOGIN=1`): `/giris` sayfasındaki hızlı-giriş
butonları; şifre `Demo1234!`.

## Daha fazlası (derinlemesine bilgi için)

| Konu | Dosya |
|---|---|
| AI çalışma kuralları (breaking changes uyarısı, dokümantasyon okuma zorunluluğu) | `AGENTS.md` |
| Mimari/harita, komutlar, yetki modeli, modül ekleme kuralları | `CLAUDE.md`, `ARCHITECTURE.md` |
| Yol haritası / faz durumu | `ROADMAP.md` → `docs/MASTER_PLAN.md`, `docs/ROADMAP_V2.md` |
| Açık iş listesi / özellik envanteri | `TASKS.md` → `docs/OZELLIK_MASTER_LISTESI.md` |
| Değişiklik geçmişi | `CHANGELOG.md` |
| Deploy rehberi | `DEPLOY_CHECKLIST.md`, `docs/DEPLOY_CHECKLIST.md` |
| Geçmiş oturumların ayrıntılı devir notları | `docs/DEVIR_NOTU.md`, `DEVIR_TESLIM.md` |
| Güvenlik açığı bildirimi | `SECURITY.md` |

## Önemli davranış kuralları (özet — tam liste `CLAUDE.md`'de)

- Migration yazan onu hemen `apply-one.ts` ile uygular.
- Yeni modül eklerken 4 kayıt yeri var (permissions.ts + NAV_MODULES + sidebar + roller
  ekranı) — biri atlanırsa modül görünmez ya da kapısız kalır.
- Bileşende `Date.now()`/`new Date()` doğrudan çağrılmaz — `src/lib/clock.ts`.
- Dark mode YOK — eklenmeyecek.
- Görünen her sayı/kart tıklanabilir olmalı ve filtrelenmiş hedefe götürmeli.
