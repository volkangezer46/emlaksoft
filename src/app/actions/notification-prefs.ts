"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireActiveTenant } from "@/lib/tenant-guard";
import type { NotifPrefs } from "@/components/app/notification-prefs";

const DEFAULTS: NotifPrefs = {
  portal: true,
  appointment: true,
  commission: true,
  digest: true,
  marketing: false,
  priceDrop: true,
  savedSearch: true,
  share: true,
  dunning: true,
  rentOverdue: true,
  network: true,
};

// Helper function (not exported, not a server action)
function mergeNotifPrefs(raw: unknown): NotifPrefs {
  if (!raw || typeof raw !== "object") return DEFAULTS;
  return { ...DEFAULTS, ...(raw as Partial<NotifPrefs>) };
}

export async function getNotificationPrefs(): Promise<NotifPrefs> {
  const gate = await requireActiveTenant();
  if (!gate.ok) return DEFAULTS;

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("notification_prefs")
    .eq("id", gate.userId)
    .maybeSingle();

  if (!profile?.notification_prefs) return DEFAULTS;
  return mergeNotifPrefs(profile.notification_prefs);
}

export async function saveNotificationPrefs(prefs: NotifPrefs): Promise<{ error?: string; ok?: boolean }> {
  const gate = await requireActiveTenant();
  if (!gate.ok) return { error: gate.error };

  const next: NotifPrefs = {
    portal: Boolean(prefs.portal),
    appointment: Boolean(prefs.appointment),
    commission: Boolean(prefs.commission),
    digest: Boolean(prefs.digest),
    marketing: Boolean(prefs.marketing),
    // Yeni anahtarlar `!== false`: eski istemci paketinden anahtar gelmezse
    // varsayılan AÇIK kalsın (Boolean(undefined) türü sessizce kapatırdı)
    priceDrop: prefs.priceDrop !== false,
    savedSearch: prefs.savedSearch !== false,
    share: prefs.share !== false,
    dunning: prefs.dunning !== false,
    rentOverdue: prefs.rentOverdue !== false,
    network: prefs.network !== false,
  };

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ notification_prefs: next })
    .eq("id", gate.userId)
    .eq("tenant_id", gate.tenantId);

  if (error) return { error: error.message };
  revalidatePath("/app/ayarlar");
  revalidatePath("/app", "layout");
  return { ok: true };
}
