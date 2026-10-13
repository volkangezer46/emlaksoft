import { describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/tenant-guard", () => ({ requireActiveTenant: vi.fn(async () => ({ ok: false, error: "test" })) }));

import { ALL_PORTALS, CURRENT_PORTALS, LEGACY_PORTALS, PORTAL_CATALOG, normalizePortalName, portalDisplayName, portalIdFromName } from "./catalog";
import {
  activePortalIds,
  awaitingOwnerConfirmation,
  checkPortalIds,
  loadPortalAccountRows,
  needsInference,
  resolveMemberships,
  suggestFromEvidence,
  tallyEvidence,
  type PortalAccountRow,
} from "./membership";
import { planPortalTeyit, WEEK_MS, type TeyitListing } from "./teyit-plan";
import { excludedCheckPortals } from "@/lib/listing-control/server/queue";
import { computeMissingPortals } from "@/lib/portal-transfer/gaps";
import { TRANSFER_PORTALS } from "@/lib/portal-transfer/rules";
import { FSBO_PORTALS } from "@/lib/prospecting/types";
import { PORTAL_KEYS, PORTAL_LABEL } from "@/lib/finance/portal-roi";
import { buildDedupeKey, timeBucket } from "@/lib/notify-dedupe";

const ROOT = process.cwd();

const row = (portal: PortalAccountRow["portal"], patch: Partial<PortalAccountRow> = {}): PortalAccountRow => ({
  portal,
  status: "active",
  check_enabled: true,
  source: "owner_declared",
  account_label: null,
  store_url: null,
  plan_ends_at: null,
  last_login_ok_at: null,
  last_login_fail_at: null,
  login_fail_streak: 0,
  updated_at: null,
  ...patch,
});

describe("portal kataloğu (tek kaynak)", () => {
  it("güncel portallar sahibinden/hepsiemlak/emlakjet; Zingat yalnız geçmiş veri", () => {
    expect([...CURRENT_PORTALS]).toEqual(["sahibinden", "hepsiemlak", "emlakjet"]);
    expect([...LEGACY_PORTALS]).toEqual(["zingat"]);
    for (const id of CURRENT_PORTALS) {
      expect(PORTAL_CATALOG[id].eids_integrated).toBe(true);
      expect(PORTAL_CATALOG[id].extension_supported).toBe(true);
      expect(PORTAL_CATALOG[id].legacy).toBe(false);
    }
    expect(PORTAL_CATALOG.zingat.legacy).toBe(true);
  });

  it("türetilen sabitler katalogla aynı", () => {
    expect([...TRANSFER_PORTALS]).toEqual([...CURRENT_PORTALS]);
    expect([...FSBO_PORTALS]).toEqual([...CURRENT_PORTALS, "other"]);
    expect([...PORTAL_KEYS].sort()).toEqual([...ALL_PORTALS].sort());
    expect(PORTAL_LABEL.sahibinden).toBe("Sahibinden.com");
  });

  it("portal adı normalleştirme ve eşleme", () => {
    expect(normalizePortalName("  Sahibinden ")).toBe("sahibinden");
    expect(portalIdFromName("Sahibinden.com")).toBe("sahibinden");
    expect(portalIdFromName("Emlak Jet")).toBe("emlakjet");
    expect(portalIdFromName("HEPSİEMLAK")).toBe("hepsiemlak");
    expect(portalIdFromName("emlaksoft vitrin")).toBeNull();
    expect(portalDisplayName("sahibinden")).toBe("Sahibinden");
    expect(portalDisplayName("emlaksoft vitrin")).toBe("Emlaksoft vitrin");
  });

  it("migration CHECK'i kataloğun güncel portallarıyla birebir", () => {
    const sql = readFileSync(join(ROOT, "supabase/migrations/20261013007000_tenant_portal_accounts.sql"), "utf8");
    const m = sql.match(/portal text not null check \(portal in \(([^)]+)\)\)/);
    expect(m).not.toBeNull();
    const ids = m![1].split(",").map((s) => s.trim().replace(/'/g, ""));
    expect(ids).toEqual([...CURRENT_PORTALS]);
    // RPC içindeki doğrulama da aynı küme
    expect(sql).toContain("p_portal not in ('sahibinden', 'hepsiemlak', 'emlakjet')");
    expect(sql).toContain("lower(btrim(portal_name))");
    expect(readFileSync(join(ROOT, "supabase/rollbacks/20261013007000_tenant_portal_accounts.rollback.sql"), "utf8")).toContain("drop table if exists public.tenant_portal_accounts");
  });

  it("projede kataloğun dışında sabit portal listesi kalmaz (grep)", () => {
    // Bilinçli istisnalar: arama anahtar sözcükleri (menü/rapor araması; liste değil), statik ana sayfa pazarlama metni
    // (görünümü birebir korunur) ve ayrıştırıcı test fikstürü.
    const allow = new Set([
      "src/lib/portals/catalog.ts",
      "src/lib/nav-config.ts",
      "src/lib/report-center/catalog/tenant-crm.ts",
      "src/lib/site-content/defaults.ts",
      "src/lib/listing-control/adapters/html/test-fixtures.ts",
    ]);
    const re = /\[\s*["'](sahibinden|hepsiemlak|emlakjet|zingat)["']\s*,\s*["'](sahibinden|hepsiemlak|emlakjet|zingat)["']/i;
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (name === "node_modules" || name.startsWith(".")) continue;
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
          const rel = relative(ROOT, full);
          if (!allow.has(rel) && re.test(readFileSync(full, "utf8"))) hits.push(rel);
        }
      }
    };
    walk(join(ROOT, "src"));
    walk(join(ROOT, "extensions/emlaksoft-ilan-kontrol/src"));
    expect(hits).toEqual([]);
  });
});

describe("üyelik kararı (resolveMemberships)", () => {
  const evidence = tallyEvidence({
    liveListingPortals: ["Sahibinden", "sahibinden", "emlaksoft vitrin"],
    expensePortalKeys: ["hepsiemlak", "zingat"],
    leadSources: ["portal_emlakjet", "portal_zingat", "web_sitesi"],
  });

  it("kanıt sayımı katalogla eşlenir; geçmiş portal (zingat) önerilmez", () => {
    expect(evidence.sahibinden.liveListings).toBe(2);
    expect(evidence.hepsiemlak.expenses).toBe(1);
    expect(evidence.emlakjet.leads).toBe(1);
    const s = suggestFromEvidence(evidence);
    expect(s.map((x) => [x.portal, x.suggested, x.source])).toEqual([
      ["sahibinden", "active", "inferred_listing"],
      ["hepsiemlak", "active", "inferred_expense"],
      ["emlakjet", "active", "inferred_listing"],
    ]);
  });

  it("beyan yokken öneri geçici aktif sayılır ve sahip onayı beklenir", () => {
    const list = resolveMemberships([], suggestFromEvidence(evidence));
    expect(activePortalIds(list)).toEqual(["sahibinden", "hepsiemlak", "emlakjet"]);
    expect(list.every((m) => m.inferred)).toBe(true);
    expect(awaitingOwnerConfirmation(list)).toBe(true);
  });

  it("kanıt yok + beyan yok → bilinmiyor, aktif DEĞİL (eklenti istek atmaz)", () => {
    const list = resolveMemberships([], suggestFromEvidence(tallyEvidence({ liveListingPortals: [], expensePortalKeys: [], leadSources: [] })));
    expect(activePortalIds(list)).toEqual([]);
    expect(checkPortalIds(list)).toEqual([]);
    expect(list.map((m) => m.effective)).toEqual(["unknown", "unknown", "unknown"]);
  });

  it("sahip beyanı öneriyi ezer: 'none' kanıt olsa da aktif değil; ilanı olmayan üye portal aktiftir", () => {
    const rows = [row("sahibinden", { status: "none" }), row("hepsiemlak", { status: "active" }), row("emlakjet", { status: "active", check_enabled: false })];
    const list = resolveMemberships(rows, suggestFromEvidence(evidence));
    expect(activePortalIds(list)).toEqual(["hepsiemlak", "emlakjet"]);
    expect(checkPortalIds(list)).toEqual(["hepsiemlak"]);
    expect(awaitingOwnerConfirmation(list)).toBe(false);
    expect(needsInference(rows)).toBe(false);
    expect(needsInference([row("sahibinden", { status: "unknown" })])).toBe(true);
  });

  it("kontrol kuyruğu: 'none' ve kontrolü kapalı portallar için iş açılmaz", () => {
    expect(excludedCheckPortals([row("sahibinden", { status: "none", check_enabled: false }), row("hepsiemlak"), row("emlakjet", { check_enabled: false })])).toEqual([
      "sahibinden",
      "emlakjet",
    ]);
  });

  it("tablo yoksa (migration bekliyor) okuyucu 'available: false' döner, hata fırlatmaz", async () => {
    const db = {
      from: () => ({ select: () => ({ eq: async () => ({ data: null, error: { code: "PGRST205", message: "Could not find the table" } }) }) }),
    } as unknown as Parameters<typeof loadPortalAccountRows>[0];
    await expect(loadPortalAccountRows(db, "t1")).resolves.toEqual({ available: false, rows: [] });
  });
});

describe("eksik portal: üyelikle süzülür", () => {
  it("hiç ilanı olmayan ama üye olunan portal görünür; üye olunmayan portal hiç önerilmez", () => {
    const gaps = computeMissingPortals(["p1", "p2"], [{ propertyId: "p1", portal: "Sahibinden" }], ["hepsiemlak", "emlakjet"]);
    expect(gaps.map((g) => g.portal).sort()).toEqual(["emlakjet", "hepsiemlak"]);
    expect(gaps.find((g) => g.portal === "hepsiemlak")?.missing).toEqual(["p1", "p2"]);
    expect(gaps.find((g) => g.portal === "hepsiemlak")?.used).toBe(0);
  });
});

describe("portal-teyit planı (eklentisiz ofis haftalık özet, üyelik dışı tek seferlik)", () => {
  const L = (id: string, tenant: string, portal = "sahibinden"): TeyitListing => ({ id, tenant_id: tenant, portal_name: portal, portal_listing_id: id });

  it("eklentisi olmayan ofis (ör. Gezertaşar) ilan başına günlük bildirim almaz; tek haftalık özet", () => {
    const plan = planPortalTeyit({
      overdue: [L("a", "gezertasar"), L("b", "gezertasar"), L("c", "eklentili")],
      nonMemberLive: [],
      nonePortals: new Map(),
      tenantsWithExtension: new Set(["eklentili"]),
    });
    expect(plan.daily.map((l) => l.id)).toEqual(["c"]);
    expect(plan.weekly).toEqual([{ tenantId: "gezertasar", count: 2 }]);
  });

  it("haftalık özetin anahtarı hafta boyunca aynı (günlük tekrar etmez), sonraki hafta değişir", () => {
    const day = 86_400_000;
    const t0 = Date.parse("2026-10-12T03:00:00Z");
    const keys = Array.from({ length: 7 }, (_, i) => buildDedupeKey("portal-teyit-ozet", timeBucket(t0 + i * day, WEEK_MS)));
    // 7 günlük pencerede en çok iki farklı kova (kova sınırı pencerenin ortasına denk gelebilir): günde bir DEĞİL.
    expect(new Set(keys).size).toBeLessThanOrEqual(2);
    // Cron 6 saatte bir çalışır: aynı gün içindeki turlar aynı anahtarı üretir (indeks ikinciyi reddeder).
    expect(buildDedupeKey("portal-teyit-ozet", timeBucket(t0 + 6 * 3_600_000, WEEK_MS))).toBe(keys[0]);
  });

  it("üyeliği 'none' portaldaki ilan teyit uyarısı almaz; tek seferlik 'üyelik dışı' uyarısı çıkar", () => {
    const none = new Map([["t1", new Set(["hepsiemlak"])]]);
    const plan = planPortalTeyit({
      overdue: [L("x", "t1", "hepsiemlak"), L("y", "t1", "sahibinden")],
      nonMemberLive: [L("x", "t1", "hepsiemlak"), L("z", "t1", "hepsiemlak"), L("x", "t1", "hepsiemlak")],
      nonePortals: none,
      tenantsWithExtension: new Set(["t1"]),
    });
    expect(plan.daily.map((l) => l.id)).toEqual(["y"]);
    expect(plan.skippedNonMember).toBe(1);
    expect(plan.outOfMembership.map((l) => l.id)).toEqual(["x", "z"]);
  });

  it("eklenti tablosu okunamazsa eski davranış: herkes ilan başına", () => {
    const plan = planPortalTeyit({ overdue: [L("a", "t")], nonMemberLive: [], nonePortals: new Map(), tenantsWithExtension: null });
    expect(plan.daily).toHaveLength(1);
    expect(plan.weekly).toEqual([]);
  });
});
