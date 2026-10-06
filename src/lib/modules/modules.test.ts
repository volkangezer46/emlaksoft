import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NAV_SECTIONS, visibleSections, moreSections } from "@/lib/nav-config";
import { getAppActions, getAppGoItems } from "@/lib/palette-core";
import { MODULES as PERMISSION_MODULES_SOURCE } from "@/lib/modules/registry";
import {
  ALL_OPEN_STATE,
  computePresetChanges,
  isFeatureEnabledIn,
  isMissingTableError,
  MODULE_PRESETS,
  resolveModuleState,
  stateFromQuery,
  unavailableState,
} from "@/lib/modules/logic";
import { canManageModules } from "@/lib/modules/permissions";
import {
  closedDependencies,
  CORE_AREAS,
  dependentsOf,
  FEATURE_KEYS,
  featureForHref,
  featureForPublicPath,
  isCoreKey,
  isFeatureKey,
  modulePlanRequirement,
  normalizeClosed,
} from "@/lib/modules/registry";
import { modulePlanInfo, planLockedKeys } from "@/lib/modules/plan";
import type { AppModule } from "@/lib/permissions";

const ROOT = process.cwd();
const ALL_MODULES: AppModule[] = [
  "dashboard", "customers", "demands", "matching", "commissions", "offers", "contracts", "calls",
  "appointments", "tasks", "properties", "portals", "open_house", "rentals", "network", "projects",
  "valuation", "expenses", "billing", "reports", "targets", "leak", "team", "settings", "campaigns",
  "compliance", "support",
];

const trialCtx = { plan: "advisor", trial: true, tenantCreatedAt: "2026-11-01T00:00:00Z" };
const advisorCtx = { plan: "advisor", trial: false, tenantCreatedAt: "2026-11-01T00:00:00Z" };
const legacyCtx = { plan: "advisor", trial: false, tenantCreatedAt: "2026-01-01T00:00:00Z" };

function allHrefs(sections: ReturnType<typeof visibleSections>) {
  return sections.flatMap((s) => s.items.flatMap((i) => [i.href, ...(i.tabs?.map((t) => t.href) ?? [])]));
}

describe("modül kayıt defteri", () => {
  it("27 kapatılabilir modül, anahtarlar benzersiz ve DB biçimine uyar", () => {
    expect(PERMISSION_MODULES_SOURCE.length).toBe(27);
    expect(new Set(FEATURE_KEYS).size).toBe(FEATURE_KEYS.length);
    for (const key of FEATURE_KEYS) expect(key).toMatch(/^[a-z][a-z0-9_]{1,40}$/);
  });

  it("her rota gerçek bir sayfa dosyasına karşılık gelir", () => {
    for (const m of PERMISSION_MODULES_SOURCE) {
      for (const route of m.routes) {
        const dir = path.join(ROOT, "src", route.replace(/^\/app/, "app/app"));
        expect(existsSync(path.join(dir, "page.tsx")), `${m.key}: ${route}`).toBe(true);
      }
    }
  });

  it("kapatılabilir her rotanın sayfası requireModulePage'e href geçirir (paket+modül kapısı için)", () => {
    const missing: string[] = [];
    for (const m of PERMISSION_MODULES_SOURCE) {
      for (const route of m.routes) {
        const file = path.join(ROOT, "src", route.replace(/^\/app/, "app/app"), "page.tsx");
        if (!existsSync(file)) continue;
        const src = readFileSync(file, "utf8");
        // yönlendirme (alias) sayfaları kapı çağırmaz; kapı çağıranlar href vermeli
        if (/requireModulePage\(\s*"[a-z_]+"\s*\)/.test(src)) missing.push(route);
      }
    }
    expect(missing).toEqual([]);
  });

  it("featureForHref: en uzun ön ek; çekirdek yol null", () => {
    expect(featureForHref("/app/portfoyler/sunumlar")).toBe("presentations");
    expect(featureForHref("/app/portfoyler/sunumlar/yeni")).toBe("presentations");
    expect(featureForHref("/app/portfoyler/anahtarlar?durum=gecikmis")).toBe("keys");
    expect(featureForHref("/app/portfoyler")).toBeNull();
    expect(featureForHref("/app/portfoyler/123")).toBeNull();
    expect(featureForHref("/app/ayarlar/is-akislari")).toBe("automation");
    expect(featureForHref("/app/ayarlar/moduller")).toBeNull();
    expect(featureForHref("/app/ayarlar")).toBeNull();
    expect(featureForHref("/app/ekip/kiyas")).toBe("team_perf");
    expect(featureForHref("/app/ekip")).toBeNull();
    expect(featureForHref("/app/kira-artis")).toBe("rentals");
    expect(featureForHref("/app/komisyon")).toBeNull();
    expect(featureForHref("/app")).toBeNull();
  });

  it("çekirdek/sistem alanı kapatılamaz: kayıt defterinde yok ve satır olsa da yok sayılır", () => {
    for (const area of CORE_AREAS) {
      expect(isFeatureKey(area.key)).toBe(false);
      expect(isCoreKey(area.key)).toBe(true);
    }
    const state = resolveModuleState([
      { module_key: "customers", enabled: false, locked_by_platform: false },
      { module_key: "system", enabled: false, locked_by_platform: true },
      { module_key: "uydurma", enabled: false, locked_by_platform: false },
    ]);
    expect(state.closed).toEqual([]);
    expect(state.locked).toEqual([]);
    expect(isFeatureEnabledIn(state, "customers")).toBe(true);
  });

  it("bağımlılık: portallar kapanınca kaçak ve şube/tv zinciri de kapanır, açarken bağımlılık istenir", () => {
    expect(dependentsOf("portals")).toEqual(["leak"]);
    expect(dependentsOf("team_perf")).toEqual(["franchise"]);
    expect(dependentsOf("reports")).toEqual(["tv_board"]);
    expect(normalizeClosed(["portals"])).toEqual(["portals", "leak"]);
    expect(closedDependencies("leak", new Set(["portals"]))).toEqual(["portals"]);
    expect(closedDependencies("portals", new Set(["leak"]))).toEqual([]);
  });

  it("açık ev ve kampanya gibi herkese açık yollar bir modüle bağlanır", () => {
    expect(featureForPublicPath("/imza/abc")).toBe("contracts");
    expect(featureForPublicPath("/sunum/abc")).toBe("presentations");
    expect(featureForPublicPath("/acik-ev-kayit/abc")).toBe("open_house");
    expect(featureForPublicPath("/giris")).toBeNull();
  });
});

