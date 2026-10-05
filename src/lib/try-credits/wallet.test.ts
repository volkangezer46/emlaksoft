import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TRY_RPC } from "./config";
import {
  isMissingRpc,
  tryBalance,
  tryCommit,
  tryCreditReady,
  tryGrant,
  tryInvoiceHold,
  tryRefundIdem,
  tryRefundInvoice,
  tryReleaseDead,
  tryReleaseInvoice,
  tryReserve,
  tryReserveIdem,
  tryReverse,
} from "./wallet";

const T = "11111111-1111-4111-8111-111111111111";
const I = "22222222-2222-4222-8222-222222222222";
const R = "33333333-3333-4333-8333-333333333333";

function client(impl: (fn: string, args?: Record<string, unknown>) => unknown) {
  const rpc = vi.fn(async (fn: string, args?: Record<string, unknown>) => impl(fn, args));
  return { c: { rpc } as unknown as Pick<SupabaseClient, "rpc">, rpc };
}

const balance = {
  available: 100,
  balance: 100,
  reserved: 0,
  debt: 0,
  granted_total: 100,
  spent_total: 0,
  next_expiry_at: null,
  expiring_amount: 0,
  expiring_buckets: [],
};

describe("try-credits wallet sarmalayıcıları (FAIL-CLOSED)", () => {
  it("hazırlık: yalnız data===true; hata/istisna = false", async () => {
    expect(await tryCreditReady(client(() => ({ data: true, error: null })).c)).toBe(true);
    expect(await tryCreditReady(client(() => ({ data: false, error: null })).c)).toBe(false);
    expect(await tryCreditReady(client(() => ({ data: true, error: { code: "x" } })).c)).toBe(false);
    expect(await tryCreditReady(client(() => { throw new Error("net"); }).c)).toBe(false);
  });

  it("bakiye: şemayı doğrular; bozuk/eksik veri = null", async () => {
    const { c, rpc } = client(() => ({ data: balance, error: null }));
    expect(await tryBalance(c, T)).toEqual(balance);
    expect(rpc).toHaveBeenCalledWith(TRY_RPC.balance, { p_tenant: T });
    expect(await tryBalance(client(() => ({ data: { available: "x" }, error: null })).c, T)).toBeNull();
    expect(await tryBalance(client(() => ({ data: null, error: { code: "42501" } })).c, T)).toBeNull();
  });

  it("grant: bozuk idem/tutar RPC'ye HİÇ gitmez; parametreler SQL sırasıyla", async () => {
    const { c, rpc } = client(() => ({ data: { ok: true, already: false, available: 5, balance: 5 }, error: null }));
    expect(await tryGrant(c, { tenantId: T, amountTry: 5, kind: "referral", idem: "kısa", expiresAt: null })).toBeNull();
    expect(await tryGrant(c, { tenantId: T, amountTry: 0, kind: "referral", idem: "referral-0001" })).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
    const ok = await tryGrant(c, {
      tenantId: T,
      amountTry: 5,
      kind: "campaign",
      idem: "campaign-0001",
      expiresAt: "2030-01-01T00:00:00Z",
      meta: { campaign: "x" },
    });
    expect(ok).toEqual({ ok: true, already: false, available: 5, balance: 5 });
    expect(rpc).toHaveBeenCalledWith(TRY_RPC.grant, {
      p_tenant: T,
      p_amount: 5,
      p_kind: "campaign",
      p_idem: "campaign-0001",
      p_expires_at: "2030-01-01T00:00:00Z",
      p_meta: { campaign: "x" },
    });
  });

  it("rezerv: sonuç birleşimi (ok / insufficient / over_cap / duplicate) ayrıştırılır; hata = null", async () => {
    const okRes = { ok: true, code: "ok", reservation_id: R, state: "reserved", amount: 50, available: 50 };
    const input = { tenantId: T, userId: null, amountTry: 50, idem: tryReserveIdem(I), invoiceId: I, maxShare: 0.5 };
    expect(await tryReserve(client(() => ({ data: okRes, error: null })).c, input)).toEqual(okRes);
    const ins = { ok: false, code: "insufficient", available: 10 };
    expect(await tryReserve(client(() => ({ data: ins, error: null })).c, input)).toEqual(ins);
    const cap = { ok: false, code: "over_cap", max_amount: 40 };
    expect(await tryReserve(client(() => ({ data: cap, error: null })).c, input)).toEqual(cap);
    expect(await tryReserve(client(() => ({ data: okRes, error: { code: "22023" } })).c, input)).toBeNull();
    expect(await tryReserve(client(() => ({ data: { ok: true, code: "weird" }, error: null })).c, input)).toBeNull();
    const { c, rpc } = client(() => ({ data: okRes, error: null }));
    await tryReserve(c, input);
    expect(rpc).toHaveBeenCalledWith(TRY_RPC.reserve, {
      p_tenant: T,
      p_user: null,
      p_amount: 50,
      p_idem: `inv-${I}`,
      p_invoice: I,
      p_max_share: 0.5,
    });
  });

  it("commit ve invoice release sonuç şeması", async () => {
    const settle = { ok: true, state: "committed", already: false };
    expect(await tryCommit(client(() => ({ data: settle, error: null })).c, T, R, { invoiceId: I })).toEqual(settle);
    expect(await tryReleaseInvoice(client(() => ({ data: { ok: true, state: "released", already: false }, error: null })).c, T, I, "x")).toMatchObject({
      state: "released",
    });
    expect(await tryCommit(client(() => ({ data: { ok: true, state: "bogus", already: false }, error: null })).c, T, R)).toBeNull();
  });

  it("clawback: gerekçe ve idem zorunlu; sonuç birleşimi", async () => {
    const good = { ok: true, already: false, balance: -150, available: 0, debt: 150 };
    const { c, rpc } = client(() => ({ data: good, error: null }));
    expect(await tryReverse(c, { tenantId: T, amountTry: 250, reason: " ", idem: "claw-00001" })).toBeNull();
    expect(await tryReverse(c, { tenantId: T, amountTry: 250, reason: "kötüye kullanım", idem: "x" })).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
    expect(await tryReverse(c, { tenantId: T, amountTry: 250, reason: "kötüye kullanım", idem: "claw-00001", originalIdem: "referral-0001" })).toEqual(good);
    expect(rpc).toHaveBeenCalledWith(TRY_RPC.reverse, {
      p_tenant: T,
      p_amount: 250,
      p_reason: "kötüye kullanım",
      p_idem: "claw-00001",
      p_original_idem: "referral-0001",
      p_meta: null,
    });
  });

  it("fatura rezerv yoklaması: RPC yok = kredi yok (eski şema); bilinmeyen hata = null (fail-closed)", async () => {
    expect(isMissingRpc({ code: "PGRST202" })).toBe(true);
    expect(isMissingRpc({ code: "42883" })).toBe(true);
    expect(isMissingRpc({ message: "Could not find the function public.try_credit_invoice_hold" })).toBe(true);
    expect(isMissingRpc({ code: "500" })).toBe(false);
    expect(await tryInvoiceHold(client(() => ({ data: null, error: { code: "PGRST202" } })).c, T, "es-1")).toEqual({ has_hold: false });
    expect(await tryInvoiceHold(client(() => ({ data: null, error: { code: "57014" } })).c, T, "es-1")).toBeNull();
    expect(await tryInvoiceHold(client(() => { throw new Error("net"); }).c, T, "es-1")).toBeNull();
    const hold = { has_hold: true, reservation_id: R, invoice_id: I, state: "reserved", amount: 100, total_try: 200, cash_try: 100 };
    expect(await tryInvoiceHold(client(() => ({ data: hold, error: null })).c, T, "es-1")).toEqual(hold);
    expect(await tryInvoiceHold(client(() => ({ data: { has_hold: false }, error: null })).c, T, "es-1")).toEqual({ has_hold: false });
  });

  it("release_dead sayı döner; iade sonucu ve idem anahtarları", async () => {
    expect(await tryReleaseDead(client(() => ({ data: 3, error: null })).c)).toBe(3);
    expect(await tryReleaseDead(client(() => ({ data: "3", error: null })).c)).toBeNull();
    expect(await tryReleaseDead(client(() => ({ data: null, error: { code: "PGRST202" } })).c)).toBeNull();
    const refund = { ok: true, already: false, restored: 30, remaining: 70, available: 30, balance: 30 };
    const { c, rpc } = client(() => ({ data: refund, error: null }));
    expect(await tryRefundInvoice(c, { tenantId: T, invoiceId: I, amountTry: 30, idem: tryRefundIdem(I, "admin"), reason: "iade" })).toEqual(refund);
    expect(rpc).toHaveBeenCalledWith(TRY_RPC.refundInvoice, {
      p_tenant: T,
      p_invoice: I,
      p_amount: 30,
      p_idem: `refund-${I}-admin`,
      p_reason: "iade",
    });
    expect(tryReserveIdem(I)).toMatch(/^[A-Za-z0-9_.:-]{8,128}$/);
    expect(tryRefundIdem(I, 1)).toMatch(/^[A-Za-z0-9_.:-]{8,128}$/);
    expect(await tryRefundInvoice(c, { tenantId: T, invoiceId: I, amountTry: null, idem: "x", reason: "r" })).toBeNull();
  });
});
