import { test, expect, type Page } from "@playwright/test";

/**
 * Ürün turu sözleşmesi (SK12 / B185, B039) — oturumlu `chromium` projesi, gerçek piksel ölçümü.
 *
 *  1. Her adımda vurgu deliği (`[data-tour-delik]`, hedefin 8 px dışı) ile turun ölçtüğü hedef (`[data-tour-hedef]`)
 *     arasındaki fark ≤4 px (masaüstü 1440 ve mobil 390). Önceki sayfanın başlığı ya da kopmuş öğe (-8,-8,16,16) ölçülmez.
 *  2. İlk balon navigationStart'tan ≤900 ms'de açılır (1440 px, ağ kısıtsız; yalnız masaüstü).
 *  3. Bitiş metni cihazdan bağımsızdır ("soldaki menü" yok).
 */

const PAD = 8;
const TOLERANCE = 4;

type Box = { x: number; y: number; w: number; h: number };

async function holeAndTarget(page: Page): Promise<{ hole: Box; target: Box } | null> {
  return page.evaluate(() => {
    const hole = document.querySelector<HTMLElement>("[data-tour-delik]");
    const target = document.querySelector<HTMLElement>("[data-tour-hedef]");
    if (!hole || !target) return null;
    const h = hole.getBoundingClientRect();
    const t = target.getBoundingClientRect();
    return { hole: { x: h.x, y: h.y, w: h.width, h: h.height }, target: { x: t.x, y: t.y, w: t.width, h: t.height } };
  });
}

/** Delik ve hedef kaydırma bitince sabitlenir; iki ardışık ölçüm aynıysa oturmuştur. */
async function settled(page: Page): Promise<{ hole: Box; target: Box }> {
  let prev = "";
  for (let i = 0; i < 40; i++) {
    const m = await holeAndTarget(page);
    const key = JSON.stringify(m);
    if (m && key === prev) return m;
    prev = key;
    await page.waitForTimeout(100);
  }
  const last = await holeAndTarget(page);
  if (!last) throw new Error("Tur deliği ya da hedefi bulunamadı");
  return last;
}

function expectAligned({ hole, target }: { hole: Box; target: Box }, label: string) {
  expect(Math.abs(hole.x + PAD - target.x), `${label} x`).toBeLessThanOrEqual(TOLERANCE);
  expect(Math.abs(hole.y + PAD - target.y), `${label} y`).toBeLessThanOrEqual(TOLERANCE);
  expect(Math.abs(hole.w - PAD * 2 - target.w), `${label} genişlik`).toBeLessThanOrEqual(TOLERANCE);
  expect(Math.abs(hole.h - PAD * 2 - target.h), `${label} yükseklik`).toBeLessThanOrEqual(TOLERANCE);
  expect(target.w, `${label} hedef boyutu`).toBeGreaterThan(4);
}

async function walkTour(page: Page) {
  const dialog = page.getByRole("dialog");
  for (let step = 1; step <= 10; step++) {
    const badge = dialog.getByText(/Adım \d+ \/ \d+/);
    await expect(badge).toBeVisible();
    expectAligned(await settled(page), `adım ${step}`);
    const next = dialog.getByRole("button", { name: /^(İleri|Bitir)/ });
    const finishing = (await next.textContent())?.includes("Bitir");
    await next.click();
    if (finishing) break;
  }
  await expect(page.getByRole("heading", { name: "Hazırsınız!" })).toBeVisible();
  await expect(page.getByText(/soldaki menü/i)).toHaveCount(0);
}

test.describe("ürün turu — masaüstü 1440", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("ilk balon ≤900 ms ve her adımda delik hedefle hizalı", async ({ page }) => {
    await page.goto("/app?tur=1");
    await expect(page.getByText(/Adım 1 \/ \d+/)).toBeVisible({ timeout: 10_000 });
    const firstBalloonMs = await page.evaluate(() => performance.now());
    test.info().annotations.push({ type: "ilk-balon-ms", description: String(Math.round(firstBalloonMs)) });
    expect(firstBalloonMs).toBeLessThanOrEqual(900);
    await walkTour(page);
  });
});

test.describe("ürün turu — mobil 390", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("her adımda delik hedefle hizalı", async ({ page }) => {
    await page.goto("/app?tur=1");
    await expect(page.getByText(/Adım 1 \/ \d+/)).toBeVisible({ timeout: 10_000 });
    await walkTour(page);
  });
});
