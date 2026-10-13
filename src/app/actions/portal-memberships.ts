"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { actionErrorMessage } from "@/lib/action-errors";
import { now } from "@/lib/clock";
import { CURRENT_PORTALS, MEMBERSHIP_STATUSES } from "@/lib/portals/catalog";
import { PORTAL_MEMBERSHIP_EDITOR_ROLES } from "@/lib/portals/membership";

/**
 * Portal üyelikleri kaydı (Ayarlar > Entegrasyonlar > "Portal üyelikleri" ve Kurulum > "Vitrin ve portallar"). Yetki:
 * `settings:edit` + rol owner/gm (RLS de aynı kuralı uygular). Öneriler (`inferPortalMembership`) burada YAZILMAZ: kart onları
 * işaretli getirir, sahip/genel müdür "Onayla ve kaydet" deyince bu eylem `source = owner_declared` ile yazar.
 * Eklentinin giriş alanları (last_login_*, seri) bu eylemde değişmez.
 */

const itemSchema = z.object({
  portal: z.enum(CURRENT_PORTALS),
  status: z.enum(MEMBERSHIP_STATUSES),
  checkEnabled: z.boolean(),
  accountLabel: z.string().trim().max(120, "Mağaza / hesap adı en fazla 120 karakter olabilir.").optional().default(""),
  storeUrl: z
    .string()
    .trim()
    .max(500, "Mağaza bağlantısı en fazla 500 karakter olabilir.")
    .refine((v) => v === "" || /^https:\/\/\S+$/i.test(v), "Mağaza bağlantısı https:// ile başlamalı. Bağlantıyı portaldaki mağaza sayfanızdan kopyalayın.")
    .optional()
    .default(""),
  planEndsAt: z
    .string()
    .trim()
    .refine((v) => v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v), "Abonelik bitişi geçerli bir tarih olmalı (gün.ay.yıl).")
    .optional()
    .default(""),
});

const inputSchema = z.array(itemSchema).min(1).max(CURRENT_PORTALS.length);

export type PortalMembershipInput = z.input<typeof itemSchema>;
export type SavePortalMembershipsResult = { ok: true; saved: number } | { ok: false; error: string };

export async function savePortalMemberships(items: PortalMembershipInput[]): Promise<SavePortalMembershipsResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!PORTAL_MEMBERSHIP_EDITOR_ROLES.has(gate.role)) {
    return { ok: false, error: "Portal üyeliklerini yalnız ofis sahibi ya da genel müdür değiştirebilir. Değişiklik için onlara iletin." };
  }
  const parsed = inputSchema.safeParse(items);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Portal üyelikleri okunamadı. Sayfayı yenileyip tekrar deneyin." };
  }
  const seen = new Set<string>();
  const updatedAt = new Date(now()).toISOString();
  const rows = parsed.data
    .filter((i) => (seen.has(i.portal) ? false : (seen.add(i.portal), true)))
    .map((i) => ({
      tenant_id: gate.tenantId,
      portal: i.portal,
      status: i.status,
      // Üye olunmayan portalda otomatik kontrol anlamsızdır: kapalı yazılır (eklenti zaten istek atmaz).
      check_enabled: i.status === "none" ? false : i.checkEnabled,
      source: "owner_declared",
      account_label: i.status === "active" && i.accountLabel ? i.accountLabel : null,
      store_url: i.status === "active" && i.storeUrl ? i.storeUrl : null,
      plan_ends_at: i.status === "active" && i.planEndsAt ? i.planEndsAt : null,
      updated_by: gate.userId,
      updated_at: updatedAt,
    }));

  const supabase = await createClient();
  const { error } = await supabase.from("tenant_portal_accounts").upsert(rows, { onConflict: "tenant_id,portal" });
  if (error) {
    const missing = error.code === "42P01" || error.code === "PGRST205" || /does not exist|schema cache/i.test(error.message ?? "");
    if (missing) return { ok: false, error: "Portal üyelikleri için sistem güncellemesi bekleniyor. Güncelleme uygulanınca tekrar deneyin." };
    console.error("savePortalMemberships", { code: error.code });
    return { ok: false, error: actionErrorMessage(error, "Portal üyelikleri kaydedilemedi.") };
  }

  // Üyelik, portal ekranlarının hepsini etkiler (aktarım, eksik portal, bağlama formları, ROI).
  revalidatePath("/app/ayarlar");
  revalidatePath("/app/baslangic");
  revalidatePath("/app/ilan-kontrol", "layout");
  revalidatePath("/app/portfoyler", "layout");
  return { ok: true, saved: rows.length };
}
