import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Kiracı dekont yüklemesi (oturumsuz): token geçersiz / başka kiracının bildirimi / tür / boyut reddi;
 * başarılı yolda yol ofis/kiracı/bildirim kimliğiyle, kimlikler token'ın çözdüğü kayıttan gelir.
 */
const TOKEN = "a".repeat(64);
const TENANT = "11111111-1111-4111-8111-111111111111";
const CUSTOMER = "22222222-2222-4222-8222-222222222222";
const NOTICE = "33333333-3333-4333-8333-333333333333";
const CHARGE = "44444444-4444-4444-8444-444444444444";

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  rate: vi.fn(),
  updates: [] as Record<string, unknown>[],
  signed: vi.fn(),
  row: null as Record<string, unknown> | null,
  blob: null as Blob | null,
}));

vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: (...a: unknown[]) => h.rate(...a), clientIp: async () => "1.2.3.4" }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: (...a: unknown[]) => h.rpc(...a) }) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      const c: Record<string, unknown> = {};
      let patch: Record<string, unknown> | null = null;
      c.update = (p: Record<string, unknown>) => {
        patch = p;
        h.updates.push(p);
        return c;
      };
      c.select = () => c;
      for (const m of ["eq", "neq"]) c[m] = () => c;
      c.maybeSingle = async () => (patch ? { data: { id: NOTICE }, error: null } : { data: h.row, error: null });
      c.then = (res: (v: unknown) => unknown) => res({ error: null });
      return c;
    },
    storage: {
      from: () => ({
        createSignedUploadUrl: (...a: unknown[]) => h.signed(...a),
        download: async () => ({ data: h.blob, error: h.blob ? null : { message: "x" } }),
        remove: async () => ({ error: null }),
      }),
    },
  }),
}));

import { finalizeRentReceiptUpload, prepareRentReceiptUpload } from "./rent-receipt-public";

const okTarget = { data: { ok: true, tenant_id: TENANT, customer_id: CUSTOMER, notice_id: NOTICE, receipt_status: null }, error: null };
const pdf = { fileName: "dekont.pdf", fileSize: 1000, fileType: "application/pdf" };

beforeEach(() => {
  vi.clearAllMocks();
  h.updates.length = 0;
  h.rate.mockResolvedValue({ allowed: true });
  h.rpc.mockResolvedValue(okTarget);
  h.signed.mockImplementation(async (path: string) => ({ data: { token: "sig", path }, error: null }));
});