describe("modül durumu mantığı (tablo yokken hepsi açık)", () => {
  it("satır yok = hepsi açık", () => {
    const state = resolveModuleState([]);
    expect(state).toEqual(ALL_OPEN_STATE);
    for (const key of FEATURE_KEYS) expect(isFeatureEnabledIn(state, key)).toBe(true);
  });

  it("tablo yok hatası (42P01 / PGRST205) = hepsi açık + 'unavailable' bilgisi", () => {
    for (const error of [
      { code: "42P01", message: 'relation "public.tenant_modules" does not exist' },
      { code: "PGRST205", message: "Could not find the table 'public.tenant_modules' in the schema cache" },
      { code: null, message: "Could not find the table public.tenant_modules in the schema cache" },
    ]) {
      expect(isMissingTableError(error)).toBe(true);
      const state = stateFromQuery(null, error);
      expect(state.status).toBe("unavailable");
      expect(state.closed).toEqual([]);
    }
    expect(unavailableState().status).toBe("unavailable");
  });

  it("beklenmeyen hata sessiz yutulmaz: 'error' durumu + mesaj, güvenli varsayılan açık", () => {
    const state = stateFromQuery(null, { code: "XX000", message: "boom" });
    expect(state.status).toBe("error");
    expect(state.message).toBeTruthy();
    expect(state.closed).toEqual([]);
  });

  it("kapalı satırlar ve platform kilidi", () => {
    const state = resolveModuleState([
      { module_key: "rentals", enabled: false, locked_by_platform: false },
      { module_key: "offers", enabled: true, locked_by_platform: true },
      { module_key: "portals", enabled: false, locked_by_platform: false },
    ]);
    expect(state.closed).toEqual(["rentals", "portals", "leak"]);
    expect(state.locked).toEqual(["offers"]);
    expect(isFeatureEnabledIn(state, "rentals")).toBe(false);
    expect(isFeatureEnabledIn(state, "leak")).toBe(false);
    expect(isFeatureEnabledIn(state, "offers")).toBe(true);
    expect(isFeatureEnabledIn(state, "bilinmeyen")).toBe(true);
  });

  it("yalnız sahip ve genel müdür yönetebilir", () => {
    expect(canManageModules("owner")).toBe(true);
    expect(canManageModules("gm")).toBe(true);
    expect(canManageModules("branch_manager")).toBe(false);
    expect(canManageModules("advisor")).toBe(false);
    expect(canManageModules(null)).toBe(false);
  });
});

