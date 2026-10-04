import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { actionBlockedByModule, featureForPermissionModule } from "@/lib/modules/guard";
import { groupPending, PENDING_DEFS } from "@/lib/modules/pending-defs";
import { featureForHref, isFeatureKey, type FeatureKey } from "@/lib/modules/registry";
import { skippedTenantsNote, tenantsDisabledFor } from "@/lib/modules/state";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

/* ---------------------------- 1) Server action kapısı ---------------------------- */

const closedKeys = vi.hoisted(() => ({ value: [] as string[] }));

vi.mock("@/lib/tenant-guard", () => ({
  requireActiveTenant: vi.fn(async () => ({ ok: true, userId: "u1", tenantId: "t1", role: "owner", impersonating: false })),
}));
vi.mock("@/lib/permissions-effective", () => ({
  getEffectivePermissions: vi.fn(async () => ({})),
  effectiveHasPermission: vi.fn(() => true),
  immutableReadonlyPermissions: vi.fn(() => ({})),
}));
vi.mock("@/lib/modules/state", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/modules/state")>();
  return {
    ...actual,
    isModuleEnabled: vi.fn(async (_tenantId: string, key: string) => !closedKeys.value.includes(key)),
  };
});

describe("server action modül kapısı (requirePermission)", () => {
  beforeEach(() => {
    closedKeys.value = [];
  });

  it("modül kapalıyken yazma eylemi anlaşılır Türkçe hatayla reddedilir", async () => {
    closedKeys.value = ["campaigns"];
    const { requirePermission } = await import("@/lib/require-permission");
    for (const action of ["create", "edit", "delete"] as const) {
      const res = await requirePermission("campaigns", action);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toContain("Kampanyalar");
        expect(res.error).toContain("kapalı");
      }
    }
  });

  it("kapalı modülde okuma (view) engellenmez: dışa aktarım ve veri sahipliği korunur", async () => {
    closedKeys.value = ["contracts"];
    const { requirePermission } = await import("@/lib/require-permission");
    expect((await requirePermission("contracts", "view")).ok).toBe(true);
  });

  it("modül açıkken ve çekirdek modüllerde eylem geçer", async () => {
    closedKeys.value = ["campaigns", "offers"];
    const { requirePermission } = await import("@/lib/require-permission");
    expect((await requirePermission("contracts", "create")).ok).toBe(true);
    expect((await requirePermission("customers", "create")).ok).toBe(true);
    expect((await requirePermission("appointments", "edit")).ok).toBe(true);
    expect((await requirePermission("settings", "edit")).ok).toBe(true);
  });
});

describe("modül kapısı eşlemesi (saf)", () => {
  it("yalnız bire bir örtüşen izin modülleri eşlenir; çekirdek ve geniş modüller eşlenmez", () => {
    for (const mod of ["customers", "properties", "appointments", "tasks", "commissions", "dashboard", "settings", "team", "billing", "compliance", "reports", "targets"]) {
      expect(featureForPermissionModule(mod)).toBeNull();
    }
    for (const mod of ["campaigns", "contracts", "offers", "open_house", "rentals", "projects", "network", "portals", "leak", "valuation", "expenses"]) {
      const key = featureForPermissionModule(mod);
      expect(key).not.toBeNull();
      expect(isFeatureKey(key)).toBe(true);
    }
  });

  it("actionBlockedByModule: yalnız kapalı modülün yazma eylemini engeller", () => {
    expect(actionBlockedByModule("rentals", "create", ["rentals"])).toBe("rentals");
    expect(actionBlockedByModule("rentals", "view", ["rentals"])).toBeNull();
    expect(actionBlockedByModule("rentals", "edit", [])).toBeNull();
    expect(actionBlockedByModule("customers", "delete", ["rentals", "campaigns"])).toBeNull();
  });
});

/* ------------------------------ 2) Zamanlanmış işler ------------------------------ */

