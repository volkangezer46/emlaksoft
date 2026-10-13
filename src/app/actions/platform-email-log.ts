"use server";

import { revalidatePath } from "next/cache";
import { guardPlatformAction } from "@/lib/platform-guards";
import { logPlatformActivity } from "@/lib/platform-activity";
import { createAdminClient } from "@/lib/supabase/admin";
import { isValidEmail } from "@/lib/email";
import { emailHash, maskEmail } from "@/lib/email/send";

/**
 * E-posta bastırma listesi eylemleri (yalnız süper admin, `sistem` modülü). Adres DÜZ SAKLANMAZ: özet + maskeli
 * gösterim. Elle ekleme: adrese hiçbir e-posta gitmez (ör. KVKK itirazı). Kaldırma: bounce düzeldiyse adres yeniden
 * gönderim alabilir. Her işlem platform denetim izine yazılır (maskeli adresle).
 */

function gate() {
  return guardPlatformAction({
    module: "sistem",
    roles: ["super_admin"],
    rate: { key: "platform-email-suppression", limit: 20, windowSec: 60 },
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE = "/admin/ayarlar/eposta";

export type SuppressionActionResult = { ok?: boolean; error?: string };

export async function addEmailSuppressionAction(formData: FormData): Promise<SuppressionActionResult> {
  const g = await gate();
  if ("error" in g) return { error: g.error };
  const address = String(formData.get("email") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim().slice(0, 300);
  if (!isValidEmail(address)) return { error: "Geçerli bir e-posta adresi girin." };
  if (note.length < 3) return { error: "Kısa bir gerekçe yazın (en az 3 karakter)." };
  const admin = createAdminClient();
  const masked = maskEmail(address);
  const { error } = await admin
    .from("email_suppressions")
    .upsert(
      { email_hash: emailHash(address), email_masked: masked, reason: "manual", detail: note, created_by: g.staff.id },
      { onConflict: "email_hash", ignoreDuplicates: true },
    );
  if (error) return { error: error.code === "42P01" || error.code === "PGRST205" ? "Bastırma tablosu henüz kurulmadı (migration bekliyor)." : "Kaydedilemedi." };
  await logPlatformActivity({ actorId: g.staff.id, action: "integration.email.suppression_add", entityType: "integration", meta: { email: masked } });
  revalidatePath(PAGE);
  return { ok: true };
}

export async function removeEmailSuppressionAction(id: string): Promise<SuppressionActionResult> {
  const g = await gate();
  if ("error" in g) return { error: g.error };
  if (!UUID_RE.test(id)) return { error: "Geçersiz kayıt." };
  const admin = createAdminClient();
  const { data, error } = await admin.from("email_suppressions").delete().eq("id", id).select("email_masked, reason");
  if (error) return { error: "Kaldırılamadı." };
  const row = (data ?? [])[0] as { email_masked: string; reason: string } | undefined;
  if (!row) return { error: "Kayıt bulunamadı." };
  await logPlatformActivity({
    actorId: g.staff.id,
    action: "integration.email.suppression_remove",
    entityType: "integration",
    meta: { email: row.email_masked, reason: row.reason },
  });
  revalidatePath(PAGE);
  return { ok: true };
}