describe("ofis tipi ön ayarları", () => {
  const byId = (id: string) => MODULE_PRESETS.find((p) => p.id === id)!;

  it("dört ön ayar; yalnız kayıtlı anahtarlar içerir (çekirdeğe dokunmaz)", () => {
    expect(MODULE_PRESETS.map((p) => p.id)).toEqual(["konut", "arsa_ticari", "kiralama", "franchise"]);
    for (const p of MODULE_PRESETS) for (const k of [...p.close, ...p.open]) expect(isFeatureKey(k)).toBe(true);
  });

  it("konut: proje, yabancı satış, franchise ve TV kapanır; kalan açık", () => {
    const diff = computePresetChanges(byId("konut"), []);
    expect(diff.toClose).toEqual(["projects", "foreign_sale", "franchise", "tv_board"]);
    expect(diff.toOpen).toEqual([]);
    const reopened = computePresetChanges(byId("konut"), ["offers", "projects"]);
    expect(reopened.toOpen).toEqual(["offers"]);
  });

  it("kiralama: portal kapanınca kaçak da kapanır; açık ev kapanır", () => {
    const diff = computePresetChanges(byId("kiralama"), []);
    expect(diff.toClose).toEqual(expect.arrayContaining(["portals", "leak", "open_house", "projects", "network"]));
    expect(diff.toOpen).toEqual([]);
  });

  it("franchise: açar, kapatmaz", () => {
    const diff = computePresetChanges(byId("franchise"), ["team_perf", "franchise", "tv_board", "reports"]);
    expect(diff.toClose).toEqual([]);
    expect(diff.toOpen).toEqual(["team_perf", "franchise", "reports", "tv_board"].sort((a, b) => FEATURE_KEYS.indexOf(a as never) - FEATURE_KEYS.indexOf(b as never)));
  });

  it("platform kilitli ve pakette olmayan modüle dokunmaz", () => {
    const diff = computePresetChanges(byId("konut"), [], { locked: ["projects"], planLocked: ["franchise"] });
    expect(diff.toClose).toEqual(["foreign_sale", "tv_board"]);
    expect(diff.skipped.map((s) => s.key).sort()).toEqual(["franchise", "projects"]);
  });
});

describe("paket bilgisi PLAN_GATES'ten türer", () => {
  it("modulePlanRequirement: gereken en düşük paket", () => {
    expect(modulePlanRequirement("projects")?.minPlan).toBe("enterprise");
    expect(modulePlanRequirement("leak")?.minPlan).toBe("professional");
    expect(modulePlanRequirement("offers")?.minPlan).toBe("office");
    expect(modulePlanRequirement("documents")).toBeNull();
    expect(modulePlanRequirement("vitrin")).toBeNull();
  });

  it("deneme ve eski ofiste kilit yok; yeni danışman paketinde kilitli", () => {
    expect(planLockedKeys(trialCtx)).toEqual([]);
    expect(planLockedKeys(legacyCtx)).toEqual([]);
    const locked = planLockedKeys(advisorCtx);
    expect(locked).toEqual(expect.arrayContaining(["projects", "leak", "offers"]));
    expect(locked).not.toContain("documents");
    expect(modulePlanInfo("projects", advisorCtx).upgradeHref).toContain("/app/paket?ozellik=");
    expect(modulePlanInfo("projects", trialCtx).locked).toBe(false);
  });
});

