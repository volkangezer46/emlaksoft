import { describe, expect, it } from "vitest";
import {
  PLATFORM_MODULES,
  PLATFORM_READONLY_MODULES,
  PLATFORM_ROLE_MODULES,
  fixedRoleMatrix,
  normalizeMatrix,
  platformCan,
  platformCanAccess,
  platformModuleMode,
  platformModulesFor,
  platformRoleLabel,
  type PlatformCustomRole,
  type PlatformPrincipal,
  type PlatformRole,
} from "./platform-access";
import { adminNavFor } from "./admin/nav";
import { officeAdminCan, OFFICE_ADMIN_ACTIONS } from "./admin/office-admin-access";
import { homeVariantFor, platformHomeSections } from "./admin/dashboard-layout";

const ROLES: PlatformRole[] = ["super_admin", "ops", "support", "billing"];

/** DG1 öncesi kuralların birebir kopyası (geriye uyumluluk ölçütü). */
const legacyCanAccess = (role: PlatformRole, m: string) => (PLATFORM_ROLE_MODULES[role] as string[]).includes(m);
const legacyMode = (role: PlatformRole, m: string) =>
  !legacyCanAccess(role, m) ? "none" : (PLATFORM_READONLY_MODULES[role] as string[] | undefined)?.includes(m) ? "readonly" : "write";

const custom = (permissions: PlatformCustomRole["permissions"], baseRole: PlatformCustomRole["baseRole"] = "support"): PlatformPrincipal => ({
  role: baseRole,
  customRole: { id: "r1", label: "Finans onaylayıcı", baseRole, permissions },
});

describe("DG1 sabit roller matrise birebir haritalanır (mevcut personel davranışı değişmez)", () => {
  it("her rol × modül: erişim ve kip eski kuralla aynı (rol adı ve personel kaydı biçimiyle)", () => {
    for (const role of ROLES) {
      for (const m of PLATFORM_MODULES) {
        expect(platformCanAccess(role, m), `${role}/${m}`).toBe(legacyCanAccess(role, m));
        expect(platformCanAccess({ role }, m), `${role}/${m} kayıt`).toBe(legacyCanAccess(role, m));
        expect(platformCanAccess({ role, customRole: null }, m)).toBe(legacyCanAccess(role, m));
        expect(platformModuleMode(role, m), `${role}/${m} kip`).toBe(legacyMode(role, m));
      }
      expect([...platformModulesFor(role)].sort()).toEqual([...PLATFORM_ROLE_MODULES[role]].sort());
    }
  });

  it("onay (approve) yalnız süper adminde; diğer roller erişebildiği her modülde yazar (ops × reklam hariç)", () => {
    for (const m of PLATFORM_MODULES) expect(platformCan("super_admin", m, "approve")).toBe(true);
    for (const role of ["ops", "support", "billing"] as const) {
      for (const m of PLATFORM_MODULES) {
        expect(platformCan(role, m, "approve")).toBe(false);
        expect(platformCan(role, m, "write")).toBe(legacyMode(role, m) === "write");
      }
    }
    expect(fixedRoleMatrix("ops").reklam).toEqual(["view"]);
  });

  it("ofis yönetimi eylemleri sabit rollerde aynı (yıkıcılar yalnız süper admin)", () => {
    expect(OFFICE_ADMIN_ACTIONS.filter((a) => officeAdminCan("ops", a))).toEqual(
      OFFICE_ADMIN_ACTIONS.filter((a) => officeAdminCan({ role: "ops" }, a)),
    );
    expect(officeAdminCan("super_admin", "archive")).toBe(true);
    for (const role of ["ops", "support", "billing"] as const) {
      expect(officeAdminCan(role, "archive")).toBe(false);
      expect(officeAdminCan(role, "suspend")).toBe(false);
    }
    expect(officeAdminCan("billing", "plan_status")).toBe(true);
    expect(officeAdminCan("support", "edit_profile")).toBe(true);
    expect(officeAdminCan("ops", "export_vault")).toBe(true);
  });

  it("panel varyantı ve bölümleri sabit rollerde aynı", () => {
    expect(homeVariantFor("billing")).toBe("billing");
    expect(homeVariantFor("support")).toBe("support");
    expect(homeVariantFor({ role: "ops" })).toBe("platform");
    expect(platformHomeSections("super_admin")).toContain("mrr");
    expect(platformHomeSections("ops")).not.toContain("mrr");
    expect(platformHomeSections("ops")).toContain("health");
  });
});

