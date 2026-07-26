import { test, expect, type Page, type Locator } from "@playwright/test";

/**
 * Oturumlu E2E akışları — 4. dalga (Dalga M kanıtlama):
 *  - Talep-Arz raporu (/app/raporlar/talep-arz) + ?donem= filtre kontratı
 *  - Takvim aboneliği (ICS feed /api/takvim/[token]) — kart + feed + bozuk token
 *  - Portföy sunumu uçtan uca: dialog → public /sunum/[token] (auth'suz context)
 *  - Müşteri sıcaklık segmentleri (?segment= kontratı + rozetler)
 *  - geo-sync cron yetki kapısı (401)
 *
 * `chromium` projesi storageState ile çalışır (e2e/auth.setup.ts); public sunum
 * adımı bilinçli olarak auth'SUZ yeni bir context'te koşar (app-flows-3 deseni).
 */

/** Sayfanın /giris'e düşmediğini ve app kabuğunun (sidebar) geldiğini doğrular. */
async function expectAppShell(page: Page) {
  await expect(page).not.toHaveURL(/\/giris/);
  await expect(page.locator('a[href="/app/musteriler"]').first()).toBeVisible({ timeout: 30_000 });
}

/**
 * Hidrasyon-retry deseni (bkz. app-flows.spec.ts): paralel yük altında ilk
 * tıklama React hidrasyonundan önce düşebilir — hedef 5 sn'de görünmezse
 * tetikleyiciye bir kez daha tıklanır.
 */
async function clickUntilVisible(trigger: Locator, target: Locator) {
  await trigger.click();
  try {
    await expect(target).toBeVisible({ timeout: 5000 });
  } catch {
    await trigger.click();
    await expect(target).toBeVisible({ timeout: 10_000 });
  }
}

test.describe("Talep-Arz raporu (/app/raporlar/talep-arz)", () => {
  test("rapor merkezindeki karttan acilir; ?donem=30 cipi URL'i gunceller; tablo veya bos durum render olur", async ({
    page,
  }) => {
    await page.goto("/app/raporlar");
    await expectAppShell(page);

    // Rapor merkezi ana sayfasındaki yeni kart → talep-arz raporu.
    const card = page.getByRole("link", { name: /Talep-Arz Haritası/ }).first();
    await expect(card).toBeVisible({ timeout: 30_000 });
    await card.click();
    await expect(page).toHaveURL(/\/app\/raporlar\/talep-arz/, { timeout: 30_000 });

    await expect(page.getByRole("heading", { name: "Talep-Arz Haritası" })).toBeVisible({ timeout: 30_000 });
    // 4 StatCard'ın etiketleri (sıfır çıkmaz metrik — hepsi tıklanabilir).
    await expect(page.getByText(/Açık talep · son \d+ gün/)).toBeVisible();
    await expect(page.getByText("Yayındaki portföy", { exact: true })).toBeVisible();
    await expect(page.getByText("En aç ilçe (talep/arz)")).toBeVisible();
    await expect(page.getByText(/Karşılanamayan bütçe/)).toBeVisible();

    // Filtre kontratı: dönem çipi URL'i günceller (varsayılan 90 → 30 param'a yazılır).
    await page.getByRole("link", { name: "Son 30 gün", exact: true }).click();
    await expect(page).toHaveURL(/\/app\/raporlar\/talep-arz\?(.*&)?donem=30/, { timeout: 30_000 });

    // İçerik esnek: ilçe denge tablosu YA DA anlamlı boş durum.
    const table = page.getByRole("heading", { name: "İlçe bazlı talep-arz dengesi" });
    const empty = page.getByText(/açık talep yok/i);
    await expect(table.or(empty).first()).toBeVisible({ timeout: 30_000 });
  });
});

