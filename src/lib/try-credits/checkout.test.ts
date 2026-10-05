import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { applyWalletCreditToInvoice, expectedProviderAmountTry } from "./checkout";

const T = "11111111-1111-4111-8111-111111111111";
const I = "22222222-2222-4222-8222-222222222222";
const R = "33333333-3333-4333-8333-333333333333";

type Handlers = Partial<Record<string, (args?: Record<string, unknown>) => unknown>>;

function client(handlers: Handlers) {
  const rpc = vi.fn(async (fn: string, args?: Record<string, unknown>) => {
    const h = handlers[fn];
    if (!h) throw new Error(`Unexpected RPC ${fn}`);
    return h(args);
  });
  return { c: { rpc } as unknown as Pick<SupabaseClient, "rpc">, rpc };
}

const bal = (available: number) => ({
  data: {
    available,
    balance: available,
    reserved: 0,
    debt: 0,
    granted_total: available,
    spent_total: 0,
    next_expiry_at: null,
    expiring_amount: 0,
    expiring_buckets: [],
  },
  error: null,
});
const request = { userId: "44444444-4444-4444-8444-444444444444", maxShare: 0.5 };

describe("applyWalletCreditToInvoice", () => {
  it("hazır değilse HİÇBİR rezerv açılmaz", async () => {
    const { c, rpc } = client({ try_credit_ready: () => ({ data: false, error: null }) });
    const r = await applyWalletCreditToInvoice(c, { tenantId: T, invoiceId: I, totalTry: 1000, request });
    expect(r.ok).toBe(false);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("bakiye yok: sessizce nakit çekilmez, hata döner", async () => {
    const { c, rpc } = client({
      try_credit_ready: () => ({ data: true, error: null }),
      try_credit_balance: () => bal(0),
    });
    const r = await applyWalletCreditToInvoice(c, { tenantId: T, invoiceId: I, totalTry: 1000, request });
    expect(r).toEqual({ ok: false, error: "Kullanılabilir hesap krediniz yok." });
    expect(rpc).not.toHaveBeenCalledWith("try_credit_reserve", expect.anything());
  });

  it("kısmi kredi: rezerv tutarı = min(bakiye, %50); nakit = kalan", async () => {
    const { c, rpc } = client({
      try_credit_ready: () => ({ data: true, error: null }),
      try_credit_balance: () => bal(5000),
      try_credit_reserve: () => ({
        data: { ok: true, code: "ok", reservation_id: R, state: "reserved", amount: 500, available: 4500 },
        error: null,
      }),
    });
    const r = await applyWalletCreditToInvoice(c, { tenantId: T, invoiceId: I, totalTry: 1000, request });
    expect(r).toEqual({ ok: true, applied: { reservationId: R, creditTry: 500, cashTry: 500, fullCredit: false } });
    expect(rpc).toHaveBeenCalledWith("try_credit_reserve", {
      p_tenant: T,
      p_user: request.userId,
      p_amount: 500,
      p_idem: `inv-${I}`,
      p_invoice: I,
      p_max_share: 0.5,
    });
  });

  it("yarış: bakiye okunduktan sonra başka harcama olduysa (insufficient) hata, kısmi tahsilat YOK", async () => {
    const { c } = client({
      try_credit_ready: () => ({ data: true, error: null }),
      try_credit_balance: () => bal(5000),
      try_credit_reserve: () => ({ data: { ok: false, code: "insufficient", available: 0 }, error: null }),
    });
    const r = await applyWalletCreditToInvoice(c, { tenantId: T, invoiceId: I, totalTry: 1000, request });
    expect(r.ok).toBe(false);
  });

  it("over_cap / fatura uygun değil / RPC hatası: hata", async () => {
    for (const reserve of [
      { data: { ok: false, code: "over_cap", max_amount: 1 }, error: null },
      { data: { ok: false, code: "invoice_not_payable" }, error: null },
      { data: { ok: false, code: "invoice_already_reserved", reservation_id: R, state: "reserved" }, error: null },
      { data: null, error: { code: "57014" } },
    ]) {
      const { c } = client({
        try_credit_ready: () => ({ data: true, error: null }),
        try_credit_balance: () => bal(5000),
        try_credit_reserve: () => reserve,
      });
      const r = await applyWalletCreditToInvoice(c, { tenantId: T, invoiceId: I, totalTry: 1000, request });
      expect(r.ok).toBe(false);
    }
  });

  it("tam kredi (pay=1): fullCredit işaretlenir", async () => {
    const { c } = client({
      try_credit_ready: () => ({ data: true, error: null }),
      try_credit_balance: () => bal(2000),
      try_credit_reserve: () => ({
        data: { ok: true, code: "ok", reservation_id: R, state: "reserved", amount: 1000, available: 1000 },
        error: null,
      }),
    });
    const r = await applyWalletCreditToInvoice(c, { tenantId: T, invoiceId: I, totalTry: 1000, request: { ...request, maxShare: 1 } });
    expect(r).toMatchObject({ ok: true, applied: { creditTry: 1000, cashTry: 0, fullCredit: true } });
  });

  it("tekrar çağrı (duplicate) zaten kesinleşmiş rezervi 'uygulanmış' saymaz", async () => {
    const { c } = client({
      try_credit_ready: () => ({ data: true, error: null }),
      try_credit_balance: () => bal(5000),
      try_credit_reserve: () => ({
        data: { ok: true, code: "duplicate", reservation_id: R, state: "committed", amount: 500, available: 4500 },
        error: null,
      }),
    });
    const r = await applyWalletCreditToInvoice(c, { tenantId: T, invoiceId: I, totalTry: 1000, request });
    expect(r.ok).toBe(false);
  });
});

describe("expectedProviderAmountTry (callback/webhook beklenen nakit)", () => {
  it("rezerv yok: fatura toplamı", () => {
    expect(expectedProviderAmountTry(2988, { has_hold: false })).toBe(2988);
  });
  it("rezerv var (her durumda): toplam - kredi, kuruş hassasiyetinde", () => {
    const hold = (state: "reserved" | "committed" | "released") => ({
      has_hold: true as const,
      reservation_id: R,
      invoice_id: I,
      state,
      amount: 1494,
      total_try: 2988,
      cash_try: 1494,
    });
    expect(expectedProviderAmountTry(2988, hold("reserved"))).toBe(1494);
    expect(expectedProviderAmountTry(2988, hold("committed"))).toBe(1494);
    expect(expectedProviderAmountTry(2988, hold("released"))).toBe(1494);
    expect(expectedProviderAmountTry(69004.8, { ...hold("reserved"), amount: 34502.4 })).toBe(34502.4);
  });
});
