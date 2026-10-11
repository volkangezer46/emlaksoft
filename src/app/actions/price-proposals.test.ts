import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fiyat önerisi action sözleşmesi: danışman tarafı properties:edit kapısı (kapı reddederse RPC'ye gitmez),
 * biçim doğrulaması; malik tarafı token/uuid/karar biçimi, IP oran sınırı, RPC yükü ve kod->mesaj eşlemesi.
 */
const rpc = vi.fn();
const rate = vi.fn();
const gate = vi.fn();
const maybeSingle = vi.fn();
const estimate = vi.fn();
const comps = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc,
    from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ is: () => ({ maybeSingle }) }) }) }) }),
  }),
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: (...a: unknown[]) => rate(...a), clientIp: async () => "1.2.3.4" }));
vi.mock("@/lib/require-permission", () => ({ requirePermission: (...a: unknown[]) => gate(...a) }));
vi.mock("@/lib/activity", () => ({ logActivity: async () => ({ ok: true }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/comparables", () => ({ estimateFromComparables: (...a: unknown[]) => estimate(...a), listComparables: (...a: unknown[]) => comps(...a) }));

const TOKEN = "b".repeat(64);
const ID = "0a1b2c3d-0000-4000-8000-000000000001";
const PID = "0a1b2c3d-0000-4000-8000-000000000002";

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  for (const m of [rpc, rate, gate, maybeSingle, estimate, comps]) m.mockReset();
  rate.mockResolvedValue({ allowed: true });
  gate.mockResolvedValue({ ok: true, userId: "u1", tenantId: "t1", role: "advisor", impersonating: false });
  maybeSingle.mockResolvedValue({
    data: { list_price: 9_000_000, district_id: "d1", property_type: "Daire", transaction_type: "Satılık", features: { sqm: 120 } },
  });
  estimate.mockResolvedValue({ estimatedValue: null, lowValue: null, highValue: null, compCount: 0, wonCount: 0, activeCount: 0, confidence: "yetersiz" });
  comps.mockResolvedValue([]);
  rpc.mockResolvedValue({ data: { ok: true, code: "ok" }, error: null });
});

describe("createPriceProposal (danışman)", () => {
  it("properties:edit kapısı reddederse RPC çağrılmaz", async () => {
    gate.mockResolvedValue({ ok: false, error: "Bu işlem için yetkiniz yok." });
    const { createPriceProposal } = await import("./price-proposals");
    const r = await createPriceProposal(form({ property_id: PID, new_price: "8.000.000", reason: "Gösterim az" }));
    expect(r.ok).toBe(false);
    expect(gate).toHaveBeenCalledWith("properties", "edit");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("geçersiz kimlik / fiyat / gerekçe RPC'ye gitmeden reddedilir", async () => {
    const { createPriceProposal } = await import("./price-proposals");
    expect((await createPriceProposal(form({ property_id: "x", new_price: "1", reason: "abc" }))).ok).toBe(false);
    expect((await createPriceProposal(form({ property_id: PID, new_price: "abc", reason: "abc" }))).ok).toBe(false);
    expect((await createPriceProposal(form({ property_id: PID, new_price: "8000000", reason: "a" }))).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("emsal yoksa RPC'ye comparables null gider (öneri aralığı yok)", async () => {
    const { createPriceProposal } = await import("./price-proposals");
    const r = await createPriceProposal(form({ property_id: PID, new_price: "8.000.000", reason: "Gösterim az" }));
    expect(r.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("create_property_price_proposal", { p_property_id: PID, p_new_price: 8_000_000, p_reason: "Gösterim az", p_comparables: null });
  });

  it("emsal varsa anonim anlık görüntü gönderilir; RPC kodu Türkçe mesaja çevrilir", async () => {
    estimate.mockResolvedValue({ estimatedValue: 8_000_000, lowValue: 7_400_000, highValue: 8_600_000, compCount: 9, wonCount: 3, activeCount: 6, confidence: "orta" });
    comps.mockResolvedValue([{ source: "active_listing", property_id: "baska", title: "Gizli başlık", price: 7_900_000, sqm: 118, rooms: "3+1", happened_at: "x" }]);
    const { createPriceProposal } = await import("./price-proposals");
    await createPriceProposal(form({ property_id: PID, new_price: "8.000.000", reason: "Gösterim az" }));
    const snap = rpc.mock.calls[0]![1].p_comparables;
    expect(snap).toMatchObject({ v: 1, low: 7_400_000, high: 8_600_000 });
    expect(JSON.stringify(snap)).not.toContain("baska");
    expect(JSON.stringify(snap)).not.toContain("Gizli");

    rpc.mockResolvedValue({ data: { ok: false, code: "no_owner_portal" }, error: null });
    const r = await createPriceProposal(form({ property_id: PID, new_price: "8.000.000", reason: "Gösterim az" }));
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/portal/);
  });
});

describe("decideOwnerPriceProposal (malik portalı)", () => {
  it("geçersiz token / kimlik / karar RPC'ye gitmeden reddedilir; not boşsa 'not' reddedilir", async () => {
    const { decideOwnerPriceProposal } = await import("./owner-price-proposal");
    expect((await decideOwnerPriceProposal(form({ token: "kisa", proposal_id: ID, decision: "approved" }))).ok).toBe(false);
    expect((await decideOwnerPriceProposal(form({ token: TOKEN, proposal_id: "x", decision: "approved" }))).ok).toBe(false);
    expect((await decideOwnerPriceProposal(form({ token: TOKEN, proposal_id: ID, decision: "hack" }))).ok).toBe(false);
    expect((await decideOwnerPriceProposal(form({ token: TOKEN, proposal_id: ID, decision: "note", note: " " }))).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("IP oran sınırı aşılırsa RPC çağrılmaz", async () => {
    rate.mockResolvedValue({ allowed: false });
    const { decideOwnerPriceProposal } = await import("./owner-price-proposal");
    expect((await decideOwnerPriceProposal(form({ token: TOKEN, proposal_id: ID, decision: "rejected" }))).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("RPC yükü token + öneri + karar + not; başarıda Türkçe sonuç; süresi dolmuşta hata mesajı", async () => {
    const { decideOwnerPriceProposal } = await import("./owner-price-proposal");
    const ok = await decideOwnerPriceProposal(form({ token: TOKEN, proposal_id: ID, decision: "approved", note: "Olur" }));
    expect(ok.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("decide_property_price_proposal_by_token", { p_token: TOKEN, p_proposal_id: ID, p_decision: "approved", p_note: "Olur" });
    rpc.mockResolvedValue({ data: { ok: false, code: "expired" }, error: null });
    const exp = await decideOwnerPriceProposal(form({ token: TOKEN, proposal_id: ID, decision: "approved" }));
    expect(exp).toMatchObject({ ok: false });
    expect(exp.message).toMatch(/süresi dolmuş/);
  });
});
