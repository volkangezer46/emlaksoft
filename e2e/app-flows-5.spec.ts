import { test, expect, type Page, type Locator } from "@playwright/test";

/**
 * Oturumlu E2E akışları — 5. dalga (Dalga N kanıtlama):
 *  - Anlaşma evrak dosyası (şablondan oluştur + checkbox toggle + ilerleme)
 *  - Duyuru panosu uçtan uca (/app/ayarlar/duyurular → dashboard bandı → Okudum)
 *  - NPS anketi uçtan uca (/app/raporlar/memnuniyet → public /anket/[token])
 *  - Günün rotası görünümü (/app/randevular?gorunum=rota)
 *  - Vitrin v2: favori kalbi + /vitrin/demo-ofis/favoriler + fiyat alarmı formu
 *
 * `chromium` projesi storageState ile çalışır (e2e/auth.setup.ts); public anket
 * ve vitrin adımları bilinçli olarak auth'SUZ yeni context'te koşar
 * (app-flows-4 sunum deseni). Veri gerektiren akışlar e2e tenant'ında veri
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

test.describe("Anlasma evrak dosyasi (/app/anlasmalar/[id])", () => {
  test("sablondan liste olusur; checkbox toggle ilerleme metnini degistirir", async ({ page }) => {
    test.slow(); // detay sayfası + server action + router.refresh — dev derlemesiyle uzun

    await page.goto("/app/anlasmalar");
    await expectAppShell(page);

    // Kanban kartlarının örtü linki: aria-label "... detayını aç" (deal-board.tsx).
    const cardLink = page.locator('a[aria-label$="detayını aç"]').first();
    try {
      await expect(cardLink).toBeVisible({ timeout: 15_000 });
    } catch {
      test.skip(true, "e2e tenant'ında hiç anlaşma yok — evrak dosyası akışı atlandı.");
    }
    const href = await cardLink.getAttribute("href");
    await page.goto(href!);

    const section = page.locator("section", {
      has: page.getByRole("heading", { name: "Evrak dosyası" }),
    });
    await expect(section).toBeVisible({ timeout: 30_000 });

    // Boş durumda şablonla başlat — dolu durumda (tekrar koşum) doğrudan toggle.
    const templateBtn = section.getByRole("button", { name: /Şablondan oluştur/ });
    if ((await templateBtn.count()) > 0) {
      await templateBtn.click();
      // Şablon maddeleri gelir (satılık/kiralık listesi "Zorunlu" rozetli maddeler içerir).
      await expect(section.locator("li").first()).toBeVisible({ timeout: 30_000 });
    }

    await expect(section.getByText("Zorunlu", { exact: true }).first()).toBeVisible({ timeout: 30_000 });

    // İlerleme metni: "X/Y zorunlu evrak tamam" — yalnız zorunlulardan hesaplanır.
    const progress = section.getByText(/\d+\/\d+ zorunlu evrak tamam/);
    await expect(progress).toBeVisible({ timeout: 30_000 });
    const before = (await progress.textContent())!.trim();

    // İlk ZORUNLU maddenin checkbox'ını toggle'la → sayaç değişmek zorunda
    // (işaretli → geri alınır, işaretsiz → tamamlanır; iki yönde de X değişir).
    const requiredItem = section
      .locator("li", { has: page.getByText("Zorunlu", { exact: true }) })
      .first();
    await requiredItem.locator('button[aria-label*="tamamlandı"]').click();
    await expect(progress).not.toHaveText(before, { timeout: 30_000 });
  });
});

test.describe("Duyuru panosu uctan uca (/app/ayarlar/duyurular -> dashboard bandi)", () => {
  test("yeni duyuru yayinlanir; dashboard bandinda gorunur; Okudum ile okundu durumuna gecer", async ({
    page,
  }) => {
    test.slow(); // iki sayfa + iki server action

    const title = `E2E Duyuru ${Date.now()}`;

    await page.goto("/app/ayarlar/duyurular");
    await expectAppShell(page);
    await expect(page.getByRole("heading", { name: "Yeni duyuru" })).toBeVisible({ timeout: 30_000 });

    await page.locator("#ann-title").fill(title);
    await page.locator("#ann-body").fill("Playwright E2E koşusundan otomatik duyuru — göz ardı edin.");
    // Yayın bitişi ~2 saat: eski koşuların duyuruları bantta sonsuza dek birikmesin.
    const ends = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const pad = (n: number) => String(n).padStart(2, "0");
    await page
      .locator("#ann-ends")
      .fill(
        `${ends.getFullYear()}-${pad(ends.getMonth() + 1)}-${pad(ends.getDate())}T${pad(ends.getHours())}:${pad(ends.getMinutes())}`,
      );
    // Başarıda form resetlenir + liste tazelenir — duyuru "Yayınlanan duyurular"da.
    // Hidrasyon-retry: ilk tıklama React bağlanmadan düşebilir (clickUntilVisible
    // deseni); ikinci tıklamada form hâlâ doluysa gönderim tekrarlanır.
    const publishBtn = page.getByRole("button", { name: "Duyuruyu yayınla" });
    const listed = page.getByText(title).first();
    await publishBtn.click();
    try {
      await expect(listed).toBeVisible({ timeout: 10_000 });
    } catch {
      await publishBtn.click();
      await expect(listed).toBeVisible({ timeout: 30_000 });
    }

    // ── Dashboard bandı ──────────────────────────────────────────────────────
    await page.goto("/app");
    await expectAppShell(page);
    await expect(page.getByRole("heading", { name: "Ofis duyuruları" })).toBeVisible({ timeout: 30_000 });

    // Okunmamışlar önde gelir; yine de bant en fazla 2 satır açık gösterir —
    // satır görünmüyorsa "Tümünü göster" ile genişlet.
    let row = page.locator("li", { hasText: title }).first();
    if (!(await row.isVisible().catch(() => false))) {
      const summary = page.getByText(/Tümünü göster/);
      if ((await summary.count()) > 0) await summary.click();
      row = page.locator("li", { hasText: title }).first();
    }
    await expect(row).toBeVisible({ timeout: 30_000 });

    // "Okudum" → satır anında "Okundu" durumuna geçer (done state). Ardından
    // router.refresh bandı tazeler: satır okunmuşlar arasına düşer, hatta tüm
    // duyurular okunduysa band tamamen kaybolur ("sıfır gürültü" kuralı) —
    // üç sonuç da başarıdır.
    await row.getByRole("button", { name: "Okudum" }).click();
    await expect(async () => {
      const gone = (await row.count()) === 0 || !(await row.isVisible().catch(() => false));
      const okundu = await row
        .getByText("Okundu")
        .isVisible()
        .catch(() => false);
      expect(gone || okundu).toBe(true);
    }).toPass({ timeout: 30_000 });
  });
});

test.describe("NPS anketi uctan uca (/app/raporlar/memnuniyet -> /anket/[token])", () => {
  test("won anlasmadan anket uretilir; public sayfada 9 puan + tesekkur; ikinci acilis 'Yanitiniz alinmis'", async ({
    page,
    browser,
  }) => {
    test.slow(); // anket üretimi + auth'suz ikinci context + iki public yükleme

    await page.goto("/app/raporlar/memnuniyet");
    await expectAppShell(page);
    await expect(page.getByRole("heading", { name: "Müşteri memnuniyeti (NPS)" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole("heading", { name: "Anket oluştur" })).toBeVisible();
    // KPI kartları (sıfır çıkmaz metrik — hepsi tıklanabilir <a>).
    await expect(page.getByText("NPS skoru", { exact: true })).toBeVisible();
    await expect(page.getByText("Yanıt oranı", { exact: true })).toBeVisible();

    // Link DOM'da metin olarak durmaz — "Linki kopyala" panoya yazar. Panoyu
    // sayfa içinde yakalanabilir hale getir (headless'ta izin dansı gerekmez).
    await page.evaluate(() => {
      (window as unknown as { __copied: string | null }).__copied = null;
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (t: string) => {
            (window as unknown as { __copied: string | null }).__copied = t;
          },
        },
      });
    });

    // Tercih 1: anket bekleyen won anlaşmadan tek tık üretim.
    // Tercih 2 (tekrar koşum): "Bekleyen anketler" listesindeki mevcut link.
    const createBtn = page.getByRole("button", { name: "Anket oluştur" }).first();
    let copyBtn: Locator;
    if ((await createBtn.count()) > 0) {
      await createBtn.click();
      await expect(page.getByText("Anket hazır").first()).toBeVisible({ timeout: 30_000 });
      copyBtn = page.getByRole("button", { name: "Linki kopyala" }).first();
    } else {
      copyBtn = page.getByRole("button", { name: "Linki kopyala" }).first();
      if ((await copyBtn.count()) === 0) {
        test.skip(
          true,
          "e2e tenant'ında won anlaşma / bekleyen anket yok — NPS public akışı atlandı.",
        );
      }
    }

    await copyBtn.click();
    const surveyUrl = await page.evaluate(
      () => (window as unknown as { __copied: string | null }).__copied,
    );
    expect(surveyUrl).toMatch(/\/anket\/[0-9a-f-]{36}$/);

    // ── Public taraf: auth'SUZ yeni context, mobil genişlik (görev: 480px) ──
    const anonContext = await browser.newContext({ viewport: { width: 480, height: 900 } });
    try {
      const pub = await anonContext.newPage();
      await pub.goto(surveyUrl!);
      await expect(pub.getByRole("heading", { name: "Memnuniyet anketi" })).toBeVisible({
        timeout: 30_000,
      });

      // 0-10 puan butonları (radiogroup) — 9 destekleyen bandı (mint).
      const nine = pub.getByRole("radio", { name: "9", exact: true });
      await clickUntilVisible(nine, pub.locator('[role="radio"][aria-checked="true"]'));
      await pub.locator("#survey-comment").fill("E2E otomasyon yorumu — harika hizmet.");
      await pub.getByRole("button", { name: "Gönder" }).click();

      // Destekleyen teşekkür ekranı: tavsiye isteği metni.
      await expect(pub.getByText(/tavsiye eder misiniz/i)).toBeVisible({ timeout: 30_000 });

      // Linki tekrar aç → cevaplanmış anket kilitli ekranı.
      await pub.goto(surveyUrl!);
      await expect(pub.getByText("Yanıtınız alınmış.")).toBeVisible({ timeout: 30_000 });
    } finally {
      await anonContext.close();
    }
  });
});

test.describe("Gunun rotasi (/app/randevular?gorunum=rota)", () => {
  test("Rota sekmesi aktif; Bugun/Yarin cipleri gorunur; durak listesi veya bos durum render olur", async ({
    page,
  }) => {
    await page.goto("/app/randevular?gorunum=rota");
    await expectAppShell(page);

    // Görünüm sekmeleri: Ay/Hafta/Gün/Rota — Rota linki render (aktif stil sınıfsal).
    await expect(page.getByRole("link", { name: "Rota", exact: true })).toBeVisible({ timeout: 30_000 });
    // Gün seçici çipleri (rota-view.tsx).
    await expect(page.getByRole("link", { name: "Bugün", exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("link", { name: "Yarın", exact: true })).toBeVisible();

    // İçerik esnek: saat sıralı durak listesi YA DA anlamlı boş durum.
    const list = page.getByText("Günün rotası", { exact: true });
    const empty = page.getByText("Bugün randevun yok");
    await expect(list.or(empty).first()).toBeVisible({ timeout: 30_000 });

    // Duraklar varsa "Yol tarifi" butonu ve durak sayacı da beklenir.
    if (await list.isVisible().catch(() => false)) {
      await expect(page.getByText(/\d+ durak/).first()).toBeVisible();
    }
  });
});

test.describe("Vitrin v2 favori + fiyat alarmi (/vitrin/demo-ofis, auth'suz)", () => {
  test("kalp favori ekler (rozet 1); favoriler sayfasinda ilan listelenir; detayda fiyat alarmi formu", async ({
    browser,
    baseURL,
  }) => {
    test.slow(); // üç public sayfa — ISR/derleme ilk isabette yavaş olabilir

    // Vitrin tamamen public — storageState'siz taze context (localStorage boş
    // başlar: favori sayacı deterministik 1 olur).
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      const res = await page.goto(`${baseURL}/vitrin/demo-ofis`);
      if (!res || res.status() === 404) {
        test.skip(true, "demo-ofis vitrini yok (seed:demo koşulmamış) — vitrin akışı atlandı.");
      }

      // İlk kartın kalbi (hydration sonrası çıkar) — tıkla, favoriye alınsın.
      const heart = page.locator('button[aria-label="Favorilere ekle"]').first();
      try {
        await expect(heart).toBeVisible({ timeout: 30_000 });
      } catch {
        test.skip(true, "demo-ofis vitrininde yayında ilan yok — favori akışı atlandı.");
      }

      // Kalbin ait olduğu kartın ilan linkini (uuid) kaydet — favoriler
      // sayfasında aynı ilanın listelendiğini kanıtlamak için.
      const shell = heart.locator('xpath=ancestor::div[contains(@class, "relative")][1]');
      const cardHref = await shell
        .locator('a[href^="/vitrin/demo-ofis/"]')
        .first()
        .getAttribute("href");
      expect(cardHref).toMatch(/\/vitrin\/demo-ofis\/[0-9a-f-]{36}$/);

      await clickUntilVisible(heart, page.locator('button[aria-label="Favorilerden çıkar"]').first());
      // Hero şeridindeki "Favorilerim (1)" chip'i favori sayısını kanıtlar.
      await expect(page.getByRole("button", { name: "Favorilerim (1)" })).toBeVisible({ timeout: 15_000 });

      // ── Favoriler sayfası (localStorage aynı context'te taşınır) ──────────
      await page.goto(`${baseURL}/vitrin/demo-ofis/favoriler`);
      await expect(page.locator(`a[href="${cardHref}"]`)).toBeVisible({ timeout: 30_000 });

      // ── İlan detayı: fiyat alarmı formu ───────────────────────────────────
      await page.goto(`${baseURL}${cardHref}`);
      const alertHeading = page.getByRole("heading", { name: "Fiyat düşünce haber ver" });
      try {
        await expect(alertHeading).toBeVisible({ timeout: 30_000 });
      } catch {
        // Form yalnız fiyatı girilmiş ilanlarda render edilir — fiyatsız ilanda
        // detayın kendisi yüklendiyse akış geçerli sayılır.
        await expect(page.getByRole("link", { name: "Favorilerim" })).toBeVisible();
        test.info().annotations.push({
          type: "note",
          description: "Seçilen ilanda fiyat yok — fiyat alarmı formu bilinçli gizli.",
        });
        return;
      }

      // Gönderim: sabit test numarası (görev). Mükerrer freni ikinci koşuda
      // hata döndürebilir — başarı YA DA dostane hata mesajı ikisi de geçerli.
      await page.locator('input[name="phone"]').fill("05339876543");
      await page.locator('input[name="kvkk"]').check();
      await page.getByRole("button", { name: "Alarmı kur" }).click();
      const okMsg = page.getByText("Fiyat alarmı kuruldu");
      const errMsg = page.locator("p.text-danger-500");
      await expect(okMsg.or(errMsg).first()).toBeVisible({ timeout: 30_000 });
    } finally {
      await context.close();
    }
  });
});
