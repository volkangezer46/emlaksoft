import { test, expect } from "@playwright/test";

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
    // Hero CTA: /kayit'e giden ilk buton
    await expect(page.locator('main a[href="/kayit"], a[href="/kayit"]').first()).toBeVisible();
    // Ikincil CTA: canli demo
    await expect(page.locator('a[href="/demo"]').first()).toBeVisible();
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

test.describe("Demo talebi (/demo)", () => {
  test("form render olur", async ({ page }) => {
    await page.goto("/demo");
    await expect(page.getByRole("heading", { name: "Canlı demo talebi" })).toBeVisible();
    await expect(page.locator("#full_name")).toBeVisible();
    await expect(page.locator("#phone")).toBeVisible();
    await expect(page.locator("#email")).toBeVisible();
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
