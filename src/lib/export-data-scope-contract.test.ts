import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { OTHER_ID, TENANT_ID, USER_ID, eqCalls, testCtx } from "./report-center/test-support";
import { TENANT_REPORT_LIST, tenantReportAllowed } from "./report-center/registry";
import { DEFAULT_MATRIX } from "./permissions";

/**
 * Veri dışa aktarma KİRACI + AKTÖR kapsam sözleşmesi (rapor merkezi).
 * Eski sözleşme `actions/export.ts` kaynağını regex'le tarıyordu; artık gerçek rapor sorguları ÇALIŞTIRILIR ve
 * uygulanan süzgeçler kaydedilir: her sorgu kiracı sınırını taşımalı, ofis geneli kapsamı olmayan kullanıcı yalnız
 * kendi kayıtlarını görmeli, kazanç raporları `earnings_all` olmadan kendi kapsamına inmeli.
 */
const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

/** Kendi sorgusunda `tenant_id` kolonu olmayan çocuk tablolar: !inner ebeveyn + ebeveynin kiracı eşitliği. */
const PARENT_BOUNDED: Record<string, string> = { campaign_recipients: "campaign.tenant_id" };
/** Kapsamı yükleyicinin içinde (viewer kimliğiyle) uygulayan hesaplanan raporlar — kaynak düzeyinde doğrulanır. */
const LOADER_SCOPED = new Set(["danisman-performansi", "hedef-gerceklesme", "aday-hizi", "talep-arz", "bolge-analizi"]);
const queryReports = TENANT_REPORT_LIST.filter((r) => r.source.kind === "query");
const computeReports = TENANT_REPORT_LIST.filter((r) => r.source.kind === "compute" && !LOADER_SCOPED.has(r.id));

function buildQuery(def: (typeof TENANT_REPORT_LIST)[number], ctx: ReturnType<typeof testCtx>["ctx"]) {
  if (def.source.kind !== "query") throw new Error("query değil");
  return def.source.build(ctx, {});
}

describe("kiracı sınırı: her rapor sorgusu kiracı süzgeci taşır", () => {
  it.each(queryReports.map((r) => [r.id, r] as const))("%s", (_id, def) => {
    const { ctx, calls } = testCtx();
    buildQuery(def, ctx);
    const from = calls.find((c) => c.method === "from")!;
    const table = String(from.args[0]);
    const eqs = eqCalls(calls);
    const col = PARENT_BOUNDED[table] ?? "tenant_id";
    expect(eqs, `${def.id}: ${table} sorgusunda ${col} = kiracı süzgeci yok`).toContainEqual([col, TENANT_ID]);
  });

  it.each(computeReports.map((r) => [r.id, r] as const))("hesaplanan rapor %s: dokunduğu her tablo kiracıya bağlı", async (_id, def) => {
    if (def.source.kind !== "compute") return;
    const { ctx, calls } = testCtx({ officeWide: true, seeAllEarnings: true });
    await def.source.run(ctx, {});
    const tables = [...new Set(calls.filter((c) => c.method === "from").map((c) => String(c.args[0])))];
    expect(tables.length).toBeGreaterThan(0);
    for (const t of tables) {
      const eqs = calls.filter((c) => c.table === t && c.method === "eq").map((c) => [String(c.args[0]), c.args[1]]);
      expect(eqs, `${def.id}: ${t} kiracı süzgeci`).toContainEqual(["tenant_id", TENANT_ID]);
    }
  });
});

