import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EXPLORER_TABLES, explorerTable, filterColumns, selectList } from "./registry";
import { maskValue } from "./mask";
import { formatRow } from "./cells";
import { EXPLORER_MAX_ROWS, EXPLORER_PAGE_SIZE, explorerAuditMeta, explorerHref, parseExplorerParams } from "./plan";
import { platformCanAccess, platformModulesFor } from "@/lib/platform-access";
import { adminNavFor } from "@/lib/admin/nav";

/**
 * SN4 veri gezgini kabul ölçütleri:
 *  - maskeli sütunlar maskeli döner, sır sütunları seçim listesinde YOK;
 *  - her görüntüleme (liste + kayıt) denetim izine düşer; iz yazılamazsa veri dönmez;
 *  - yetkisiz personel ekranı göremez (modül `veri`: varsayılan yalnız süper admin).
 */

type Call = { method: string; args: unknown[] };
const db = vi.hoisted(() => ({
  calls: [] as { table: string; calls: { method: string; args: unknown[] }[] }[],
  rows: {} as Record<string, Record<string, unknown>[]>,
  error: null as null | { code: string },
}));
const audit = vi.hoisted(() => ({ calls: [] as Record<string, unknown>[], ok: true }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      const rec = { table, calls: [] as Call[] };
      db.calls.push(rec);
      const result = () => {
        const data = db.rows[table] ?? [];
        return { data, count: data.length, error: db.error };
      };
      const api: Record<string, unknown> = {
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej),
        maybeSingle: () => {
          rec.calls.push({ method: "maybeSingle", args: [] });
          const r = result();
          return Promise.resolve({ data: r.data[0] ?? null, error: r.error });
        },
      };
      for (const m of ["select", "eq", "ilike", "gte", "lte", "in", "order", "range"]) {
        api[m] = (...args: unknown[]) => {
          rec.calls.push({ method: m, args });
          return api;
        };
      }
      return api;
    },
  }),
}));
vi.mock("@/lib/platform-activity", () => ({
  logPlatformActivityChecked: async (input: Record<string, unknown>) => {
    audit.calls.push(input);
    return { ok: audit.ok };
  },
}));

const SECRET_NAME = /token|secret|password|passwd|hash|stack|iyzico|api_key|_key$|^key$|otp|hidden_price|min_price/i;
const TENANT = "11111111-1111-4111-8111-111111111111";
const CUSTOMER = "22222222-2222-4222-8222-222222222222";

describe("kayıt (registry): sır sütunları seçilmez, maskeli sütun süzülmez", () => {
  it("hiçbir tablonun seçim listesinde sır sütunu yok", () => {
    for (const t of EXPLORER_TABLES) {
      const selected = selectList(t).split(", ");
      for (const s of t.secretColumns) expect(selected, `${t.table}.${s}`).not.toContain(s);
      for (const c of selected) expect(c, `${t.table}.${c}`).not.toMatch(SECRET_NAME);
      expect(new Set(selected).size, `${t.table} yinelenen sütun`).toBe(selected.length);
      expect(selected, `${t.table} id`).toContain("id");
      expect(selected, `${t.table} sıralama sütunu`).toContain(t.orderBy);
    }
  });

  it("bilinen kişisel veri sütunları maskeli tanımlı", () => {
    const mask = (table: string, col: string) => explorerTable(table)!.columns.find((c) => c.key === col)?.mask;
    expect(mask("musteriler", "full_name")).toBe("name");
    expect(mask("musteriler", "phone")).toBe("phone");
    expect(mask("musteriler", "email")).toBe("email");
    expect(mask("musteriler", "passport_no")).toBe("idNo");
    expect(mask("ofisler", "iban")).toBe("iban");
    expect(mask("ofisler", "tax_number")).toBe("idNo");
    expect(mask("kullanicilar", "phone")).toBe("phone");
  });

  it("maskeli sütun süzgeç listesinde değil", () => {
    for (const t of EXPLORER_TABLES) for (const c of filterColumns(t)) expect(c.mask, `${t.table}.${c.key}`).toBeUndefined();
  });

  it("tablo anahtarları benzersiz", () => {
    expect(new Set(EXPLORER_TABLES.map((t) => t.key)).size).toBe(EXPLORER_TABLES.length);
  });
});

