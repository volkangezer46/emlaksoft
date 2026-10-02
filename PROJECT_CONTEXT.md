# PROJECT_CONTEXT.md — EmlakSoft

> Herhangi bir AI aracı (Claude Code, Cursor, ChatGPT Codex, ...) yeni bir oturumda
> önce bu dosyayı, sonra `AGENTS.md`'yi okumalı. İkisi birlikte "bu proje ne, kurallar
> ne" sorusunu birkaç dakikada cevaplar. Daha derin bilgi için altındaki "Daha fazlası"
> bölümündeki dosyalara bakılır.

> [!IMPORTANT]
> 13 Ağustos 2026 uçtan uca denetimin güncel ve bağlayıcı kaydı
> `docs/AUDIT_2026-08-13.md` dosyasındadır. Public Git geçmişindeki aktif
> secret olayı ve canlı DB migration drift'i çözülmeden commit, push, migration veya deploy
> yapılmamalıdır.

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

Projenin önceki sürümü canlıda ve proje aktif geliştirme altında; 13 Ağustos denetim/yayın
adayı henüz canlıya alınmadı. Genellikle **birden fazla oturum/araç aynı
anda** bu depoda çalışıyor olabilir (ör. bir tarafta güvenlik sertleştirme migration'ları
yazılırken diğer tarafta UI işi yapılabilir) — çalışmaya başlamadan önce `git status` ve
`git log --oneline -20` ile gerçek durumu doğrula, bu dosyadaki özete körü körüne güvenme.

Kaba ölçek: 100+ rota, çok sayıda cron (`vercel.json`), yüzlerce birim/contract testi
(`npm run test`), Playwright E2E (`npm run test:e2e`). Migration'lar `supabase/migrations/`
altında sıralı ve forward-only'dir. Önce checksum/ledger denetimi ile dry-run yapılır;
restore edilebilir backup/PITR doğrulandıktan sonra kontrollü biçimde `npm run db:migrate`
çalıştırılır. Ledger drift varsa veritabanına yazılmaz.

## Hızlı komutlar

```bash
npm run dev            # geliştirme sunucusu
npm run build           # prod build (deploy öncesi yeşil olmalı)
npm run type-check      # tsc --noEmit
npm run lint            # eslint . --max-warnings=0
npm run test            # vitest (birim + contract testleri)
npm run test:e2e:public # playwright (salt-okunur public smoke)
npm run check:migrations -- --database # canlı ledger salt-okunur kontrol
npm run db:migrate -- --dry-run         # kalıcı yazmaz; kısa süreli advisory lock alır
```

Demo giriş (yalnız dev, `ENABLE_DEMO_LOGIN=true`): `/giris` sayfasındaki hızlı-giriş
butonları; ortak parola kullanılmaz, kimlik bilgisi sunucu sırrından türetilir.

## Daha fazlası (derinlemesine bilgi için)

| Konu | Dosya |
|---|---|
| AI çalışma kuralları (breaking changes uyarısı, dokümantasyon okuma zorunluluğu) | `AGENTS.md` |
| Mimari/harita, komutlar, yetki modeli, modül ekleme kuralları | `CLAUDE.md`, `ARCHITECTURE.md` |
| Yol haritası / faz durumu | `ROADMAP.md` → `docs/MASTER_PLAN.md`, `docs/ROADMAP_V2.md` |
| Açık iş listesi / özellik envanteri | `TASKS.md` → `docs/OZELLIK_MASTER_LISTESI.md` |
| Değişiklik geçmişi | `CHANGELOG.md` |
| Deploy rehberi | `DEPLOY_CHECKLIST.md`, `docs/DEPLOY_CHECKLIST.md` |
| Güncel uçtan uca denetim/yayın kararı | `docs/AUDIT_2026-08-13.md` |
| Önceki release-hardening devir kaydı | `docs/DEVIR_2026-08-10_RELEASE_HARDENING.md` |
| Geçmiş oturumların tarihsel devir notları | `docs/DEVIR_NOTU.md`, `DEVIR_TESLIM.md` |
| Güvenlik açığı bildirimi | `SECURITY.md` |

## Önemli davranış kuralları (özet — tam liste `CLAUDE.md`'de)

- Uygulanmış migration dosyası değiştirilmez. Yeni migration önce doğrulanır ve dry-run'dan
  geçirilir; canlı uygulama yalnız backup/PITR ve ledger bütünlüğü doğrulandıktan sonra yapılır.
- Yeni modül eklerken 4 kayıt yeri var (permissions.ts + NAV_MODULES + sidebar + roller
  ekranı) — biri atlanırsa modül görünmez ya da kapısız kalır.
- Bileşende `Date.now()`/`new Date()` doğrudan çağrılmaz — `src/lib/clock.ts`.
- Dark mode YOK — eklenmeyecek.
- Görünen her sayı/kart tıklanabilir olmalı ve filtrelenmiş hedefe götürmeli.
