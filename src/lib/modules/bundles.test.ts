import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  BUNDLES,
  FEATURE_KEYS,
  MODULES,
  getBundle,
  mergeHidden,
  modulesOfBundle,
  normalizeClosed,
} from "@/lib/modules/registry";
import { bundleAsPreset, bundleStatus, computeBundleChanges, computeSetupChanges } from "@/lib/modules/logic";
import { loadPglite, type Db } from "@/lib/test-support/pglite";

describe("paket <-> modül eşlemesi", () => {
  it("her modül tam bir pakette, her paket en az bir modül içerir", () => {
    const ids = new Set(BUNDLES.map((b) => b.id));
    for (const m of MODULES) expect(ids.has(m.group), `${m.key} bilinmeyen pakette`).toBe(true);
    const seen = BUNDLES.flatMap((b) => modulesOfBundle(b.id));
    expect([...seen].sort()).toEqual([...FEATURE_KEYS].sort());
    for (const b of BUNDLES) expect(modulesOfBundle(b.id).length, b.id).toBeGreaterThan(0);
  });

  it("ürün sahibinin altı paketi ve beklenen üyeler", () => {
    const has = (id: string, keys: string[]) => {
      const members = modulesOfBundle(id as never) as string[];
      for (const k of keys) expect(members, `${id} > ${k}`).toContain(k);
    };
    has("mulk", ["rentals"]);
    has("pazarlama", ["campaigns", "vitrin", "presentations", "open_house", "smart_lists"]);
    has("satis_plus", ["offers", "contracts", "approvals", "lost_sales"]);
    has("ekip", ["team_perf", "franchise", "office_center", "automation", "tv_board"]);
    has("analiz", ["valuation", "reports", "leak", "portals"]);
    has("proje", ["projects", "foreign_sale", "network"]);
    expect(getBundle("yok")).toBeNull();
  });

  it("paket durumu: açık / kapalı / kısmen", () => {
    expect(bundleStatus("mulk", [])).toBe("open");
    expect(bundleStatus("mulk", ["rentals"])).toBe("partial");
    expect(bundleStatus("mulk", modulesOfBundle("mulk"))).toBe("closed");
  });
});

describe("paket kapatma + dependsOn", () => {
  it("analiz paketi kapanınca başka paketteki bağımlı (TV panosu <- raporlar) da kapanır", () => {
    const diff = computeBundleChanges("analiz", false, []);
    expect(diff.toClose).toEqual(expect.arrayContaining(["valuation", "reports", "leak", "portals", "tv_board"]));
    expect(normalizeClosed(diff.toClose)).toEqual(diff.toClose);
  });

  it("ekip paketi açılırken kapalı raporlar yüzünden TV panosu kapalı kalır", () => {
    const closed = normalizeClosed(["reports"]); // tv_board da kapanır
    const diff = computeBundleChanges("ekip", true, closed);
    expect(diff.toOpen).not.toContain("tv_board");
    expect(diff.toOpen).toEqual([]); // ekip üyeleri zaten açık, tv_board bağımlılık nedeniyle kapalı
  });

  it("platform ve paket kilitli üyelere dokunulmaz", () => {
    const diff = computeBundleChanges("pazarlama", false, [], { locked: ["campaigns"], planLocked: ["vitrin"] });
    expect(diff.toClose).not.toContain("campaigns");
    expect(diff.toClose).not.toContain("vitrin");
    expect(diff.skipped.map((s) => s.key).sort()).toEqual(["campaigns", "vitrin"]);
  });

  it("her paket kapatılıp açılınca eski duruma döner (kilitsiz)", () => {
    for (const b of BUNDLES) {
      const off = computeBundleChanges(b.id, false, []);
      const closed = normalizeClosed(off.toClose);
      const on = computeBundleChanges(b.id, true, closed);
      const after = new Set(closed.filter((k) => !on.toOpen.includes(k)));
      for (const k of modulesOfBundle(b.id)) expect(after.has(k), `${b.id}/${k}`).toBe(false);
    }
  });

  it("kurulum sihirbazı: hayır = paket kapanır, evet = açık kalır", () => {
    const diff = computeSetupChanges({ mulk: false, proje: false, satis_plus: true }, []);
    expect(diff.toClose).toEqual(expect.arrayContaining([...modulesOfBundle("mulk"), ...modulesOfBundle("proje")]));
    expect(diff.toClose).not.toContain("offers");
    expect(bundleAsPreset({}).open).toEqual([]);
  });
});

