"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformModule } from "@/lib/platform";
import { logPlatformActivity } from "@/lib/platform-activity";
import { checkRateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseMoneyTry, validateRefundAmount, MANUAL_PAYMENT_METHODS, type ManualPaymentMethod } from "@/lib/billing/invoice-ops";

export type BillingOpResult = { ok?: boolean; error?: string; notice?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function guard(action: string, destructive: boolean) {
  const staff = await requirePlatformModule("billing");
  if (destructive && staff.role !== "super_admin") {
    return { error: "Bu işlem yalnız süper admin tarafından yapılabilir." } as const;
  }
  const rl = await checkRateLimit(`billing-op:${action}:${staff.id}`, { limit: 30, windowSec: 600, failurePolicy: "deny" });
  if (!rl.allowed) return { error: "Çok sık işlem yaptınız; birkaç dakika sonra tekrar deneyin." } as const;
  return { staff } as const;
}

function refresh(invoiceId?: string) {
  revalidatePath("/admin/billing");
  if (invoiceId) revalidatePath(`/admin/billing/faturalar/${invoiceId}`);
}

/**
 * Havale/EFT/nakit ile alınan ödemeyi faturada "ödendi" işaretler.
 * Koşullu güncelleme: yalnız ödenmemiş fatura güncellenir; çift tıklama ikinci kez ödeme kaydetmez.
 */
export async function markInvoicePaid(formData: FormData): Promise<BillingOpResult> {
  const g = await guard("mark-paid", false);
  if ("error" in g) return { error: g.error };
  const invoiceId = String(formData.get("invoice_id") ?? "");
  if (!UUID.test(invoiceId)) return { error: "Geçersiz fatura." };
  const method = String(formData.get("method") ?? "") as ManualPaymentMethod;
  if (!MANUAL_PAYMENT_METHODS.some((m) => m.value === method)) return { error: "Ödeme yöntemi seçin." };
  const reference = String(formData.get("reference") ?? "").trim().slice(0, 120);
  const paidDateRaw = String(formData.get("paid_date") ?? "").trim();
  if (paidDateRaw && !/^\d{4}-\d{2}-\d{2}$/.test(paidDateRaw)) return { error: "Geçersiz ödeme tarihi." };

  const admin = createAdminClient();
  const { data: inv } = await admin
    .from("invoices")
    .select("id, tenant_id, status, total_try, currency, checkout_status, meta")
    .eq("id", invoiceId)
    .maybeSingle();
  if (!inv) return { error: "Fatura bulunamadı." };
  if (inv.status === "paid") return { ok: true, notice: "Fatura zaten ödendi olarak işaretli." };
  if (inv.status === "void") return { error: "İptal edilmiş fatura ödendi işaretlenemez." };
  if (inv.currency !== "TRY") return { error: "Yalnız TRY faturalar elle ödendi işaretlenebilir." };
  if (inv.status === "draft" && inv.checkout_status) {
    return { error: "Ödeme oturumu bekleyen taslak fatura elle kapatılamaz; sağlayıcı tahsilatı doğrulanmalı." };
  }

  const receivedRaw = String(formData.get("received_try") ?? "").trim();
  const total = Number(inv.total_try);
  if (receivedRaw) {
    const received = parseMoneyTry(receivedRaw);
    if (received === null) return { error: "Tutar geçersiz (pozitif, en fazla 2 ondalık)." };
    if (Math.abs(received - total) > 0.01) {
      return { error: `Alınan tutar fatura tutarıyla (${total.toFixed(2)} TRY) eşleşmiyor. Kısmi ödeme desteklenmez.` };
    }
  }

  const paidAt = paidDateRaw ? new Date(`${paidDateRaw}T12:00:00+03:00`).toISOString() : new Date().toISOString();
  const { data: updated, error } = await admin
    .from("invoices")
    .update({
      status: "paid",
      paid_at: paidAt,
      meta: { ...((inv.meta ?? {}) as Record<string, unknown>), manual_payment: { method, reference: reference || null, by: g.staff.id, recorded_at: new Date().toISOString() } },
    })
    .eq("id", invoiceId)
    .in("status", ["open", "draft", "uncollectible"])
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("markInvoicePaid", error.message);
    return { error: "Fatura güncellenemedi." };
  }
  if (!updated) return { ok: true, notice: "Fatura başka bir işlemle zaten güncellenmiş." };

  await logPlatformActivity({
    actorId: g.staff.id,
    action: "billing.invoice.mark_paid",
    entityType: "invoice",
    entityId: invoiceId,
    meta: { tenantId: inv.tenant_id, method, reference: reference || null, totalTry: total },
  });
  refresh(invoiceId);
  return { ok: true };
}

/** Ödenmemiş faturayı iptal eder (void). Yıkıcı: süper admin. Ödenmiş fatura için iade kullanılır. */
export async function voidInvoice(formData: FormData): Promise<BillingOpResult> {
  const g = await guard("void", true);
  if ("error" in g) return { error: g.error };
  const invoiceId = String(formData.get("invoice_id") ?? "");
  if (!UUID.test(invoiceId)) return { error: "Geçersiz fatura." };
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 300);
  if (reason.length < 3) return { error: "İptal nedeni yazın." };

  const admin = createAdminClient();
  const { data: updated, error } = await admin
    .from("invoices")
    .update({ status: "void", meta: { voided: { reason, by: g.staff.id, at: new Date().toISOString() } } })
    .eq("id", invoiceId)
    .in("status", ["open", "draft", "uncollectible"])
    .select("id, tenant_id")
    .maybeSingle();
  if (error) {
    console.error("voidInvoice", error.message);
    return { error: "Fatura iptal edilemedi." };
  }
  if (!updated) return { error: "Fatura iptal edilemez: ödenmiş ya da zaten iptal." };
  await logPlatformActivity({
    actorId: g.staff.id,
    action: "billing.invoice.void",
    entityType: "invoice",
    entityId: invoiceId,
    meta: { tenantId: updated.tenant_id, reason },
  });
  refresh(invoiceId);
  return { ok: true };
}

