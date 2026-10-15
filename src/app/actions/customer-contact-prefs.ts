"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { actionErrorMessage } from "@/lib/action-errors";
import { isMissingContactPrefsColumn, sanitizeContactPrefs, type ContactPrefs } from "@/lib/customer-contact-prefs";

export type ContactPrefsResult = { ok: true; prefs: ContactPrefs } | { ok: false; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Müşteri iletişim tercihi (CRM-G11): kanal, uygun zaman dilimleri, dil. `customers:edit` kapısı + tenant filtresi;
 * tanınmayan değerler sessizce atılır (sanitizeContactPrefs). Sütunlar yoksa (migration bekliyor) açık hata döner.
 */
export async function updateCustomerContactPrefs(
  customerId: string,
  input: { channel?: unknown; windows?: unknown; language?: unknown },
): Promise<ContactPrefsResult> {
  const gate = await requirePermission("customers", "edit");
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!UUID_RE.test(String(customerId ?? ""))) return { ok: false, error: "Müşteri bulunamadı." };
  const prefs = sanitizeContactPrefs(input ?? {});

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customers")
    .update({ preferred_channel: prefs.channel, contact_window: prefs.windows, preferred_language: prefs.language })
    .eq("id", customerId)
    .eq("tenant_id", gate.tenantId)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();
  if (error) {
    if (isMissingContactPrefsColumn(error)) {
      return { ok: false, error: "İletişim tercihi için veritabanı güncellemesi henüz uygulanmamış." };
    }
    console.error("updateCustomerContactPrefs", { code: error.code });
    return { ok: false, error: actionErrorMessage(error, "Tercih kaydedilemedi.") };
  }
  if (!data) return { ok: false, error: "Müşteri bulunamadı." };

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "customer.contact_prefs",
    entityType: "customer",
    entityId: customerId,
    newValue: { channel: prefs.channel, windows: prefs.windows, language: prefs.language },
  });
  revalidatePath(`/app/musteriler/${customerId}`);
  return { ok: true, prefs };
}
