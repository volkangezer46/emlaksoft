import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { ALL_NAV_HREFS, HIDDEN_APP_PAGES } from "./nav-config";

/**
 * Yetim sayfa sözleşmesi: `src/app/app` altındaki her STATİK page.tsx ya menüde (öğe/sekme/eski yol),
 * ya bir menü öğesinin alt yolu (ör. /app/ekip/izinler), ya da gerekçeli `HIDDEN_APP_PAGES` listesindedir.
 * Dinamik segmentler ([id]) ve özel klasörler (_home) zaten üst sayfanın altındadır, taranmaz.
 * Yeni sayfa eklenip menüye bağlanmazsa bu test kırılır: ya nav-config'e öğe/sekme eklenir ya da
 * gizli listeye gerekçesiyle yazılır.
 */
const ROOT = join(process.cwd(), "src", "app", "app");

function collectStaticPages(dir: string, url: string, out: string[]) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (!statSync(full).isDirectory()) {
      if (name === "page.tsx") out.push(url);
      continue;
    }
    if (name.startsWith("_") || name.startsWith("[")) continue;
    collectStaticPages(full, name.startsWith("(") ? url : `${url}/${name}`, out);
  }
}

function underNavParent(route: string): boolean {
  return ALL_NAV_HREFS.some((h) => h !== "/app" && route.startsWith(`${h}/`));
}

describe("yetim sayfa sözleşmesi (/app)", () => {
  const pages: string[] = [];
  collectStaticPages(ROOT, "/app", pages);

  it("en az 100 statik sayfa tarandı (tarayıcı çalışıyor)", () => {
    expect(pages.length).toBeGreaterThan(100);
  });

  it("her statik sayfa menüde, bir menü öğesinin altında ya da gerekçeli gizli listede", () => {
    const orphans = pages.filter((p) => !ALL_NAV_HREFS.includes(p) && !underNavParent(p) && !(p in HIDDEN_APP_PAGES));
    expect(orphans).toEqual([]);
  });

  it("gizli liste bayat değil: her kayıt var olan, menüde/üst öğe altında OLMAYAN bir sayfadır", () => {
    for (const route of Object.keys(HIDDEN_APP_PAGES)) {
      expect(existsSync(join(ROOT, route.slice("/app/".length), "page.tsx")), route).toBe(true);
      expect(ALL_NAV_HREFS, route).not.toContain(route);
      expect(underNavParent(route), `${route} zaten bir menü öğesinin altında; gizli listeden çıkarılmalı`).toBe(false);
    }
  });
});
