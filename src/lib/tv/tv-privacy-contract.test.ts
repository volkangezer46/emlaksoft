import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8");
const TV_FILES = [
  "src/app/app/pano-tv/page.tsx",
  "src/app/app/pano-tv/tv-board.tsx",
  "src/app/app/pano-tv/tv-hooks.ts",
  "src/lib/tv/tv-data.ts",
  "src/app/api/app/tv-data/route.ts",
];

describe("TV panosu gizlilik sözleşmesi (herkese açık odada görünür)", () => {
  it("telefon / e-posta / TC / adres alanı sorgulanmaz ya da render edilmez", () => {
    for (const f of TV_FILES) {
      const src = read(f);
      expect(src, f).not.toMatch(/\b(phone|email|tc_no|tc_kimlik|identity_no|address|iban)\b/i);
      expect(src, f).not.toMatch(/type=["'](tel|email)["']/);
    }
  });

  it("müşteri adı yalnız shortName ile çıkar; tam ad istemciye gitmez", () => {
    const data = read("src/lib/tv/tv-data.ts");
    expect(data).toContain("customer: shortName(cust?.full_name");
    // DTO'da müşteri adı alanı yalnız kısaltılmış değerdir
    expect(data).not.toMatch(/customer:\s*(cust\?\.full_name|String\()/);
    const board = read("src/app/app/pano-tv/tv-board.tsx");
    expect(board).not.toContain("full_name");
    expect(board).not.toContain("fullName");
  });

  it("service_role yok; kullanıcı oturumlu client + yetki kapısı", () => {
    for (const f of TV_FILES) expect(read(f), f).not.toContain("createAdminClient");
    const route = read("src/app/api/app/tv-data/route.ts");
    expect(route).toContain('requirePermission("reports", "view")');
    expect(route).toContain("canViewTv(gate.role)");
    expect(route).toContain("no-store");
  });

  it("gelir yalnız istek + earnings_all ile (sunucu kapısı), varsayılan kapalı", () => {
    const data = read("src/lib/tv/tv-data.ts");
    expect(data).toContain("opts.revenueRequested && metrics.seeAllEarnings");
    expect(read("src/lib/tv/tv-logic.ts")).toContain("showRevenue: false");
  });

  it("token'lı herkese açık TV rotası yok", () => {
    expect(read("src/app/app/pano-tv/page.tsx")).toContain('requireModulePage("reports"');
  });
});
