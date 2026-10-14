import { describe, expect, it } from "vitest";
import { ALL_NAV_HREFS } from "@/lib/nav-config";
import {
  PLAN_GATES,
  PLAN_GATING_START,
  findGate,
  gatesLockedAfterTrial,
  lockedGate,
  lockedHrefs,
  planGatingApplies,
  requiredPlanName,
} from "./page-gates";

const NEW = "2026-11-01T00:00:00.000Z";
const OLD = "2026-07-01T00:00:00.000Z";
const ctx = (plan: string, over: Partial<{ trial: boolean; tenantCreatedAt: string | null }> = {}) => ({
  plan,
  trial: false,
  tenantCreatedAt: NEW,
  ...over,
});

describe("paket kilidi", () => {
  it("mevcut tenant'lar (kesim tarihinden önce) kilitlenmez", () => {
    expect(planGatingApplies(ctx("advisor", { tenantCreatedAt: OLD }))).toBe(false);
    expect(lockedHrefs(ctx("advisor", { tenantCreatedAt: OLD }))).toEqual([]);
    expect(lockedGate("/app/teklifler", ctx("advisor", { tenantCreatedAt: OLD }))).toBeNull();
  });

  it("kesim tarihi tam sınırda dahildir; geçersiz/boş tarih kilitlemez", () => {
    expect(planGatingApplies(ctx("advisor", { tenantCreatedAt: PLAN_GATING_START }))).toBe(true);
    expect(planGatingApplies(ctx("advisor", { tenantCreatedAt: null }))).toBe(false);
    expect(planGatingApplies(ctx("advisor", { tenantCreatedAt: "bozuk" }))).toBe(false);
  });

  it("deneme süresince her şey açıktır", () => {
    expect(lockedHrefs(ctx("advisor", { trial: true }))).toEqual([]);
    expect(lockedGate("/app/projeler", ctx("advisor", { trial: true }))).toBeNull();
  });

  it("Danışman çekirdeği açık, ekip/teklif/kayıp-kaçak kilitli", () => {
    const c = ctx("advisor");
    for (const open of ["/app", "/app/musteriler", "/app/portfoyler", "/app/talepler", "/app/randevular", "/app/komisyon", "/app/degerleme", "/app/abonelik", "/app/ayarlar"]) {
      expect(lockedGate(open, c), open).toBeNull();
    }
    for (const locked of ["/app/teklifler", "/app/sozlesmeler", "/app/ekip", "/app/kayip-kacak", "/app/otomasyonlar", "/app/projeler"]) {
      expect(lockedGate(locked, c), locked).not.toBeNull();
    }
  });

  it("Ofis ekip ve sözleşmeyi açar, kayıp-kaçak ve otomasyonu açmaz", () => {
    const c = ctx("office");
    expect(lockedGate("/app/ekip", c)).toBeNull();
    expect(lockedGate("/app/sozlesmeler/abc", c)).toBeNull();
    expect(lockedGate("/app/kayip-kacak", c)?.title).toContain("Kayıp-kaçak");
    expect(lockedGate("/app/otomasyonlar", c)).not.toBeNull();
  });

  it("Profesyonel kayıp-kaçak ve otomasyonu açar, proje satışını açmaz; Kurumsal hepsini açar", () => {
    expect(lockedGate("/app/kayip-kacak", ctx("professional"))).toBeNull();
    expect(lockedGate("/app/otomasyonlar", ctx("professional"))).toBeNull();
    expect(lockedGate("/app/projeler", ctx("professional"))?.minPlan).toBe("enterprise");
    expect(lockedHrefs(ctx("enterprise"))).toEqual([]);
  });

  it("alt sayfalar üst kilidi miras alır; istisna yollar paketten bağımsız açıktır", () => {
    expect(findGate("/app/teklifler/123")?.href).toBe("/app/teklifler");
    expect(findGate("/app/ekip/izinler")?.href).toBe("/app/ekip");
    expect(findGate("/app/ekip/kartvizitim")).toBeNull();
    expect(findGate("/app/musteriler")).toBeNull();
  });

  it("bilinmeyen paket Ofis gibi davranır (güvenli varsayılan)", () => {
    expect(lockedGate("/app/ekip", ctx("bilinmeyen"))).toBeNull();
    expect(lockedGate("/app/kayip-kacak", ctx("bilinmeyen"))).not.toBeNull();
  });

  it("her kilit menüde bir sayfaya karşılık gelir ve tekrar etmez", () => {
    const hrefs = PLAN_GATES.map((g) => g.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    const orphans = hrefs.filter((h) => !ALL_NAV_HREFS.includes(h) && h !== "/app/franchise" && h !== "/app/ofis-kontrol/kurallar");
    expect(orphans).toEqual([]);
    expect(requiredPlanName(PLAN_GATES[0]!)).toBe("Ofis");
  });
});

// Kilit tanımı ile sayfa kapısı birbirinden kopmasın: kilitli her sayfa kendi yolunu
// requireModulePage'e vermeli (aksi halde menüde kilit görünür ama sayfa açılır).
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, dirname, sep } from "node:path";

function pagesUnder(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) pagesUnder(full, out);
    else if (name === "page.tsx") out.push(full);
  }
  return out;
}

describe("paket kilidi sayfalara bağlı", () => {
  it("kilitli yolların her sayfası requireModulePage'e kendi kilit yolunu verir", () => {
    const missing: string[] = [];
    for (const gate of PLAN_GATES) {
      const dir = join("src/app", gate.href.replace(/^\/app/, "app"));
      for (const file of pagesUnder(dir)) {
        const url = "/" + relative("src/app", dirname(file)).split(sep).join("/");
        const owner = findGate(url);
        if (!owner || owner.href !== gate.href) continue; // istisna veya daha özel kilit
        if (!readFileSync(file, "utf8").includes(`, "${gate.href}")`)) missing.push(`${url} → ${gate.href}`);
      }
    }
    expect(missing).toEqual([]);
  });
});

describe("deneme sonrası kilitlenecek sayfalar (deneme bandı)", () => {
  it("PLAN_GATES'ten üretilir: aynı ofis planı için lockedHrefs ile birebir aynıdır", () => {
    const fromBanner = gatesLockedAfterTrial({ plan: "office", tenantCreatedAt: NEW }).map((g) => g.href);
    expect(fromBanner).toEqual(lockedHrefs(ctx("office")));
    expect(fromBanner.length).toBeGreaterThan(0);
    expect(fromBanner).toContain("/app/lig");
    expect(fromBanner).not.toContain("/app/teklifler");
  });

  it("kesim tarihinden eski tenant'ta ve en üst pakette boş döner", () => {
    expect(gatesLockedAfterTrial({ plan: "office", tenantCreatedAt: OLD })).toEqual([]);
    expect(gatesLockedAfterTrial({ plan: "enterprise", tenantCreatedAt: NEW })).toEqual([]);
  });
});
