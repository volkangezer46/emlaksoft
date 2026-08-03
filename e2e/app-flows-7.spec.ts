import { test, expect, type Page, type Locator } from "@playwright/test";

/**
 * Oturumlu E2E akışları — 7. dalga (Q1b kapsam boşluğu): roadmap'in istediği
 * dört kritik akıştan (giriş, portföy ekle, teklif, sözleşme imza) yalnız
 * girişin spec kapsamı vardı (auth.setup.ts). Bu dosya kalan üçünü ekler.
 *
 * `chromium` projesi storageState ile çalışır (e2e/auth.setup.ts). Sözleşme
 * imza akışı ayrıca auth'SUZ yeni bir context'te public /imza/[token]
 * sayfasını da kapsar (app-flows-4/5 deseni).
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

test.describe("Portfoy ekleme (/app/portfoyler)", () => {
  test("yeni portfoy dialogu doldurulup gonderilir; listede gorunur ve detaya gidilir", async ({ page }) => {
    const title = `E2E Test Portföy ${Date.now()}`;

    await page.goto("/app/portfoyler");
    await expectAppShell(page);

    const newBtn = page.getByRole("button", { name: /Yeni portföy/ }).first();
    const dialog = page.getByRole("dialog");
    await clickUntilVisible(newBtn, dialog);

    await dialog.locator("#property-title").fill(title);
    await dialog.locator("#list-price").fill("4.500.000");
    await dialog.getByRole("button", { name: /Portföyü oluştur/ }).click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });

    // Sunucu filtresiyle (?q=) satırı bul — sayfalama/sıralamadan bağımsız
    // (musteriler testindeki desenin aynısı).
    await page.goto(`/app/portfoyler?q=${encodeURIComponent(title)}`);
    const cardLink = page.getByRole("link", { name: title }).first();
    await expect(cardLink).toBeVisible({ timeout: 30_000 });
    await cardLink.click();
    await expect(page).toHaveURL(/\/app\/portfoyler\/[0-9a-f-]+/, { timeout: 30_000 });
    await expect(page.getByText(title).first()).toBeVisible({ timeout: 30_000 });
  });
});

test.describe("Teklif olusturma (/app/teklifler)", () => {
  test("portfoy secilip teklif olusturulur; teklifler listesinde gorunur", async ({ page }) => {
    await page.goto("/app/teklifler");
    await expectAppShell(page);

    const newBtn = page.getByRole("button", { name: /Yeni teklif/ }).first();
    const dialog = page.getByRole("dialog");
    await clickUntilVisible(newBtn, dialog);

    const propertySelect = dialog.locator("#offer-property");
    const optionCount = await propertySelect.locator("option").count();
    // Kural: e2e tenant'ında teklif verilecek portföy yoksa test veri
    // üretmeye kalkmaz — runtime skip (görev kuralı, bkz. app-flows-4/5/6).
    test.skip(optionCount <= 1, "e2e tenant'ında seçilebilir portföy yok — teklif dialogu boş.");

    await propertySelect.selectOption({ index: 1 });

    // Portföy seçimi liste fiyatını otomatik dolduruyor (bkz. handlePropertyChange)
    // ama alan `min="1" step="1000"` taşıyor — geçerli değerler 1 + k*1000'dir,
    // yuvarlak liste fiyatları (ör. 5.000.000) native doğrulamayı geçemez. Kendi
    // adımla-uyumlu, benzersiz tutarımızı her zaman elle yazıyoruz. `amount`
    // kolonu numeric(14,2) — 10^12'yi asla aşmamalı (saniye epoch'unu doğrudan
    // 1000'le çarpmak bu sınırı kolayca deler, dikkat).
    const amount = 3_000_001 + (Math.floor(Date.now() / 1000) % 1000) * 1000;
    await dialog.locator("#offer-amount").fill(String(amount));

    await dialog.getByRole("button", { name: /Teklif oluştur/ }).click();
    // Sunucu hatası oluşursa dialog kapanmadan mesaj gösterir — ham 15sn'lik
    // timeout yerine gerçek hatayı raporla (createOffer'ın döndürebileceği
    // 3 hata metninden biri).
    const inlineError = dialog.getByText(/Teklif kaydedilemedi|Portföy seçimi zorunludur|Geçerli bir teklif tutarı/);
    await expect(dialog).toBeHidden({ timeout: 15_000 }).catch(async () => {
      const errText = await inlineError.textContent().catch(() => null);
      if (errText) throw new Error(`createOffer sunucu hatası döndürdü: "${errText}"`);
      throw new Error("Dialog 15sn içinde kapanmadı ve görünür bir hata mesajı yok.");
    });

    await page.goto("/app/teklifler");
    // Satır etiketi seçilen portföyün başlığı VEYA kodu olabilir (property_label
    // = title ?? property_code) — hangisi olduğu tahmin edilemez. Zaman tabanlı
    // tutar zaten pratikte benzersiz; tabloda onu bulmak yeterli kanıt.
    const amountText = new Intl.NumberFormat("tr-TR", {
      style: "currency",
      currency: "TRY",
      maximumFractionDigits: 0,
    }).format(amount);
    const row = page.locator("tr", { hasText: amountText }).first();
    await expect(row).toBeVisible({ timeout: 30_000 });
  });
});

test.describe("Sozlesme e-imza uctan uca (/app/sozlesmeler -> /imza/[token])", () => {
  test("sozlesme olusur, imzalayan eklenir, link kopyalanir; public imza sayfasinda imzalanir", async ({
    page,
    context,
    browser,
  }) => {
    test.slow(); // dialog + server action + ikinci context — dev derlemesiyle uzun sürebilir

    const title = `E2E Sözleşme ${Date.now()}`;

    await page.goto("/app/sozlesmeler");
    await expectAppShell(page);

    const newBtn = page.getByRole("button", { name: /Yeni sözleşme/ }).first();
    const dialog = page.getByRole("dialog");
    await clickUntilVisible(newBtn, dialog);

    // Ofis şablonu varsa önce galeri gösterilir — boş sözleşmeyle devam et.
    const blankBtn = dialog.getByRole("button", { name: "Boş sözleşme" });
    if (await blankBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await blankBtn.click();
    }

    await dialog.locator("#sozl-title").fill(title);
    await dialog.locator("#sozl-body").fill("E2E test sözleşme içeriği. Madde 1: test amaçlıdır.");
    await dialog.getByRole("button", { name: /Sözleşme oluştur/ }).click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });

    const rowLink = page.getByRole("link", { name: `${title} detayları` }).first();
    if (!(await rowLink.isVisible({ timeout: 5000 }).catch(() => false))) {
      await page.goto("/app/sozlesmeler");
    }
    await expect(rowLink).toBeVisible({ timeout: 30_000 });
    await rowLink.click();
    await expect(page).toHaveURL(/\/app\/sozlesmeler\/[0-9a-f-]+/, { timeout: 30_000 });

    // İmzalayan ekle — telefon/e-posta boş bırakılır: SMS gönderilmez, OTP
    // gerekmez (signContractByToken yalnız signer.phone doluysa SMS ister).
    await page.locator('input[placeholder="Ad Soyad *"]').fill("E2E İmzalayan");
    await page.getByRole("button", { name: /İmzaya gönder/ }).click();
    await expect(page.getByText(/Sözleşme imzalamaya gönderildi/)).toBeVisible({ timeout: 15_000 });

    // İmza linki yalnız panoya kopyalanıyor (token DOM'da görünmüyor) —
    // clipboard izni gerekir (chromium projesi).
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.getByRole("button", { name: "İmza linkini kopyala" }).click();
    const signUrl = await page.evaluate(() => navigator.clipboard.readText());
    expect(signUrl).toMatch(/\/imza\/[0-9a-f-]+$/);

    // ── Public taraf: auth'SUZ yeni context (storageState taşınmaz) ──────────
    const anonContext = await browser.newContext();
    try {
      const pub = await anonContext.newPage();
      await pub.goto(signUrl);

      await expect(pub.getByRole("heading", { name: title })).toBeVisible({ timeout: 30_000 });
      const consent = pub.locator('input[name="consent"]');
      await expect(consent).toBeVisible({ timeout: 15_000 });
      await consent.check();
      await pub.getByRole("button", { name: /Sözleşmeyi imzala/ }).click();
      // İki eşdeğer başarı hâli: istemcinin kendi "İmzanız alındı" geçiş durumu
      // YA DA server action'ın revalidatePath'iyle tetiklenen sayfa yenilemesi
      // "zaten imzaladınız" (alreadySigned) dalını göstermeyi yetiştirebilir —
      // hangisi önce commit ederse. İkisi de imzanın kalıcı olduğunu kanıtlar.
      await expect(
        pub.getByText(/İmzanız alındı|Bu sözleşmeyi zaten imzaladınız/),
      ).toBeVisible({ timeout: 15_000 });
    } finally {
      await anonContext.close();
    }

    // ── Kalıcı doğrulama: panelde imzalayan "İmzaladı" durumuna geçer ──────────
    await page.reload();
    await expect(page.getByText("İmzaladı")).toBeVisible({ timeout: 30_000 });
  });
});
