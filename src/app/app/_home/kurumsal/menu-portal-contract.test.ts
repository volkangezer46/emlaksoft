import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Ana sayfa açılır menüleri PORTAL katmanında (sahip geri bildirimi 2026-10-16: "işaretlediğim menü arkada kalıyor").
 * Kahraman "Diğer", KPI/kart "⋯", Satış performansı süzgeci, randevu/görev satır menüleri ve öneri eylemleri tek
 * bileşenden (`PortalMenu`) geçer; panel Radix Popover Portal ile document.body'de çizilir, kart `overflow` kırpamaz.
 */
const read = (p: string) => readFileSync(p, "utf8");

describe("ana sayfa menüleri portal bileşenini kullanır", () => {
  const files = [
    "src/app/app/_home/kurumsal/views.tsx",
    "src/app/app/_home/insight-eylem.tsx",
  ];
  it("kart içinde konumlanan details/summary ya da absolute menü paneli yok", () => {
    for (const f of files) {
      const src = read(f);
      expect(src, f).not.toMatch(/<details\b|<summary\b/);
      expect(src, f).not.toContain("kh-menu-panel");
      expect(src, f).toContain('from "@/components/ui/portal-menu"');
    }
  });
  it("RowMenu, kahraman 'Diğer' ve satış süzgeci PortalMenu ile çizilir", () => {
    const views = read("src/app/app/_home/kurumsal/views.tsx");
    const rowMenu = views.slice(views.indexOf("export function RowMenu"), views.indexOf("export function MenuLink"));
    expect(rowMenu).toContain("<PortalMenu");
    expect(views).toMatch(/<PortalMenu\s+label="Diğer hızlı işlemler"/);
    expect(views).toMatch(/<PortalMenu\s+label=\{`Satış süzgeci: /);
  });
  it("PortalMenu gövdesi Radix Popover Portal kullanır ve tembel yüklenir", () => {
    expect(read("src/components/ui/portal-menu.tsx")).toMatch(/lazyPanel[\s\S]*import\("\.\/portal-menu-panel"\)/);
    expect(read("src/components/ui/portal-menu-panel.tsx")).toContain('from "./popover"');
    const popover = read("src/components/ui/popover.tsx");
    expect(popover).toContain("<PopoverPrimitive.Portal>");
    expect(popover).toMatch(/z-\[60\]/);
  });
  it("kahramanda yönetim için TV modu bağlantısı var (/app/pano-tv)", () => {
    const blocks = read("src/app/app/_home/kurumsal/blocks.tsx");
    expect(blocks).toMatch(/href="\/app\/pano-tv"[\s\S]{0,300}TV modu/);
    expect(blocks).toContain("canViewTv(ctx.role)");
  });
});
