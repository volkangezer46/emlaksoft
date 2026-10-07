"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { now } from "@/lib/clock";
import { actionErrorMessage } from "@/lib/action-errors";

export type CancelResult = { ok?: boolean; error?: string; message?: string };

const CANCEL_ROLES = ["owner", "gm"];
const MISSING_COLUMN = /cancel_at_period_end|cancel_requested_at|cancel_reason|column .* does not exist|schema cache/i;

async function gate() {
  const g = await requirePermission("billing", "edit");
  if (!g.ok) return { error: g.error } as const;
  if (g.impersonating) return { error: "Destek oturumunda abonelik değiştirilemez." } as const;
  if (!CANCEL_ROLES.includes(g.role)) {
    return { error: "Aboneliği yalnız ofis sahibi veya genel müdür iptal edebilir." } as const;
  }
  return { g } as const;
}

/**
 * Aboneliği dönem sonunda iptal ister: erişim dönem sonuna kadar sürer, yenileme yapılmaz.
 * Şema (cancel_at_period_end) henüz uygulanmadıysa açık hata verir; veri değişmez.
 */
export async function requestSubscriptionCancel(
  _prev: CancelResult,
  formData: FormData,
): Promise<CancelResult> {
  const ctx = await gate();
  if ("error" in ctx) return { error: ctx.error };
  const { g } = ctx;

  const reason = String(formData.get("reason") ?? "").trim().slice(0, 500);
  const admin = createAdminClient();
  const { data: sub, error: readError } = await admin
    .from("subscriptions")
    .select("id, status, current_period_end, trial_ends_at")
    .eq("tenant_id", g.tenantId)
    .maybeSingle();
  if (readError || !sub) return { error: "Abonelik kaydı bulunamadı." };
  if (sub.status === "cancelled") return { error: "Abonelik zaten iptal edilmiş." };

  const { error } = await admin
    .from("subscriptions")
    .update({
      cancel_at_period_end: true,
      cancel_requested_at: new Date(now()).toISOString(),
      cancel_reason: reason || null,
    })
    .eq("id", sub.id)
    .eq("tenant_id", g.tenantId);
  if (error) {
    console.error("requestSubscriptionCancel", error.message);
    return {
      error: MISSING_COLUMN.test(error.message)
        ? "İptal talebi bu ortamda henüz etkin değil. Lütfen destek ile iletişime geçin."
        : actionErrorMessage(null, "İptal talebi kaydedilemedi."),
    };
  }

  await logActivity({
    tenantId: g.tenantId,
    actorId: g.userId,
    action: "billing.cancel_requested",
    entityType: "subscription",
    entityId: sub.id,
    newValue: { reason: reason || null, effective_at: sub.current_period_end ?? sub.trial_ends_at ?? null },
  });
  revalidatePath("/app/abonelik");
  return { ok: true, message: "İptal talebiniz alındı. Dönem sonuna kadar kullanmaya devam edebilirsiniz." };
}

/** Dönem sonu iptal talebini geri alır (dönem bitmeden). */
export async function undoSubscriptionCancel(
  _prev: CancelResult,
  _formData: FormData,
): Promise<CancelResult> {
  void _formData;
  const ctx = await gate();
  if ("error" in ctx) return { error: ctx.error };
  const { g } = ctx;

  const admin = createAdminClient();
  const { data: sub } = await admin
    .from("subscriptions")
    .select("id, status")
    .eq("tenant_id", g.tenantId)
    .maybeSingle();
  if (!sub) return { error: "Abonelik kaydı bulunamadı." };
  if (sub.status === "cancelled") return { error: "Abonelik iptal edilmiş; yeni paket seçerek yeniden başlatın." };

  const { error } = await admin
    .from("subscriptions")
    .update({ cancel_at_period_end: false, cancel_requested_at: null, cancel_reason: null })
    .eq("id", sub.id)
    .eq("tenant_id", g.tenantId);
  if (error) {
    console.error("undoSubscriptionCancel", error.message);
    return { error: actionErrorMessage(error, "İptal talebi geri alınamadı.") };
  }
  await logActivity({
    tenantId: g.tenantId,
    actorId: g.userId,
    action: "billing.cancel_undone",
    entityType: "subscription",
    entityId: sub.id,
  });
  revalidatePath("/app/abonelik");
  return { ok: true, message: "İptal talebi geri alındı; aboneliğiniz yenilenmeye devam edecek." };
}