describe("zamanlanmış işler kapalı modüllü ofisleri atlar", () => {
  const CRONS: { file: string; key: FeatureKey }[] = [
    { file: "src/app/api/cron/portal-teyit/route.ts", key: "portals" },
    { file: "src/app/api/cron/anahtar-gecikme/route.ts", key: "keys" },
    { file: "src/app/api/cron/kira-tahakkuk/route.ts", key: "rentals" },
    { file: "src/app/api/cron/proje-vade/route.ts", key: "projects" },
    { file: "src/app/api/cron/leak-sla/route.ts", key: "leak" },
    { file: "src/app/api/cron/bolge-snapshot/route.ts", key: "reports" },
    { file: "src/app/api/cron/haftalik-ozet/route.ts", key: "reports" },
    { file: "src/app/api/cron/lig-snapshot/route.ts", key: "team_perf" },
    { file: "src/app/api/cron/vitrin-eslesme/route.ts", key: "vitrin" },
  ];

  for (const { file, key } of CRONS) {
    it(`${file.split("/").slice(-2, -1)[0]}: "${key}" kapalı ofisi atlar ve heartbeat'e sayıyı yazar`, () => {
      const src = read(file);
      expect(src).toContain("getDisabledModulesByTenant");
      expect(src).toContain(`"${key}"`);
      expect(src).toMatch(new RegExp(`isDisabledFor\\(disabledModules, [^\\n]*"${key}"\\)`));
      expect(src).toContain(`skippedTenantsNote(disabledModules, "${key}")`);
      expect(src).toContain("recordHeartbeat");
    });
  }

  it("vitrin-alarm: kapalı ofisin alarmları taranmaz ve heartbeat'e sayı yazılır", () => {
    const route = read("src/app/api/cron/vitrin-alarm/route.ts");
    expect(route).toContain('tenantsDisabledFor(disabledModules, "vitrin")');
    expect(route).toContain('skippedTenantsNote(disabledModules, "vitrin")');
    expect(read("src/lib/vitrin-alert-notify.ts")).toContain("skipTenantIds.has(a.tenant_id)");
  });

  it("campaign-delivery: kapalı ofisin kampanyası claim edilmez, özetinde atlanan ofis sayısı vardır", () => {
    const lib = read("src/lib/campaign-delivery.ts");
    expect(lib).toContain('tenantsDisabledFor(await getDisabledModulesByTenant(admin), "campaigns")');
    expect(lib).toContain('query.not("tenant_id", "in"');
    expect(lib).toContain("summary.skippedTenants");
  });

  it("otomasyon motoru kapalı otomasyon modülünü atlar", () => {
    expect(read("src/lib/automation-engine.ts")).toContain('isDisabledFor(disabledModules, row.tenant_id, "automation")');
  });

  it("atlama yardımcıları: ofis listesi ve heartbeat notu", () => {
    const map = new Map<string, Set<FeatureKey>>([
      ["t1", new Set<FeatureKey>(["reports", "keys"])],
      ["t2", new Set<FeatureKey>(["reports"])],
      ["t3", new Set<FeatureKey>(["keys"])],
    ]);
    expect(tenantsDisabledFor(map, "reports").sort()).toEqual(["t1", "t2"]);
    expect(skippedTenantsNote(map, "reports")).toBe(" · 2 ofis atlandı (modül kapalı)");
    expect(skippedTenantsNote(map, "projects")).toBe("");
    expect(skippedTenantsNote(new Map(), "reports")).toBe("");
  });

  it("cron sayısı değişmedi: yeni route dosyası eklenmedi (vercel.json ile uyumlu)", () => {
    const vercel = JSON.parse(read("vercel.json")) as { crons: { path: string }[] };
    for (const { file } of CRONS) {
      const p = "/" + file.replace("src/app/", "").replace("/route.ts", "");
      expect(vercel.crons.some((c) => c.path.startsWith(p))).toBe(true);
    }
  });
});

/* -------------------------------- 3) Public kapı --------------------------------- */

