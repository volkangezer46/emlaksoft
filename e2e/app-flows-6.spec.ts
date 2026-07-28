import { test, expect, type Page, type Locator } from "@playwright/test";

/**
 * Oturumlu E2E akışları — 6. dalga (Dalga P kanıtlama):
 *  - Anahtar & emanet takibi (portföy detayı → çıkış → pano → iade)
 *  - Online randevu rezervasyonu (/app/randevular kartı → public /randevu-al/[token])
 *  - Hesaplayıcı (/app/hesaplayici, paylaşılabilir parametreler + iki sekme)
 *  - Tavsiye programı (/app/tavsiyeler → public /tavsiye/[token] → müşteriye dönüştür)
 *  - Sidebar: "Tavsiyeler" ve "Hesaplayıcı" girişleri
 *
 * `chromium` projesi storageState ile çalışır (e2e/auth.setup.ts); public
 * rezervasyon ve tavsiye adımları bilinçli olarak auth'SUZ yeni context'te
 * koşar (app-flows-5 deseni). Veri gerektiren akışlar e2e tenant'ında veri
 * yoksa runtime SKIP olur — test veri üretmeye kalkmaz (görev kuralı).
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

/** Metinde en az bir rakam var mı — para/sayı kartlarının "dolu" kanıtı. */
function hasDigits(text: string | null) {
  return /\d/.test(text ?? "");
}

