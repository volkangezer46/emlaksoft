import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlatformPrincipal } from "@/lib/platform-access";

/**
 * DG1 kabul: eşik üstü iade talebi oluşur, AYNI kişi onaylayamaz, İKİNCİ yetkili onaylayınca iade gerçekten yazılır.
 * Gerçek zincir: recordInvoiceRefund (platform-billing) → fourEyesGate (four-eyes) → approvePlatformRequest
 * (platform-approvals) → aynı recordInvoiceRefund onaylayan adına. Veritabanı küçük bir bellek içi PostgREST taklidi;
 * dört göz CHECK'i (decided_by <> requested_by) ve bekleyen tekilliği burada da uygulanır (SQL'deki karşılığı pglite testinde).
 */

type Row = Record<string, unknown>;
const db = vi.hoisted(() => ({ tables: new Map<string, Row[]>(), seq: 0 }));
const who = vi.hoisted(() => ({ staff: null as null | (PlatformPrincipal & { id: string; email: string; full_name: string; is_active: boolean }) }));
const audit = vi.hoisted(() => [] as { actorId: string | null; action: string; meta?: unknown }[]);
const notified = vi.hoisted(() => [] as unknown[]);
const settings = vi.hoisted(() => ({ refund: 1000 }));

// --- bellek içi PostgREST taklidi -------------------------------------------------------------------------------------
function get(row: Row, key: string): unknown {
  const [col, ...path] = key.split("->");
  let v: unknown = row[col!];
  for (const p of path) v = v && typeof v === "object" ? (v as Row)[p.replace(/^>/, "")] : undefined;
  return v;
}
function fakeFrom(table: string) {
  const rows = () => db.tables.get(table) ?? (db.tables.set(table, []), db.tables.get(table)!);
  const filters: ((r: Row) => boolean)[] = [];
  let op: "select" | "insert" | "update" | "delete" = "select";
  let payload: Row | null = null;
  let head = false;
  const b: Record<string, unknown> = {};
  const chain = (f: (r: Row) => boolean) => (filters.push(f), b);
  Object.assign(b, {
    select: (_c?: string, o?: { head?: boolean }) => ((head = !!o?.head), b),
    insert: (r: Row) => ((op = "insert"), (payload = r), b),
    update: (r: Row) => ((op = "update"), (payload = r), b),
    eq: (k: string, v: unknown) => chain((r) => get(r, k) === v),
    neq: (k: string, v: unknown) => chain((r) => get(r, k) !== v),
    gt: (k: string, v: string) => chain((r) => String(get(r, k)) > v),
    lte: (k: string, v: string) => chain((r) => String(get(r, k)) <= v),
    is: (k: string, v: unknown) => chain((r) => (get(r, k) ?? null) === v),
    in: (k: string, vs: unknown[]) => chain((r) => vs.includes(get(r, k))),
    not: () => b,
    filter: () => b,
    or: () => b,
    order: () => b,
    limit: () => b,
  });
  const run = (): { data: unknown; error: { code: string; message: string } | null; count?: number } => {
    const match = rows().filter((r) => filters.every((f) => f(r)));
    if (op === "insert") {
      const row: Row = { id: `00000000-0000-4000-8000-${String(++db.seq).padStart(12, "0")}`, status: "pending", ...payload };
      if (table === "platform_approval_requests" && rows().some((r) => r.status === "pending" && r.kind === row.kind && r.entity_id === row.entity_id)) {
        return { data: null, error: { code: "23505", message: "duplicate" } };
      }
      rows().push(row);
      return { data: [row], error: null };
    }
    if (op === "update") {
      for (const r of match) {
        const next = { ...r, ...payload };
        if (table === "platform_approval_requests" && next.decided_by && next.decided_by === next.requested_by) {
          return { data: null, error: { code: "23514", message: "platform_approval_four_eyes" } };
        }
        Object.assign(r, payload);
      }
      return { data: match, error: null };
    }
    return { data: head ? null : match, error: null, count: match.length };
  };
  Object.assign(b, {
    maybeSingle: async () => {
      const r = run();
      return { ...r, data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data };
    },
    single: async () => {
      const r = run();
      return { ...r, data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data };
    },
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
  });
  return b;
}

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
  unstable_rethrow: (e: unknown) => {
    if (e instanceof Error && e.message.startsWith("REDIRECT:")) throw e;
  },
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: fakeFrom, rpc: async () => ({ data: null, error: null }) }) }));
vi.mock("@/lib/platform", async () => {
  const { platformCan } = await import("@/lib/platform-access");
  return {
    requirePlatformStaff: async () => who.staff!,
    requirePlatformModule: async (m: Parameters<typeof platformCan>[1], a?: Parameters<typeof platformCan>[2]) => {
      if (!platformCan(who.staff!, m, a ?? "write")) throw new Error("REDIRECT:/admin");
      return who.staff!;
    },
    staffFromRow: (r: Row) => ({ ...r, customRole: null }),
  };
});
vi.mock("@/lib/platform-activity", () => ({
  logPlatformActivity: async (i: { actorId: string | null; action: string; meta?: unknown }) => {
    audit.push(i);
    return { ok: true };
  },
}));
vi.mock("@/lib/platform-notify", () => ({ notifyPlatformStaff: async (i: unknown) => void notified.push(i) }));
vi.mock("@/lib/settings/read", () => ({
  getSettings: async (keys: string[]) =>
    Object.fromEntries(keys.map((k) => [k, k.endsWith("refund_threshold_try") ? settings.refund : k.endsWith("expiry_hours") ? 72 : k.includes("threshold") ? 0 : false])),
}));
vi.mock("@/lib/platform-security/step-up", () => ({
  STEP_UP_FIELD: "step_up_code",
  requireStepUp: async (input: FormData | { code?: unknown }, _a: string, _s: string) => {
    const code = input instanceof FormData ? input.get("step_up_code") : input.code;
    return code === "123456" ? { ok: true } : { ok: false, code: "step_up_required", error: "Doğrulayıcı kodu gerekli." };
  },
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => ({ allowed: true }) }));
vi.mock("@/lib/growth/engine", () => ({ reverseClaimsForInvoiceSafe: async () => undefined }));
vi.mock("@/lib/try-credits/wallet", () => ({ tryRefundIdem: () => "idem", tryRefundInvoice: async () => null, tryReleaseInvoice: async () => null }));
vi.mock("@/lib/ef-credits/wallet", () => ({ efCommit: async () => null, efReserve: async () => null }));
// Diğer tür yürütücüleri bu testte kullanılmaz (ağır içe aktarımlar yerine taslak).
vi.mock("@/app/actions/admin-account-credit", () => ({ grantAccountCredit: async () => ({ error: "kullanılmaz" }) }));
vi.mock("@/app/actions/platform-tenants", () => ({ setTenantLifecycleByAdmin: async () => ({ error: "kullanılmaz" }) }));
vi.mock("@/app/actions/platform-staff", () => ({ updateStaffRole: async () => ({ error: "kullanılmaz" }) }));