describe("public yüzeyler kapalı modülde 'kapalı' sayfası döner", () => {
  const PAGES: { file: string; key: FeatureKey }[] = [
    { file: "src/app/vitrin/[slug]/page.tsx", key: "vitrin" },
    { file: "src/app/vitrin/[slug]/[id]/page.tsx", key: "vitrin" },
    { file: "src/app/vitrin/[slug]/degerleme/page.tsx", key: "vitrin" },
    { file: "src/app/vitrin/[slug]/favoriler/page.tsx", key: "vitrin" },
    { file: "src/app/danisman/[slug]/page.tsx", key: "vitrin" },
    { file: "src/app/randevu-al/[token]/page.tsx", key: "vitrin" },
    { file: "src/app/paylas/[token]/page.tsx", key: "presentations" },
    { file: "src/app/sunum/[token]/page.tsx", key: "presentations" },
    { file: "src/app/degerleme-raporu/[token]/page.tsx", key: "valuation" },
    { file: "src/app/imza/[token]/page.tsx", key: "contracts" },
    { file: "src/app/tavsiye/[token]/page.tsx", key: "smart_lists" },
    { file: "src/app/acik-ev-kayit/[token]/page.tsx", key: "open_house" },
    { file: "src/app/musteri-portali/[token]/page.tsx", key: "client_portals" },
    { file: "src/app/malik-portali/[token]/page.tsx", key: "client_portals" },
  ];

  for (const { file, key } of PAGES) {
    it(`${file}: "${key}" kapalıyken PublicModuleClosed döner`, () => {
      const src = read(file);
      expect(src).toMatch(new RegExp(`isPublicFeatureClosed\\(admin, [^,]+, "${key}"\\)\\) return <PublicModuleClosed`));
    });
  }

  it("kapı, ofis/örnek-veri süzgecinden SONRA gelir: kapalı olmayan ofiste davranış değişmez (404 korunur)", () => {
    // Portal sayfaları token'ı sunucu fonksiyonuyla çözer (notFound çağrısı o fonksiyonun içindedir).
    for (const { file } of PAGES.filter((p) => p.key !== "client_portals")) {
      const src = read(file);
      const gate = src.indexOf("isPublicFeatureClosed(admin");
      expect(gate).toBeGreaterThan(-1);
      // Önce ofis/token doğrulaması (notFound ya da aktif-ofis kontrolü) yapılır.
      expect(/notFound\(|isPublicTenantActive\(/.test(src.slice(0, gate))).toBe(true);
    }
  });

  it("public yollar kayıt defterindeki modüle bağlanır", () => {
    expect(featureForHref("/app/degerleme")).toBe("valuation");
  });
});

/* ---------------------------- 4) Kapatırken bekleyen iş --------------------------- */

describe("kapatırken bekleyen iş uyarısı", () => {
  it("her tanım gerçek bir modüle ve o modülün sayfasına filtreli bağlantıya gider", () => {
    for (const def of PENDING_DEFS) {
      expect(isFeatureKey(def.module)).toBe(true);
      expect(def.href.startsWith("/app/")).toBe(true);
      expect(featureForHref(def.href)).toBe(def.module);
      expect(def.values.length).toBeGreaterThan(0);
    }
    expect(new Set(PENDING_DEFS.map((d) => d.id)).size).toBe(PENDING_DEFS.length);
  });

  it("groupPending sıfır sayıları dışlar ve modüle göre gruplar", () => {
    const grouped = groupPending(new Map([["campaign-scheduled", 3], ["campaign-sending", 0], ["contract-sent", 2]]));
    expect(Object.keys(grouped).sort()).toEqual(["campaigns", "contracts"]);
    expect(grouped.campaigns).toEqual([
      { id: "campaign-scheduled", label: "zamanlanmış kampanya", count: 3, href: "/app/kampanyalar?durum=scheduled" },
    ]);
    expect(groupPending(new Map())).toEqual({});
  });

  it("ekran kapatmaya engel koymaz: onay paneli satır içi ve bağlantılıdır", () => {
    const board = read("src/app/app/ayarlar/moduller/modules-board.tsx");
    expect(board).toContain("Bu modülde bekleyen iş var");
    expect(board).toContain("Yine de kapatabilirsiniz");
    expect(board).toContain("href={item.href}");
    expect(board).not.toMatch(/window\.confirm|<dialog/);
  });
});