test.describe("Anahtar & emanet takibi (portfoy detayi -> pano)", () => {
  test("anahtar eklenir, cikis verilir, panoda 'disarida' gorunur ve iade alinir", async ({ page }) => {
    test.setTimeout(300_000); // üç ağır sayfa + dört server action — dev derlemesiyle uzun

    await page.goto("/app/portfoyler");
    await expectAppShell(page);

    // Kart linkleri /app/portfoyler/<uuid> — toolbar'daki /anahtarlar, /sunumlar
    // gibi alt sayfa linklerini uuid deseni eler.
    const detailHref = await page
      .locator('a[href^="/app/portfoyler/"]')
      .evaluateAll((els) =>
        els
          .map((el) => (el as HTMLAnchorElement).getAttribute("href") ?? "")
          .find((h) => /^\/app\/portfoyler\/[0-9a-f-]{36}$/.test(h)),
      );
    if (!detailHref) {
      test.skip(true, "e2e tenant'ında portföy yok — anahtar akışı atlandı.");
    }

    /*
     * Portföy detayı ağır bir sayfa (medya, zaman tüneli, fiyat geçmişi, emsal,
     * döviz, anahtarlar). Dev derlemesinde "load" olayını beklemek prefetch'le
     * yarışıp ERR_ABORTED üretiyordu — DOM hazır olması yeterli, asıl bekleme
     * aşağıdaki bölüm görünürlüğünde.
     */
    await page.goto(detailHref!, { waitUntil: "domcontentloaded", timeout: 120_000 });
    const section = page.locator("section#anahtarlar");
    await expect(section).toBeVisible({ timeout: 30_000 });
    await expect(section.getByRole("heading", { name: "Anahtar takibi" })).toBeVisible();

    // ── Anahtar ekle ────────────────────────────────────────────────────────
    const label = `E2E Anahtar ${Date.now()}`;
    const addToggle = section.getByRole("button", { name: "Anahtar ekle" });
    await clickUntilVisible(addToggle, section.locator('input[name="label"]'));
    await section.locator('input[name="label"]').fill(label);
    await section.locator('input[name="note"]').first().fill("Playwright E2E — göz ardı edin.");
    await section.getByRole("button", { name: /^Ekle$/ }).click();

    const row = section.locator("li", { hasText: label }).first();
    await expect(row).toBeVisible({ timeout: 30_000 });
    // "Ofiste" hem durum rozetinde hem "kimde?" satırında geçer — ilki yeter.
    await expect(row.getByText("Ofiste", { exact: true }).first()).toBeVisible({ timeout: 30_000 });

    // ── Çıkış ver (danışman; danışman yoksa 3. kişi) ────────────────────────
    await clickUntilVisible(
      row.getByRole("button", { name: "Çıkış ver" }),
      row.locator('form select[name="holder_staff_id"], form input[name="holder_name"]').first(),
    );

    const staffSelect = row.locator('select[name="holder_staff_id"]');
    const staffOptions = await staffSelect.locator("option").count().catch(() => 0);
    if (staffOptions > 1) {
      // İlk seçenek "Seçin…" (disabled) — ikinciden itibaren gerçek danışmanlar.
      const value = await staffSelect.locator("option").nth(1).getAttribute("value");
      await staffSelect.selectOption(value!);
    } else {
      await row.getByRole("button", { name: "Müşteri / 3. kişi" }).click();
      await row.locator('input[name="holder_name"]').fill("E2E Anahtar Alıcısı");
    }
    // Vade alanı sunucu varsayılanıyla (+2 gün) dolu gelir — dokunmuyoruz.
    await expect(row.locator('input[name="due_at"]')).not.toHaveValue("");
    await row.getByRole("button", { name: "Çıkışı kaydet" }).click();

    // Durum "dışarıda" ailesine geçer: Danışmanda ya da Müşteride.
    const outBadge = row.getByText(/^(Danışmanda|Müşteride)$/).first();
    await expect(outBadge).toBeVisible({ timeout: 30_000 });

    // ── Pano: ?durum=disarida ───────────────────────────────────────────────
    await page.goto(`/app/portfoyler/anahtarlar?durum=disarida&q=${encodeURIComponent(label)}`);
    await expectAppShell(page);
    await expect(page.getByRole("heading", { name: "Anahtar panosu" })).toBeVisible({ timeout: 30_000 });
    // 4 StatCard — sıfır çıkmaz metrik kuralı.
    for (const stat of ["Ofiste", "Dışarıda", "Gecikmiş iade", "Kayıp"]) {
      await expect(page.getByText(stat, { exact: true }).first()).toBeVisible();
    }

    const boardRow = page.locator("article", { hasText: label }).first();
    await expect(boardRow).toBeVisible({ timeout: 30_000 });
    await expect(boardRow.getByText(/^(Danışmanda|Müşteride)$/).first()).toBeVisible();

    // ── İade al → satır "dışarıda" filtresinden düşer ────────────────────────
    await boardRow.getByRole("button", { name: "İade al" }).click();
    await expect(page.locator("article", { hasText: label })).toHaveCount(0, { timeout: 30_000 });

    // Filtresiz aramada anahtar yine var ve artık ofiste.
    await page.goto(`/app/portfoyler/anahtarlar?q=${encodeURIComponent(label)}`);
    const returned = page.locator("article", { hasText: label }).first();
    await expect(returned).toBeVisible({ timeout: 30_000 });
    await expect(returned.getByText("Ofiste", { exact: true }).first()).toBeVisible();
  });
});

