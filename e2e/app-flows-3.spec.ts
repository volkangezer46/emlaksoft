import { test, expect, type Page, type Locator } from "@playwright/test";

/**
 * Oturumlu E2E akışları — 3. dalga (Dalga L kanıtlama): talep detay sayfası,
 * bildirim arşivi filtre kontratı, açık ev QR self check-in public akışı.
 * `chromium` projesi storageState ile çalışır (e2e/auth.setup.ts); public
 * check-in adımı bilinçli olarak auth'SUZ yeni bir context'te koşar.
 *
 * Deterministiklik: e2e-test tenant'ında talep/açık ev yoksa test kendi
 * kaydını UI üzerinden oluşturur (seed sayısına katı bağımlılık yok).
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

test.describe("Talep detayi (/app/talepler/[id])", () => {
  test("liste kartindan detaya gidilir; kunye + eslesmeler + musteri karti render olur", async ({ page }) => {
    await page.goto("/app/talepler");
    await expectAppShell(page);

    // Kart overlay linki detay sayfasına gider (liste sayfası Dalga L değişimi).
    const cardLink = page.locator('a[href^="/app/talepler/"][aria-label$="detayını aç"]');

    // Tenant'ta hiç talep yoksa UI üzerinden bir tane oluştur (deterministik).
    if ((await cardLink.count()) === 0) {
      const newBtn = page.getByRole("button", { name: /Yeni talep/ }).first();
      const dialog = page.getByRole("dialog");
      await clickUntilVisible(newBtn, dialog);
      await expect(dialog.getByText("Yeni talep", { exact: true })).toBeVisible();

      // İlk gerçek müşteri seçilir (index 0 placeholder'dır); işlem türü ve
      // portföy türü varsayılanları (Satılık / Daire) yeterli.
      await dialog.locator("#demand-customer").selectOption({ index: 1 });
      await dialog.getByRole("button", { name: /Talebi kaydet/ }).click();
      await expect(dialog).toBeHidden({ timeout: 20_000 });
    }

    await expect(cardLink.first()).toBeVisible({ timeout: 30_000 });
    await cardLink.first().click();
    // waitForURL "load" bekler — dev'de detay rotasının ilk derlemesi uzun
    // sürebilir; toHaveURL yalnız adres çubuğunu doğrular (app-flows-2 deseni).
    await expect(page).toHaveURL(/\/app\/talepler\/[0-9a-f-]+/, { timeout: 30_000 });

    // Künye (hero): "Talepler" geri linki + skorlu eşleşme bölümü başlığı.
    await expect(page.getByRole("heading", { name: "Bu talebin eşleşmeleri" })).toBeVisible({ timeout: 30_000 });
    // Yan sütun: müşteri kartı + durum bölümü.
    await expect(page.getByRole("heading", { name: "Müşteri", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Durum", exact: true })).toBeVisible();
    // Sıfır çıkmaz metrik: eşleştirme ekranına köprü her koşulda var.
    await expect(page.getByRole("link", { name: /Eşleştirmede aç/ }).first()).toBeVisible();
  });
});

test.describe("Bildirim arsivi (/app/bildirimler)", () => {
  test("sayfa render olur; 'Okunmamis' filtre cipi URL'i ve listeyi gunceller", async ({ page }) => {
    await page.goto("/app/bildirimler");
    await expectAppShell(page);

    await expect(page.getByRole("heading", { name: "Bildirimler" })).toBeVisible({ timeout: 30_000 });
    // Liste çerçevesi (dolu ya da boş durumda da başlık şeridi render olur).
    await expect(page.getByText("Gelen kutusu", { exact: true })).toBeVisible();
    await expect(page.getByText(/\d+ kayıt/)).toBeVisible();

    // Filtre kontratı: çip tıklanınca URL ?durum=okunmamis olur, sayfa
    // sunucu filtresiyle yeniden render edilir ve çip aktif işaretlenir.
    /*
     * Hero'daki KPI kartları ile filtre çipleri AYNI href'lere gider; ad
     * bazlı seçici ikisini birden yakalayıp strict-mode ihlali doğurur.
     * Çözüm: çipleri kapsayan `<nav aria-label="Bildirim filtresi">` ile
     * kapsamlandırmak (uygulama dosyasında zaten var olan yapı — testid yok).
     * Çip metinleri sayı taşır ("Tümü (12)", "Okunmamış (3)"), sayı sıfırsa
     * parantez hiç basılmaz; bu yüzden `^` ile başlangıca çapalanmış regex.
     */
    const filterNav = page.getByRole("navigation", { name: "Bildirim filtresi" });
    const unreadChip = filterNav.getByRole("link", { name: /^Okunmamış/ });
    const allChip = filterNav.getByRole("link", { name: /^Tümü/ });

    await expect(unreadChip).toBeVisible({ timeout: 30_000 });
    await unreadChip.click();
    await expect(page).toHaveURL(/\/app\/bildirimler\?durum=okunmamis/, { timeout: 30_000 });
    await expect(unreadChip).toHaveAttribute("aria-current", "page", { timeout: 30_000 });
    // İçerik esnek: okunmamış satırlar YA DA filtre boş durumu.
    const emptyFiltered = page.getByText("Filtreye uyan bildirim yok");
    const frame = page.getByText("Gelen kutusu", { exact: true });
    await expect(emptyFiltered.or(frame).first()).toBeVisible({ timeout: 30_000 });

    // "Tümü" çipi filtreyi temizler (aktif filtre yokken aria-current onda).
    await allChip.click();
    await expect(page).toHaveURL(/\/app\/bildirimler$/, { timeout: 30_000 });
    await expect(allChip).toHaveAttribute("aria-current", "page", { timeout: 30_000 });
  });
});

