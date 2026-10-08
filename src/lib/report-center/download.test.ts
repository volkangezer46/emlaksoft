import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MATRIX } from "@/lib/permissions";
import { TENANT_ID, USER_ID, eqCalls, testCtx } from "./test-support";

/**
 * Rapor indirme uçları (/api/app/rapor/[id], /api/admin/rapor/[id]) — yetki, hız sınırı, onay kapısı,
 * denetim kaydı, başlıklar ve kapsam. Dış bağımlılıklar taklit edilir; rapor sorguları gerçekten çalışır.
 */
const state = vi.hoisted(() => ({
  permissions: {} as Record<string, boolean>,
  session: true,
  rateAllowed: true,
  approval: { status: "not_required" } as { status: string; message?: string },
  ctx: null as unknown,
  staff: null as null | { id: string; role: string; full_name: string },
  activity: [] as unknown[],
  platformActivity: [] as unknown[],
  approvalCalls: [] as unknown[],
}));

vi.mock("@/lib/require-permission", () => ({
  requirePermission: async (mod: string) => {
    if (!state.session) return { ok: false, error: "Oturum bulunamadı." };
    if (state.permissions[mod] === false) return { ok: false, error: "Bu işlem için yetkiniz yok." };
    return { ok: true, userId: "22222222-2222-4222-8222-222222222222", tenantId: "11111111-1111-4111-8111-111111111111", role: "advisor", impersonating: false };
  },
}));
vi.mock("./context", () => ({
  buildTenantContext: async () => state.ctx,
  buildPlatformContext: () => state.ctx,
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => ({ allowed: state.rateAllowed }) }));
vi.mock("@/lib/activity", () => ({ logActivity: async (v: unknown) => void state.activity.push(v) }));
vi.mock("@/lib/platform-activity", () => ({ logPlatformActivity: async (v: unknown) => void state.platformActivity.push(v) }));
vi.mock("@/lib/oversight/approval-gate", () => ({
  requestApprovalIfNeeded: async (...args: unknown[]) => {
    state.approvalCalls.push(args);
    return state.approval;
  },
}));
vi.mock("@/lib/platform", () => ({ getPlatformStaff: async () => state.staff }));

import { handleReportDownload } from "./download";

const req = (qs: string) => new Request(`https://emlaksoft.test/api/app/rapor/x?${qs}`);

beforeEach(() => {
  state.permissions = {};
  state.session = true;
  state.rateAllowed = true;
  state.approval = { status: "not_required" };
  state.staff = null;
  state.activity = [];
  state.platformActivity = [];
  state.approvalCalls = [];
});