describe("kişisel gizleme birleşimi", () => {
  it("ofis kapalıları ∪ kullanıcı gizledikleri; bilinmeyen/çekirdek anahtar atılır; sıra kayıt defteri", () => {
    const merged = mergeHidden(["rentals"], ["campaigns", "customers", "yok"]);
    expect(merged).toEqual(FEATURE_KEYS.filter((k) => k === "rentals" || k === "campaigns"));
  });

  it("boş girdiler boş döner ve yinelenen anahtar tek sayılır", () => {
    expect(mergeHidden([], [])).toEqual([]);
    expect(mergeHidden(["offers"], ["offers"])).toEqual(["offers"]);
  });
});

describe("görünürlük sözleşmesi", () => {
  it("görünürlük tüketicileri tek kapıdan süzer (nav-config, palet, sekme, ana ekran)", () => {
    const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
    expect(read("src/app/app/layout.tsx")).toContain("mergeHidden(officeClosedModules, hiddenModules)");
    expect(read("src/app/app/page.tsx")).toContain("getInvisibleFeatures");
    for (const f of ["src/components/app/app-sidebar.tsx", "src/components/app/command-search-panel.tsx", "src/components/app/section-tabs.tsx"]) {
      expect(read(f), f).toContain("useClosedModules");
    }
  });

  it("yazma reddi ofis düzeyinde kalır: guard kişisel tercihe bakmaz", () => {
    const guard = readFileSync(resolve(process.cwd(), "src/lib/modules/guard.ts"), "utf8");
    expect(guard).not.toContain("user_module_prefs");
    expect(guard).not.toContain("prefs");
  });
});

const mod = await loadPglite();
const STUB = `
create role service_role; create role authenticated; create role anon;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create function public.current_tenant_id() returns uuid language sql stable as $$ select nullif(current_setting('test.tenant', true), '')::uuid $$;
create table public.tenants(id uuid primary key default gen_random_uuid());
create table public.profiles(id uuid primary key default gen_random_uuid());
grant usage on schema public, auth to authenticated;
grant execute on all functions in schema auth, public to authenticated;
`;

describe.skipIf(!mod)("user_module_prefs RLS (pglite)", () => {
  let db: Db;
  let T: string, T2: string, A: string, B: string;
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows;
  const as = async (uid: string, tenant: string) => {
    await db.exec(`reset role; select set_config('test.uid','${uid}',false), set_config('test.tenant','${tenant}',false); set role authenticated`);
  };

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    await db.exec(readFileSync(resolve(process.cwd(), "supabase/migrations/20261008001200_user_module_prefs.sql"), "utf8"));
    T = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    T2 = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    A = (await q(`insert into public.profiles default values returning id`))[0]!.id as string;
    B = (await q(`insert into public.profiles default values returning id`))[0]!.id as string;
  });

  it("kullanıcı kendi satırını yazar ve yalnız onu okur", async () => {
    await as(A, T);
    await db.query(`insert into public.user_module_prefs(user_id, tenant_id, module_key) values ($1,$2,'campaigns')`, [A, T]);
    await as(B, T);
    await db.query(`insert into public.user_module_prefs(user_id, tenant_id, module_key) values ($1,$2,'rentals')`, [B, T]);
    expect((await q(`select module_key from public.user_module_prefs`)).map((r) => r.module_key)).toEqual(["rentals"]);
    await as(A, T);
    expect((await q(`select module_key from public.user_module_prefs`)).map((r) => r.module_key)).toEqual(["campaigns"]);
  });

  it("başkası adına ya da başka ofis için satır yazılamaz", async () => {
    await as(A, T);
    await expect(db.query(`insert into public.user_module_prefs(user_id, tenant_id, module_key) values ($1,$2,'offers')`, [B, T])).rejects.toThrow();
    await expect(db.query(`insert into public.user_module_prefs(user_id, tenant_id, module_key) values ($1,$2,'offers')`, [A, T2])).rejects.toThrow();
  });

  it("başkasının satırı güncellenemez/silinemez; kendi satırı güncellenir ve silinir", async () => {
    await as(A, T);
    await db.query(`update public.user_module_prefs set hidden = false where module_key = 'rentals'`);
    await db.query(`delete from public.user_module_prefs where module_key = 'rentals'`);
    await as(B, T);
    expect((await q(`select hidden from public.user_module_prefs where module_key = 'rentals'`))[0]!.hidden).toBe(true);
    await db.query(`update public.user_module_prefs set hidden = false where module_key = 'rentals'`);
    expect((await q(`select hidden from public.user_module_prefs where module_key = 'rentals'`))[0]!.hidden).toBe(false);
    await db.query(`delete from public.user_module_prefs`);
    expect(await q(`select 1 from public.user_module_prefs`)).toHaveLength(0);
  });

  it("anahtar biçimi denetlenir", async () => {
    await as(A, T);
    await expect(db.query(`insert into public.user_module_prefs(user_id, tenant_id, module_key) values ($1,$2,'BAD KEY')`, [A, T])).rejects.toThrow();
  });
});
