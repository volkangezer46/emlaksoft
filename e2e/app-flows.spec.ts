import { test, expect, type Page } from "@playwright/test";

/**
 * Oturumlu (auth'lu) E2E akışları — `chromium` projesi storageState ile çalışır
 * (bkz. e2e/auth.setup.ts). Test kullanıcısı: scripts/e2e-user.ts.
 *
 * Deterministiklik notu: testler seed verisine katı bağımlı DEĞİLDİR —
 * satır sayısı asserlenmez, "tablo YA DA boş durum" gibi esnek beklentiler
 * kullanılır. Ürün turu, auth.setup'ta yazılan `emlaksoft:tour-done`
 * localStorage bayrağı sayesinde hiç açılmaz.
 */

/** Sayfanın /giris'e düşmediğini ve app kabuğunun (sidebar) geldiğini doğrular. */
async function expectAppShell(page: Page) {
  await expect(page).not.toHaveURL(/\/giris/);
  await expect(page.locator('a[href="/app/musteriler"]').first()).toBeVisible({ timeout: 30_000 });
}

test.describe("Dashboard (/app)", () => {
  test("KPI kartlari gorunur ve linklidir", async ({ page }) => {
    await page.goto("/app");
    await expectAppShell(page);

    const kpiGrid = page.locator('[data-tour="kpi"]');
    await expect(kpiGrid).toBeVisible({ timeout: 30_000 });

    // En az bir KPI kartı href'li bir link olmalı.
    const firstKpi = kpiGrid.locator("a").first();
    await expect(firstKpi).toBeVisible();
    const href = await firstKpi.getAttribute("href");
    expect(href, "KPI kartı href taşımalı").toBeTruthy();
    expect(href!).toMatch(/^\/app/);

    // Ürün turu overlay'i hiç açılmamalı (tour-done bayrağı storageState'te).
    await expect(page.getByText("Turu atla", { exact: false })).toHaveCount(0);
  });
});

test.describe("Musteriler (/app/musteriler)", () => {
  test("sidebar'dan gidilir; tablo veya bos durum render olur", async ({ page }) => {
    await page.goto("/app");
    await expectAppShell(page);

    await page.locator('a[href="/app/musteriler"]').first().click();
    await page.waitForURL("**/app/musteriler**");

    // Seed'e bağımlı olmayan esnek beklenti: veri varsa tablo, yoksa boş durum.
    const table = page.locator("table").first();
    const empty = page.getByText("Henüz müşteri yok");
    await expect(table.or(empty).first()).toBeVisible({ timeout: 30_000 });
  });

  test("yeni musteri dialogu acilir (buton varsa) ya da detaya girilir", async ({ page }) => {
    await page.goto("/app/musteriler");
    await expectAppShell(page);

    const newBtn = page.getByRole("button", { name: /Yeni müşteri/ }).first();
    if (await newBtn.isVisible().catch(() => false)) {
      await newBtn.click();
      const dialog = page.getByRole("dialog");
      // Paralel yük altında ilk tıklama hidrasyondan önce düşebilir —
      // diyalog 5 sn'de açılmazsa bir kez daha tıkla.
      try {
        await expect(dialog).toBeVisible({ timeout: 5000 });
      } catch {
        await newBtn.click();
        await expect(dialog).toBeVisible({ timeout: 10000 });
      }
      await expect(dialog.getByText("Yeni müşteri").first()).toBeVisible();
      await expect(dialog.locator("#full_name")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
    } else {
      // Buton yoksa (yetki/eski layout) en azından bir müşteri detayına gir.
      const detail = page.locator('a[href^="/app/musteriler/"]').first();
      await expect(detail).toBeVisible();
      await detail.click();
      await page.waitForURL(/\/app\/musteriler\/.+/);
      await expect(page.getByRole("heading").first()).toBeVisible();
    }
  });
});

test.describe("Portfoyler (/app/portfoyler)", () => {
  test("liste-harita toggle calisir, ?gorunum=harita URL'e yansir", async ({ page }) => {
    await page.goto("/app/portfoyler");
    await expectAppShell(page);
    await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 30_000 });

    // Toggle: "Harita" görünümüne geçen link.
    const mapLink = page.locator('a[href*="gorunum=harita"]').first();
    await expect(mapLink).toBeVisible();
    await mapLink.click();
    await expect(page).toHaveURL(/gorunum=harita/);

    // Geri: "Liste" linki gorunum paramını düşürür.
    const listLink = page.getByRole("link", { name: /^Liste$/ }).first();
    await expect(listLink).toBeVisible();
    await listLink.click();
    await expect(page).not.toHaveURL(/gorunum=harita/);
  });
});

test.describe("Anlasmalar (/app/anlasmalar)", () => {
  test("kanban kolonlari render olur", async ({ page }) => {
    await page.goto("/app/anlasmalar");
    await expectAppShell(page);

    // Seed'e bağımlı olmayan esnek beklenti: anlaşma varsa kanban (#tahta),
    // yoksa "Satış hattı boş" boş durumu render olur.
    const board = page.locator("#tahta");
    const empty = page.getByText("Satış hattı boş");
    await expect(board.or(empty).first()).toBeVisible({ timeout: 30_000 });

    if (await board.isVisible()) {
      // deal-board.tsx: her aşama `sutun-<key>` id'li bir <section>.
      for (const key of ["new", "qualified", "negotiation", "won", "lost"]) {
        await expect(page.locator(`#sutun-${key}`)).toBeVisible();
      }
    }
  });
});

test.describe("Cuzdan ve Kiralama", () => {
  test("/app/cuzdan acilir", async ({ page }) => {
    await page.goto("/app/cuzdan");
    await expectAppShell(page);
    await expect(page).toHaveURL(/\/app\/cuzdan/);
    await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 30_000 });
  });

  test("/app/kiralama acilir", async ({ page }) => {
    await page.goto("/app/kiralama");
    await expectAppShell(page);
    await expect(page).toHaveURL(/\/app\/kiralama/);
    await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 30_000 });
  });
});

test.describe("Komut paleti", () => {
  test("Ctrl+K acar, 2+2 hesabi '= 4' gosterir, Esc kapatir", async ({ page }) => {
    await page.goto("/app");
    await expectAppShell(page);

    await page.keyboard.press("Control+k");
    // Dev'de Next.js error overlay de role="dialog" taşır — palete aria-label ile hedeflen.
    const dialog = page.getByRole("dialog", { name: "Hızlı arama" });
    // Paralel yük altında kısayol hidrasyondan önce düşebilir — bir kez daha dene.
    try {
      await expect(dialog).toBeVisible({ timeout: 5000 });
    } catch {
      await page.keyboard.press("Control+k");
      await expect(dialog).toBeVisible({ timeout: 10000 });
    }

    // Palet inputu açılınca odaklanır — direkt yaz.
    await page.keyboard.type("2+2");
    await expect(dialog.getByText("= 4", { exact: false }).first()).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });
});
