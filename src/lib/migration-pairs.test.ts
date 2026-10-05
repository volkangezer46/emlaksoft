import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  baseName,
  findVersionCollisions,
  impactTable,
  validateGroups,
  versionOf,
  type GroupSpec,
} from "./migration-pairs";
import { LEGACY_MIGRATION_VERSIONS, MIGRATION_GROUP_SPEC } from "../../scripts/migration-pairs-data";

const codes = (findings: { code: string }[]) => findings.map((f) => f.code);

describe("versionOf / baseName", () => {
  it("surumu ve taban adi cikarir", () => {
    expect(versionOf("20260819020100_property_owner_info.sql")).toBe("20260819020100");
    expect(versionOf("20260726000087b_contract_types_usage.sql")).toBe("20260726000087b");
    expect(versionOf("20260814_perf_indexes.sql")).toBeNull();
    expect(baseName("20260816060100_x.rollback.sql")).toBe("20260816060100_x");
  });
});

describe("findVersionCollisions", () => {
  it("proposed ile migrations ayni surum farkli ad: hata", () => {
    const f = findVersionCollisions(["20260820000100_oversight.sql"], ["20260820000100_billing.sql"]);
    expect(codes(f)).toContain("proposed-numara-cakismasi");
  });

  it("ayni ad migrations'a terfi etmis: hata", () => {
    const f = findVersionCollisions(["20260820000100_x.sql"], ["20260820000100_x.sql", "20260820000100_x.rollback.sql"]);
    expect(codes(f)).toEqual(expect.arrayContaining(["terfi-edilmis-kopya"]));
    expect(codes(f)).not.toContain("proposed-numara-cakismasi");
  });

  it("migrations icinde yeni cakisma hata, donmus tarihsel istisna degil", () => {
    const files = ["20260726000058_a.sql", "20260726000058_b.sql", "20260801000100_c.sql", "20260801000100_d.sql"];
    const f = findVersionCollisions(files, [], { legacyMigrationVersions: ["20260726000058"] });
    expect(f.filter((x) => x.code === "migrations-ic-cakisma").map((x) => x.message.includes("20260801000100"))).toEqual([true]);
  });

  it("proposed icinde ayni surum iki taslak: hata; .rollback ayni taslak sayilir", () => {
    expect(codes(findVersionCollisions([], ["20261001000100_a.sql", "20261001000100_b.sql"]))).toContain("proposed-ic-cakisma");
    expect(codes(findVersionCollisions([], ["20261001000100_a.sql", "20261001000100_a.rollback.sql"]))).not.toContain("proposed-ic-cakisma");
  });

  it("ayri surumler temiz; gerideki taslak bilgi, uyumsuz ad uyari verir", () => {
    const f = findVersionCollisions(["20260901000100_m.sql"], ["20260814_perf.sql", "20260816060100_v.sql", "20261005000100_n.sql"]);
    expect(codes(f).filter((c) => c.endsWith("cakisma") || c === "terfi-edilmis-kopya")).toEqual([]);
    expect(f.find((x) => x.code === "uyumsuz-ad")?.level).toBe("warn");
    expect(f.filter((x) => x.code === "terfide-yeni-numara")).toHaveLength(1);
  });
});

const MAIN = "20260816001500_listing_pool.sql";
const FIX = "20260823000200_sec3_listing_pool_insert_claim_guard.sql";
const DEP = "20260816000900_assignment_rules.sql";

function spec(overrides: Partial<GroupSpec> = {}): GroupSpec {
  return {
    appliedHead: "20260813000300",
    impact: { [DEP]: "ek", [MAIN]: "ek", [FIX]: "siki" },
    windows: [
      { id: "A", order: 1, title: "a", files: [DEP] },
      { id: "B", order: 2, title: "b", files: [MAIN, FIX] },
    ],
    pairGroups: [{ id: "g", title: "g", main: [MAIN], fixes: [FIX], window: "B" }],
    requires: [[MAIN, DEP]],
    externalPending: [],
    ...overrides,
  };
}
const FILES = [DEP, MAIN, FIX];