describe("prepareRentReceiptUpload", () => {
  it("token biçimi ya da tahakkuk kimliği geçersizse RPC bile çağrılmaz", async () => {
    expect((await prepareRentReceiptUpload("kisa", CHARGE, pdf)).ok).toBeFalsy();
    expect((await prepareRentReceiptUpload(TOKEN, "x", pdf)).ok).toBeFalsy();
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("süresi dolmuş/başka kiracının bildirimi (RPC reddi) imza üretmez", async () => {
    h.rpc.mockResolvedValue({ data: { ok: false, code: "not_found" }, error: null });
    const res = await prepareRentReceiptUpload(TOKEN, CHARGE, pdf);
    expect(res.ok).toBeFalsy();
    expect(h.signed).not.toHaveBeenCalled();
    expect(h.updates).toHaveLength(0);
  });

  it("tür ve boyut reddedilir (RPC'ye gidilmez)", async () => {
    expect((await prepareRentReceiptUpload(TOKEN, CHARGE, { ...pdf, fileType: "text/html" })) as { error: string }).toMatchObject({ error: expect.stringContaining("JPEG") });
    expect((await prepareRentReceiptUpload(TOKEN, CHARGE, { ...pdf, fileType: "image/gif" })).ok).toBeFalsy();
    expect((await prepareRentReceiptUpload(TOKEN, CHARGE, { ...pdf, fileSize: 5 * 1024 * 1024 + 1 })) as { error: string }).toMatchObject({ error: expect.stringContaining("5 MB") });
    expect((await prepareRentReceiptUpload(TOKEN, CHARGE, { ...pdf, fileSize: 0 })).ok).toBeFalsy();
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.signed).not.toHaveBeenCalled();
  });

  it("oran sınırı aşılırsa hiçbir şey yapılmaz", async () => {
    h.rate.mockResolvedValue({ allowed: false });
    expect((await prepareRentReceiptUpload(TOKEN, CHARGE, pdf)).ok).toBeFalsy();
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.rate.mock.calls.every((c) => (c[1] as { failurePolicy: string }).failurePolicy === "deny")).toBe(true);
  });

  it("başarı: yol ofis/kiracı/bildirim kimliğiyle, tek nesnelik imzalı URL; dosya adı ve bildirim kimliği istemciden alınmaz", async () => {
    const res = await prepareRentReceiptUpload(TOKEN, CHARGE, { ...pdf, fileName: "../../etc/passwd.pdf" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.upload.bucket).toBe("rent-receipts");
    expect(res.upload.path).toMatch(new RegExp(`^${TENANT}/${CUSTOMER}/${NOTICE}/[0-9a-f-]{36}\\.pdf$`));
    expect(h.updates[0]).toMatchObject({ receipt_status: "pending", receipt_mime: "application/pdf", receipt_size: 1000 });
    expect(String(h.updates[0]!.receipt_name)).not.toContain("/");
  });

  it("zaten doğrulanmış dekont varsa yenisi alınmaz", async () => {
    h.rpc.mockResolvedValue({ data: { ...okTarget.data, receipt_status: "verified" }, error: null });
    expect((await prepareRentReceiptUpload(TOKEN, CHARGE, pdf)).ok).toBeFalsy();
    expect(h.signed).not.toHaveBeenCalled();
  });
});

describe("finalizeRentReceiptUpload", () => {
  const rowOf = (over: Record<string, unknown> = {}) => ({
    id: NOTICE,
    receipt_path: `${TENANT}/${CUSTOMER}/${NOTICE}/55555555-5555-4555-8555-555555555555.pdf`,
    receipt_name: "dekont.pdf",
    receipt_mime: "application/pdf",
    receipt_size: 20,
    receipt_status: "pending",
    ...over,
  });

  it("geçersiz token reddedilir", async () => {
    h.rpc.mockResolvedValue({ data: { ok: false, code: "invalid_link" }, error: null });
    expect((await finalizeRentReceiptUpload(TOKEN, CHARGE)).ok).toBeFalsy();
    expect(h.updates).toHaveLength(0);
  });

  it("içerik PDF değilse (sahte uzantı/tür) dosya engellenir", async () => {
    h.row = rowOf({ receipt_size: 14 });
    h.blob = new Blob(["<script>alert(1)</script>"].map((s) => s.slice(0, 14)), { type: "application/pdf" });
    const res = await finalizeRentReceiptUpload(TOKEN, CHARGE);
    expect(res.ok).toBeFalsy();
    expect(h.updates.some((u) => u.receipt_status === "blocked")).toBe(true);
    expect(h.updates.some((u) => u.receipt_status === "verified")).toBe(false);
  });

  it("boyut beyan edilenle uyuşmazsa engellenir", async () => {
    h.row = rowOf({ receipt_size: 99 });
    h.blob = new Blob(["%PDF-1.4\n%%EOF"], { type: "application/pdf" });
    expect((await finalizeRentReceiptUpload(TOKEN, CHARGE)).ok).toBeFalsy();
    expect(h.updates.some((u) => u.receipt_status === "blocked")).toBe(true);
  });

  it("geçerli PDF doğrulanır", async () => {
    const body = "%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF";
    h.row = rowOf({ receipt_size: body.length });
    h.blob = new Blob([body], { type: "application/pdf" });
    const res = await finalizeRentReceiptUpload(TOKEN, CHARGE);
    expect(res.ok).toBe(true);
    expect(h.updates.some((u) => u.receipt_status === "verified")).toBe(true);
  });
});