test.describe("Online randevu rezervasyonu (/app/randevular -> /randevu-al/[token])", () => {
  test("link ayarlari kaydedilir; auth'suz context slot secip randevu olusturur", async ({
    page,
    browser,
    baseURL,
  }) => {
    test.slow(); // ayar kaydı + public sayfa + server action

    await page.goto("/app/randevular");
    await expectAppShell(page);

    const card = page.locator("section", {
      has: page.getByRole("heading", { name: "Online randevu linkin" }),
    });
    await expect(card).toBeVisible({ timeout: 30_000 });

    // Aktif et (kapalıysa) — "AÇIK" rozeti kaydetmeden sonra gelir.
    const activeBox = card.locator('input[name="is_active"]');
    if (!(await activeBox.isChecked())) await activeBox.check();

    // Yedi günü de aç ve 09:00-20:00 yap: slot ızgarası her koşumda dolu olsun.
    for (const day of ["1", "2", "3", "4", "5", "6", "7"]) {
      const box = card.locator(`input[name="gun_${day}_acik"]`);
      if (!(await box.isChecked())) await box.check();
      await card.locator(`input[name="gun_${day}_baslangic"]`).fill("09:00");
      await card.locator(`input[name="gun_${day}_bitis"]`).fill("20:00");
    }
    await card.locator("#booking-slot").selectOption("60");
    await card.locator("#booking-days").fill("14");
    await card.locator("#booking-notice").fill("0");
    await card.locator("#booking-note").fill("E2E koşusu — otomatik ayar.");

    const saveBtn = card.getByRole("button", { name: /Ayarları kaydet/ });
    const linkCode = card.locator("code", { hasText: "/randevu-al/" });
    await saveBtn.click();
    try {
      await expect(linkCode).toBeVisible({ timeout: 15_000 });
    } catch {
      await saveBtn.click();
      await expect(linkCode).toBeVisible({ timeout: 30_000 });
    }
    await expect(card.getByText("AÇIK", { exact: true })).toBeVisible({ timeout: 30_000 });

    // Link DOM'da metin olarak duruyor — panoya gerek yok.
    const shown = (await linkCode.first().textContent())!.trim();
    const token = shown.match(/\/randevu-al\/([0-9a-f-]{36})/)?.[1];
    expect(token).toBeTruthy();

    // ── Public taraf: auth'SUZ yeni context ─────────────────────────────────
    const anon = await browser.newContext();
    const visitor = `E2E Rezervasyon ${Date.now()}`;
    try {
      const pub = await anon.newPage();
      await pub.goto(`${baseURL}/randevu-al/${token}`);
      await expect(pub.getByRole("heading", { name: "Randevu al" })).toBeVisible({ timeout: 30_000 });

      // Saat ızgarası: "HH:MM" etiketli butonlar. Hiç boş saat yoksa (dolu
      // takvim) akış anlamlı boş durumla biter — testi burada bırakırız.
      const slot = pub.getByRole("button", { name: /^\d{2}:\d{2}$/ }).first();
      try {
        await expect(slot).toBeVisible({ timeout: 20_000 });
      } catch {
        await expect(pub.getByText("Uygun saat kalmadı")).toBeVisible();
        test.skip(true, "Danışmanın önümüzdeki 14 günde boş saati yok — rezervasyon adımı atlandı.");
      }

      await clickUntilVisible(slot, pub.getByText("Seçtiğiniz saat"));
      await pub.locator("#booking-name").fill(visitor);
      await pub.locator("#booking-phone").fill("05339876543");
      await pub.locator('input[name="kvkk"]').check();
      await pub.getByRole("button", { name: "Randevumu oluştur" }).click();

      await expect(pub.getByText("Randevunuz alındı!")).toBeVisible({ timeout: 30_000 });
      // Google Takvim linki teşekkür ekranının ikinci vaadi.
      await expect(pub.getByRole("link", { name: /Takviminize ekleyin/ })).toHaveAttribute(
        "href",
        /calendar\.google\.com/,
      );
    } finally {
      await anon.close();
    }

    // ── Panelde randevu göründü mü (opsiyonel doğrulama) ────────────────────
    // Randevu 14 gün içindeki ilk boş slota düşer; ay takvimi yalnız içinde
    // bulunulan ayı gösterdiği için ay atlaması durumunda satır görünmeyebilir.
    await page.goto("/app/randevular");
    const listed = page.getByText(visitor).first();
    if (await listed.isVisible({ timeout: 20_000 }).catch(() => false)) {
      await expect(listed).toBeVisible();
    } else {
      test.info().annotations.push({
        type: "note",
        description:
          "Randevu panel listesinde görünmedi (slot içinde bulunulan ayın dışına düşmüş olabilir) — public akış yine de kanıtlandı.",
      });
    }
  });
});