describe("DG1 özel rol: yalnız izin verilen modüller", () => {
  const finance = custom({ billing: ["approve"], tickets: ["view"] }, "ops");

  it("matris normalize: approve ⊇ write ⊇ view, bilinmeyen modül/eylem atılır, Genel bakış hep görünür", () => {
    expect(normalizeMatrix({ billing: ["approve"], foo: ["view"], tickets: ["delete", "view"], geo: [] })).toEqual({
      dashboard: ["view"],
      billing: ["view", "write", "approve"],
      tickets: ["view"],
    });
    expect(normalizeMatrix(null)).toEqual({ dashboard: ["view"] });
    expect(normalizeMatrix(["billing"])).toEqual({ dashboard: ["view"] });
  });

  it("taban rolün (ops) modülleri SIZMAZ: yalnız matristekiler görünür", () => {
    expect(platformModulesFor(finance)).toEqual(["dashboard", "billing", "tickets"]);
    expect(platformCanAccess(finance, "tenants")).toBe(false);
    expect(platformCanAccess(finance, "sistem")).toBe(false);
    expect(platformModuleMode(finance, "tickets")).toBe("readonly");
    expect(platformModuleMode(finance, "billing")).toBe("write");
    expect(platformCan(finance, "billing", "approve")).toBe(true);
    expect(platformRoleLabel(finance)).toBe("Finans onaylayıcı");
    expect(platformRoleLabel({ role: "ops" })).toBe("Operasyon");
  });

  it("menü yalnız izinli bölümleri gösterir", () => {
    const hrefs = adminNavFor(platformModulesFor(finance)).flatMap((s) => s.items.map((i) => i.href));
    expect(hrefs).toContain("/admin");
    expect(hrefs).toContain("/admin/billing");
    expect(hrefs).toContain("/admin/tickets");
    expect(hrefs).not.toContain("/admin/tenants");
    expect(hrefs).not.toContain("/admin/sistem");
    expect(hrefs).not.toContain("/admin/personel");
    const panelTabs = adminNavFor(platformModulesFor(finance)).flatMap((s) => s.items).find((i) => i.href === "/admin")!.tabs!.map((t) => t.href);
    expect(panelTabs).toContain("/admin/onaylar");
    expect(panelTabs).not.toContain("/admin/raporlar");
  });

  it("ofis eylemleri: ofis modülü yoksa hiçbiri; salt okunur ofis modülünde yazma yok; approve yıkıcıyı açar", () => {
    expect(OFFICE_ADMIN_ACTIONS.some((a) => officeAdminCan(finance, a))).toBe(false);
    const viewer = custom({ tenants: ["view"], billing: ["write"] }, "billing");
    expect(OFFICE_ADMIN_ACTIONS.some((a) => officeAdminCan(viewer, a))).toBe(false);
    const closer = custom({ tenants: ["approve"] }, "support");
    expect(officeAdminCan(closer, "archive")).toBe(true);
    expect(officeAdminCan(closer, "plan_status")).toBe(false); // faturalama modülü yok
  });

  it("panel: ofisleri görmeyen özel rol ofis metriklerini görmez", () => {
    expect(homeVariantFor(finance)).toBe("billing");
    expect(homeVariantFor(custom({ tickets: ["write"] }))).toBe("support");
    const sections = platformHomeSections(custom({ geo: ["view"] }, "ops"));
    expect(sections).toEqual(["attention", "geo"]);
  });
});
