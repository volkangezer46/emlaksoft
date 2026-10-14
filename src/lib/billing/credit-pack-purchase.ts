import { randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { IYZICO_CURRENCY } from "@/lib/billing/iyzico";
import { invoiceAmountsTry, resolveAutoInvoiceVatRate, writeAutoInvoiceLine } from "@/lib/billing/fulfillment";
import { buildCreditPackMeta } from "@/lib/billing/credit-pack-purchase-core";
import { now } from "@/lib/clock";
import { ActionUserError } from "@/lib/action-errors";
import type { EfPack } from "@/lib/ef-credits/config";
import { applyWalletCreditToInvoice, type AppliedWalletCredit, type WalletCreditRequest } from "@/lib/try-credits/checkout";

/**
 * ANALİZ PAKETİ SATIN ALMA: SUNUCU KATMANI.
 * Para tahsil eden yol yalnız `ef_credit_ready()` true iken açılır (kapı action'dadır): cüzdan SQL'i
 * (ef_credit_grant + fulfill'in `meta.kind='credit_pack'` dalı) yokken tahsilat yapılıp analiz bakiyesi verilememesi mümkün olmaz.
 *
 * Fatura meta sözleşmesi (fulfill SQL'inin okuyacağı): { kind: 'credit_pack', packId, units, priceNetTry }
 * + izleme alanı conversationId. Fulfill, units/priceNetTry'yi fatura net tutarıyla doğrular; analiz bakiyesi
 * `ef_credit_grant(kind 'purchase', idem 'invoice:<fatura id>')` ile eklenir.
 */

/** Analiz paketi faturası taslağı; tutar/analiz bakiyesi SUNUCU kataloğundan gelen pakettir (istemciden değil). */
export async function createCreditPackInvoice(input: {
  tenantId: string;
  pack: Pick<EfPack, "id" | "units" | "months" | "priceNetTry">;
  conversationId: string;
  /** "Hesap kredimi kullan": rezerv fatura taslağından hemen sonra, iyzico açılmadan ÖNCE yapılır. */
  walletCredit?: WalletCreditRequest | null;
  /** Onay ekranındaki tutarın hesaplandığı KDV oranı (kesim anındaki ayar); yoksa burada okunur. */
  vatRate?: number | null;
}): Promise<{ invoiceId: string; totalTry: number; credit?: AppliedWalletCredit | null }> {
  const admin = createAdminClient();
  const vatRate = await resolveAutoInvoiceVatRate(admin, input.vatRate);
  const amounts = invoiceAmountsTry(input.pack.priceNetTry, vatRate);
  const meta = { ...buildCreditPackMeta(input.pack), conversationId: input.conversationId, source: "checkout", vatRate };
  const expiresAt = new Date(now() + 2 * 60 * 60 * 1000);
  const { data, error } = await admin
    .from("invoices")
    .insert({
      tenant_id: input.tenantId,
      subscription_id: null,
      invoice_no: `ES-KONTOR-${input.tenantId.replace(/-/g, "").slice(0, 6).toUpperCase()}-${randomBytes(5).toString("hex").toUpperCase()}`,
      status: "draft",
      checkout_status: "pending_checkout",
      checkout_expires_at: expiresAt.toISOString(),
      amount_try: amounts.amountTry,
      tax_try: amounts.taxTry,
      total_try: amounts.totalTry,
      currency: IYZICO_CURRENCY,
      period_start: null,
      period_end: null,
      due_at: null,
      meta,
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error("createCreditPackInvoice", error);
    throw new Error("Analiz paketi faturası oluşturulamadı.");
  }
  const invoiceId = data.id as string;
  await writeAutoInvoiceLine(admin, { invoiceId, tenantId: input.tenantId, meta, amounts, vatRate });
  if (!input.walletCredit) return { invoiceId, totalTry: amounts.totalTry, credit: null };
  const applied = await applyWalletCreditToInvoice(admin, {
    tenantId: input.tenantId,
    invoiceId,
    totalTry: amounts.totalTry,
    request: input.walletCredit,
  });
  if (!applied.ok) {
    await admin
      .from("invoices")
      .update({ checkout_status: "initialization_failed" })
      .eq("id", invoiceId)
      .eq("tenant_id", input.tenantId)
      .eq("status", "draft");
    throw new ActionUserError(applied.error);
  }
  return { invoiceId, totalTry: amounts.totalTry, credit: applied.applied };
}