describe("maskeler: ham değer çıktıda görünmez", () => {
  const raw = {
    id: CUSTOMER,
    tenant_id: TENANT,
    full_name: "Ayşe Yılmaz",
    phone: "05321234567",
    email: "ayse.yilmaz@example.com",
    passport_no: "U12345678",
    birth_date: "1985-04-12",
    notes: "Aradı, 05321234567 numarasından ulaşılır; TR330006100519786457841326",
    source: "web",
    blacklist: false,
    created_at: "2026-10-01T09:00:00Z",
  };

  it("müşteri satırı maskeli biçimlenir", () => {
    const out = formatRow(explorerTable("musteriler")!.columns, raw);
    const flat = JSON.stringify(out);
    for (const secret of ["Ayşe Yılmaz", "Yılmaz", "5321234567", "ayse.yilmaz", "U12345678", "04-12", "TR3300061005"]) expect(flat).not.toContain(secret);
    expect(out.full_name).toBe("A*** Y***");
    expect(out.phone).toMatch(/67$/);
    expect(out.email).toBe("a***@example.com");
    expect(out.birth_date).toBe("**.**.1985");
    expect(out.notes).toContain("[TELEFON]");
    expect(out.source).toBe("web");
    expect(out.blacklist).toBe("Hayır");
  });

  it("IBAN, adres ve IP maskeleri", () => {
    expect(maskValue("iban", "TR330006100519786457841326")).toBe("TR33 **** **** **** **** **26");
    expect(maskValue("address", "Atatürk Mah. 12. Sokak No:4")).toBe("Ata*** (gizli)");
    expect(maskValue("ip", "203.0.113.42")).toBe("203.0.*.*");
    expect(maskValue("phone", null)).toBeNull();
  });
});

describe("güvenli sorgu oluşturucu (plan)", () => {
  it("sayfalama tavanı: sayfa 400'ü aşmaz, sayfalamaya verilen toplam tavanla sınırlı ve uyarı gösterilir", () => {
    expect(EXPLORER_MAX_ROWS).toBe(10_000);
    expect(parseExplorerParams({ tablo: "musteriler", sayfa: "401" })!.page).toBe(EXPLORER_MAX_ROWS / EXPLORER_PAGE_SIZE);
    const view = readFileSync("src/app/admin/sistem/data-explorer-view.tsx", "utf8");
    expect(view).toContain("total={Math.min(res.total, EXPLORER_MAX_ROWS)}");
    expect(view).toContain("süzgeçle daraltın");
  });

  it("bilinmeyen tablo plan üretmez", () => {
    expect(parseExplorerParams({ tablo: "platform_staff" })).toBeNull();
    expect(parseExplorerParams({})).toBeNull();
  });

  it("maskeli ve bilinmeyen sütun süzgeçleri yok sayılır; değerler türüne göre doğrulanır", () => {
    const plan = parseExplorerParams({
      tablo: "musteriler",
      f_phone: "0532",
      f_full_name: "Ayşe",
      f_lead_capture_token: "x",
      f_source: "web",
      f_blacklist: "evet",
      f_assigned_to: "not-a-uuid",
      ofis: TENANT,
      sayfa: "99999",
      bas: "2026-10-01",
      bit: "kötü",
    })!;
    expect(plan.filters.map((f) => f.column).sort()).toEqual(["blacklist", "source"]);
    expect(plan.office).toEqual({ id: TENANT });
    expect(plan.page).toBe(400);
    expect(plan.from).toBe("2026-10-01");
    expect(plan.to).toBeNull();
  });

  it("seçenekli süzgeç yalnız şemadaki değeri kabul eder; arama deseni temizlenir", () => {
    const plan = parseExplorerParams({ tablo: "ofisler", f_status: "active'; drop", f_name: "a%b,(c)" })!;
    expect(plan.filters).toHaveLength(1);
    expect(plan.filters[0]).toMatchObject({ column: "name", op: "ilike", pattern: "%a b c%" });
  });

  it("ofis kısa adı ve adres gidiş-dönüşü", () => {
    const plan = parseExplorerParams({ tablo: "faturalar", ofis: "Demo-Ofis", f_status: "paid" })!;
    expect(plan.office).toEqual({ slug: "demo-ofis" });
    const href = explorerHref({ table: "faturalar", office: TENANT, filters: plan.filters, page: 2 });
    expect(href).toBe(`/admin/sistem?sekme=veri&tablo=faturalar&ofis=${TENANT}&f_status=paid&sayfa=2`);
  });

  it("denetim meta'sı tablo + süzgeç taşır, kişisel veri taşımaz", () => {
    const plan = parseExplorerParams({ tablo: "musteriler", f_source: "web", f_phone: "05321234567" })!;
    const meta = explorerAuditMeta(plan, TENANT);
    expect(meta).toMatchObject({ tablo: "customers", ofis: TENANT, suzgecler: { source: "web" }, sayfa: 1 });
    expect(JSON.stringify(meta)).not.toContain("0532");
  });
});

