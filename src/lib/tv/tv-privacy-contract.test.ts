import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8");
const CLIENT_FILES = [
  "src/app/app/pano-tv/page.tsx",
  "src/app/app/pano-tv/tv-board.tsx",
  "src/app/app/pano-tv/tv-scenes.tsx",
  "src/app/app/pano-tv/tv-viz.tsx",
  "src/app/app/pano-tv/tv-settings.tsx",
  "src/app/app/pano-tv/tv-hooks.ts",
];
const TV_FILES = [...CLIENT_FILES, "src/lib/tv/tv-data.ts", "src/app/api/app/tv-data/route.ts", "src/app/api/tv/data/route.ts"];

describe("TV panosu gizlilik sözleşmesi (herkese açık odada görünür)", () => {
  it("telefon / e-posta / TC / adres / IBAN / doğum tarihi alanı sorgulanmaz ya da render edilmez", () => {
    for (const f of TV_FILES) {
      const src = read(f);
      expect(src, f).not.toMatch(/\b(phone|email|tc_no|tc_kimlik|identity_no|national_id\w*|address|address_line|iban\w*|birth_date)\b/i);
      expect(src, f).not.toMatch(/type=["'](tel|email)["']/);
    }
  });

  it("kişi adı yalnız shortName ile çıkar; tam ad istemciye gitmez", () => {
    const data = read("src/lib/tv/tv-data.ts");
    expect(data).toContain("customer: shortName(cust?.full_name");
    expect(data).toContain('name: shortName(r.fullName, "Danışman")');
    // DTO'da müşteri/personel adı alanı yalnız kısaltılmış değerdir
    expect(data).not.toMatch(/(customer|name):\s*(cust\?\.full_name|r\.fullName|String\(r\.full_name)/);
    for (const f of CLIENT_FILES) {
      expect(read(f), f).not.toContain("full_name");
      expect(read(f), f).not.toContain("fullName");
    }
  });

  it("görev başlığı (serbest metin) ve personel özel tablosu TV'ye girmez", () => {
    const data = read("src/lib/tv/tv-data.ts");
    expect(data).toContain('select("id, kind, priority, due_at, assigned_to")');
    expect(data).not.toContain("advisor_private");
  });

  it("oturumlu uç: service_role yok, yetki kapısı + no-store", () => {
    for (const f of [...CLIENT_FILES, "src/lib/tv/tv-data.ts", "src/app/api/app/tv-data/route.ts"]) expect(read(f), f).not.toContain("createAdminClient");
    const route = read("src/app/api/app/tv-data/route.ts");
    expect(route).toContain('requirePermission("reports", "view")');
    expect(route).toContain("canViewTv(gate.role)");
    expect(route).toContain("no-store");
  });

  it("tutar: ofis ayarı + istek + earnings_all (üçlü kapı, sunucuda); varsayılan kapalı; cihazda asla", () => {
    const data = read("src/lib/tv/tv-data.ts");
    expect(data).toContain("opts.moneyAllowed && config.showMoney && metrics.seeAllEarnings");
    expect(read("src/lib/tv/tv-logic.ts")).toContain("showMoney: false");
    const device = read("src/app/api/tv/data/route.ts");
    expect(device).toContain("moneyAllowed: false");
    expect(device).toContain('coverMode: "public"');
    expect(device).toContain("immutableReadonlyPermissions()");
  });

  it("TV ayarı yalnız köprü eylemiyle (settings:edit + TV rolü) yazılır", () => {
    const action = read("src/app/actions/tv-config.ts");
    expect(action).toContain('requirePermission("settings", "edit"');
    expect(action).toContain("canViewTv(gate.role)");
    expect(action).toContain("fromBridge: true");
    expect(read("src/lib/settings/registry/tv.ts")).toContain('editMode: "bridge"');
  });

  it("token'lı herkese açık TV rotası yok (cihaz yalnız eşleştirme çereziyle)", () => {
    expect(read("src/app/app/pano-tv/page.tsx")).toContain('requireModulePage("reports"');
    expect(read("src/app/api/tv/data/route.ts")).toContain("resolveTvDevice");
  });
});
