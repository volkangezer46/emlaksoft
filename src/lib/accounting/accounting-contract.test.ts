import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("muhasebe sözleşmesi", () => {
  const route = read("src/app/admin/muhasebe/disa-aktar/route.ts");
  const action = read("src/app/actions/accounting.ts");
  const loaders = read("src/lib/accounting/loaders.ts");

  it("dışa aktarım: oturum + modül yetkisi + hız sınırı + denetim kaydı", () => {
    expect(route).toContain("getPlatformStaff()");
    expect(route).toContain('platformCanAccess(staff.role, "billing")');
    expect(route).toContain("checkRateLimit(");
    expect(route).toContain("logPlatformActivity(");
    expect(route).toContain("ReadableStream");
  });

  it("dışa aktarım denetim kaydına satır içeriği yazılmaz (yalnız süzgeç + sayı)", () => {
    const metaLine = route.split("\n").find((l) => l.includes("meta: {")) ?? "";
    expect(metaLine).toContain("rowCount");
    for (const forbidden of ["invoiceNo", "tenantName", "taxNumber", "grossKurus", "inv."]) {
      expect(metaLine).not.toContain(forbidden);
    }
  });

  it("EmlakFiyatı maliyet yazımı: yalnız süper admin, denetimli, async export", () => {
    expect(action.startsWith('"use server"')).toBe(true);
    expect(action).toContain('roles: ["super_admin"]');
    expect(action).toContain("logPlatformActivity(");
    const exportsList = action.match(/^export (?!async function)(?!type )/gm);
    expect(exportsList).toBeNull();
  });

  it("okuyucular yeni service_role üretmez (istemci çağıranla gelir)", () => {
    expect(loaders).not.toContain("createAdminClient(");
    expect(loaders).toContain('import "server-only"');
  });

  it("muhasebe sayfaları billing modül kapısından geçer", () => {
    expect(read("src/app/admin/muhasebe/page.tsx")).toContain('requirePlatformModule("billing")');
    expect(read("src/app/admin/muhasebe/defter/page.tsx")).toContain('requirePlatformModule("billing")');
  });

  it("MRR/ARR tek hesaptan: loaders exactMrr/exactArr kullanır, kendi formülü yok", () => {
    expect(loaders).toContain("exactMrr(");
    expect(loaders).toContain("exactArr(");
    expect(loaders).not.toMatch(/mrr\s*\*\s*12/);
  });
});
