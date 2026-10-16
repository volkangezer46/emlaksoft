import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { ADMIN_EXTRA_PALETTE, ADMIN_NAV, adminPaletteFor } from "./nav";
import { PLATFORM_ROLE_MODULES } from "@/lib/platform-access";

/**
 * /admin MENÜ KAPSAMI (sahip kararı 2026-10-16, "herşey full adminden yönetilebilir"): src/app/admin altındaki HER sayfa
 * menüden erişilir — bir menü öğesi, öğenin sekmesi/alt sekmesi, palet hedefi ya da bunlardan birinin ALT yolu (ayrıntı ve
 * eylem sayfaları: /admin/tenants/[id], /admin/tickets/yeni). Yetim sayfa ve ölü bağlantı yok.
 */
const root = join(process.cwd(), "src/app/admin");

function pages(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...pages(p));
    else if (name === "page.tsx") out.push(`/admin/${relative(root, dir).split(sep).join("/")}`.replace(/\/$/, ""));
  }
  return out;
}

const pathOf = (href: string) => href.split(/[?#]/)[0]!;
const items = ADMIN_NAV.flatMap((s) => s.items);
const links = [
  ...items,
  ...items.flatMap((i) => [...(i.tabs ?? []), ...(i.tabs ?? []).flatMap((t) => t.children ?? []), ...(i.palette ?? [])]),
  ...ADMIN_EXTRA_PALETTE,
];
const targets = [...new Set(links.map((l) => pathOf(l.href)))];

describe("/admin menü kapsamı", () => {
  const all = pages(root);

  it("sayfa envanteri okunur (en az 75 sayfa)", () => {
    expect(all.length).toBeGreaterThanOrEqual(75);
  });

  it("her admin sayfası menüden (öğe, sekme, palet ya da onların alt yolu) erişilir: yetim sayfa yok", () => {
    const orphans = all.filter((page) => {
      const p = page === "/admin" ? "/admin" : page;
      return !targets.some((t) => p === t || (t !== "/admin" && p.startsWith(`${t}/`)));
    });
    expect(orphans).toEqual([]);
  });

  it("ayrıntı/eylem dışındaki (dinamik parçasız, yeni/düzenle/önizleme olmayan) her sayfanın KENDİ menü bağlantısı var", () => {
    const leaf = all.filter((p) => !/\[|\/(yeni|duzenle|onizleme)$/.test(p));
    const missing = leaf.filter((p) => !targets.includes(p) && !targets.some((t) => t !== "/admin" && p.startsWith(`${t}/`) && /\/sayfalar\/(ana-sayfa|fiyatlar)$/.test(p)));
    expect(missing).toEqual([]);
  });

  it("ölü bağlantı yok: her hedefin sayfası var", () => {
    for (const t of targets) expect(existsSync(join(process.cwd(), "src/app", t, "page.tsx")), t).toBe(true);
  });

  it("süper adminde her menü/sekme hedefi komut paletinde de aranır", () => {
    const palette = new Set(adminPaletteFor(PLATFORM_ROLE_MODULES.super_admin).map((c) => pathOf(c.href)));
    for (const t of targets) expect(palette.has(t), t).toBe(true);
  });
});
