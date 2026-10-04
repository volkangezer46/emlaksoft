import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MARKETING_NAV, allNavLinks } from "@/lib/marketing-nav";

const root = process.cwd();

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sources(p);
    return /\.(tsx|ts)$/.test(e.name) ? [readFileSync(p, "utf8")] : [];
  });
}

describe("mega menü sözleşmesi", () => {
  const home = [readFileSync(join(root, "src/app/page.tsx"), "utf8"), ...sources(join(root, "src/components/marketing"))].join("\n");
  const fiyatlar = readFileSync(join(root, "src/app/fiyatlar/page.tsx"), "utf8");

  it("dört grup var ve her grupta öne çıkan kart ile en az bir bağlantı bulunur", () => {
    expect(MARKETING_NAV.map((g) => g.id)).toEqual(["urun", "cozum", "kaynak", "fiyat"]);
    for (const g of MARKETING_NAV) {
      expect(g.featured.href.length).toBeGreaterThan(0);
      expect(g.columns.flatMap((c) => c.items).length).toBeGreaterThan(0);
    }
  });

  it("her bağlantı var olan bir sayfaya veya sayfadaki bir bölüme gider (ölü bağlantı yok)", () => {
    const links = [...allNavLinks(), ...MARKETING_NAV.map((g) => g.featured)];
    for (const l of links) {
      if (l.href.startsWith("mailto:")) continue;
      const [pathAndQuery, hash] = l.href.split("#");
      const path = pathAndQuery!.split("?")[0]!;
      const pageFile = path === "/" ? "src/app/page.tsx" : `src/app${path}/page.tsx`;
      expect(existsSync(join(root, pageFile)), `${l.href} -> ${pageFile}`).toBe(true);
      if (hash) {
        const haystack = path === "/" ? home : fiyatlar;
        const found = new RegExp(`id=["']${hash}["']|id:\\s*["']${hash}["']|id="\\$\\{id\\}-baslik"`).test(haystack) || haystack.includes(`id="${hash}"`) || (path === "/fiyatlar" && haystack.includes(`id="${hash}"`));
        expect(found, `${l.href} bölüm kimliği bulunamadı`).toBe(true);
      }
    }
  });

  it("menüde sabit fiyat, paket adı veya deneme günü yazılmaz (tek kaynak: admin paket tanımları)", () => {
    const text = JSON.stringify(
      MARKETING_NAV.map((g) => ({ ...g, columns: g.columns.map((c) => ({ ...c, items: c.items.map(({ label, text }) => ({ label, text })) })), featured: { ...g.featured, icon: undefined } })),
    );
    expect(text).not.toMatch(/\d[\d.]*\s*(₺|TL\b)/);
    expect(text).not.toMatch(/\d+\s*gün/);
  });
});
