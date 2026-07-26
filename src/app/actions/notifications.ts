"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireActiveTenant } from "@/lib/tenant-guard";

export type NotificationRow = {
  id: string;
  title: string;
  body: string | null;
  href: string | null;
  kind: string;
  read_at: string | null;
  created_at: string;
};

export async function listMyNotifications(): Promise<NotificationRow[]> {
  const gate = await requireActiveTenant();
  if (!gate.ok) return [];

  const supabase = await createClient();
  const { data } = await supabase
    .from("notifications")
    .select("id, title, body, href, kind, read_at, created_at")
    .or(`user_id.eq.${gate.userId},user_id.is.null`)
    .order("created_at", { ascending: false })
    .limit(30);

  return (data ?? []) as NotificationRow[];
}

export async function markNotificationRead(id: string): Promise<void> {
  const gate = await requireActiveTenant();
  if (!gate.ok || !id) return;
  const supabase = await createClient();
  await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);
  revalidatePath("/app", "layout");
}

export async function markAllNotificationsRead(): Promise<void> {
  const gate = await requireActiveTenant();
  if (!gate.ok) return;
  const supabase = await createClient();
  await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("tenant_id", gate.tenantId)
    .or(`user_id.eq.${gate.userId},user_id.is.null`)
    .is("read_at", null);
  revalidatePath("/app", "layout");
}

/**
 * /app/bildirimler arşiv sayfası için form-action sarmalayıcıları — server
 * component'te <form action={...}> yalnız FormData imzası kabul eder.
 */
export async function markNotificationReadForm(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;
  await markNotificationRead(id);
}

export async function markAllNotificationsReadForm(): Promise<void> {
  await markAllNotificationsRead();
}

/*
 * `notifyTenant` buradan src/lib/notify.ts'e TASINDI.
 *
 * Sebep: bu dosya "use server" tasiyor, yani buradan export edilen her
 * fonksiyon tarayicidan cagrilabilen bir UC NOKTA oluyor. notifyTenant
 * `tenantId`'yi parametre olarak aliyor ve createAdminClient() (service_role)
 * kullaniyordu — yani RLS'i atliyordu ve yetki kontrolu de yoktu. Action
 * kimligini ele geciren biri istedigi kiraciya bildirim yazdirabilirdi.
 *
 * lib/ altinda artik uc nokta degil; yalnizca sunucu kodu import edebiliyor.
 */

export async function subscribeToPush(sub: { endpoint: string; p256dh: string; auth: string }): Promise<{ ok?: boolean; error?: string }> {
  const gate = await requireActiveTenant();
  if (!gate.ok) return { error: gate.error };
  if (!sub.endpoint || !sub.p256dh || !sub.auth) return { error: "Geçersiz abonelik" };

  const supabase = await createClient();
  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      tenant_id: gate.tenantId,
      user_id: gate.userId,
      endpoint: sub.endpoint,
      p256dh: sub.p256dh,
      auth: sub.auth,
    },
    { onConflict: "endpoint" },
  );
  if (error) return { error: error.message };
  return { ok: true };
}

export async function unsubscribeFromPush(endpoint: string): Promise<{ ok?: boolean; error?: string }> {
  const gate = await requireActiveTenant();
  if (!gate.ok) return { error: gate.error };
  const supabase = await createClient();
  await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint).eq("user_id", gate.userId);
  return { ok: true };
}
