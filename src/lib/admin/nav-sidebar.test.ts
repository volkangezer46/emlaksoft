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

  it("süper yöneticide 8 çekirdek öğe görünür, nadir araçlar grup içinde katlanır", () => {
    const groups = adminSidebarModel(PLATFORM_ROLE_MODULES.super_admin);
    const visible = groups.flatMap((g) => g.items.map((i) => i.href));
    expect(visible).toEqual(["/admin", "/admin/raporlar", "/admin/tenants", "/admin/members", "/admin/billing", "/admin/site", "/admin/tickets", "/admin/sistem"]);
    const folded = groups.flatMap((g) => g.folded.map((i) => i.href));
    expect(folded).toEqual(expect.arrayContaining(["/admin/danisman", "/admin/ayarlar", "/admin/personel", "/admin/geo"]));
  });

  it("çekirdeği olmayan grup (rol süzgeci sonrası) tam gösterilir; boş grup yoktur", () => {
    for (const mods of Object.values(PLATFORM_ROLE_MODULES)) {
      for (const g of adminSidebarModel(mods)) {
        expect(g.items.length).toBeGreaterThan(0);
        if (g.folded.length > 0) expect(g.items.every((i) => i.core)).toBe(true);
      }
    }
  });

  it("çekirdek bayrağı yalnız 8 tanımlı menü öğesinde", () => {
    expect(ADMIN_NAV.flatMap((s) => s.items).filter((i) => i.core).length).toBe(8);
  });
});