describe("okuyucu: her görüntüleme denetim izine düşer, iz yoksa veri yok", () => {
  beforeEach(() => {
    db.calls = [];
    db.rows = {
      customers: [{ id: CUSTOMER, tenant_id: TENANT, full_name: "Ayşe Yılmaz", phone: "05321234567", email: "ayse@example.com", source: "web", created_at: "2026-10-01T09:00:00Z" }],
      tenants: [{ id: TENANT, name: "Demo Ofis" }],
    };
    db.error = null;
    audit.calls = [];
    audit.ok = true;
  });

  it("liste: tek denetim kaydı (aktör, tablo, süzgeç) + maskeli satırlar + yalnız kayıtlı sütunlar seçilir", async () => {
    const { readExplorerList, DATA_EXPLORER_LIST_ACTION } = await import("./read");
    const plan = parseExplorerParams({ tablo: "musteriler", ofis: TENANT, f_source: "web" })!;
    const res = await readExplorerList(plan, "staff-1");
    expect(audit.calls).toHaveLength(1);
    expect(audit.calls[0]).toMatchObject({ actorId: "staff-1", action: DATA_EXPLORER_LIST_ACTION, entityType: "customers", entityId: TENANT });
    expect(audit.calls[0]!.meta).toMatchObject({ tablo: "customers", suzgecler: { source: "web" } });
    if (res.kind !== "ok") throw new Error(res.kind);
    expect(res.rows[0]!.cells.full_name).toBe("A*** Y***");
    expect(JSON.stringify(res)).not.toContain("5321234567");
    expect(res.officeNames[TENANT]).toBe("Demo Ofis");

    const q = db.calls.find((c) => c.table === "customers")!;
    const select = q.calls.find((c) => c.method === "select")!.args[0] as string;
    expect(select).toBe(selectList(explorerTable("musteriler")!));
    expect(q.calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([["tenant_id", TENANT], ["source", "web"]]);
    // Yazma yöntemi hiç çağrılmaz (salt okunur).
    expect(db.calls.flatMap((c) => c.calls.map((x) => x.method))).not.toEqual(expect.arrayContaining(["insert"]));
  });

  it("kayıt ayrıntısı da denetim izine düşer", async () => {
    const { readExplorerRecord, DATA_EXPLORER_RECORD_ACTION } = await import("./read");
    const plan = parseExplorerParams({ tablo: "musteriler", kayit: CUSTOMER })!;
    const res = await readExplorerRecord(plan, "staff-1");
    expect(res.kind).toBe("ok");
    expect(audit.calls).toEqual([expect.objectContaining({ actorId: "staff-1", action: DATA_EXPLORER_RECORD_ACTION, entityType: "customers", entityId: CUSTOMER })]);
  });

  it("denetim izi yazılamazsa liste ve kayıt veri döndürmez (fail-closed)", async () => {
    audit.ok = false;
    const { readExplorerList, readExplorerRecord } = await import("./read");
    const list = await readExplorerList(parseExplorerParams({ tablo: "musteriler" })!, "staff-1");
    const rec = await readExplorerRecord(parseExplorerParams({ tablo: "musteriler", kayit: CUSTOMER })!, "staff-1");
    expect(list).toEqual({ kind: "audit_failed" });
    expect(rec).toEqual({ kind: "audit_failed" });
  });

  it("bulunamayan ofis kısa adında sorgu ve iz yok", async () => {
    db.rows.tenants = [];
    const { readExplorerList } = await import("./read");
    const res = await readExplorerList(parseExplorerParams({ tablo: "musteriler", ofis: "yok-ofis" })!, "staff-1");
    expect(res).toEqual({ kind: "office_not_found" });
    expect(db.calls.some((c) => c.table === "customers")).toBe(false);
  });
});

describe("yetki: yetkisiz personel ekranı göremez", () => {
  it("varsayılan yalnız süper admin; özel rol açıkça verilirse görür", () => {
    expect(platformCanAccess("super_admin", "veri")).toBe(true);
    for (const r of ["ops", "support", "billing"] as const) expect(platformCanAccess(r, "veri"), r).toBe(false);
    const custom = { role: "ops" as const, customRole: { id: "r1", label: "Veri analisti", baseRole: "ops" as const, permissions: { veri: ["view" as const] } } };
    expect(platformCanAccess(custom, "veri")).toBe(true);
  });

  it("menü: sekme yalnız `veri` modülü olana çizilir", () => {
    const tabsOf = (mods: Parameters<typeof adminNavFor>[0]) =>
      adminNavFor(mods)
        .flatMap((s) => s.items)
        .find((i) => i.label === "Sistem durumu")
        ?.tabs?.map((t) => t.href) ?? [];
    expect(tabsOf(platformModulesFor("super_admin"))).toContain("/admin/sistem?sekme=veri");
    expect(tabsOf(platformModulesFor("ops"))).not.toContain("/admin/sistem?sekme=veri");
  });

  it("sıfır çıkmaz: yalnız `veri` modülü olan rolün menü satırı Veri gezginine gider (sistem kapısına değil)", () => {
    const sys = (mods: Parameters<typeof adminNavFor>[0]) =>
      adminNavFor(mods)
        .flatMap((s) => s.items)
        .find((i) => i.label === "Sistem durumu");
    expect(sys(["veri"])?.href).toBe("/admin/sistem?sekme=veri");
    expect(sys(["activity"])).toBeUndefined(); // Aktivite kendi satırıdır (Operasyon & sistem)
    expect(sys(platformModulesFor("super_admin"))?.href).toBe("/admin/sistem");
  });

  it("hover ısıtması yok: gezgin içi her bağlantı ve sayfalama `prefetch={false}` taşır (açılmamış görüntüleme denetime düşmez)", () => {
    const view = readFileSync("src/app/admin/sistem/data-explorer-view.tsx", "utf8");
    const tags = view.match(/<(?:Link|ButtonLink|Pagination)\b[^>]*>/g) ?? [];
    const explorerTags = tags.filter((t) => /explorerHref|EXPLORER_BASE|hrefFor|href=\{back\}/.test(t));
    expect(explorerTags.length).toBeGreaterThanOrEqual(8);
    for (const t of explorerTags) expect(t, t).toContain("prefetch={false}");
  });

  it("sayfa kapısı: görünüm veri okumadan önce `veri` modülünü ister; sistem sayfası veri sekmesini sistem kapısına bağlamaz", () => {
    const view = readFileSync("src/app/admin/sistem/data-explorer-view.tsx", "utf8");
    const body = view.slice(view.indexOf("export async function DataExplorerView"));
    expect(body.indexOf('requirePlatformModule("veri")')).toBeGreaterThan(-1);
    expect(body.indexOf('requirePlatformModule("veri")')).toBeLessThan(body.indexOf("parseExplorerParams"));
    expect(view).not.toMatch(/\.(insert|update|upsert|delete|rpc)\(/);
    const page = readFileSync("src/app/admin/sistem/page.tsx", "utf8");
    expect(page).toContain('active === "veri"');
  });
});

describe("görünüm kapısı (çalışan): yetkisiz personel veri okumaz", () => {
  it("requirePlatformModule reddederse okuyucu hiç çağrılmaz", async () => {
    vi.resetModules();
    const read = vi.fn();
    vi.doMock("@/lib/platform", () => ({
      requirePlatformModule: async (m: string) => {
        throw new Error(`REDIRECT /admin (${m})`);
      },
    }));
    vi.doMock("@/lib/admin/data-explorer/read", () => ({ readExplorerList: read, readExplorerRecord: read }));
    const { DataExplorerView } = await import("@/app/admin/sistem/data-explorer-view");
    await expect(DataExplorerView({ params: { tablo: "musteriler" } })).rejects.toThrow("REDIRECT /admin (veri)");
    expect(read).not.toHaveBeenCalled();
  });
});
