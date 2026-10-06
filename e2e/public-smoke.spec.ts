import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Auth GEREKTIRMEYEN smoke testleri.
 * Amac: public sayfalarin render oldugunu ve temel etkilesimlerin
 * calistigini dogrulamak. Login'li akislar icin bkz. e2e/README.md.
 */

test.describe("Landing", () => {
  test("acilir, baslik ve CTA gorunur", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/EmlakSoft/i);
    await expect(page.locator("h1").first()).toBeVisible();
    // Hero CTA: /kayit'e giden ilk GORUNUR bag. DOM'daki ilk /kayit baglari
    // mobil menu/mega menu icindedir (masaustunde kasitli gizli); hero CTA main icindedir.
    await expect(page.locator('main a[href="/kayit"]:visible').first()).toBeVisible();
  });
});

test.describe("Giris (/giris)", () => {
  test("form render olur", async ({ page }) => {
    await page.goto("/giris");
    await expect(page.getByRole("heading", { name: "Tekrar hoş geldiniz" })).toBeVisible();
    await expect(page.locator("#email")).toBeVisible();
    await expect(page.locator("#password")).toBeVisible();
    await expect(page.getByRole("button", { name: /Giriş yap/ })).toBeVisible();
  });

  test("bos submit'te tarayici validasyonu girisi engeller", async ({ page }) => {
    await page.goto("/giris");
    await page.getByRole("button", { name: /Giriş yap/ }).click();
    // Alanlar `required` oldugu icin native validasyon devreye girer,
    // sayfa /giris'te kalir ve email alani :invalid olur.
    await expect(page).toHaveURL(/\/giris/);
    await expect(page.locator("#email:invalid")).toHaveCount(1);
    const message = await page
      .locator("#email")
      .evaluate((el) => (el as HTMLInputElement).validationMessage);
    expect(message.length).toBeGreaterThan(0);
  });
});

test.describe("Kayit sihirbazi (/kayit)", () => {
  test("1. adim alanlari gorunur", async ({ page }) => {
    await page.goto("/kayit");
    await expect(page.getByRole("heading", { name: "Ücretsiz başlayın" })).toBeVisible();
    // Adim gostergesi (Hesap / Ofisiniz / Guvenlik)
    await expect(page.getByLabel("Kayıt adımları")).toBeVisible();
    // 1. adim: ad soyad + e-posta + telefon
    await expect(page.locator("#name")).toBeVisible();
    await expect(page.locator("#email")).toBeVisible();
    await expect(page.locator("#phone")).toBeVisible();
  });
});

test.describe("/demo yonlendirmesi", () => {
  test("/kayit sayfasina gider", async ({ page }) => {
    await page.goto("/demo");
    await expect(page).toHaveURL(/\/kayit/);
  });
});

test.describe("Yasal sayfalar", () => {
  test("gizlilik politikasi acilir", async ({ page }) => {
    await page.goto("/gizlilik");
    await expect(page.getByRole("heading", { name: "Gizlilik Politikası" })).toBeVisible();
    await expect(page.getByText("Topladığımız Veriler")).toBeVisible();
  });
});

test.describe("Sifre sifirlama (/sifre-sifirla)", () => {
  test("form render olur", async ({ page }) => {
    await page.goto("/sifre-sifirla");
    await expect(page.getByRole("heading", { name: /Şifrenizi mi unuttunuz/ })).toBeVisible();
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });
});

/**
 * Erisilebilirlik (axe-core): yalniz KRITIK ve CIDDI ihlaller testi kirar (orta/hafif raporlanmaz).
 * Salt-okunur; public sayfalar. Ihlal ozeti hata mesajina yazilir (kural, etki, hedef secici).
 */
test.describe("Erisilebilirlik (axe) — kritik/ciddi ihlal yok", () => {
  const PAGES: { name: string; path: string }[] = [
    { name: "landing", path: "/" },
    { name: "giris", path: "/giris" },
    { name: "kayit", path: "/kayit" },
    { name: "fiyatlar", path: "/fiyatlar" },
  ];

  for (const p of PAGES) {
    test(`${p.name} (${p.path})`, async ({ page }) => {
      await page.goto(p.path);
      await expect(page.locator("h1").first()).toBeVisible();
      const results = await new AxeBuilder({ page }).analyze();
      const blocking = results.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
      const summary = blocking.map(
        (v) => `${v.id} [${v.impact}] x${v.nodes.length}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`,
      );
      expect(summary, `axe ihlalleri (${p.path}):\n${summary.join("\n")}`).toEqual([]);
    });
  }
});
