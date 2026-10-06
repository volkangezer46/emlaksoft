"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireActiveTenant } from "@/lib/tenant-guard";
import { getSettings } from "@/lib/settings/read";
import { notifyKey } from "@/lib/settings/registry/tenant";
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
  insight: true,
  support: true,
  assignment: true,
  authority: true,
  survey: true,
};

// Helper function (not exported, not a server action)
function mergeNotifPrefs(raw: unknown, base: NotifPrefs): NotifPrefs {
  if (!raw || typeof raw !== "object") return base;
  return { ...base, ...(raw as Partial<NotifPrefs>) };
}

/** Ofis Tanımları Merkezi: ofisin bildirim varsayılanları (kayıt yoksa kod varsayılanı DEFAULTS). */
async function officeDefaults(tenantId: string): Promise<NotifPrefs> {
  const keys = Object.keys(DEFAULTS) as (keyof NotifPrefs)[];
  const values = await getSettings(keys.map(notifyKey), { tenantId });
  const out = { ...DEFAULTS };
  for (const k of keys) {
    const v = values[notifyKey(k)];
    if (typeof v === "boolean") out[k] = v;
  }
  return out;
}

export async function getNotificationPrefs(): Promise<NotifPrefs> {
  const gate = await requireActiveTenant();
  if (!gate.ok) return DEFAULTS;
  const base = await officeDefaults(gate.tenantId);

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("notification_prefs")
    .eq("id", gate.userId)
    .maybeSingle();

  if (!profile?.notification_prefs) return base;
  return mergeNotifPrefs(profile.notification_prefs, base);
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
    insight: prefs.insight !== false,
    support: prefs.support !== false,
    assignment: prefs.assignment !== false,
    authority: prefs.authority !== false,
    survey: prefs.survey !== false,
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
