import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * e-Fatura action'ları (Konsey P2): resmileştirme ATOMİK TALEP (claim) ile başlar; satır dönmezse sağlayıcı çağrılmaz;
 * provider_ref yazımı hata kontrollüdür; oran sınırı anahtarları ve deny politikası; yazma yalnız RPC.
 */
const TENANT = "12345678-aaaa-bbbb-cccc-000000000000";
const INV_ID = "aaaaaaaa-1111-2222-3333-444444444444";

const h = vi.hoisted(() => ({
  gate: { ok: true, userId: "u1", tenantId: "12345678-aaaa-bbbb-cccc-000000000000" } as
    | { ok: true; userId: string; tenantId: string }
    | { ok: false; error: string },
  rpc: vi.fn(),
  rate: vi.fn(),
  createDraft: vi.fn(),
  issue: vi.fn(),
  lookupTaxpayer: vi.fn(),
  loadedRow: null as Record<string, unknown> | null,
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/require-permission", () => ({ requirePermission: async () => h.gate }));
vi.mock("@/lib/activity", () => ({ logActivity: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: (...a: unknown[]) => h.rate(...a) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: (...a: unknown[]) => h.rpc(...a),
    from: () => {
      const c: Record<string, unknown> = {};
      for (const m of ["select", "eq"]) c[m] = () => c;
      c.maybeSingle = async () => ({ data: h.loadedRow, error: null });
      return c;
    },
  }),
}));
vi.mock("@/lib/integrations/einvoice/service", async (orig) => {
  const real = await orig<typeof import("@/lib/integrations/einvoice/service")>();
  return {
    ...real,
    loadAdapterForUser: async () => ({
      ok: true,
      value: {
        adapter: { createDraft: h.createDraft, issue: h.issue, lookupTaxpayer: h.lookupTaxpayer },
        connection: { id: "c1", provider: "nilvera", mode: "live" },
      },
    }),
  };
});

import { issueInvoice, lookupInvoiceBuyer } from "./einvoice";

function claimedRow(over: Record<string, unknown> = {}) {
  return {
    id: INV_ID, tenant_id: TENANT, connection_id: "c1", provider: "nilvera", mode: "live", source_type: "free", source_id: null,
    source_label: "Serbest fatura", doc_type: "e-arsiv", status: "draft", provider_state: "none", buyer_name: "Ali", buyer_tax_id: "12345678901",
    buyer_tax_office: null, buyer_address: null, buyer_city: null, buyer_district: null, buyer_alias: null,
    lines: [{ description: "Hizmet", quantity: 1, unitPrice: 100, vatRate: 20 }], net_total: 100, vat_total: 20, gross_total: 120,
    issue_date: "2026-10-11", note: null, external_id: "ext-1", provider_ref: {}, number: null, error: null, idempotency_key: "free:a:invoice",
    issued_at: null, last_checked_at: null, created_at: "2026-10-11T00:00:00Z", ...over,
  };
}

const REF = { externalId: "prov-1", docType: "e-arsiv" };

/** rpc mock'u: ad -> yanıt. */
function rpcMap(map: Record<string, { data?: unknown; error?: { code: string; message: string } | null }>) {
  h.rpc.mockImplementation(async (name: string) => map[name] ?? { data: true, error: null });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.gate = { ok: true, userId: "u1", tenantId: TENANT };
  h.rate.mockResolvedValue({ allowed: true });
  h.loadedRow = null;
  h.createDraft.mockResolvedValue({ ok: true, value: { ref: REF, number: "N1" } });
  h.issue.mockResolvedValue({ ok: true, value: { ref: REF, number: "N1" } });
});