/**
 * Ödenmiş faturaya iade KAYDI düşer (para hareketi sağlayıcıda/bankada elle yapılır; bu ekran para göndermez).
 * Tutar: 0 < tutar <= fatura toplamı. Koşullu güncelleme: ikinci tıklama ikinci iade yazmaz.
 */
export async function recordInvoiceRefund(formData: FormData): Promise<BillingOpResult> {
  const g = await guard("refund", true);
  if ("error" in g) return { error: g.error };
  const invoiceId = String(formData.get("invoice_id") ?? "");
  if (!UUID.test(invoiceId)) return { error: "Geçersiz fatura." };
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 300);
  if (reason.length < 3) return { error: "İade nedeni yazın." };

  const admin = createAdminClient();
  const { data: inv } = await admin
    .from("invoices")
    .select("id, tenant_id, status, total_try, currency, meta")
    .eq("id", invoiceId)
    .maybeSingle();
  if (!inv) return { error: "Fatura bulunamadı." };
  if (inv.status !== "paid") return { error: "Yalnız ödenmiş faturaya iade kaydı düşülür." };
  if (inv.currency !== "TRY") return { error: "Yalnız TRY faturalar için iade kaydı düşülür." };
  const meta = (inv.meta ?? {}) as Record<string, unknown>;
  if (meta.refund) return { ok: true, notice: "Bu faturaya iade zaten kaydedilmiş." };

  const amount = validateRefundAmount(String(formData.get("amount_try") ?? ""), Number(inv.total_try));
  if ("error" in amount) return { error: amount.error };

  const { data: updated, error } = await admin
    .from("invoices")
    .update({
      meta: { ...meta, refund: { amount_try: amount.value, reason, by: g.staff.id, at: new Date().toISOString() } },
    })
    .eq("id", invoiceId)
    .eq("status", "paid")
    .is("meta->refund", null)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("recordInvoiceRefund", error.message);
    return { error: "İade kaydı yazılamadı." };
  }
  if (!updated) return { ok: true, notice: "Bu faturaya iade zaten kaydedilmiş." };
  await logPlatformActivity({
    actorId: g.staff.id,
    action: "billing.invoice.refund_recorded",
    entityType: "invoice",
    entityId: invoiceId,
    meta: { tenantId: inv.tenant_id, amountTry: amount.value, reason },
  });
  refresh(invoiceId);
  return { ok: true };
}

const CAPTURE_ACTIONS = {
  refunded: { to: "refunded", label: "iade edildi" },
  review: { to: "manual_review", label: "manuel incelemeye alındı" },
  refund_needed: { to: "refund_required", label: "iade gerekli olarak işaretlendi" },
} as const;

/**
 * Mutabakat kuyruğu satır eylemi. Durum geçişi veritabanındaki transition RPC'sinde korunur
 * (refunded geri alınamaz; aynı durum tekrarında tutarlı) — çift tıklama çift para hareketi yaratmaz,
 * çünkü bu ekran zaten para göndermez; yalnız durum ve denetim kaydı yazar.
 */
export async function resolveCapture(formData: FormData): Promise<BillingOpResult> {
  const op = String(formData.get("op") ?? "") as keyof typeof CAPTURE_ACTIONS;
  const spec = CAPTURE_ACTIONS[op];
  if (!spec) return { error: "Geçersiz işlem." };
  const g = await guard(`capture-${op}`, op === "refunded");
  if ("error" in g) return { error: g.error };
  const captureId = String(formData.get("capture_id") ?? "");
  if (!UUID.test(captureId)) return { error: "Geçersiz kayıt." };
  const note = String(formData.get("note") ?? "").trim().slice(0, 300);
  if (op === "refunded" && note.length < 3) return { error: "İade referansını/notunu yazın." };

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("billing_payment_captures")
    .select("id, status, tenant_id, payment_id, amount_try")
    .eq("id", captureId)
    .maybeSingle();
  if (!row) return { error: "Tahsilat kaydı bulunamadı." };
  if (row.status === spec.to) return { ok: true, notice: "Kayıt zaten bu durumda." };
  if (row.status === "fulfilled" || row.status === "refunded") return { error: "Tamamlanmış kayıt değiştirilemez." };

  const { error } = await admin.rpc("transition_billing_payment_capture", {
    p_capture_id: captureId,
    p_status: spec.to,
    p_error_code: op === "refunded" ? null : "STAFF_" + op.toUpperCase(),
  });
  if (error) {
    console.error("resolveCapture", error.code, error.message);
    return { error: "Durum geçişi reddedildi (geçersiz geçiş olabilir)." };
  }
  await logPlatformActivity({
    actorId: g.staff.id,
    action: `billing.capture.${op}`,
    entityType: "billing_payment_capture",
    entityId: captureId,
    meta: { tenantId: row.tenant_id, paymentId: row.payment_id, amountTry: row.amount_try, from: row.status, to: spec.to, note: note || null },
  });
  refresh();
  return { ok: true, notice: `Kayıt ${spec.label}.` };
}
