"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPlatformStaff, requirePlatformStaff } from "@/lib/platform";
import { notifyTenant } from "@/lib/notify";
import { logPlatformActivity } from "@/lib/platform-activity";
import { checkRateLimit } from "@/lib/rate-limit";
import type { ComboboxOption } from "@/components/ui/combobox";

export async function markPlatformNotificationRead(id: string): Promise<{ ok: boolean }> {
  const staff = await requirePlatformStaff();
  if (!id) return { ok: false };
  const admin = createAdminClient();
  await admin
    .from("platform_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .eq("staff_id", staff.id)
    .is("read_at", null);
  revalidatePath("/admin/bildirimler");
  return { ok: true };
}

export async function markAllPlatformNotificationsRead(): Promise<{ ok: boolean }> {
  const staff = await requirePlatformStaff();
  const admin = createAdminClient();
  await admin
    .from("platform_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("staff_id", staff.id)
    .is("read_at", null);
  revalidatePath("/admin/bildirimler");
  return { ok: true };
}

/** `<form action>` için void dönen sarmalayıcı. */
export async function markAllPlatformNotificationsReadForm(): Promise<void> {
  await markAllPlatformNotificationsRead();
}

/** `<form action>` için tekil okundu sarmalayıcısı (href'siz bildirim satırları). */
export async function markPlatformNotificationReadForm(formData: FormData): Promise<void> {
  await markPlatformNotificationRead(String(formData.get("id") ?? "").trim());
}

// ---------------------------------------------------------------------------
// Toplu duyuru (platform personelinden ofislere)
// ---------------------------------------------------------------------------

export type BroadcastTarget = "all" | "trial" | "active" | "specific";

export type BroadcastResult = {
  ok?: boolean;
  error?: string;
  sent?: number;
};

/**
 * Seçilen ofislere `notifications` tablosuna bildirim yazar.
 * `user_id = null` → tenant'taki tüm kullanıcılar görür.
 */
export async function sendBroadcast(fd: FormData): Promise<BroadcastResult> {
  // Sadece super_admin ve ops gönderebilir
  const staff = await requirePlatformStaff();
  if (!["super_admin", "ops"].includes(staff.role)) {
    return { error: "Bu işlem için yetkiniz yok." };
  }

  const sendRl = await checkRateLimit(`broadcast-send:${staff.id}`, { limit: 10, windowSec: 600, failurePolicy: "deny" });
  if (!sendRl.allowed) return { error: "Çok sık duyuru gönderdiniz; birkaç dakika sonra tekrar deneyin." };

  const title = (fd.get("title") as string | null)?.trim();
  const body = (fd.get("body") as string | null)?.trim() || undefined;
  const kind = (fd.get("kind") as string | null) ?? "info";
  const href = (fd.get("href") as string | null)?.trim() || undefined;
  const rawTarget = (fd.get("target") as string | null) ?? "all";
  // Arşiv tablosundaki check kısıtıyla birebir — bilinmeyen değer "all"a düşer.
  const target: BroadcastTarget = (["all", "trial", "active", "specific"] as const).includes(
    rawTarget as BroadcastTarget,
  )
    ? (rawTarget as BroadcastTarget)
    : "all";
  const specificId = (fd.get("tenant_id") as string | null)?.trim() || undefined;

  if (!title) return { error: "Başlık zorunludur." };
  if (title.length > 120) return { error: "Başlık en fazla 120 karakter olabilir." };

  const admin = createAdminClient();

  let query = admin.from("tenants").select("id, status").neq("status", "cancelled");

  if (target === "trial") query = admin.from("tenants").select("id, status").eq("status", "trial");
  else if (target === "active") query = admin.from("tenants").select("id, status").eq("status", "active");
  else if (target === "specific") {
    if (!specificId) return { error: "Belirli ofis için ofis ID gerekli." };
    query = admin.from("tenants").select("id, status").eq("id", specificId).neq("status", "cancelled");
  }

  const { data: tenants, error: qErr } = await query;
  if (qErr) return { error: qErr.message };
  if (!tenants || tenants.length === 0) return { error: "Eşleşen ofis bulunamadı." };

  const validKind = ["info", "success", "warning", "danger", "system"].includes(kind)
    ? (kind as "info" | "success" | "warning" | "danger" | "system")
    : "info";

  let sent = 0;
  for (const t of tenants) {
    await notifyTenant({ tenantId: t.id, title, body, href, kind: validKind });
    sent++;
  }

  // Arşiv: gönderim başına TEK satır — geçmiş listesi ve "kaç ofise ulaştı"
  // buradan okunur. Arşiv yazımı başarısız olsa bile duyurular gitti; işlemi
  // geriye düşürmeyiz, yalnızca loglarız.
  const { error: archiveErr } = await admin.from("platform_announcements").insert({
    title,
    body: body ?? null,
    kind: validKind,
    audience: target,
    tenant_id: target === "specific" ? (specificId ?? null) : null,
    sent_count: sent,
    created_by: staff.id,
  });
  if (archiveErr) console.error("duyuru arşivi yazılamadı", archiveErr);
  await logPlatformActivity({
    actorId: staff.id,
    action: "broadcast.send",
    entityType: "announcement",
    meta: { title, audience: target, sent },
  });

  revalidatePath("/admin/duyuru");
  return { ok: true, sent };
}

/** Son gönderilen duyuruları listeler (platform_notifications değil, `broadcast_log` yerine
 *  admin client ile notifications tablosundan çekiyoruz — user_id IS NULL olanlar). */
export async function listRecentBroadcasts(limit = 20) {
  const staff = await requirePlatformStaff();
  if (!["super_admin", "ops"].includes(staff.role)) return [];

  const admin = createAdminClient();
  const { data } = await admin
    .from("notifications")
    .select("id, title, body, kind, created_at, tenant_id")
    .is("user_id", null)
    .order("created_at", { ascending: false })
    .limit(limit);
  return data ?? [];
}

/**
 * "Belirli ofis" hedefi için Combobox sunucu araması. UUID kopyala-yapıştır
 * yerine ad ile arama — admin client kullanılır, bu yüzden yetki kapısı şart:
 * duyuru gönderemeyen rol (support/billing) ofis listesini de tarayamaz.
 */
export async function searchTenantsBroadcast(query: string): Promise<ComboboxOption[]> {
  const staff = await getPlatformStaff();
  if (!staff || !["super_admin", "ops"].includes(staff.role)) return [];

  const q = query.trim();
  if (q.length < 2) return [];

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("tenants")
    .select("id, name, slug, status")
    .neq("status", "cancelled")
    .ilike("name", `%${q}%`)
    .order("name")
    .limit(25);

  if (error || !data) return [];
  return data.map((t) => ({
    value: t.id,
    label: t.name,
    hint: `/${t.slug} · ${t.status}`,
  }));
}

// ---------------------------------------------------------------------------
// Duyuru düzenleme / silme (geri çekme)
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BROADCAST_KINDS = ["info", "success", "warning", "danger", "system"] as const;

/**
 * Arşiv satırının gönderdiği bildirimleri bulur: `notifications` tablosunda duyuruya
 * bağ (FK) yoktur; aynı başlık/gövde/tür, kullanıcıya özel olmayan (user_id null) ve gönderim
 * penceresindeki satırlar eşleşir (gönderim döngüsü arşiv satırından önce biter).
 */
function matchSentNotifications(
  admin: ReturnType<typeof createAdminClient>,
  a: { title: string; body: string | null; kind: string; tenant_id: string | null; created_at: string },
) {
  const end = new Date(a.created_at).getTime();
  let q = admin
    .from("notifications")
    .select("id", { count: "exact" })
    .is("user_id", null)
    .eq("title", a.title)
    .eq("kind", a.kind)
    .gte("created_at", new Date(end - 15 * 60_000).toISOString())
    .lte("created_at", new Date(end + 60_000).toISOString());
  q = a.body === null ? q.is("body", null) : q.eq("body", a.body);
  if (a.tenant_id) q = q.eq("tenant_id", a.tenant_id);
  return q;
}

export type BroadcastEditResult = { ok?: boolean; error?: string; affected?: number };

/** Gönderilmiş duyurunun başlık/gövde/türünü arşivde ve ofislerin bildirim kutusunda düzeltir. */
export async function updateBroadcast(fd: FormData): Promise<BroadcastEditResult> {
  const staff = await requirePlatformStaff();
  if (!["super_admin", "ops"].includes(staff.role)) return { error: "Bu işlem için yetkiniz yok." };
  const id = String(fd.get("id") ?? "");
  if (!UUID_RE.test(id)) return { error: "Geçersiz duyuru." };
  const title = String(fd.get("title") ?? "").trim();
  const body = String(fd.get("body") ?? "").trim() || null;
  const kind = String(fd.get("kind") ?? "info");
  if (!title) return { error: "Başlık zorunludur." };
  if (title.length > 120) return { error: "Başlık en fazla 120 karakter olabilir." };
  if (body && body.length > 2000) return { error: "Mesaj en fazla 2000 karakter olabilir." };
  if (!(BROADCAST_KINDS as readonly string[]).includes(kind)) return { error: "Geçersiz tür." };
  const rl = await checkRateLimit(`broadcast-edit:${staff.id}`, { limit: 30, windowSec: 600, failurePolicy: "deny" });
  if (!rl.allowed) return { error: "Çok sık düzenleme yaptınız; birkaç dakika sonra tekrar deneyin." };

  const admin = createAdminClient();
  const { data: a } = await admin
    .from("platform_announcements")
    .select("id, title, body, kind, tenant_id, created_at")
    .eq("id", id)
    .maybeSingle();
  if (!a) return { error: "Duyuru bulunamadı." };

  const { data: sent } = await matchSentNotifications(admin, a);
  const ids = (sent ?? []).map((r) => r.id as string);
  if (ids.length > 0) {
    const { error: nErr } = await admin.from("notifications").update({ title, body, kind }).in("id", ids);
    if (nErr) {
      console.error("updateBroadcast notifications", nErr.message);
      return { error: "Ofis bildirimleri güncellenemedi; duyuru değiştirilmedi." };
    }
  }
  const { error } = await admin.from("platform_announcements").update({ title, body, kind }).eq("id", id);
  if (error) {
    console.error("updateBroadcast", error.message);
    return { error: "Duyuru güncellenemedi." };
  }
  await logPlatformActivity({
    actorId: staff.id,
    action: "broadcast.update",
    entityType: "announcement",
    entityId: id,
    meta: { affected: ids.length },
  });
  revalidatePath("/admin/duyuru");
  return { ok: true, affected: ids.length };
}

/** Duyuruyu geri çeker: ofislerin bildirim kutusundan siler ve arşiv satırını kaldırır. Yıkıcı: süper admin. */
export async function deleteBroadcast(fd: FormData): Promise<BroadcastEditResult> {
  const staff = await requirePlatformStaff();
  if (staff.role !== "super_admin") return { error: "Duyuru silme yalnız süper admin tarafından yapılabilir." };
  const id = String(fd.get("id") ?? "");
  if (!UUID_RE.test(id)) return { error: "Geçersiz duyuru." };
  const rl = await checkRateLimit(`broadcast-delete:${staff.id}`, { limit: 20, windowSec: 600, failurePolicy: "deny" });
  if (!rl.allowed) return { error: "Çok sık silme yaptınız; birkaç dakika sonra tekrar deneyin." };

  const admin = createAdminClient();
  const { data: a } = await admin
    .from("platform_announcements")
    .select("id, title, body, kind, tenant_id, created_at")
    .eq("id", id)
    .maybeSingle();
  if (!a) return { ok: true, affected: 0 };

  const { data: sent } = await matchSentNotifications(admin, a);
  const ids = (sent ?? []).map((r) => r.id as string);
  if (ids.length > 0) {
    const { error: nErr } = await admin.from("notifications").delete().in("id", ids);
    if (nErr) {
      console.error("deleteBroadcast notifications", nErr.message);
      return { error: "Ofis bildirimleri silinemedi; duyuru korunuyor." };
    }
  }
  const { error } = await admin.from("platform_announcements").delete().eq("id", id);
  if (error) {
    console.error("deleteBroadcast", error.message);
    return { error: "Duyuru silinemedi." };
  }
  await logPlatformActivity({
    actorId: staff.id,
    action: "broadcast.delete",
    entityType: "announcement",
    entityId: id,
    meta: { title: a.title, retracted: ids.length },
  });
  revalidatePath("/admin/duyuru");
  return { ok: true, affected: ids.length };
}