describe("issueInvoice atomik talep", () => {
  it("talep satır döndürmezse (başka istek sürüyor) sağlayıcı ÇAĞRILMAZ ve 'işlem sürüyor' döner", async () => {
    rpcMap({ einvoice_claim_issue: { data: [], error: null } });
    h.loadedRow = claimedRow();
    const res = await issueInvoice(INV_ID, true);
    expect(res.error).toContain("İşlem sürüyor");
    expect(res.error).toContain("Durumu yenile");
    expect(h.createDraft).not.toHaveBeenCalled();
    expect(h.issue).not.toHaveBeenCalled();
  });

  it("taslak olmayan fatura için talep boşsa durum mesajı verir", async () => {
    rpcMap({ einvoice_claim_issue: { data: [], error: null } });
    h.loadedRow = claimedRow({ status: "issued" });
    expect((await issueInvoice(INV_ID, true)).error).toBe("Yalnız taslak fatura resmileştirilebilir.");
    expect(h.issue).not.toHaveBeenCalled();
  });

  it("başarılı akış: talep -> sağlayıcı taslak -> provider_ref RPC -> issue -> mark_issued; mesaj yanlış vaat içermez", async () => {
    rpcMap({ einvoice_claim_issue: { data: [claimedRow()], error: null } });
    const res = await issueInvoice(INV_ID, true);
    expect(res.ok).toBe(true);
    expect(res.message).not.toContain("Birkaç dakika içinde görünür");
    expect(res.message).toContain("Durumu yenile");
    const names = h.rpc.mock.calls.map((c) => c[0]);
    expect(names).toEqual(["einvoice_claim_issue", "einvoice_record_progress", "einvoice_mark_issue_sent", "einvoice_mark_issued"]);
    expect(h.rpc.mock.calls[1]![1]).toMatchObject({ p_id: INV_ID, p_ref: REF });
  });

  it("provider_ref yazımı başarısızsa resmileştirme ÇAĞRILMAZ, kilit bırakılır", async () => {
    rpcMap({
      einvoice_claim_issue: { data: [claimedRow()], error: null },
      einvoice_record_progress: { data: false, error: null },
    });
    const res = await issueInvoice(INV_ID, true);
    expect(res.error).toBeTruthy();
    expect(h.issue).not.toHaveBeenCalled();
    const releases = h.rpc.mock.calls.filter((c) => c[0] === "einvoice_record_progress" && (c[1] as { p_release?: boolean }).p_release === true);
    expect(releases.length).toBe(1);
  });

  it("sağlayıcı issue hatasında hata kaydedilir ve kilit bırakılır; mark_issued çağrılmaz", async () => {
    rpcMap({ einvoice_claim_issue: { data: [claimedRow({ provider_ref: REF })], error: null } });
    h.issue.mockResolvedValue({ ok: false, error: { code: "rejected", message: "Sağlayıcı reddetti." } });
    const res = await issueInvoice(INV_ID, true);
    expect(res.error).toBe("Sağlayıcı reddetti.");
    expect(h.rpc.mock.calls.map((c) => c[0])).toEqual(["einvoice_claim_issue", "einvoice_mark_issue_sent", "einvoice_record_progress"]);
    expect(h.createDraft).not.toHaveBeenCalled();
  });

  it("belirsiz hata (zaman aşımı/5xx): kilit ve işaret KORUNUR (release yok), tekrar gönderilmez, açık mesaj verilir", async () => {
    rpcMap({ einvoice_claim_issue: { data: [claimedRow({ provider_ref: REF })], error: null } });
    h.issue.mockResolvedValue({ ok: false, error: { code: "unavailable", message: "Nilvera zamanında yanıt vermedi." } });
    const res = await issueInvoice(INV_ID, true);
    expect(res.error).toContain("doğrulanıyor");
    expect(res.error).toContain("tekrar gönderilmeyecek");
    expect(h.rpc.mock.calls.map((c) => c[0])).toEqual(["einvoice_claim_issue", "einvoice_mark_issue_sent"]);
    expect(h.issue).toHaveBeenCalledTimes(1);
  });

  it("işaret yazılamazsa sağlayıcıya resmileştirme İSTEĞİ GİTMEZ", async () => {
    rpcMap({
      einvoice_claim_issue: { data: [claimedRow({ provider_ref: REF })], error: null },
      einvoice_mark_issue_sent: { data: false, error: null },
    });
    const res = await issueInvoice(INV_ID, true);
    expect(res.error).toBeTruthy();
    expect(h.issue).not.toHaveBeenCalled();
  });

  it("sonucu doğrulanan (issue_stage dolu) taslak yeniden talep edilirse sağlayıcıya GİDİLMEZ ve belirsizlik mesajı döner", async () => {
    rpcMap({ einvoice_claim_issue: { data: [], error: null } });
    h.loadedRow = claimedRow({ issue_stage: "issue_sent", provider_ref: REF });
    const res = await issueInvoice(INV_ID, true);
    expect(res.error).toContain("doğrulanıyor");
    expect(h.issue).not.toHaveBeenCalled();
    expect(h.createDraft).not.toHaveBeenCalled();
  });

  it("mark_issued başarısızsa açık hata döner (sessiz başarı yok)", async () => {
    rpcMap({
      einvoice_claim_issue: { data: [claimedRow({ provider_ref: REF })], error: null },
      einvoice_mark_issued: { data: false, error: null },
    });
    const res = await issueInvoice(INV_ID, true);
    expect(res.ok).toBeUndefined();
    expect(res.error).toContain("Durumu yenile");
  });

  it("onay yoksa ve yetki yoksa talep hiç yapılmaz", async () => {
    expect((await issueInvoice(INV_ID, false)).error).toBe("Resmileştirmek için onay gerekli.");
    h.gate = { ok: false, error: "Yetkiniz yok." };
    expect((await issueInvoice(INV_ID, true)).error).toBe("Yetkiniz yok.");
    expect(h.rpc).not.toHaveBeenCalled();
  });
});

describe("oran sınırı", () => {
  it("alıcı sorgusu ofis başına 60/dk, deny politikası; sınır aşılınca sağlayıcı çağrılmaz", async () => {
    h.rate.mockResolvedValue({ allowed: false });
    const res = await lookupInvoiceBuyer("1234567890");
    expect(res.error).toContain("Çok sık");
    expect(h.rate).toHaveBeenCalledWith(`einvoice-lookup:${TENANT}`, { limit: 60, windowSec: 60, failurePolicy: "deny" });
    expect(h.lookupTaxpayer).not.toHaveBeenCalled();
  });
});
