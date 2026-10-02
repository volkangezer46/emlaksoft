# E2E Testleri (Playwright)

```bash
npm run test:e2e:public       # her ortamda güvenli, salt-okunur public smoke
# Oturumlu testler için benzersiz kimlik bilgileri ve açık mutasyon izni verin:
# E2E_MUTATION_ALLOWED=true E2E_USER_EMAIL=... E2E_USER_PASSWORD=... npx tsx scripts/e2e-user.ts
# Aynı env değişkenleriyle npm run test:e2e
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

- Test e-postası ve en az 16 karakterlik benzersiz parola yalnız
  `E2E_USER_EMAIL` / `E2E_USER_PASSWORD` ortam değişkenlerinden alınır.
- Sunucu secret key ile çalışır (`.env.local`: `SUPABASE_SECRET_KEY`); kullanıcıyı
  olusturur/bulur, `e2e-test` slug'li tenant'a **owner** profili baglar,
  `two_factor_sms=false` garanti eder ve anon login ile dogrular. Idempotent —
  her calistirmada sifreyi/metadata'yi bilinen duruma resetler.
- Oturumlu projeler ancak `E2E_MUTATION_ALLOWED=true` iken çalışır. Hosted
  Supabase kullanıcı hazırlığı ayrıca `SEED_CONFIRM=1` ister.

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
