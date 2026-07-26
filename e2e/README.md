# E2E Testleri (Playwright)

```bash
npx tsx scripts/e2e-user.ts   # bir kez: e2e test kullanicisini hazirla (idempotent)
npm run test:e2e              # tum e2e testlerini calistirir (dev server otomatik ayaga kalkar)
npx playwright test --ui      # UI modunda debug
```

- Vitest birim testleri (`npm test`) bu klasorden tamamen ayridir; `vitest.config.ts` `e2e/` klasorunu taramaz.

## Proje yapisi (playwright.config.ts)

| Proje      | Ne calistirir            | storageState |
| ---------- | ------------------------ | ------------ |
| `setup`    | `auth.setup.ts` — login olur, oturumu `e2e/.auth/user.json`'a yazar | yazar |
| `public`   | `public-smoke.spec.ts` — auth GEREKTIRMEYEN smoke testleri | YOK |
| `chromium` | geri kalan spec'ler (`app-flows.spec.ts`) — oturumlu akislar | kullanir (`dependencies: ["setup"]`) |

## Test kullanicisi (scripts/e2e-user.ts)

- `e2e-test@emlaksoft.local` — sabit sifre script icinde (sadece test hesabi).
- Service role ile calisir (`.env.local`: `SUPABASE_SERVICE_ROLE_KEY`); kullaniciyi
  olusturur/bulur, `e2e-test` slug'li tenant'a **owner** profili baglar,
  `two_factor_sms=false` garanti eder ve anon login ile dogrular. Idempotent —
  her calistirmada sifreyi/metadata'yi bilinen duruma resetler.
- Farkli kimlik gerekiyorsa `E2E_USER_EMAIL` / `E2E_USER_PASSWORD` env degiskenleri
  `auth.setup.ts`'i override eder.

## Oturumlu testler (app-flows.spec.ts)

- Dashboard KPI kartlari + linkleri, Musteriler (sidebar navigasyonu, tablo/bos durum,
  yeni musteri dialogu), Portfoyler liste↔harita toggle (`?gorunum=harita`),
  Anlasmalar kanban kolonlari, `/app/cuzdan`, `/app/kiralama`, komut paleti
  (Ctrl+K → `2+2` → `= 4` → Esc).
- **Deterministiklik:** seed verisine kati bagimlilik yok — satir SAYISI asserlenmez,
  "tablo YA DA bos durum" gibi esnek beklentiler kullanilir.
- **Urun turu:** `auth.setup.ts` login sonrasi localStorage'a `emlaksoft:tour-done=1`
  yazar; storageState localStorage'i da tasidigi icin tur oturumlu testlerde hic acilmaz.

## Notlar

- `e2e/.auth/` `.gitignore`'dadir (oturum cerezleri icerir) — commit etmeyin.
- Supabase oturumu cookie tabanli (`@supabase/ssr`); `storageState` cookie +
  localStorage tasidigi icin dogrudan calisir.
- Dev'de Next.js error overlay'i de `role="dialog"` tasir — dialog assert'lerinde
  `aria-label` ile hedefleyin (ornek: `getByRole("dialog", { name: "Hızlı arama" })`).
