import { test, expect, type Browser, type Page } from "@playwright/test";

/**
 * METİN SIĞMA BEKÇİSİ (sahip: "yazılarda kayma vs olmasın; uzun yazı varsa mantıklı olarak kısalt").
 *
 * Her persona kendi demo kartıyla girer (/giris), anahtar rotaları 1366x768 ve 390x844'te (açık + koyu) tarar:
 *  1. TAŞAN METİN: kendi metin düğümü olan, görünür bir öğede `scrollWidth > clientWidth` iken ne `text-overflow: ellipsis`
 *     ne yatay kaydırma (`overflow-x: auto|scroll`) ne de satır sınırı (`line-clamp`) var → metin kutudan taşıyor ya da
 *     kelime ortasından kesiliyor.
 *  2. ÇAKIŞAN METİN: kahraman (`.kh-hero`), üst çubuk (`header`) ve yan menüde (`aside`) iki ayrı metin kutusu üst üste
 *     biniyor (metin düğümlerinin satır dikdörtgenleriyle ölçülür; ata/çocuk ilişkisi sayılmaz).
 *  3. TV panosu (`/app/pano-tv`, 1920): başlıktaki hava/saat metni sahne sekmeleriyle çakışmaz.
 *
 * Salt okunur: hiçbir düğmeye basılmaz, kayıt yazılmaz. Koşum (yalnız APP_URL ile):
 *   APP_URL=https://emlaksoft.com.tr npx playwright test --project=text-fit
 * Kart hedefte yoksa persona ATLANIR (sahte geçiş yok). Statik karşılığı: src/lib/text-fit-contract.test.ts.
 */

type Persona = { card: RegExp; name: string; routes: string[] };

const PERSONAS: Persona[] = [
  {
    card: /^Ofis sahibi/,
    name: "sahip",
    routes: ["/app", "/app/musteriler", "/app/portfoyler", "/app/anlasmalar", "/app/gorevler", "/app/randevular", "/app/finans", "/app/ekip", "/app/raporlar", "/app/ayarlar"],
  },
  { card: /^Danışman/, name: "danisman", routes: ["/app", "/app/musteriler", "/app/portfoyler", "/app/gorevler"] },
  { card: /^Ofis muhasebe/, name: "muhasebe", routes: ["/app", "/app/finans"] },
  { card: /^Çağrı merkezi/, name: "cagri", routes: ["/app"] },
  { card: /^Süper admin/, name: "admin", routes: ["/admin", "/admin/tenants"] },
];

const VIEWPORTS = [
  { width: 1366, height: 768, mobile: false },
  { width: 390, height: 844, mobile: true },
] as const;

async function login(browser: Browser, persona: Persona, vp: (typeof VIEWPORTS)[number], scheme: "light" | "dark"): Promise<Page | null> {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, hasTouch: vp.mobile, isMobile: vp.mobile, colorScheme: scheme });
  const page = await ctx.newPage();
  await page.goto("/giris");
  const card = page.getByRole("button", { name: persona.card });
  await card.first().waitFor({ state: "visible", timeout: 15_000 }).catch(() => undefined);
  if (!(await card.first().isVisible().catch(() => false))) {
    await ctx.close();
    return null;
  }
  await card.first().click();
  await page.waitForURL(/\/(app|admin)(\/|$|\?)/, { timeout: 45_000 }).catch(() => undefined);
  if (!/^\/(app|admin)/.test(new URL(page.url()).pathname)) {
    await ctx.close();
    return null;
  }
  await page.evaluate(() => window.localStorage.setItem("emlaksoft:tour-done", "1"));
  return page;
}

export type FitIssue = { kind: "overflow" | "overlap"; where: string; text: string; detail: string };