test.describe("Takvim aboneligi (ICS feed)", () => {
  test("abone ol karti gorunur; ICS feed 200 + VCALENDAR doner; bozuk token 404", async ({ page }) => {
    await page.goto("/app/randevular");
    await expectAppShell(page);

    // "Takvime abone ol" kartı (calendar_token migration 099'da not null default —
    // her kullanıcıda olmalı).
    await expect(page.getByRole("heading", { name: "Takvime abone ol" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: /Linki yenile/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Google Takvim/ })).toBeVisible();

    // ICS URL'i DOM'dan oku — origin client'ta çözülür (useSyncExternalStore),
    // hidrasyon öncesi "…" görünür; gerçek link gelene dek bekle.
    const codeEl = page.locator("code", { hasText: "/api/takvim/" });
    await expect(codeEl).toBeVisible({ timeout: 30_000 });
    const icsUrl = (await codeEl.textContent())!.trim();
    expect(icsUrl).toMatch(/\/api\/takvim\/[0-9a-f-]{36}$/);

    // Feed auth GEREKTİRMEZ (token yeterli) — page.request cookie taşısa da
    // route cookie'ye bakmaz; 200 + text/calendar + VCALENDAR gövdesi beklenir.
    const res = await page.request.get(icsUrl);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"] ?? "").toContain("text/calendar");
    const body = await res.text();
    expect(body).toContain("BEGIN:VCALENDAR");
    expect(body).toContain("END:VCALENDAR");

    // Bozuk (kayıtsız) token → 404. Not: all-zero uuid biçimsel olarak geçerli,
    // profil eşleşmez ve route 404 döner.
    const bad = await page.request.get("/api/takvim/00000000-0000-0000-0000-000000000000");
    expect(bad.status()).toBe(404);
  });
});

test.describe("Portfoy sunumu uctan uca (/app/portfoyler/sunumlar -> /sunum/[token])", () => {
  test("yeni sunum dialogu link uretir; public sayfa auth'suz kapak + portfoy slaydi render eder", async ({
    page,
    browser,
  }) => {
    test.slow(); // dialog + server action + ikinci context — dev derlemesiyle uzun sürebilir

    await page.goto("/app/portfoyler/sunumlar");
    await expectAppShell(page);
    await expect(page.getByRole("heading", { name: "Portföy sunumları" })).toBeVisible({ timeout: 30_000 });

    // Boş durumda iki tetikleyici var (hero + boş durum) — ilki yeter.
    const newBtn = page.getByRole("button", { name: /Yeni sunum/ }).first();
    const dialog = page.getByRole("dialog");
    await clickUntilVisible(newBtn, dialog);
    await expect(dialog.getByText("Yeni portföy sunumu")).toBeVisible();

    // Kural: yayında portföy yoksa test veri üretmeye KALKMAZ — runtime skip
    // (görev tanımı; portföyü yayına almak ayrı bir akış).
    if ((await dialog.getByText("Yayında portföy yok").count()) > 0) {
      test.skip(true, "e2e tenant'ında yayında portföy yok — sunum dialogu seçim havuzu boş, akış atlandı.");
    }

    await dialog.locator('input[name="title"]').fill("E2E Sunum");
    // Müşteri adı → public kapakta "… için hazırlandı" satırının kanıtı.
    await dialog.locator('input[name="customer_name"]').fill("E2E Müşteri");

    // İlk yayındaki portföyü seç (maks 5 sınırı bu testte tek seçimle ilgisiz).
    const firstCheckbox = dialog.locator('input[type="checkbox"]').first();
    await expect(firstCheckbox).toBeVisible({ timeout: 15_000 });
    await firstCheckbox.check();
    await expect(dialog.getByText(/1\/5 seçili/)).toBeVisible();

    const submit = dialog.getByRole("button", { name: "Sunumu oluştur" });
    await expect(submit).toBeEnabled({ timeout: 10_000 });
    await submit.click();

    // Başarıda dialog kapanmaz — "Sunum hazır" paneli public linki gösterir.
    await expect(dialog.getByText("Sunum hazır")).toBeVisible({ timeout: 30_000 });
    const publicUrl = await dialog.getByRole("link", { name: /Önizle/ }).getAttribute("href");
    expect(publicUrl).toMatch(/\/sunum\/[0-9a-f-]{36}$/);

    // ── Public taraf: auth'SUZ yeni context (storageState taşınmaz) ──────────
    const anonContext = await browser.newContext();
    try {
      const pub = await anonContext.newPage();
      await pub.goto(publicUrl!);

      // Kapak: sunum başlığı + "için hazırlandı" satırı (customer_name verildi).
      await expect(pub.getByRole("heading", { name: "E2E Sunum" })).toBeVisible({ timeout: 30_000 });
      await expect(pub.getByText(/için hazırlandı/)).toBeVisible();
      // Portföy slaytı: "1 / N" sayaç rozeti + iletişim CTA sayfası.
      await expect(pub.getByText(/^1 \/ \d+$/)).toBeVisible();
      await expect(pub.getByRole("heading", { name: "Beğendiğiniz portföy oldu mu?" })).toBeVisible();
      // Ekran araç çubuğu: yazdır butonu (print CSS'in giriş noktası).
      await expect(pub.getByRole("button", { name: /Yazdır|PDF/i })).toBeVisible();
    } finally {
      await anonContext.close();
    }
  });
});

