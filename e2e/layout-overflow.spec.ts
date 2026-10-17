import { test, expect, type Page } from "@playwright/test";

/**
 * Mobil ve tablet düzeni sözleşmesi (SK11) — gerçek piksel ölçümü (oturumlu `chromium` projesi, salt-okunur: hiçbir
 * kayıt yazılmaz; form testi boş gönderimde tarayıcı doğrulamasında durur).
 *
 *  1. Çekirdek /app ve /admin rotalarında 320, 390, 768, 844x390 ve 1024 genişlikte belge yana taşmaz
 *     (`scrollWidth === innerWidth`; bugün /app/raporlar 320'de 367, /admin/tenants 768'de 1346).
 *  2. Randevular kartları 360-414 px'te sağ kenarı aşmaz; onay kutusu ve saat alanları ekranda.
 *  3. KPI çiplerinde etiket ile değer kesişmez (0 px).
 *  4. /app/anlasmalar ve /app/gorevler'de 24 px'ten küçük dokunma hedefi yok; görev kartı metin sütunu ≥250 px.
 *  5. 844x390: kullanıcı menüsü ekrana sığar ("Çıkış yap" erişilebilir), listede iç dikey kaydırıcı yok.
 *  6. 768 px'te tablolarda işlem sütunu görünür ya da kart görünümü açık; /admin/tenants 1280'de "İşlemler" ekranda.
 *  7. Kullanıcı menüsündeki tüm denetimlere ok tuşlarıyla ulaşılır.
 *  8. en-US tarayıcıda bile zorunlu alan uyarısı Türkçe.
 *
 * Statik karşılığı (tarayıcısız, her koşuda): src/lib/layout-overflow-contract.test.ts.
 * Platform yöneticisi olmayan test hesabında /admin rotaları atlanır (atlama raporda görünür).
 */

const APP_ROUTES = ["/app", "/app/musteriler", "/app/portfoyler", "/app/randevular", "/app/raporlar", "/app/anlasmalar", "/app/gorevler", "/app/ekip", "/app/finans"];
const ADMIN_ROUTES = ["/admin", "/admin/tenants"];
const VIEWPORTS = [
  { width: 320, height: 700 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 844, height: 390 },
  { width: 1024, height: 768 },
] as const;

async function open(page: Page, path: string): Promise<boolean> {
  await page.goto(path);
  await page.waitForLoadState("networkidle").catch(() => undefined);
  return new URL(page.url()).pathname.startsWith(path.split("?")[0]!);
}

/** Belgenin yatay taşması (px) ve en sağa taşan öğeler (tanı için). */
async function overflow(page: Page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const width = Math.min(window.innerWidth, doc.clientWidth || window.innerWidth);
    const over = doc.scrollWidth - width;
    const culprits =
      over > 0
        ? [...document.querySelectorAll<HTMLElement>("body *")]
            .map((el) => ({ el, r: el.getBoundingClientRect() }))
            .filter((x) => x.r.right > width + 1 && x.r.width > 0)
            .sort((a, b) => b.r.right - a.r.right)
            .slice(0, 3)
            .map((x) => `${x.el.tagName.toLowerCase()}.${String(x.el.className).slice(0, 40)}@${Math.round(x.r.right)}`)
        : [];
    return { over, culprits };
  });
}

for (const vp of VIEWPORTS) {
  test.describe(`taşma yok — ${vp.width}x${vp.height}`, () => {
    test.use({ viewport: vp, hasTouch: vp.width < 1024 });
    for (const path of [...APP_ROUTES, ...ADMIN_ROUTES]) {
      test(path, async ({ page }) => {
        const reached = await open(page, path);
        test.skip(!reached && path.startsWith("/admin"), "Test hesabı platform yöneticisi değil; /admin atlandı.");
        const { over, culprits } = await overflow(page);
        expect(over, `${path} @${vp.width}: ${culprits.join(" ; ")}`).toBeLessThanOrEqual(0);
      });
    }
  });
}

test.describe("randevular kartları dar telefonda", () => {
  for (const width of [360, 390, 414]) {
    test(`${width} px: kartlar ve saat alanları ekranda`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await open(page, "/app/randevular");
      const out = await page.evaluate(() => {
        const iw = window.innerWidth;
        const bad: string[] = [];
        for (const el of document.querySelectorAll<HTMLElement>('main section.dashboard-panel, main input[type="time"], main input[name^="gun_"]')) {
          el.scrollIntoView({ block: "nearest" });
          const r = el.getBoundingClientRect();
          if (r.width > 0 && (r.right > iw + 0.5 || r.left < -0.5)) bad.push(`${el.tagName}:${Math.round(r.left)}-${Math.round(r.right)}`);
        }
        return bad;
      });
      expect(out).toEqual([]);
    });
  }
});

