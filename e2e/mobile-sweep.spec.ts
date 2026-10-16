import { test, expect, type Page } from "@playwright/test";
import { MIN_TARGET, SWEEP_ROUTES, SWEEP_VIEWPORTS, type SweepRoute } from "./mobile-routes";

/**
 * MOBİL DÜZEN SÜPÜRMESİ (MP12) — 360 / 390 / 430 px telefonda en çok açılan ~23 panel ekranı (salt-okunur; hiçbir kayıt
 * yazılmaz). Her ekran ve genişlikte:
 *  1. Belge yana taşmaz (`scrollWidth <= innerWidth + 1`); taşan ilk üç öğe hata metninde.
 *  2. BİRİNCİL eylemler ≥44 px: sayfanın `.btn-primary` düğmeleri, mobil alt gezinme ve üst çubuk düğmeleri.
 *  3. Sayfa sonuna kaydırınca son etkileşimli öğe alt gezinme çubuğunun ALTINDA kalmaz.
 *  4. Ekran görüntüsü rapora eklenir (görsel inceleme).
 *
 * Oturum: `E2E_MOBILE_SWEEP=1` ile ayrı `mobile-sweep` projesi koşar ve /giris'teki DEMO "Ofis sahibi" kartıyla girer
 * (kartlar hedefte açık değilse tüm süpürme ATLANIR, raporda görünür). Ortam yoksa proje hiç koşmaz.
 * Statik karşılığı (tarayıcısız, her koşuda): src/lib/mobile-table-ratchet.test.ts.
 */
test.describe.configure({ mode: "serial" });

const PERSONA = process.env.E2E_MOBILE_SWEEP_PERSONA?.trim() || "Ofis sahibi";
let loggedIn = false;
const resolved = new Map<string, string | null>();

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/giris");
  const card = page.getByRole("button", { name: new RegExp(PERSONA) });
  if (await card.first().isVisible().catch(() => false)) {
    await card.first().click();
    await page.waitForURL(/\/app(\/|$|\?)/, { timeout: 45_000 }).catch(() => undefined);
    loggedIn = new URL(page.url()).pathname.startsWith("/app");
    if (loggedIn) {
      await page.evaluate(() => window.localStorage.setItem("emlaksoft:tour-done", "1"));
      await ctx.storageState({ path: "e2e/.auth/mobile-sweep.json" });
    }
  }
  await ctx.close();
});

async function resolvePath(page: Page, r: SweepRoute): Promise<string | null> {
  if (r.kind === "path") return r.path;
  const cached = resolved.get(r.name);
  if (cached !== undefined) return cached;
  let out: string | null = null;
  if (r.kind === "discover") {
    await page.goto("/app");
    const hrefs = await page.evaluate(() => [...document.querySelectorAll<HTMLAnchorElement>("a[href^='/app']")].map((a) => [a.textContent?.trim() ?? "", a.getAttribute("href") ?? ""]));
    out = hrefs.find(([text]) => r.label.test(text))?.[1]?.split("?")[0] ?? null;
  } else {
    await page.goto(r.list);
    const hrefs = await page.evaluate(() => [...document.querySelectorAll<HTMLAnchorElement>("main a[href]")].map((a) => a.getAttribute("href") ?? ""));
    out = hrefs.find((h) => r.hrefPattern.test(h.split("?")[0]!)) ?? null;
  }
  resolved.set(r.name, out);
  return out;
}

type Measure = { over: number; culprits: string[]; small: string[]; hidden: string[] };