describe("aktör kapsamı: ofis geneli veri kapsamı olmayan kullanıcı yalnız kendi kayıtlarını görür", () => {
  const scoped = queryReports.filter((r) => !r.officeWideOnly && !r.rolesOnly && !r.earningsAllOnly);

  it("kapsam kuralsız (herkese açık) rapor yok: ofis geneli rapor ya aktör süzgeci taşır ya kısıtlı rol ister", () => {
    // Ofis kontrol kayıt defteri vb. rolesOnly; geri kalan her rapor aşağıda aktör süzgeci taşımalı.
    expect(scoped.length).toBeGreaterThan(20);
  });

  it.each(scoped.map((r) => [r.id, r] as const))("%s: danışman bağlamında kullanıcı kimliğiyle süzer", (_id, def) => {
    const { ctx, calls } = testCtx({ officeWide: false });
    buildQuery(def, ctx);
    const userEq = eqCalls(calls).filter(([, v]) => v === USER_ID);
    expect(userEq.length, `${def.id}: aktör (kullanıcı kimliği) süzgeci yok`).toBeGreaterThan(0);
  });

  it.each(scoped.map((r) => [r.id, r] as const))("%s: başkasının kimliğine süzgeç uygulamaz (kullanıcı süzgeci yalnız kendi kimliği)", (_id, def) => {
    const { ctx, calls } = testCtx({ officeWide: false, userId: USER_ID });
    buildQuery(def, ctx);
    for (const [, v] of eqCalls(calls)) expect(v).not.toBe(OTHER_ID);
  });

  it.each(scoped.filter((r) => r.earnings).map((r) => [r.id, r] as const))("%s: ofis geneli rol bile earnings_all olmadan yalnız kendi kazancını görür", (_id, def) => {
    const { ctx, calls } = testCtx({ officeWide: true, seeAllEarnings: false });
    buildQuery(def, ctx);
    expect(eqCalls(calls).filter(([, v]) => v === USER_ID).length).toBeGreaterThan(0);
  });

  it.each(scoped.filter((r) => !r.earnings).map((r) => [r.id, r] as const))("%s: ofis bayrağıyla takım kapsamı yalnız daraltır (in süzgeci)", (_id, def) => {
    const ids = [USER_ID, OTHER_ID];
    const { ctx, calls } = testCtx({ officeWide: true, seeAllEarnings: true, listScope: { kind: "members", ids } });
    buildQuery(def, ctx);
    const inCall = calls.find((c) => c.method === "in" && Array.isArray(c.args[1]) && (c.args[1] as string[]).includes(OTHER_ID));
    expect(inCall, `${def.id}: takım kapsamı uygulanmadı`).toBeTruthy();
  });

  it("ofis geneli kapsam tanımlı ve bayrak kapalıyken süzgeç eklenmez (ofis sahibi tüm kayıtları görür)", () => {
    const def = TENANT_REPORT_LIST.find((r) => r.id === "musteriler")!;
    const { ctx, calls } = testCtx({ officeWide: true, seeAllEarnings: true, role: "owner" });
    buildQuery(def, ctx);
    expect(eqCalls(calls).filter(([, v]) => v === USER_ID)).toEqual([]);
  });
});

describe("kısıtlı raporlar yetkisiz kullanıcıya hiç açılmaz", () => {
  const advisor = { perms: DEFAULT_MATRIX.advisor, role: "advisor", officeWide: false, seeAllEarnings: false };
  const owner = { perms: DEFAULT_MATRIX.owner, role: "owner", officeWide: true, seeAllEarnings: true };
  it.each(TENANT_REPORT_LIST.filter((r) => r.officeWideOnly || r.rolesOnly || r.earningsAllOnly).map((r) => [r.id, r] as const))("%s", (_id, def) => {
    expect(tenantReportAllowed(def, advisor)).toBe(false);
    expect(tenantReportAllowed(def, owner)).toBe(true);
  });
});

describe("service_role sınırı", () => {
  it("kiracı rapor kataloğu ve motoru servis istemcisi kullanmaz (yalnız context.ts platform bağlamı)", () => {
    const dir = "src/lib/report-center";
    const offenders: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(resolve(process.cwd(), d), { withFileTypes: true })) {
        const rel = `${d}/${e.name}`;
        if (e.isDirectory()) walk(rel);
        else if (/\.tsx?$/.test(e.name) && !e.name.endsWith(".test.ts") && /createAdminClient|supabase\/admin/.test(read(rel))) offenders.push(rel);
      }
    };
    walk(dir);
    expect(offenders).toEqual(["src/lib/report-center/context.ts"]);
  });

  it("platform bağlamı yalnız personel + departman kapısından sonra kurulur", () => {
    const s = read("src/lib/report-center/download.ts");
    const fn = s.slice(s.indexOf("export async function authorizePlatformReport"), s.indexOf("export async function handleReportDownload"));
    expect(fn.indexOf("getPlatformStaff()")).toBeGreaterThan(-1);
    expect(fn.indexOf("buildPlatformContext(")).toBeGreaterThan(fn.indexOf("platformReportAllowed("));
    expect(fn).toContain('platformCanAccess(staff.role, "reports")');
  });

  it("kiracı raporu: oturum + reports modülü + raporun modülü, sonra bağlam", () => {
    const s = read("src/lib/report-center/download.ts");
    const fn = s.slice(s.indexOf("export async function authorizeTenantReport"), s.indexOf("/** Platform raporu için kapılar"));
    expect(fn.indexOf('requirePermission("reports", "view")')).toBeGreaterThan(-1);
    expect(fn.indexOf("requirePermission(def.module")).toBeGreaterThan(fn.indexOf('requirePermission("reports"'));
    expect(fn.indexOf("buildTenantContext(gate)")).toBeGreaterThan(fn.indexOf("requirePermission(def.module"));
    expect(fn).toContain("tenantReportAllowed(");
  });

  it("hesaplanan (yükleyici kapsamlı) raporlar izleyici kimliğini yükleyiciye verir", () => {
    const team = read("src/lib/report-center/catalog/tenant-team.ts");
    expect(team).toContain("viewer: { userId: ctx.userId, role: ctx.role, perms: ctx.perms }");
    const analysis = read("src/lib/report-center/catalog/tenant-analysis.ts");
    expect(analysis).toContain("assignedToIn: ctx.officeWide ? null : [ctx.userId]");
    expect(analysis).toContain('.eq("tenant_id", tid(ctx))');
  });
});