describe("validateGroups", () => {
  it("tutarli veri temiz", () => {
    expect(validateGroups(FILES, spec()).filter((f) => f.level === "error")).toEqual([]);
  });

  it("duzeltici ana'dan ONCE numaralanmissa hata", () => {
    const early = "20260816001400_early_fix.sql";
    const s = spec({
      impact: { [DEP]: "ek", [MAIN]: "ek", [early]: "siki" },
      windows: [
        { id: "A", order: 1, title: "a", files: [DEP] },
        { id: "B", order: 2, title: "b", files: [early, MAIN] },
      ],
      pairGroups: [{ id: "g", title: "g", main: [MAIN], fixes: [early], window: "B" }],
    });
    expect(codes(validateGroups([DEP, MAIN, early], s))).toContain("duzeltici-ana-oncesi");
  });

  it("grup uyeleri farkli pencerede ise hata", () => {
    const s = spec({
      windows: [
        { id: "A", order: 1, title: "a", files: [DEP, FIX] },
        { id: "B", order: 2, title: "b", files: [MAIN] },
      ],
    });
    expect(codes(validateGroups(FILES, s))).toContain("grup-ayri-pencere");
  });

  it("onkosul penceresi bagimlidan SONRA ise hata", () => {
    const s = spec({
      windows: [
        { id: "A", order: 2, title: "a", files: [DEP] },
        { id: "B", order: 1, title: "b", files: [MAIN, FIX] },
      ],
    });
    expect(codes(validateGroups(FILES, s))).toContain("bagimlilik-pencere-sirasi");
  });

  it("onkosul bagimlidan sonra numaralanmissa hata", () => {
    const s = spec({ requires: [[DEP, MAIN]] });
    expect(codes(validateGroups(FILES, s))).toContain("bagimlilik-numara");
  });

  it("etiketsiz, pencere'siz ve hayalet kayitlari yakalar", () => {
    const extra = "20260901000100_new.sql";
    const f = validateGroups([...FILES, extra], spec({ impact: { ...spec().impact, "20260101000100_ghost.sql": "ek" } }));
    expect(codes(f)).toEqual(expect.arrayContaining(["etki-sinifi-yok", "pencere-yok", "etki-sinifi-hayalet"]));
  });

  it("ayri pencere baska pencereyle dosya paylasirsa hata", () => {
    const s = spec({
      windows: [
        { id: "A", order: 1, title: "a", files: [DEP, MAIN] },
        { id: "B", order: 2, title: "b", files: [MAIN, FIX], separate: true },
      ],
    });
    expect(codes(validateGroups(FILES, s))).toEqual(expect.arrayContaining(["ayri-pencere-ihlali", "dosya-iki-pencerede"]));
  });

  it("dal'da bekleyen (K4) dosya hata degil uyari/bilgi", () => {
    const k4 = "20260818000400_property_media_is_document.sql";
    const s = spec({
      impact: { ...spec().impact, [k4]: "ek" },
      windows: [...spec().windows, { id: "K4", order: 3, title: "k4", files: [k4] }],
      externalPending: [{ file: k4, branch: "k4", rule: "migration-once", note: "migration once" }],
    });
    const f = validateGroups(FILES, s);
    expect(f.filter((x) => x.level === "error")).toEqual([]);
    expect(codes(f)).toEqual(expect.arrayContaining(["dal-bekliyor", "dis-bekleyen"]));
  });
});

describe("impactTable", () => {
  it("rollback ve pencere eslemesini verir; uygulanmis dosyalari atlar", () => {
    const rows = impactTable(["20260101000100_old.sql", ...FILES], [`${MAIN.replace(".sql", "")}.rollback.sql`], spec());
    expect(rows.map((r) => r.file)).toEqual([DEP, MAIN, FIX]);
    expect(rows.find((r) => r.file === MAIN)).toMatchObject({ hasRollback: true, window: "B", impact: "ek" });
    expect(rows.find((r) => r.file === FIX)?.hasRollback).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Gercek depo sozlesmesi (yalniz dosya adlarini okur; DB yok, SQL icerigi yok).
// ---------------------------------------------------------------------------
const supabaseDir = path.join(process.cwd(), "supabase");
const ls = (d: string) => readdirSync(path.join(supabaseDir, d)).filter((f) => f.endsWith(".sql"));

/**
 * Bilinen proposed cakismalari. Iki eski cakisma (ownership_transfers, billing_pause) 20261005000700/800 olarak
 * yeniden numaralandi; liste BOS kalmali. Yeni bir cakisma testi kirar.
 */
const KNOWN_PROPOSED_COLLISIONS: string[] = [];

describe("gercek depo: yayin penceresi verisi", () => {
  const migrations = ls("migrations");

  it("gruplar, pencereler ve bagimliliklar hatasiz (K4 dal uyarisi haric)", () => {
    const errors = validateGroups(migrations, MIGRATION_GROUP_SPEC).filter((f) => f.level === "error");
    expect(errors, errors.map((e) => `${e.code}: ${e.message}`).join("\n")).toEqual([]);
  });

  it("migrations/ icinde yeni numara cakismasi yok", () => {
    const errors = findVersionCollisions(migrations, [], { legacyMigrationVersions: LEGACY_MIGRATION_VERSIONS });
    expect(errors.filter((f) => f.level === "error")).toEqual([]);
  });

  it("proposed cakismalari yalniz bilinenlerden ibaret (yeniden numaralama sahibe/ayri goreve ait)", () => {
    const f = findVersionCollisions(migrations, ls("proposed"), { legacyMigrationVersions: LEGACY_MIGRATION_VERSIONS });
    const collided = f.filter((x) => x.code === "proposed-numara-cakismasi" || x.code === "terfi-edilmis-kopya" || x.code === "proposed-ic-cakisma");
    const unknown = collided.filter((x) => !KNOWN_PROPOSED_COLLISIONS.some((k) => x.message.includes(k)));
    expect(unknown, unknown.map((u) => u.message).join("\n")).toEqual([]);
  });

  it("her guvenlik (sec3) duzeltici migration'i bir cift grubunda", () => {
    const inGroups = new Set(MIGRATION_GROUP_SPEC.pairGroups.flatMap((g) => g.fixes));
    const sec3 = migrations.filter((f) => f.includes("_sec3_"));
    expect(sec3.length).toBeGreaterThan(0);
    for (const f of sec3) expect(inGroups.has(f), `${f} hicbir cift grubunda degil`).toBe(true);
  });

  it("kazanc gizliligi RLS tek basina AYRI pencerede", () => {
    const w = MIGRATION_GROUP_SPEC.windows.find((x) => x.separate);
    expect(w?.files).toEqual(["20260816000500_commission_earnings_privacy.sql"]);
  });
});
