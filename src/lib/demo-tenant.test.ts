import { describe, expect, it } from "vitest";
import { impersonationAllowedForStaff, isDemoTenantSlug } from "@/lib/demo-tenant";

describe("demo kiracı kimliği (YD1)", () => {
  it("yalnız demo slug'ı demo sayılır; ad benzerliği yetmez", () => {
    expect(isDemoTenantSlug("demo-ofis")).toBe(true);
    expect(isDemoTenantSlug(" DEMO-OFIS ")).toBe(true);
    expect(isDemoTenantSlug("demo-ofis-2")).toBe(false);
    expect(isDemoTenantSlug("Demo Emlak Ofisi")).toBe(false);
    expect(isDemoTenantSlug(null)).toBe(false);
  });

  it("demo platform kişiliği yalnız demo ofise girebilir; gerçek personel her ofise", () => {
    expect(impersonationAllowedForStaff("admin@demo.emlaksoft.test", "demo-ofis")).toBe(true);
    expect(impersonationAllowedForStaff("admin@demo.emlaksoft.test", "gercek-ofis")).toBe(false);
    expect(impersonationAllowedForStaff("OPS@DEMO.EMLAKSOFT.TEST", "gercek-ofis")).toBe(false);
    expect(impersonationAllowedForStaff("volkan@emlaksoft.com.tr", "gercek-ofis")).toBe(true);
  });
});