test.describe("telefon (390x844, dokunmatik)", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("KPI çiplerinde etiket ile değer kesişmez", async ({ page }) => {
    for (const path of ["/app/musteriler", "/app/portfoyler", "/app/talepler", "/app/anlasmalar", "/app/randevular", "/app/finans"]) {
      await open(page, path);
      const hits = await page.evaluate(() => {
        let n = 0;
        for (const c of document.querySelectorAll<HTMLElement>(".kpi-compact .pm-card")) {
          const t = c.querySelector(".pm-card-title")?.getBoundingClientRect();
          const v = c.querySelector(".pm-value")?.getBoundingClientRect();
          if (!t || !v || !t.width || !v.width) continue;
          const w = Math.min(t.right, v.right) - Math.max(t.left, v.left);
          const h = Math.min(t.bottom, v.bottom) - Math.max(t.top, v.top);
          if (w > 0 && h > 0) n++;
        }
        return n;
      });
      expect(hits, `${path}: kesişen KPI çipi`).toBe(0);
    }
  });

  // WP1: a11y.css 24 px tabanı (özgüllük 0) `touch:min-h-11`'i artık ezmez; <main> içindeki her görünür `touch:min-h-11` öğe ≥44 px.
  for (const path of ["/app/gorevler", "/app/finans"]) {
    test(`${path}: touch:min-h-11 öğeler <main> içinde ≥44 px`, async ({ page }) => {
      await open(page, path);
      const out = await page.evaluate(() => {
        const els = [...document.querySelectorAll<HTMLElement>("main [class~='touch:min-h-11']")].filter((el) => {
          const r = el.getBoundingClientRect();
          const st = getComputedStyle(el);
          return r.width > 1 && r.height > 1 && st.display !== "none" && st.visibility !== "hidden";
        });
        const short = els
          .filter((el) => el.getBoundingClientRect().height < 43.5)
          .map((el) => `${el.tagName.toLowerCase()}:${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 24)}:${Math.round(el.getBoundingClientRect().height)}`);
        return { count: els.length, short };
      });
      expect(out.count, `${path}: ölçülecek touch:min-h-11 öğe yok`).toBeGreaterThan(0);
      expect(out.short).toEqual([]);
    });
  }

  for (const path of ["/app/anlasmalar", "/app/gorevler"]) {
    test(`${path}: 24 px'ten küçük dokunma hedefi yok`, async ({ page }) => {
      await open(page, path);
      const small = await page.evaluate(() => {
        const out: string[] = [];
        const sel = 'main a[href], main button, main summary, main select, main input:not([type="hidden"]), main [role="button"], main [role="slider"], main [tabindex]:not([tabindex="-1"])';
        for (const el of document.querySelectorAll<HTMLElement>(sel)) {
          if (el.closest('[aria-hidden="true"]') || el.getAttribute("tabindex") === "-1") continue;
          let t: HTMLElement = el;
          if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) t = el.closest("label") ?? el;
          const r = t.getBoundingClientRect();
          if (r.width <= 1 || r.height <= 1) continue;
          const st = getComputedStyle(t);
          if (st.visibility === "hidden" || st.display === "none" || st.opacity === "0") continue;
          if (r.width < 23.5 || r.height < 23.5) out.push(`${t.tagName.toLowerCase()}:${(t.getAttribute("aria-label") ?? t.textContent ?? "").trim().slice(0, 24)}:${Math.round(r.width)}x${Math.round(r.height)}`);
        }
        return out;
      });
      expect(small).toEqual([]);
    });
  }

  for (const path of ["/app/musteriler/yeni", "/app/portfoyler/yeni", "/app/talepler/yeni", "/app/randevular/yeni"]) {
    test(`${path}: etkin adım şeritte görünür, İptal "Daha fazla" ile ekranda`, async ({ page }) => {
      await open(page, path);
      // Sadeleştirme 2.7: mobilde altta TEK birincil düğme; İptal "Daha fazla" (…) satırına indi.
      const more = page.locator(".fab-bar").getByRole("button", { name: "Daha fazla" });
      if (await more.isVisible().catch(() => false)) await more.click();
      const out = await page.evaluate(() => {
        const iw = window.innerWidth;
        const active = document.querySelector<HTMLElement>('.mt-tab[aria-selected="true"], .mt-tab[data-state="active"], .mt-tab[aria-current]');
        const ar = active?.querySelector(".mt-lw")?.getBoundingClientRect() ?? active?.getBoundingClientRect();
        const cancel = [...document.querySelectorAll<HTMLElement>(".fab-bar a, .fab-bar button")].find(
          (b) => /Vazgeç|İptal/.test(b.textContent ?? "") && b.getBoundingClientRect().width > 0,
        );
        const cr = cancel?.getBoundingClientRect();
        return { activeLeft: ar?.left ?? 0, activeRight: ar?.right ?? 0, cancelLeft: cr ? cr.left : -1, cancelRight: cr ? cr.right : 0, iw };
      });
      expect(out.activeLeft).toBeGreaterThanOrEqual(-0.5);
      expect(out.activeRight).toBeLessThanOrEqual(out.iw + 0.5);
      expect(out.cancelLeft).toBeGreaterThanOrEqual(0);
      expect(out.cancelRight).toBeLessThanOrEqual(out.iw + 0.5);
    });
  }

  test("görev kartında metin sütunu ≥250 px", async ({ page }) => {
    await open(page, "/app/gorevler");
    const widths = await page.locator("[data-task-card] [data-task-text]").evaluateAll((els) => els.slice(0, 5).map((e) => e.getBoundingClientRect().width));
    test.skip(widths.length === 0, "Test hesabında açık görev yok.");
    for (const w of widths) expect(w).toBeGreaterThanOrEqual(250);
  });
});

