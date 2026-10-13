import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PLATFORM_ROLE_MODULES } from "@/lib/platform-access";
import { ADMIN_NAV, adminNavFor, adminSidebarModel } from "./nav";

describe("/admin yan menü görünümü (çekirdek + katlanan)", () => {
  it("her rolde görünen + katlanan = rolün menüsü; hiçbir sayfa kaybolmaz, tekrar yok", () => {
    for (const [role, mods] of Object.entries(PLATFORM_ROLE_MODULES)) {
      const all = adminNavFor(mods).flatMap((s) => s.items.map((i) => i.href));
      const model = adminSidebarModel(mods).flatMap((g) => [...g.items, ...g.folded].map((i) => i.href));
      expect(model.slice().sort(), role).toEqual(all.slice().sort());
    }
  });

  it("süper yöneticide 6 çekirdek öğe görünür (Raporlar/AI danışmanı Kontrol paneli, Üyeler Ofisler sekmesi), nadir araçlar grup içinde katlanır", () => {
    const groups = adminSidebarModel(PLATFORM_ROLE_MODULES.super_admin);
    const visible = groups.flatMap((g) => g.items.map((i) => i.href));
    expect(visible).toEqual(["/admin", "/admin/tenants", "/admin/billing", "/admin/site", "/admin/tickets", "/admin/sistem"]);
    const folded = groups.flatMap((g) => g.folded.map((i) => i.href));
    expect(folded).toEqual(expect.arrayContaining(["/admin/ayarlar", "/admin/personel", "/admin/geo"]));
  });

  it("çekirdeği olmayan grup (rol süzgeci sonrası) tam gösterilir; boş grup yoktur", () => {
    for (const mods of Object.values(PLATFORM_ROLE_MODULES)) {
      for (const g of adminSidebarModel(mods)) {
        expect(g.items.length).toBeGreaterThan(0);
        if (g.folded.length > 0) expect(g.items.every((i) => i.core)).toBe(true);
      }
    }
  });

  it("çekirdek bayrağı yalnız 6 tanımlı menü öğesinde", () => {
    expect(ADMIN_NAV.flatMap((s) => s.items).filter((i) => i.core).length).toBe(6);
  });

  it("görünür satır >= grup sayısı: her grubun en az bir satırı hep görünür (başlık tek başına kalmaz)", () => {
    for (const [role, mods] of Object.entries(PLATFORM_ROLE_MODULES)) {
      const groups = adminSidebarModel(mods);
      const visible = groups.flatMap((g) => g.items);
      expect(visible.length, role).toBeGreaterThanOrEqual(groups.length);
    }
  });

  it("eski ortak 'Diğer' grubu yok: ek öğeler ilgili gruptadır (Gelir, Destek, Sistem)", () => {
    const groupOf = (href: string) => ADMIN_NAV.find((s) => s.items.some((i) => i.href === href))?.id;
    expect(groupOf("/admin/growth")).toBe("gelir");
    expect(groupOf("/admin/analiz-tarifesi")).toBe("gelir");
    expect(groupOf("/admin/duyuru")).toBe("destek");
    expect(groupOf("/admin/geo")).toBe("sistem");
    expect(groupOf("/admin/personel")).toBe("sistem");
    expect(groupOf("/admin/ayarlar")).toBe("sistem");
    const code = readFileSync(join(process.cwd(), "src/components/admin/admin-sidebar.tsx"), "utf8");
    expect(code).not.toContain("diger-acik");
    expect(code).not.toContain('"adm-diger"');
  });

  it("alt çubuk kısa adları: Kontrol paneli -> Panel, Site ve marka -> Site", () => {
    const byHref = new Map(ADMIN_NAV.flatMap((s) => s.items).map((i) => [i.href, i]));
    expect(byHref.get("/admin")?.short).toBe("Panel");
    expect(byHref.get("/admin/site")?.short).toBe("Site");
    const code = readFileSync(join(process.cwd(), "src/components/admin/admin-sidebar.tsx"), "utf8");
    expect(code).toContain("{tab.short ?? tab.label}");
  });
});
