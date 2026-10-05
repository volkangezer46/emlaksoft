import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  GROWTH_RPC,
  decisionErrorText,
  engineReady,
  grantWelcomeSafe,
  parseQueueFilter,
  processClaims,
  readAdminQueue,
  readInvitePreview,
  readReferralSettings,
  registerClaimSafe,
  reverseClaimsForInvoiceSafe,
  staffRpc,
} from "./engine";

type Reply = { data?: unknown; error?: { code?: string; message?: string } | null };
type Fake = Pick<SupabaseClient, "rpc"> & { calls: { fn: string; args: unknown }[] };
function client(reply: Reply | ((fn: string, args: unknown) => Reply)): Fake {
  const calls: { fn: string; args: unknown }[] = [];
  return {
    calls,
    rpc: vi.fn(async (fn: string, args?: unknown) => {
      calls.push({ fn, args });
      const r = typeof reply === "function" ? reply(fn, args) : reply;
      return { data: r.data ?? null, error: r.error ?? null };
    }),
  } as unknown as Fake;
}
const thrower = () => ({ rpc: vi.fn(async () => { throw new Error("ağ"); }) }) as unknown as Pick<SupabaseClient, "rpc">;
const INV = "11111111-1111-4111-8111-111111111111";

describe("ödeme kancası: registerClaimSafe (asla fırlatmaz, ödemeyi bozmaz)", () => {
  it("geçerli sonuç çözülür; doğru RPC ve parametre", async () => {
    const c = client({ data: { ok: true, claim_id: "22222222-2222-4222-8222-222222222222", status: "held", flags: [] } });
    const r = await registerClaimSafe(c, INV);
    expect(r).toMatchObject({ ok: true, status: "held" });
    expect(c.calls[0]).toEqual({ fn: "growth_claim_register", args: { p_invoice: INV } });
  });
  it("geçersiz fatura kimliği hiç RPC çağırmaz", async () => {
    const c = client({ data: { ok: true } });
    expect(await registerClaimSafe(c, "not-a-uuid")).toBeNull();
    expect(await registerClaimSafe(c, null)).toBeNull();
    expect(c.rpc).not.toHaveBeenCalled();
  });
  it("RPC hatası, eksik fonksiyon, bozuk çıktı ve fırlatma -> null (sessiz/kayıtlı)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await registerClaimSafe(client({ error: { code: "PGRST202", message: "x" } }), INV)).toBeNull();
    expect(spy).not.toHaveBeenCalled(); // migration yok: sessiz
    expect(await registerClaimSafe(client({ error: { code: "XX000" } }), INV)).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(await registerClaimSafe(client({ data: { bogus: true } }), INV)).toBeNull();
    await expect(registerClaimSafe(thrower(), INV)).resolves.toBeNull();
    spy.mockRestore();
  });
  it("idempotent: aynı sonucu iki kez almak sorun değildir", async () => {
    const c = client({ data: { ok: true, already: true } });
    expect(await registerClaimSafe(c, INV)).toMatchObject({ already: true });
    expect(await registerClaimSafe(c, INV)).toMatchObject({ already: true });
  });
});

describe("iade kancası, hoş geldin, işleyici", () => {
  it("reverseClaimsForInvoiceSafe: hata false döner, fırlatmaz", async () => {
    const c = client({ data: { ok: true } });
    expect(await reverseClaimsForInvoiceSafe(c, INV, "invoice_refunded")).toBe(true);
    expect(c.calls[0]).toEqual({ fn: "growth_claims_reverse_for_invoice", args: { p_invoice: INV, p_reason: "invoice_refunded" } });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await reverseClaimsForInvoiceSafe(client({ error: { code: "XX000" } }), INV, "x")).toBe(false);
    expect(await reverseClaimsForInvoiceSafe(thrower(), INV, "x")).toBe(false);
    spy.mockRestore();
  });
  it("grantWelcomeSafe: yalnız gerçekten verildiğinde true (atlanan = false)", async () => {
    expect(await grantWelcomeSafe(client({ data: { ok: true, amount: 250 } }), INV)).toBe(true);
    expect(await grantWelcomeSafe(client({ data: { ok: true, skipped: "not_configured" } }), INV)).toBe(false);
    expect(await grantWelcomeSafe(client({ error: { code: "PGRST202" } }), INV)).toBe(false);
  });
  it("processClaims: şema doğrulanır, bozuk çıktı null", async () => {
    const summary = { ok: true, wallet_ready: true, registered: 1, reversed: 0, paid: 2, bonus: 1, blocked: 0, rejected: 0, clawback: 0, wallet_skipped: 0, partner_approved: 0, partner_payouts_credited: 0 };
    const c = client({ data: summary });
    expect(await processClaims(c, 50)).toEqual(summary);
    expect(c.calls[0]).toEqual({ fn: "growth_claims_process", args: { p_limit: 50 } });
    expect(await processClaims(client({ data: { ok: true } }))).toBeNull();
    expect(await processClaims(client({ error: { code: "PGRST202" } }))).toBeNull();
  });
  it("engineReady yalnız true değerinde true", async () => {
    expect(await engineReady(client({ data: true }))).toBe(true);
    expect(await engineReady(client({ data: false }))).toBe(false);
    expect(await engineReady(client({ error: { code: "42883" } }))).toBe(false);
  });
});