test.describe("kısa ekran (844x390 yatay telefon)", () => {
  test.use({ viewport: { width: 844, height: 390 }, hasTouch: true });

  test("kullanıcı menüsü ekrana sığar; 'Çıkış yap' erişilebilir", async ({ page }) => {
    await open(page, "/app/musteriler");
    await page.getByRole("button", { name: /Kullanıcı menüsü/ }).click();
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    const box = await menu.boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(390 + 0.5);
    const out = page.getByRole("menuitem", { name: "Çıkış yap" });
    await out.scrollIntoViewIfNeeded();
    await expect(out).toBeInViewport();
  });

  test("listede iç dikey kaydırıcı yok; ilk kayıt ilk ekranda", async ({ page }) => {
    await open(page, "/app/musteriler");
    const inner = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("main .tbl-scroll")].filter((el) => el.scrollHeight > el.clientHeight + 1 && getComputedStyle(el).maxHeight !== "none").length,
    );
    expect(inner).toBe(0);
    const firstRow = page.locator("main tbody tr").first();
    test.skip((await firstRow.count()) === 0, "Test hesabında müşteri yok.");
    const r = await firstRow.boundingBox();
    expect(r!.y).toBeLessThan(390);
  });
});

test.describe("tablet (768 px) ve geniş masaüstü", () => {
  test("768: tablolarda işlem sütunu görünür ya da kart görünümü açık", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    for (const path of ["/app/musteriler", "/app/portfoyler", "/app/anlasmalar?gorunum=liste", "/app/ekip"]) {
      await open(page, path);
      const hidden = await page.evaluate(() => {
        const iw = window.innerWidth;
        return [...document.querySelectorAll<HTMLElement>("main td[data-actions]")]
          .filter((td) => td.getBoundingClientRect().width > 0 && getComputedStyle(td).display === "table-cell")
          .filter((td) => td.getBoundingClientRect().right > iw + 0.5).length;
      });
      expect(hidden, `${path}: ekran dışındaki işlem hücresi`).toBe(0);
    }
  });

  test("/admin/tenants 1280 px'te 'İşlemler' sütunu ekranda", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const reached = await open(page, "/admin/tenants");
    test.skip(!reached, "Test hesabı platform yöneticisi değil.");
    await expect(page.getByRole("columnheader", { name: "İşlemler" })).toBeInViewport();
  });
});

test("kullanıcı menüsünde tüm denetimlere ok tuşlarıyla ulaşılır", async ({ page }) => {
  await open(page, "/app");
  const trigger = page.getByRole("button", { name: /Kullanıcı menüsü/ });
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menu")).toBeVisible();
  const reached = new Set<string>();
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press("ArrowDown");
    const role = await page.evaluate(() => document.activeElement?.getAttribute("role") ?? "");
    reached.add(role);
  }
  expect(reached).toContain("menuitemcheckbox");
  expect(reached).toContain("menuitemradio");
  expect(reached).toContain("menuitem");
});

test.describe("doğrulama iletisi tarayıcı dilinden bağımsız", () => {
  test.use({ locale: "en-US" });
  test("en-US'de zorunlu alan uyarısı Türkçe", async ({ page }) => {
    await open(page, "/app/musteriler/yeni");
    await page.locator("form button[type=submit]").last().click();
    const msg = await page.evaluate(() => (document.querySelector("form :invalid") as HTMLInputElement | null)?.validationMessage ?? "");
    expect(msg).not.toMatch(/fill out|select/i);
    expect(msg).toMatch(/zorunlu|seçim|işaretleyin/);
  });
});