const { recordInvoiceRefund } = await import("@/app/actions/platform-billing");
const { approvePlatformRequest, rejectPlatformRequest, cancelPlatformRequest } = await import("@/app/actions/platform-approvals");

const INV = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const A = { id: "11111111-1111-4111-8111-111111111111", email: "a@x", full_name: "Ayşe", is_active: true, role: "super_admin" as const, customRole: null };
const B = { id: "22222222-2222-4222-8222-222222222222", email: "b@x", full_name: "Burak", is_active: true, role: "super_admin" as const, customRole: null };
const FIN = {
  id: "33333333-3333-4333-8333-333333333333",
  email: "c@x",
  full_name: "Cem",
  is_active: true,
  role: "billing" as const,
  customRole: { id: "r1", label: "Finans onaylayıcı", baseRole: "billing" as const, permissions: { billing: ["approve" as const] } },
};
const SUPPORT = { id: "44444444-4444-4444-8444-444444444444", email: "d@x", full_name: "Deniz", is_active: true, role: "billing" as const, customRole: null };

const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const invoice = () => db.tables.get("invoices")![0]!;
const request = () => db.tables.get("platform_approval_requests")![0]!;

describe("DG1 dört göz: eşik üstü iade", () => {
  beforeEach(() => {
    db.tables.clear();
    db.seq = 0;
    audit.length = 0;
    notified.length = 0;
    settings.refund = 1000;
    db.tables.set("invoices", [{ id: INV, tenant_id: "t1", status: "paid", total_try: 5000, currency: "TRY", meta: {} }]);
    db.tables.set("platform_staff", [A, B, FIN, SUPPORT].map(({ customRole: _c, ...r }) => ({ ...r })));
    db.tables.set("platform_approval_requests", []);
    who.staff = A;
  });

  it("eşik altı iade eskisi gibi tek imzayla yürür (talep açılmaz)", async () => {
    const r = await recordInvoiceRefund(fd({ invoice_id: INV, amount_try: "500", reason: "Müşteri isteği", step_up_code: "123456" }));
    expect(r).toEqual({ ok: true });
    expect((invoice().meta as Row).refund).toMatchObject({ amount_try: 500, by: A.id });
    expect(db.tables.get("platform_approval_requests")).toHaveLength(0);
  });

  it("eşik üstü: talep açılır, iade YAZILMAZ; talep eden onaylayamaz/reddedemez; ikinci kişi onaylayınca iade yazılır", async () => {
    const r = await recordInvoiceRefund(fd({ invoice_id: INV, amount_try: "2500", reason: "Çift tahsilat", step_up_code: "123456" }));
    expect(r.ok).toBe(true);
    expect(r.notice).toMatch(/ikinci onaya/);
    expect((invoice().meta as Row).refund).toBeUndefined();
    const req = request();
    expect(req).toMatchObject({ kind: "refund", module: "billing", entity_id: INV, amount_try: 2500, status: "pending", requested_by: A.id });
    // Doğrulayıcı kodu yükte SAKLANMAZ.
    expect(req.payload).toEqual({ invoice_id: INV, amount_try: "2500", reason: "Çift tahsilat" });
    expect(audit.map((a) => a.action)).toContain("platform.approval.requested");
    // Bildirim talep edene değil, onay yetkisi olan diğerlerine gider (sabit rol bildirim süzgeci taklitte rol adına bakar).
    expect(notified.length).toBeGreaterThan(0);

    // Aynı kayıt için ikinci talep açılmaz.
    const again = await recordInvoiceRefund(fd({ invoice_id: INV, amount_try: "2500", reason: "Çift tahsilat", step_up_code: "123456" }));
    expect(again.notice).toMatch(/zaten onay bekleyen/);
    expect(db.tables.get("platform_approval_requests")).toHaveLength(1);

    // Talep eden onaylayamaz ve reddedemez.
    const self = await approvePlatformRequest(fd({ id: req.id as string, step_up_code: "123456" }));
    expect(self.error).toMatch(/Kendi talebinizi/);
    expect((await rejectPlatformRequest(fd({ id: req.id as string, note: "olmaz" }))).error).toMatch(/Kendi talebinizi/);
    expect(request().status).toBe("pending");
    expect((invoice().meta as Row).refund).toBeUndefined();

    // Onay yetkisi olmayan personel karar veremez.
    who.staff = SUPPORT;
    expect((await approvePlatformRequest(fd({ id: req.id as string, step_up_code: "123456" }))).error).toMatch(/yetkiniz yok/);

    // İkinci yetkili: kodsuz onay reddedilir, kodla onaylanınca iade ONUN adına yazılır.
    who.staff = B;
    expect((await approvePlatformRequest(fd({ id: req.id as string }))).error).toMatch(/kodu/);
    const ok = await approvePlatformRequest(fd({ id: req.id as string, step_up_code: "123456", note: "Kontrol edildi" }));
    expect(ok.error).toBeUndefined();
    expect(ok.ok).toBe(true);
    expect((invoice().meta as Row).refund).toMatchObject({ amount_try: 2500, by: B.id, reason: "Çift tahsilat" });
    expect(request()).toMatchObject({ status: "executed", decided_by: B.id, decision_note: "Kontrol edildi" });
    const actions = audit.map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["platform.approval.approved", "billing.invoice.refund_recorded", "platform.approval.executed"]));

    // Sonuçlanmış talep ikinci kez yürütülemez.
    expect((await approvePlatformRequest(fd({ id: req.id as string, step_up_code: "123456" }))).error).toMatch(/sonuçlanmış/);
  });

  it("özel rol (Faturalama: Onayla) onaylayabilir; onaylı yürütme bağlamı istemciden taklit edilemez", async () => {
    await recordInvoiceRefund(fd({ invoice_id: INV, amount_try: "3000", reason: "İade", step_up_code: "123456" }));
    who.staff = FIN;
    // Onay ekranı dışında, aynı forma ek alan koyarak dört gözü atlamak mümkün değil: yine talep açar/bekleyene düşer.
    const bypass = await recordInvoiceRefund(fd({ invoice_id: INV, amount_try: "3000", reason: "İade", step_up_code: "123456", approved: "1" }));
    expect(bypass.notice).toMatch(/zaten onay bekleyen/);
    const ok = await approvePlatformRequest(fd({ id: request().id as string, step_up_code: "123456" }));
    expect(ok.ok).toBe(true);
    expect((invoice().meta as Row).refund).toMatchObject({ amount_try: 3000, by: FIN.id });
  });

  it("ret ve geri çekme: işlem yapılmaz", async () => {
    await recordInvoiceRefund(fd({ invoice_id: INV, amount_try: "3000", reason: "İade", step_up_code: "123456" }));
    who.staff = B;
    expect((await cancelPlatformRequest(fd({ id: request().id as string }))).error).toMatch(/yalnız açan/);
    const rej = await rejectPlatformRequest(fd({ id: request().id as string, note: "Belge eksik" }));
    expect(rej.ok).toBe(true);
    expect(request()).toMatchObject({ status: "rejected", decided_by: B.id });
    expect((invoice().meta as Row).refund).toBeUndefined();
  });

  it("eşik kapalıyken (0) talep açılmaz", async () => {
    settings.refund = 0;
    await recordInvoiceRefund(fd({ invoice_id: INV, amount_try: "4000", reason: "İade", step_up_code: "123456" }));
    expect(db.tables.get("platform_approval_requests")).toHaveLength(0);
    expect((invoice().meta as Row).refund).toMatchObject({ amount_try: 4000 });
  });
});
