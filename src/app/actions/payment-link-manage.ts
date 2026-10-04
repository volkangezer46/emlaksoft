"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { getBaseUrl } from "@/lib/base-url";
import { normalizeExtendDays, paymentLinkCancelDecision } from "@/lib/workflow-rules";

export type PaymentLinkManageResult = { error?: string; ok?: boolean };

export type PaymentLinkRow = {
  id: string;
  title: string;
  amount: number;
  status: "open" | "paid" | "cancelled" | "expired";
  expiresAt: string | null;
  createdAt: string;
  url: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Bir komisyona bağlı ödeme linkleri (ofis içi; token yalnız yetkili kullanıcıya döner). */
export async function listCommissionPaymentLinks(
  commissionId: string,
): Promise<{ error?: string; links?: PaymentLinkRow[] }> {
  const gate = await requirePermission("commissions", "view");
  if (!gate.ok) return { error: gate.error };
  if (!UUID.test(commissionId)) return { error: "Komisyon seçimi geçersiz." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("payment_links")
    .select("id, token, title, amount_try, status, expires_at, created_at")
    .eq("tenant_id", gate.tenantId)
    .eq("commission_id", commissionId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) {
    console.error("listCommissionPaymentLinks", error);
    return { error: "Ödeme linkleri okunamadı." };
  }
  const base = getBaseUrl();
  return {
    links: (data ?? []).map((l) => ({
      id: l.id as string,
      title: l.title as string,
      amount: Number(l.amount_try),
      status: l.status as PaymentLinkRow["status"],
      expiresAt: (l.expires_at as string | null) ?? null,
      createdAt: l.created_at as string,
      url: `${base}/odeme-link/${l.token as string}`,
    })),
  };
}

/**
 * Açık ödeme linkini iptal eder (P0-4). Yalnız `open` link iptal edilir; ödeme yakalanmış
 * (billing_payment_captures) link iptal edilemez. İptal sonrası link "kazanmayı geri al"ı kilitlemez.
 * Tekrarlanan tıklama güvenli: zaten iptal edilmişse sessizce başarı döner.
 */
export async function cancelPaymentLink(linkId: string): Promise<PaymentLinkManageResult> {
  const gate = await requirePermission("commissions", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!UUID.test(linkId)) return { error: "Link seçimi geçersiz." };

  const admin = createAdminClient();
  const { data: link } = await admin
    .from("payment_links")
    .select("id, status, title, amount_try")
    .eq("id", linkId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  if (!link) return { error: "Ödeme linki bulunamadı." };
  const pre = paymentLinkCancelDecision(String(link.status), false);
  if (pre === "already_cancelled") return { ok: true };
  if (pre === "not_open") return { error: "Yalnız açık ödeme linki iptal edilebilir." };

  const { data: capture } = await admin
    .from("billing_payment_captures")
    .select("id")
    .eq("payment_link_id", linkId)
    .limit(1)
    .maybeSingle();
  if (paymentLinkCancelDecision(String(link.status), Boolean(capture)) === "captured") {
    return { error: "Bu link için ödeme alınmış; iptal edilemez." };
  }

  const { data: updated, error } = await admin
    .from("payment_links")
    .update({ status: "cancelled" })
    .eq("id", linkId)
    .eq("tenant_id", gate.tenantId)
    .eq("status", "open")
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("cancelPaymentLink", error);
    return { error: "Ödeme linki iptal edilemedi." };
  }
  if (!updated) return { error: "Link durumu bu sırada değişti; yenileyin." };

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "payment_link.cancel",
    entityType: "payment_link",
    entityId: linkId,
    newValue: { title: link.title, amount: Number(link.amount_try) },
  });
  revalidatePath("/app/komisyon");
  revalidatePath("/app/anlasmalar");
  return { ok: true };
}

/** Açık linkin süresini bugünden itibaren 1-30 gün uzatır. */
export async function extendPaymentLink(linkId: string, days: number): Promise<PaymentLinkManageResult> {
  const gate = await requirePermission("commissions", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!UUID.test(linkId)) return { error: "Link seçimi geçersiz." };
  const d = normalizeExtendDays(days);
  if (d == null) return { error: "Süre 1-30 gün arasında olmalı." };

  const admin = createAdminClient();
  const { data: updated, error } = await admin
    .from("payment_links")
    .update({ expires_at: new Date(Date.now() + d * 86_400_000).toISOString() })
    .eq("id", linkId)
    .eq("tenant_id", gate.tenantId)
    .eq("status", "open")
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("extendPaymentLink", error);
    return { error: "Süre uzatılamadı." };
  }
  if (!updated) return { error: "Yalnız açık link uzatılabilir." };

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "payment_link.extend",
    entityType: "payment_link",
    entityId: linkId,
    newValue: { days: d },
  });
  revalidatePath("/app/komisyon");
  return { ok: true };
}
