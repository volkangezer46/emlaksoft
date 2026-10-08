import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("muhasebe sözleşmesi", () => {
  const download = read("src/lib/report-center/download.ts");
  const report = read("src/lib/report-center/catalog/platform-accounting.ts");
  const action = read("src/app/actions/accounting.ts");
  const loaders = read("src/lib/accounting/loaders.ts");

  it("dışa aktarım Rapor merkezindedir: oturum + modül yetkisi + hız sınırı + denetim kaydı; eski uç kaldırıldı", () => {
    expect(() => read("src/app/admin/muhasebe/disa-aktar/route.ts")).toThrow();
    expect(download).toContain("getPlatformStaff()");
    expect(download).toContain("platformReportAllowed(");
    expect(download).toContain("checkRateLimit(");
    expect(download).toContain("logPlatformActivity(");
    expect(report).toContain('platformModule: "billing"');
    expect(report).toContain("iterateInvoicePages(");
    expect(report).toContain("matchesLedger(");
  });

  it("dışa aktarım denetim kaydına satır içeriği yazılmaz (yalnız süzgeç + sayı)", () => {
    const metaLine = download.split("\n").find((l) => l.includes("const auditValue")) ?? "";
    expect(metaLine).toContain("rows: result.rowCount");
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