async function measure(page: Page): Promise<Measure> {
  return page.evaluate((min) => {
    const doc = document.documentElement;
    const width = Math.min(window.innerWidth, doc.clientWidth || window.innerWidth);
    const over = doc.scrollWidth - width;
    const culprits =
      over > 1
        ? [...document.querySelectorAll<HTMLElement>("body *")]
            .map((el) => ({ el, r: el.getBoundingClientRect() }))
            .filter((x) => x.r.right > width + 1 && x.r.width > 0)
            .sort((a, b) => b.r.right - a.r.right)
            .slice(0, 3)
            .map((x) => `${x.el.tagName.toLowerCase()}.${String(x.el.className).slice(0, 48)}@${Math.round(x.r.right)}`)
        : [];
    const visible = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      if (r.width <= 1 || r.height <= 1) return null;
      const st = getComputedStyle(el);
      if (st.visibility === "hidden" || st.display === "none" || st.opacity === "0") return null;
      return r;
    };
    const primary = [
      ...document.querySelectorAll<HTMLElement>("main .btn-primary"),
      ...document.querySelectorAll<HTMLElement>('nav[aria-label="Mobil hızlı gezinme"] :is(a, button)'),
      ...document.querySelectorAll<HTMLElement>("header button"),
    ];
    const small: string[] = [];
    for (const el of primary) {
      if (el.closest('[aria-hidden="true"], .sr-only')) continue;
      const r = visible(el);
      if (!r) continue;
      if (r.width < min || r.height < min) small.push(`${el.tagName.toLowerCase()}:${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 24)}:${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    // Sayfa sonu: son etkileşimli öğe alt çubuğun altında kalmasın.
    window.scrollTo(0, doc.scrollHeight);
    const nav = document.querySelector<HTMLElement>('nav[aria-label="Mobil hızlı gezinme"]');
    const navTop = nav && visible(nav) ? nav.getBoundingClientRect().top : window.innerHeight;
    const hidden: string[] = [];
    const last = [...document.querySelectorAll<HTMLElement>("main :is(a[href], button, input:not([type=hidden]), select, textarea)")]
      .filter((el) => visible(el))
      .sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom)[0];
    if (last) {
      const r = last.getBoundingClientRect();
      if (r.top >= navTop - 1 && r.top < window.innerHeight) hidden.push(`${last.tagName.toLowerCase()}:${(last.textContent ?? "").trim().slice(0, 24)}@${Math.round(r.top)}>${Math.round(navTop)}`);
    }
    return { over, culprits, small, hidden };
  }, MIN_TARGET);
}

for (const vp of SWEEP_VIEWPORTS) {
  test.describe(`mobil süpürme ${vp.width}x${vp.height}`, () => {
    test.use({ viewport: vp, hasTouch: true, isMobile: true });

    for (const r of SWEEP_ROUTES) {
      test(r.name, async ({ browser }, testInfo) => {
        test.skip(!loggedIn, `Demo "${PERSONA}" girişi hedefte yok; mobil süpürme atlandı.`);
        const ctx = await browser.newContext({ viewport: vp, hasTouch: true, isMobile: true, storageState: "e2e/.auth/mobile-sweep.json" });
        const page = await ctx.newPage();
        try {
          const path = await resolvePath(page, r);
          test.skip(!path, `${r.name}: hedef çözülemedi (kayıt ya da menü öğesi yok).`);
          await page.goto(path!);
          await page.waitForLoadState("networkidle").catch(() => undefined);
          test.skip(!new URL(page.url()).pathname.startsWith(path!.split("?")[0]!), `${r.name}: rol için kapalı ya da yönlendirildi.`);
          await testInfo.attach(`${r.name}-${vp.width}.png`, { body: await page.screenshot(), contentType: "image/png" });
          const m = await measure(page);
          expect.soft(m.over, `${path} @${vp.width} yana taşma: ${m.culprits.join(" ; ")}`).toBeLessThanOrEqual(1);
          expect.soft(m.small, `${path} @${vp.width} 44 px altı birincil hedef`).toEqual([]);
          expect.soft(m.hidden, `${path} @${vp.width} alt çubuğun altında kalan son öğe`).toEqual([]);
        } finally {
          await ctx.close();
        }
      });
    }
  });
}
