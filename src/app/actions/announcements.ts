"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { requireActiveTenant } from "@/lib/tenant-guard";
import { notifyTenant } from "@/lib/notify";

export type AnnouncementResult = { ok?: boolean; error?: string };

const LEVELS = ["info", "warning", "success"] as const;
export type AnnouncementLevel = (typeof LEVELS)[number];

/** Form alanlarını ayrıştırıp doğrular — create/update ortak. */
function parseAnnouncementForm(fd: FormData):
  | { ok: true; title: string; body: string; level: AnnouncementLevel; pinned: boolean; ends_at: string | null }
  | { ok: false; error: string } {
  const title = String(fd.get("title") ?? "").trim();
  const body = String(fd.get("body") ?? "").trim();
  const level = String(fd.get("level") ?? "info");
  const pinned = fd.get("pinned") === "on";
  const endsAtRaw = String(fd.get("ends_at") ?? "").trim();

  if (!title) return { ok: false, error: "Başlık zorunludur." };
  if (title.length > 200) return { ok: false, error: "Başlık en fazla 200 karakter olabilir." };
  if (!body) return { ok: false, error: "Duyuru metni zorunludur." };
  if (body.length > 4000) return { ok: false, error: "Duyuru metni en fazla 4000 karakter olabilir." };
  if (!(LEVELS as readonly string[]).includes(level)) return { ok: false, error: "Geçersiz seviye." };

  let ends_at: string | null = null;
  if (endsAtRaw) {
    const parsed = new Date(endsAtRaw);
    if (Number.isNaN(parsed.getTime())) return { ok: false, error: "Bitiş tarihi geçersiz." };
    ends_at = parsed.toISOString();
  }

  return { ok: true, title, body, level: level as AnnouncementLevel, pinned, ends_at };
}

function revalidateAnnouncements() {
  revalidatePath("/app/ayarlar/duyurular");
  revalidatePath("/app");
}

/** Yeni duyuru yayınlar ve tüm ekibe bildirim düşer. */
export async function createAnnouncement(_prev: AnnouncementResult, fd: FormData): Promise<AnnouncementResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };

  const parsed = parseAnnouncementForm(fd);
  if (!parsed.ok) return { error: parsed.error };

  const supabase = await createClient();
  const { error } = await supabase.from("announcements").insert({
    tenant_id: gate.tenantId,
    title: parsed.title,
    body: parsed.body,
    level: parsed.level,
    pinned: parsed.pinned,
    ends_at: parsed.ends_at,
    created_by: gate.userId,
  });
  if (error) {
    console.error("createAnnouncement", error);
    return { error: "Duyuru yayınlanamadı." };
  }

  // Ekibe tenant-geneli bildirim — duyurular dashboard bandında göründüğü için hedef /app
  await notifyTenant({
    tenantId: gate.tenantId,
    title: `📢 Yeni duyuru: ${parsed.title}`,
    body: parsed.body.length > 140 ? `${parsed.body.slice(0, 140)}…` : parsed.body,
    href: "/app",
    kind: parsed.level === "warning" ? "warning" : parsed.level === "success" ? "success" : "info",
  });

  revalidateAnnouncements();
  return { ok: true };
}

/** Mevcut duyuruyu günceller. */
export async function updateAnnouncement(_prev: AnnouncementResult, fd: FormData): Promise<AnnouncementResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };

  const id = String(fd.get("id") ?? "").trim();
  if (!id) return { error: "Duyuru bulunamadı." };

  const parsed = parseAnnouncementForm(fd);
  if (!parsed.ok) return { error: parsed.error };

  const supabase = await createClient();
  const { error } = await supabase
    .from("announcements")
    .update({
      title: parsed.title,
      body: parsed.body,
      level: parsed.level,
      pinned: parsed.pinned,
      ends_at: parsed.ends_at,
    })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);
  if (error) {
    console.error("updateAnnouncement", error);
    return { error: "Duyuru güncellenemedi." };
  }

  revalidateAnnouncements();
  return { ok: true };
}

/** Duyuruyu kalıcı siler (okundu kayıtları cascade). ConfirmDialog formAction imzası. */
export async function deleteAnnouncementForm(fd: FormData): Promise<void> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return;

  const id = String(fd.get("id") ?? "").trim();
  if (!id) return;

  const supabase = await createClient();
  await supabase.from("announcements").delete().eq("id", id).eq("tenant_id", gate.tenantId);
  revalidateAnnouncements();
}

/**
 * Dashboard bandındaki "Okudum" — kendi adına okundu kaydı (upsert idempotent,
 * pk(announcement_id, user_id)). RLS insert politikası user_id = auth.uid() zorlar.
 */
export async function markAnnouncementRead(announcementId: string): Promise<AnnouncementResult> {
  const gate = await requireActiveTenant();
  if (!gate.ok) return { error: gate.error };
  if (!announcementId) return { error: "Duyuru bulunamadı." };

  const supabase = await createClient();
  const { error } = await supabase.from("announcement_reads").upsert(
    { announcement_id: announcementId, user_id: gate.userId },
    { onConflict: "announcement_id,user_id", ignoreDuplicates: true },
  );
  if (error) {
    console.error("markAnnouncementRead", error);
    return { error: "Okundu işaretlenemedi." };
  }

  revalidatePath("/app");
  return { ok: true };
}