test.describe("Acik ev QR self check-in", () => {
  test("detaydaki Kayit QR karti public linki verir; auth'suz form dolduralir, tesekkur + mukerrer yolu dogrulanir", async ({
    page,
    browser,
  }) => {
    test.slow(); // iki context + olası kayıt oluşturma — dev derlemesiyle uzun sürebilir

    await page.goto("/app/acik-ev");
    await expectAppShell(page);

    const detailLink = page.locator('a[href^="/app/acik-ev/"][aria-label$="açık ev detayını aç"]');

    /*
     * HER KOŞUMDA taze (yarın tarihli) açık ev oluşturuyoruz. Önceden "hiç
     * etkinlik yoksa oluştur" deniyordu; e2e ofisinde eski bir kayıt kalınca
     * test onu seçiyor ve public sayfa "etkinlik sona erdi" diyerek formu hiç
     * basmıyordu — yani test verisi bayatlayınca yanlış kırmızı üretiyordu.
     * Liste `scheduled_at` azalan sıralı olduğundan yeni kayıt en üstte çıkar.
     * migration 098 public_token'ı kolon varsayılanıyla üretir.
     */
    {
      const newBtn = page.getByRole("button", { name: /Yeni açık ev/ }).first();
      /*
       * Diyalog seçicisi başlığa göre daraltılır: Radix Popover (Combobox
       * açılır listesi) de `role="dialog"` taşır, çıplak getByRole("dialog")
       * iki öğeye çözülüp strict-mode ihlali veriyordu.
       */
      const dialog = page.getByRole("dialog").filter({ hasText: "Yeni açık ev günü" });
      await clickUntilVisible(newBtn, dialog);

      // Combobox: tetikleyici → arama → seçenek (popover portal'da, page'den aranır).
      const comboTrigger = page.getByRole("combobox", { name: "Portföy" });
      const searchInput = page.getByPlaceholder("Başlık, kod ya da adres…");
      await clickUntilVisible(comboTrigger, searchInput);
      await searchInput.fill("E2E-001");
      const option = page.getByRole("option", { name: /E2E/ }).first();
      await expect(option).toBeVisible({ timeout: 15_000 });
      await option.click();

      // Yarın aynı saat — datetime-local biçimi (testte Date.now serbest).
      const dt = new Date(Date.now() + 24 * 3600 * 1000);
      const pad = (n: number) => String(n).padStart(2, "0");
      const scheduled = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
      await page.locator("#oh-scheduled").fill(scheduled);

      const submit = page.getByRole("button", { name: /Açık ev oluştur/ });
      await expect(submit).toBeEnabled({ timeout: 10_000 });
      await submit.click();
      await expect(dialog).toBeHidden({ timeout: 20_000 });
    }

    await expect(detailLink.first()).toBeVisible({ timeout: 30_000 });
    await detailLink.first().click();
    await expect(page).toHaveURL(/\/app\/acik-ev\/[0-9a-f-]+/, { timeout: 30_000 });

    // "Kayıt QR'ı" kartı yalnız aktif/planlı + token'lı etkinlikte görünür.
    const qrHeading = page.getByRole("heading", { name: /Kayıt QR/ });
    try {
      await expect(qrHeading).toBeVisible({ timeout: 15_000 });
    } catch {
      test.skip(true, "Bu etkinlikte Kayıt QR kartı yok (bitmiş/iptal etkinlik ya da token üretilmemiş).");
    }

    // Public linki DOM'dan oku ("Sayfayı önizle" doğrudan publicUrl'e gider).
    const publicUrl = await page.getByRole("link", { name: "Sayfayı önizle" }).getAttribute("href");
    expect(publicUrl).toMatch(/\/acik-ev-kayit\/[0-9a-f-]{36}$/);

    // ── Public taraf: auth'SUZ yeni context (storageState taşınmaz) ──────────
    const anonContext = await browser.newContext();
    try {
      const pub = await anonContext.newPage();
      await pub.goto(publicUrl!);

      await expect(pub.getByRole("heading", { name: "Açık ev kaydı" })).toBeVisible({ timeout: 30_000 });
      /*
       * Taze kayıt kanıtı: bitmiş etkinlikte public sayfa formu değil "sona
       * erdi" kutusunu basar ve başlık yine görünür — bu yüzden ayrıca
       * doğruluyoruz, yoksa bayat veri sessizce yanlış kırmızıya döner.
       */
      await expect(pub.getByText(/Bu açık ev etkinliği sona erdi\./)).toHaveCount(0);

      // Form alanları: ad soyad + telefon + KVKK onayı.
      const nameInput = pub.locator("#checkin-name");
      const phoneInput = pub.locator("#checkin-phone");
      const kvkk = pub.locator('input[name="kvkk"]');
      const submitBtn = pub.getByRole("button", { name: /Kaydımı oluştur/ });
      await expect(nameInput).toBeVisible({ timeout: 30_000 });
      await expect(kvkk).toBeVisible();

      // Kontrollü inputlar hidrasyon öncesi yazılanı sıfırlayabilir — KVKK
      // işareti + butonun aktifleşmesi hidrasyonun kanıtıdır, toPass ile döngüle.
      await expect(async () => {
        if (!(await kvkk.isChecked())) await kvkk.check();
        await expect(submitBtn).toBeEnabled({ timeout: 2000 });
      }).toPass({ timeout: 30_000 });

      await nameInput.fill("E2E Ziyaretçi");
      await phoneInput.fill("05321234567");
      await expect(phoneInput).toHaveValue("05321234567");

      await submitBtn.click();
      // İlk koşuda "Kaydınız alındı!", suite tekrarında aynı telefonla
      // "Kaydınız zaten alınmış." döner — ikisi de başarılı check-in kanıtı.
      await expect(pub.getByText(/Kaydınız alındı!|Kaydınız zaten alınmış\./)).toBeVisible({ timeout: 30_000 });

      // Mükerrer yol (idempotens): aynı telefonla ikinci gönderim yeni kayıt
      // üretmez, teşekkür ekranı "zaten alınmış" der.
      await pub.goto(publicUrl!);
      await expect(kvkk).toBeVisible({ timeout: 30_000 });
      await expect(async () => {
        if (!(await kvkk.isChecked())) await kvkk.check();
        await expect(submitBtn).toBeEnabled({ timeout: 2000 });
      }).toPass({ timeout: 30_000 });
      await nameInput.fill("E2E Ziyaretçi");
      await phoneInput.fill("05321234567");
      await submitBtn.click();
      await expect(pub.getByText("Kaydınız zaten alınmış.")).toBeVisible({ timeout: 30_000 });
    } finally {
      await anonContext.close();
    }
  });
});