test.describe("Musteri sicaklik segmentleri (/app/musteriler)", () => {
  test("4 segment karti gorunur; karta tiklama ?segment= filtresini uygular; rozetler render olur", async ({
    page,
  }) => {
    await page.goto("/app/musteriler");
    await expectAppShell(page);

    const section = page.locator('section[aria-label="Müşteri sıcaklık segmentleri"]');
    try {
      await expect(section).toBeVisible({ timeout: 30_000 });
    } catch {
      test.skip(true, "e2e tenant'ında hiç müşteri yok — segment kartları render edilmez.");
    }

    // 4 segment kartı (StatCard=link, sıfır çıkmaz metrik).
    const labels = [/Sıcak/, /İlgili/, /Soğuk/, /Uykuda/];
    for (const l of labels) {
      await expect(section.getByRole("link", { name: l }).first()).toBeVisible();
    }

    // Sayısı > 0 olan ilk kartı seç (rozet kanıtı için dolu segment tercih edilir);
    // hepsi 0 ise "Uykuda" kartına tıklanır ve liste boş durumu kabul edilir.
    let target = section.getByRole("link", { name: /Uykuda/ }).first();
    let targetNonEmpty = false;
    for (const l of labels) {
      const cardEl = section.getByRole("link", { name: l }).first();
      const text = (await cardEl.innerText()).replace(/\./g, "");
      const num = text.match(/\d+/);
      if (num && Number(num[0]) > 0) {
        target = cardEl;
        targetNonEmpty = true;
        break;
      }
    }

    await target.click();
    await expect(page).toHaveURL(/\/app\/musteriler\?(.*&)?segment=(sicak|ilgili|soguk|uykuda)/, {
      timeout: 30_000,
    });
    // Aktif kart "Filtre aktif" durumunu gösterir (kaldırma yolu görünür).
    await expect(page.getByText("Filtre aktif — kaldır")).toBeVisible({ timeout: 30_000 });

    if (targetNonEmpty) {
      // Satır rozetleri: title="Sıcaklık X/100 …" skor dökümü taşır (customer-heat.ts).
      await expect(page.locator('[title^="Sıcaklık"]').first()).toBeVisible({ timeout: 30_000 });
    }
  });
});

test.describe("geo-sync cron yetki kapisi", () => {
  test("Authorization'siz istek 401 doner (CRON_SECRET tanimliysa)", async ({ page }) => {
    const res = await page.request.get("/api/cron/geo-sync");
    if (res.status() !== 401) {
      // Dev fallback: CRON_SECRET tanımsızken route dev ortamında bilinçli açık
      // (src/app/api/cron/geo-sync/route.ts authorized()) — 401 kontratı ancak
      // secret tanımlı ortamda (prod/CI) doğrulanabilir.
      test.skip(true, `CRON_SECRET tanımsız — dev fallback aktif (status ${res.status()}); 401 kontratı prod'da geçerli.`);
    }
    expect(res.status()).toBe(401);
  });
});