describe("menü birleşimi 41 -> 36 ve kapalı modül kapısı", () => {
  it("menü öğesi sayısı 42 (9 başlık; 36 + Davet et ve kazan + İlan Kontrol + Ofis Merkezi + yetim sayfalar: Bildirimler, İçe aktarma, Mahalle notları)", () => {
    expect(NAV_SECTIONS.length).toBe(9);
    expect(NAV_SECTIONS.flatMap((s) => s.items).length).toBe(42);
  });

  it("Akıllı Listeler/Tavsiyeler, Kayıp nedenleri, Anahtar/Sunumlar menüden çıkar, sekme olarak kalır", () => {
    const items = NAV_SECTIONS.flatMap((s) => s.items);
    const topHrefs = items.map((i) => i.href);
    for (const gone of ["/app/akilli-listeler", "/app/tavsiyeler", "/app/kayip-satis", "/app/portfoyler/anahtarlar", "/app/portfoyler/sunumlar"]) {
      expect(topHrefs).not.toContain(gone);
    }
    const tabsOf = (href: string) => items.find((i) => i.href === href)?.tabs?.map((t) => t.href);
    expect(tabsOf("/app/musteriler")).toEqual(["/app/musteriler", "/app/akilli-listeler", "/app/tavsiyeler"]);
    expect(tabsOf("/app/anlasmalar")).toEqual(["/app/anlasmalar", "/app/kayip-satis"]);
    expect(tabsOf("/app/portfoyler")).toEqual(["/app/portfoyler", "/app/portfoyler/anahtarlar", "/app/portfoyler/sunumlar", "/app/ilan-havuzu"]);
  });

  it("kapalı modül menüden, sekmelerden ve Daha fazla listesinden çıkar; çekirdek kalır", () => {
    const closed = ["smart_lists", "keys", "presentations", "lost_sales", "rentals", "projects", "campaigns"];
    const open = allHrefs(visibleSections(ALL_MODULES));
    const shut = allHrefs(visibleSections(ALL_MODULES, { closed }));
    for (const href of ["/app/akilli-listeler", "/app/tavsiyeler", "/app/portfoyler/anahtarlar", "/app/portfoyler/sunumlar", "/app/kayip-satis", "/app/kiralama", "/app/kira-artis", "/app/projeler", "/app/kampanyalar"]) {
      expect(open, `açıkken ${href}`).toContain(href);
      expect(shut, `kapalıyken ${href}`).not.toContain(href);
    }
    for (const core of ["/app", "/app/musteriler", "/app/portfoyler", "/app/anlasmalar", "/app/gelen-kutusu", "/app/ayarlar"]) {
      expect(shut).toContain(core);
    }
    const more = allHrefs(moreSections(ALL_MODULES, { role: "owner", closed }));
    for (const href of ["/app/kiralama", "/app/projeler", "/app/kampanyalar"]) expect(more).not.toContain(href);
  });

  it("ofis kapatmayan ofiste menü değişmez (varsayılan hepsi açık)", () => {
    expect(allHrefs(visibleSections(ALL_MODULES, { closed: [] }))).toEqual(allHrefs(visibleSections(ALL_MODULES)));
  });

  it("komut paleti: Git ve Eylemler kapalı modülü göstermez", () => {
    const closed = ["offers", "contracts", "rentals", "projects", "presentations", "open_house", "campaigns", "automation", "smart_lists"];
    const go = getAppGoItems(ALL_MODULES, "", closed).map((e) => e.href);
    for (const href of ["/app/teklifler", "/app/sozlesmeler", "/app/kiralama", "/app/projeler", "/app/akilli-listeler", "/app/otomasyonlar"]) {
      expect(go).not.toContain(href);
    }
    expect(getAppGoItems(ALL_MODULES).map((e) => e.href)).toContain("/app/akilli-listeler");
    const actions = getAppActions(ALL_MODULES, "", [], closed).map((a) => a.href);
    for (const href of ["/app/teklifler/yeni", "/app/sozlesmeler/yeni", "/app/kiralama/yeni", "/app/projeler/yeni", "/app/portfoyler/sunumlar/yeni", "/app/acik-ev/yeni", "/app/kampanyalar/yeni", "/app/otomasyonlar/yeni"]) {
      expect(actions).not.toContain(href);
    }
    expect(actions).toContain("/app/musteriler/yeni");
    expect(actions).toContain("/app/portfoyler/yeni");
    expect(getAppActions(ALL_MODULES).map((a) => a.href)).toContain("/app/teklifler/yeni");
  });

  it("Kayıp nedenleri sekmesi kendi izniyle gizlenir (anlaşma izni yoksa öğe de yok)", () => {
    const items = (mods: AppModule[]) => visibleSections(mods).flatMap((s) => s.items).find((i) => i.label === "Anlaşmalar");
    expect(items(["commissions"])?.tabs?.map((t) => t.href)).toEqual(["/app/anlasmalar"]);
    expect(items(["commissions", "customers"])?.tabs?.map((t) => t.href)).toEqual(["/app/anlasmalar", "/app/kayip-satis"]);
    expect(items(["customers"])).toBeUndefined();
  });
});