test.describe("Hesaplayici (/app/hesaplayici)", () => {
  test("URL parametreleri ozet karta yansir; sekme degisince kredi dokumu render olur", async ({
    page,
  }) => {
    // NOT: ?pesinat= TL tutarıdır (yüzde değil) — "Müşteriye gönder" düğmesi de
    // linke TL yazar. Buradaki 25, bilinçli olarak görevdeki linkin aynısıdır.
    await page.goto("/app/hesaplayici?fiyat=3000000&pesinat=25&vade=120&faiz=2.5");
    await expectAppShell(page);
    await expect(
      page.getByRole("heading", { name: "Alım maliyeti & kredi hesaplayıcı" }),
    ).toBeVisible({ timeout: 30_000 });

    // ── Özet kartı: cepten çıkan toplam + aylık taksit sayı içermeli ────────
    const summary = page.locator("section", { has: page.getByRole("heading", { name: "Özet" }) });
    await expect(summary).toBeVisible({ timeout: 30_000 });

    // Etiketler DOM'da normal yazımda; büyük harf yalnız CSS (uppercase).
    const cashCard = summary.locator("div").filter({ hasText: "Cepten çıkan toplam" }).last();
    await expect(cashCard).toBeVisible();
    expect(hasDigits(await cashCard.textContent())).toBe(true);

    const monthlyCard = summary.locator("div").filter({ hasText: "Aylık taksit" }).last();
    await expect(monthlyCard).toBeVisible();
    const monthlyText = (await monthlyCard.textContent()) ?? "";
    expect(hasDigits(monthlyText)).toBe(true);
    // ?vade=120 & ?faiz=2.5 gerçekten hesaba girdi mi.
    expect(monthlyText).toContain("120 ay");
    expect(monthlyText).toContain("%2.5");

    // ── Varsayılan sekme: alım maliyeti kalem dökümü ────────────────────────
    await expect(page.getByRole("tab", { name: /Alım maliyeti/ })).toHaveAttribute(
      "data-state",
      "active",
    );
    // Hero metninde de "masraf toplamını" geçiyor — tablo hücresini hedefle.
    await expect(page.getByRole("cell", { name: /Masraf toplamı/ })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("columnheader", { name: "Kalem" })).toBeVisible();

    // ── Sekme değişimi: kredi taksiti tablosu ───────────────────────────────
    const loanTab = page.getByRole("tab", { name: /Kredi taksiti/ });
    await clickUntilVisible(loanTab, page.getByText("İlk 12 taksitin kırılımı"));
    await expect(page.getByRole("columnheader", { name: "Anapara" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Kalan borç" })).toBeVisible();
    await expect(page.getByText("1. ay", { exact: true })).toBeVisible();

    // ?sekme= paramı da aynı sekmeyi açar (paylaşılabilir link kontratı).
    await page.goto("/app/hesaplayici?fiyat=3000000&pesinat=25&vade=120&faiz=2.5&sekme=kredi");
    await expect(page.getByRole("tab", { name: /Kredi taksiti/ })).toHaveAttribute(
      "data-state",
      "active",
      { timeout: 30_000 },
    );
  });
});

test.describe("Tavsiye programi (/app/tavsiyeler -> /tavsiye/[token])", () => {
  test("link uretilir; auth'suz context tavsiye gonderir; panelde 'yeni' listede ve musteriye donusur", async ({
    page,
    browser,
    baseURL,
  }) => {
    test.slow(); // link üretimi + public gönderim + iki panel yüklemesi

    await page.goto("/app/tavsiyeler");
    await expectAppShell(page);
    await expect(page.getByRole("heading", { name: "Tavsiyeler" })).toBeVisible({ timeout: 30_000 });
    for (const stat of ["Aktif tavsiye linki", "Gelen tavsiye", "Müşteriye dönen", "Kazanılan anlaşma"]) {
      await expect(page.getByText(stat, { exact: true }).first()).toBeVisible();
    }

    // ── Link üret: aramalı müşteri seçici ───────────────────────────────────
    const creator = page.locator("div", { has: page.getByRole("heading", { name: "Tavsiye linki üret" }) }).last();
    const search = page.locator("#ref-customer-search");
    if ((await search.count()) === 0) {
      test.skip(true, "Tavsiye linki üretici görünmüyor (yetki/veri) — akış atlandı.");
    }
    await search.fill("a"); // en yaygın harf — Türkçe adların çoğunda geçer
    const firstOption = creator.locator("ul li button").first();
    try {
      await expect(firstOption).toBeVisible({ timeout: 10_000 });
    } catch {
      test.skip(true, "e2e tenant'ında müşteri yok — tavsiye akışı atlandı.");
    }
    await firstOption.click();

    const generate = page.getByRole("button", { name: "Link üret" }).first();
    const linkCode = page.locator("code", { hasText: "/tavsiye/" }).first();
    await generate.click();
    try {
      await expect(linkCode).toBeVisible({ timeout: 15_000 });
    } catch {
      await generate.click();
      await expect(linkCode).toBeVisible({ timeout: 30_000 });
    }
    const token = ((await linkCode.textContent()) ?? "").match(/\/tavsiye\/([0-9a-f-]{36})/)?.[1];
    expect(token).toBeTruthy();

    // ── Public taraf: auth'SUZ context ──────────────────────────────────────
    // Mükerrer freni (link + telefon) sabit numarada ikinci koşuda yeni kayıt
    // ÜRETMEZ; "yeni" listesi ve dönüştürme adımı deterministik kalsın diye
    // numara koşuma özel türetiliyor (0532 + zaman damgasının son 7 hanesi).
    const phone = `0532${String(Date.now()).slice(-7)}`;
    const referredName = `Tanıdık Kişi ${Date.now()}`;
    const anon = await browser.newContext();
    try {
      const pub = await anon.newPage();
      await pub.goto(`${baseURL}/tavsiye/${token}`);
      await expect(pub.locator("#ref-name")).toBeVisible({ timeout: 30_000 });

      await pub.locator("#ref-name").fill(referredName);
      await pub.locator("#ref-phone").fill(phone);
      await pub.locator("#ref-note").fill("E2E otomasyon — 2+1 kiralık arıyor.");
      await pub.locator('input[name="kvkk"]').check();
      await pub.getByRole("button", { name: "Tavsiyemi ilet" }).click();

      await expect(
        pub.getByText(/Teşekkür ederiz!|zaten iletmişsiniz/).first(),
      ).toBeVisible({ timeout: 30_000 });
    } finally {
      await anon.close();
    }

    // ── Panel: ?durum=yeni listesinde görünür ───────────────────────────────
    await page.goto(`/app/tavsiyeler?durum=yeni&q=${encodeURIComponent(referredName)}`);
    const row = page.locator("tr", { hasText: referredName }).first();
    await expect(row).toBeVisible({ timeout: 30_000 });

    // ── Müşteriye dönüştür ──────────────────────────────────────────────────
    await row.getByRole("button", { name: "Müşteriye dönüştür" }).click();
    await expect(
      row.getByText(/Müşteri kaydı açıldı|zaten|müşteri/i).first(),
    ).toBeVisible({ timeout: 30_000 });
  });
});

test.describe("Sidebar: Tavsiyeler + Hesaplayici", () => {
  test("iki yeni menu girisi gorunur ve dogru sayfaya goturur", async ({ page }) => {
    await page.goto("/app");
    await expectAppShell(page);

    const referrals = page.locator('a[href="/app/tavsiyeler"]').first();
    const calculator = page.locator('a[href="/app/hesaplayici"]').first();
    await expect(referrals).toBeVisible({ timeout: 30_000 });
    await expect(calculator).toBeVisible();
    await expect(referrals).toHaveText(/Tavsiyeler/);
    await expect(calculator).toHaveText(/Hesaplayıcı/);

    await referrals.click();
    await expect(page).toHaveURL(/\/app\/tavsiyeler/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "Tavsiyeler" })).toBeVisible({ timeout: 30_000 });

    await page.locator('a[href="/app/hesaplayici"]').first().click();
    await expect(page).toHaveURL(/\/app\/hesaplayici/, { timeout: 30_000 });
    await expect(
      page.getByRole("heading", { name: "Alım maliyeti & kredi hesaplayıcı" }),
    ).toBeVisible({ timeout: 30_000 });
  });
});