describe("kuyruk, ayar ve önizleme okuyucuları", () => {
  it("kuyruk süzgeci beyaz liste; satırlar çözülür, bozuk satır atlanır", async () => {
    expect(parseQueueFilter("flagged")).toBe("flagged");
    expect(parseQueueFilter("hack")).toBeNull();
    const row = {
      id: "a", status: "pending", component: "base", amount_try: "100.5", flags: ["same_tax_no"], eligible_at: null,
      created_at: "2026-01-01", note: null, reversal_reason: null, granted_at: null, clawed_back_at: null,
      referred_tenant_id: "t1", beneficiary_tenant_id: "t2", partner_id: null, referred_name: "A", beneficiary_name: "B", partner_name: null,
    };
    const c = client({ data: [row, { broken: true }] });
    const rows = await readAdminQueue(c, "pending", 10);
    expect(rows).toHaveLength(1);
    expect(rows?.[0]?.amount_try).toBe(100.5);
    expect(c.calls[0]).toEqual({ fn: "growth_admin_queue", args: { p_status: "pending", p_limit: 10 } });
  });
  it("ayar satırı okunur; yoksa null", async () => {
    const vals = {
      welcome_credit_try: "0", welcome_expires_days: 45, tier1_at: 3, tier1_bonus_months: "0.50", tier1_badge: "G", tier2_at: 10,
      tier2_bonus_months: "2.00", tier2_badge: "A", annual_cap_months: "12.00", velocity_max_per_day: 5, partner_tier1_max: 4,
      partner_tier1_pct: "20", partner_tier2_max: 14, partner_tier2_pct: "25", partner_tier3_pct: "30", partner_duration_months: 12,
      partner_min_payout_try: "1000",
    };
    const from = (data: unknown) => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data, error: null }) }) }) }) }) as unknown as Pick<SupabaseClient, "from">;
    expect((await readReferralSettings(from(vals)))?.tier1_bonus_months).toBe(0.5);
    expect(await readReferralSettings(from(null))).toBeNull();
  });
  it("davet önizlemesi: program kapalı/kod yok = null", async () => {
    expect(await readInvitePreview(client({ data: null }), "abcd2345")).toBeNull();
    expect(await readInvitePreview(client({ data: { office_name: "Yılmaz Gayrimenkul", welcome_credit_try: 100 } }), "abcd2345")).toEqual({
      office_name: "Yılmaz Gayrimenkul",
      welcome_credit_try: 100,
    });
  });
});

describe("personel RPC'leri", () => {
  it("42501 -> forbidden; bozuk çıktı; hata metinleri Türkçe", async () => {
    expect(await staffRpc(client({ error: { code: "42501" } }), GROWTH_RPC.decide, {})).toEqual({ ok: false, code: "forbidden" });
    expect(await staffRpc(client({ error: { code: "XX000" } }), GROWTH_RPC.decide, {})).toEqual({ ok: false, code: "rpc_error" });
    expect(await staffRpc(client({ data: "x" }), GROWTH_RPC.decide, {})).toEqual({ ok: false, code: "bad_result" });
    expect(await staffRpc(client({ data: { ok: true, status: "approved" } }), GROWTH_RPC.decide, {})).toEqual({ ok: true, status: "approved" });
    expect(decisionErrorText("not_tax_payer")).toMatch(/vergi mükellefi/);
    expect(decisionErrorText("cash_payout_off")).toMatch(/Nakit/);
    expect(decisionErrorText("yok")).toBe("İşlem tamamlanamadı.");
  });
});