describe("kiracı raporu indirme", () => {
  it("oturum yoksa 401, modül yetkisi yoksa 403", async () => {
    const { ctx } = testCtx({ perms: DEFAULT_MATRIX.advisor });
    state.ctx = ctx;
    state.session = false;
    expect((await handleReportDownload("tenant", "musteriler", req("format=csv"))).status).toBe(401);
    state.session = true;
    state.permissions = { customers: false };
    expect((await handleReportDownload("tenant", "musteriler", req("format=csv"))).status).toBe(403);
    state.permissions = { reports: false };
    expect((await handleReportDownload("tenant", "musteriler", req("format=csv"))).status).toBe(403);
  });

  it("bilinmeyen rapor 404, geçersiz biçim ve filtre 400", async () => {
    const { ctx } = testCtx({ perms: DEFAULT_MATRIX.advisor });
    state.ctx = ctx;
    expect((await handleReportDownload("tenant", "yok-boyle-rapor", req("format=csv"))).status).toBe(404);
    expect((await handleReportDownload("tenant", "musteriler", req("format=docx"))).status).toBe(400);
    expect((await handleReportDownload("tenant", "musteriler", req("format=csv&from=2026-99-99"))).status).toBe(400);
  });

  it("danışman ofis geneline kısıtlı raporu (kâr/zarar, ekip, uyum defteri) indiremez", async () => {
    const { ctx } = testCtx({ perms: DEFAULT_MATRIX.advisor, role: "advisor", officeWide: false });
    state.ctx = ctx;
    for (const id of ["kar-zarar", "ekip-kullanicilari", "uyum-kayit-defteri", "yetki-denetimi"]) {
      expect((await handleReportDownload("tenant", id, req("format=csv"))).status, id).toBe(403);
    }
  });

  it("hız sınırı aşılınca 429 + Retry-After", async () => {
    const { ctx } = testCtx({ perms: DEFAULT_MATRIX.advisor });
    state.ctx = ctx;
    state.rateAllowed = false;
    const res = await handleReportDownload("tenant", "musteriler", req("format=csv"));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("600");
  });

  it("onay kapısı bekletirse dosya üretilmez (403) ve denetim kaydı yazılmaz", async () => {
    const { ctx } = testCtx({ perms: DEFAULT_MATRIX.advisor });
    state.ctx = ctx;
    state.approval = { status: "pending", message: "Onay bekleniyor." };
    const res = await handleReportDownload("tenant", "musteriler", req("format=xlsx"));
    expect(res.status).toBe(403);
    expect(state.activity).toEqual([]);
    expect(state.approvalCalls[0]).toMatchObject({ 2: "bulk_export" });
  });

  it("danışman kendi müşterilerini CSV indirir: başlıklar, kapsam süzgeci ve denetim kaydı", async () => {
    const { ctx, calls } = testCtx(
      { perms: DEFAULT_MATRIX.advisor },
      { customers: [{ id: "c1", full_name: "Şükrü Işık", phone: "05321112233", email: "s@x.com", customer_types: ["Alıcı"], tags: [], source: "web", lead_channel: "web_form", assigned_to: USER_ID, created_at: "2026-10-01T09:00:00Z", updated_at: "2026-10-02T09:00:00Z" }] },
    );
    state.ctx = ctx;
    const res = await handleReportDownload("tenant", "musteriler", req("format=csv&q=%C5%9E%C3%BCkr%C3%BC"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toMatch(/attachment; filename="musteriler-\d{4}-\d{2}-\d{2}\.csv"/);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-report-rows")).toBe("1");
    const buf = Buffer.from(await res.arrayBuffer());
    expect([...buf.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // UTF-8 BOM (Excel Türkçe)
    const text = buf.toString("utf8");
    expect(text).toContain("Şükrü Işık");
    expect(text).toContain("0532 111 22 33");
    // kapsam: danışman yalnız kendi kayıtları + kiracı sınırı
    expect(eqCalls(calls)).toContainEqual(["tenant_id", TENANT_ID]);
    expect(eqCalls(calls)).toContainEqual(["assigned_to", USER_ID]);
    // denetim: kişi verisi yok, serbest metin filtre maskeli
    expect(state.activity).toHaveLength(1);
    expect(state.activity[0]).toMatchObject({
      tenantId: TENANT_ID,
      actorId: USER_ID,
      action: "export.report",
      entityType: "musteriler",
      newValue: { report: "musteriler", format: "csv", rows: 1, truncated: false, filters: { q: "(metin)" } },
    });
    expect(JSON.stringify(state.activity[0])).not.toContain("Şükrü");
  });

  it("XLSX ve PDF imzalı dosya döner", async () => {
    const rows = { customers: [{ id: "c1", full_name: "Ayşe", phone: "", email: "", customer_types: [], tags: [], source: null, lead_channel: null, assigned_to: USER_ID, created_at: "2026-10-01T09:00:00Z", updated_at: null }] };
    const { ctx } = testCtx({ perms: DEFAULT_MATRIX.advisor }, rows);
    state.ctx = ctx;
    const x = await handleReportDownload("tenant", "musteriler", req("format=xlsx"));
    expect(x.status).toBe(200);
    expect(x.headers.get("content-type")).toContain("spreadsheetml.sheet");
    expect(Buffer.from(await x.arrayBuffer()).readUInt32LE(0)).toBe(0x04034b50);
    const p = await handleReportDownload("tenant", "musteriler", req("format=pdf"));
    expect(p.headers.get("content-type")).toBe("application/pdf");
    expect(Buffer.from(await p.arrayBuffer()).subarray(0, 5).toString()).toBe("%PDF-");
    expect(state.activity).toHaveLength(2);
  });
});

describe("platform raporu indirme", () => {
  it("personel yoksa 401; departman izni yoksa 403", async () => {
    const { ctx } = testCtx({ scope: "platform", tenantId: null, role: "support" });
    state.ctx = ctx;
    state.staff = null;
    expect((await handleReportDownload("platform", "ofisler", req("format=csv"))).status).toBe(401);
    // destek rolü `reports` departman modülüne sahip değil
    state.staff = { id: "99999999-9999-4999-8999-999999999999", role: "support", full_name: "Destek" };
    expect((await handleReportDownload("platform", "ofisler", req("format=csv"))).status).toBe(403);
    // muhasebe: faturalar evet, platform denetimi hayır
    state.staff = { id: "99999999-9999-4999-8999-999999999999", role: "billing", full_name: "Muhasebe" };
    expect((await handleReportDownload("platform", "platform-denetim", req("format=csv"))).status).toBe(403);
  });

  it("muhasebe faturaları indirir; platform denetim kaydına yazılır, ofis denetimine değil", async () => {
    const { ctx } = testCtx(
      { scope: "platform", tenantId: null, role: "billing" },
      { invoices: [{ id: "i1", tenant_id: TENANT_ID, invoice_no: "FTR-1", status: "paid", amount_try: 1000, tax_try: 200, total_try: 1200, due_at: null, paid_at: "2026-10-01T10:00:00Z", reminder_count: 0, created_at: "2026-09-30T10:00:00Z" }] },
    );
    state.ctx = ctx;
    state.staff = { id: "99999999-9999-4999-8999-999999999999", role: "billing", full_name: "Muhasebe" };
    const res = await handleReportDownload("platform", "faturalar", req("format=csv"));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("FTR-1");
    expect(state.activity).toEqual([]);
    expect(state.platformActivity[0]).toMatchObject({ action: "report.export", entityType: "faturalar", meta: { rows: 1, format: "csv" } });
    expect(state.approvalCalls).toEqual([]);
  });
});