/** Tarayıcıda koşar: taşan ve çakışan metin kutuları. */
async function scan(page: Page): Promise<FitIssue[]> {
  return page.evaluate(() => {
    const out: { kind: "overflow" | "overlap"; where: string; text: string; detail: string }[] = [];
    const label = (el: Element) => {
      const cls = typeof (el as HTMLElement).className === "string" ? (el as HTMLElement).className.split(/\s+/).filter(Boolean).slice(0, 3).join(".") : "";
      return `${el.tagName.toLowerCase()}${cls ? "." + cls : ""}`;
    };
    const ownText = (el: Element) =>
      [...el.childNodes]
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent ?? "")
        .join("")
        .replace(/\s+/g, " ")
        .trim();
    const hidden = (el: Element) => Boolean(el.closest('[aria-hidden="true"], .sr-only, [hidden], template, script, style, noscript, svg'));
    const visible = (el: HTMLElement, cs: CSSStyleDeclaration) => {
      if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) return false;
      const r = el.getBoundingClientRect();
      return r.width > 2 && r.height > 2;
    };
    // Kaydırılabilir bir atanın içindeki taşma kasıtlıdır (yatay şerit, tablo kaydırıcısı).
    const inScroller = (el: HTMLElement) => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const ox = getComputedStyle(p).overflowX;
        if (ox === "auto" || ox === "scroll") return true;
      }
      return false;
    };

    // 1) Taşan metin
    for (const el of document.querySelectorAll<HTMLElement>("body *")) {
      if (el.matches("input, textarea, select, option, button svg, canvas, img, video, iframe, code, pre, kbd")) continue;
      const text = ownText(el);
      if (text.length < 2 || hidden(el)) continue;
      const cs = getComputedStyle(el);
      if (!visible(el, cs)) continue;
      if (cs.display === "inline") continue; // satır içi öğenin kutusu metni sarar; kapsayıcı blok ölçülür
      const over = el.scrollWidth - el.clientWidth;
      if (over <= 1) continue;
      if (cs.textOverflow === "ellipsis") continue;
      if (cs.overflowX === "auto" || cs.overflowX === "scroll") continue;
      const clamp = cs.getPropertyValue("-webkit-line-clamp");
      if (clamp && clamp !== "none") continue;
      if (inScroller(el)) continue;
      out.push({ kind: "overflow", where: label(el), text: text.slice(0, 80), detail: `+${over}px (w=${el.clientWidth})` });
    }

    // 2) Çakışan metin (kahraman · üst çubuk · yan menü)
    const regions = [...document.querySelectorAll<HTMLElement>(".kh-hero, .app-topbar, .topbar-platform, .tv-head, header[role='banner'], aside")];
    for (const region of regions) {
      const boxes: { el: Element; r: DOMRect; text: string }[] = [];
      const walker = document.createTreeWalker(region, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const t = (n.textContent ?? "").trim();
        const parent = n.parentElement;
        if (!t || !parent || hidden(parent)) continue;
        const cs = getComputedStyle(parent);
        if (!visible(parent, cs)) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        // Kırpılan (ellipsis / overflow:hidden) metnin görünmeyen kısmı sayılmaz: satır kutusu kırpan atalarla kesilir.
        // Ebeveyn kutusu da kırpar: `line-height: 1` başlıklarda yazı tipinin üst/alt boşluğu komşu satıra taşar ama glif taşmaz.
        const clips: DOMRect[] = [parent.getBoundingClientRect()];
        for (let p: HTMLElement | null = parent; p && p !== region.parentElement; p = p.parentElement) {
          const c = getComputedStyle(p);
          if (c.overflowX !== "visible" || c.overflowY !== "visible") clips.push(p.getBoundingClientRect());
        }
        for (const raw of range.getClientRects()) {
          let l = raw.left, t2 = raw.top, r2 = raw.right, b = raw.bottom;
          for (const c of clips) {
            l = Math.max(l, c.left);
            t2 = Math.max(t2, c.top);
            r2 = Math.min(r2, c.right);
            b = Math.min(b, c.bottom);
          }
          if (r2 - l > 1 && b - t2 > 1) boxes.push({ el: parent, r: new DOMRect(l, t2, r2 - l, b - t2), text: t });
        }
      }
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i]!;
          const b = boxes[j]!;
          if (a.el === b.el || a.el.contains(b.el) || b.el.contains(a.el)) continue;
          const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
          const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
          if (w > 3 && h > 3) {
            out.push({ kind: "overlap", where: `${label(region)}: ${label(a.el)} × ${label(b.el)}`, text: `${a.text.slice(0, 40)} × ${b.text.slice(0, 40)}`, detail: `${Math.round(w)}x${Math.round(h)}px` });
          }
        }
      }
    }
    // Aynı öğe birden çok kez (her satır kutusu) raporlanmasın.
    const seen = new Set<string>();
    return out.filter((x) => {
      const k = `${x.kind}|${x.where}|${x.text}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  });
}

async function settle(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined);
  // Ekran altı bloklar (DeferredSection) ve yazı tipleri otursun.
  await page.evaluate(() => document.fonts?.ready).catch(() => undefined);
  await page.waitForTimeout(400);
}

for (const persona of PERSONAS) {
  for (const vp of VIEWPORTS) {
    for (const scheme of ["light", "dark"] as const) {
      test(`${persona.name} @${vp.width} ${scheme}: metin taşmaz ve çakışmaz`, async ({ browser }) => {
        test.setTimeout(240_000);
        const page = await login(browser, persona, vp, scheme);
        test.skip(!page, `"${persona.name}" demo kartı hedefte yok`);
        const all: string[] = [];
        for (const path of persona.routes) {
          await settle(page!, path);
          if (!new URL(page!.url()).pathname.startsWith(path)) continue; // yetkisiz/yönlenen rota
          for (const i of await scan(page!)) all.push(`${path} [${i.kind}] ${i.where} "${i.text}" ${i.detail}`);
        }
        await page!.context().close();
        if (all.length) console.log(`\n${persona.name} @${vp.width} ${scheme}:\n  ${all.join("\n  ")}`);
        expect(all, all.join("\n")).toEqual([]);
      });
    }
  }
}

test("TV panosu @1920: hava/saat metni sahne sekmeleriyle çakışmaz", async ({ browser }) => {
  test.setTimeout(120_000);
  const page = await login(browser, PERSONAS[0]!, { width: 1920, height: 1080, mobile: false } as never, "dark");
  test.skip(!page, "Ofis sahibi demo kartı hedefte yok");
  await page!.setViewportSize({ width: 1920, height: 1080 });
  await settle(page!, "/app/pano-tv");
  const hits = await page!.evaluate(() => {
    const tabs = [...document.querySelectorAll<HTMLElement>(".tv-scenes-nav")];
    const head = document.querySelector<HTMLElement>(".tv-head");
    if (!head || tabs.length === 0) return [] as string[];
    const out: string[] = [];
    const walker = document.createTreeWalker(head, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = (n.textContent ?? "").trim();
      const parent = n.parentElement;
      if (!t || !parent || tabs.some((tab) => tab.contains(parent))) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) {
        for (const tab of tabs) {
          const b = tab.getBoundingClientRect();
          const w = Math.min(r.right, b.right) - Math.max(r.left, b.left);
          const h = Math.min(r.bottom, b.bottom) - Math.max(r.top, b.top);
          if (w > 2 && h > 2) out.push(`"${t.slice(0, 40)}" × "${(tab.textContent ?? "").trim().slice(0, 30)}"`);
        }
      }
    }
    return [...new Set(out)];
  });
  const fit = await scan(page!);
  await page!.context().close();
  expect([...hits, ...fit.map((i) => `[${i.kind}] ${i.where} "${i.text}" ${i.detail}`)]).toEqual([]);
});
