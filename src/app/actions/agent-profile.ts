"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyImageFile } from "@/lib/file-validation";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { now } from "@/lib/clock";
import {
  AGENT_BIO_MAX,
  AGENT_LANGUAGES_MAX,
  AGENT_SPECIALTIES_MAX,
  AGENT_TITLE_MAX,
  isValidAgentSlug,
  parseChips,
  slugifyAgentName,
} from "@/lib/agent-profile";

export type AgentProfileResult = { ok?: boolean; error?: string; slug?: string; url?: string };

const PHOTO_BUCKET = "agent-photos";
const PHOTO_MAX_SIZE = 3 * 1024 * 1024; // 3MB — portre için fazlasıyla yeterli
const PHOTO_ALLOWED = ["image/jpeg", "image/png", "image/webp"];

/**
 * Hedef kullanıcıyı çözer ve yetkiyi kapıya bağlar.
 *
 * KENDİ kartvizitini düzenlemek `team:view` ile yeterlidir — danışman kendi
 * tanıtım metnini yazmak için yönetici yetkisi beklememeli. BAŞKASININ
 * profiline dokunmak `team:edit` ister (yönetici /app/ekip üzerinden düzenler).
 * Hedef her zaman aynı kiracıda olmalı; aksi halde kiracı sınırı delinirdi.
 */
async function gateForTarget(rawTargetId: string | null) {
  const viewGate = await requirePermission("team", "view");
  if (!viewGate.ok) return { ok: false as const, error: viewGate.error };

  const targetId = (rawTargetId ?? "").trim() || viewGate.userId;
  if (targetId !== viewGate.userId) {
    const editGate = await requirePermission("team", "edit");
    if (!editGate.ok) {
      return { ok: false as const, error: "Başkasının kartvizitini düzenlemek için ekip yönetimi yetkisi gerekir." };
    }
    // Kiracı izolasyonu: RLS'li client ile okunur — başka kiracının profili görünmez.
    const supabase = await createClient();
    const { data: target } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", targetId)
      .maybeSingle();
    if (!target) return { ok: false as const, error: "Ekip üyesi bulunamadı." };
  }

  return { ok: true as const, userId: viewGate.userId, tenantId: viewGate.tenantId, targetId };
}

/**
 * Kartvizit (public danışman profili) kaydeder.
 *
 * Slug GLOBAL benzersizdir (adres tek segmentli: /danisman/<slug>), bu yüzden
 * çakışma kontrolü admin client ile yapılır — başka kiracıdaki bir slug RLS
 * yüzünden "boş" görünüp 23505 ile patlamasın, kullanıcı anlamlı hata alsın.
 */
export async function saveAgentProfile(fd: FormData): Promise<AgentProfileResult> {
  const gate = await gateForTarget(String(fd.get("target_id") ?? ""));
  if (!gate.ok) return { error: gate.error };

  const supabase = await createClient();
  const { data: current } = await supabase
    .from("profiles")
    .select("id, full_name, public_slug")
    .eq("id", gate.targetId)
    .maybeSingle();
  if (!current) return { error: "Profil bulunamadı." };

  const title = String(fd.get("title") ?? "").trim().slice(0, AGENT_TITLE_MAX);
  const bio = String(fd.get("bio") ?? "").trim().slice(0, AGENT_BIO_MAX);
  const specialties = parseChips(String(fd.get("specialties") ?? ""), AGENT_SPECIALTIES_MAX);
  const languages = parseChips(String(fd.get("languages") ?? ""), AGENT_LANGUAGES_MAX);
  const isPublic = String(fd.get("is_public") ?? "") === "on";

  // Slug: elle girilmediyse ad-soyaddan türet; o da tutmazsa mevcut slug korunur.
  const rawSlug = String(fd.get("public_slug") ?? "").trim().toLowerCase();
  const slug = rawSlug || current.public_slug || slugifyAgentName(String(current.full_name ?? ""));

  if (!slug) {
    return { error: "Adres (slug) üretilemedi. En az 3 karakterlik bir adres girin." };
  }
  if (!isValidAgentSlug(slug)) {
    return {
      error: "Adres yalnız küçük harf, rakam ve tire içerebilir; 3-60 karakter olmalı ve tire ile başlayıp bitmemeli.",
    };
  }

  // Yayına almadan önce en az bir tanıtım verisi olsun — boş kartvizit paylaşılmasın.
  if (isPublic && !title && !bio && specialties.length === 0) {
    return { error: "Yayına almadan önce en az unvan, kısa tanıtım veya bir uzmanlık alanı girin." };
  }

  const admin = createAdminClient();
  const { data: clash } = await admin
    .from("profiles")
    .select("id")
    .eq("public_slug", slug)
    .neq("id", gate.targetId)
    .maybeSingle();
  if (clash) {
    return { error: `"${slug}" adresi başka bir danışman tarafından kullanılıyor. Farklı bir adres deneyin.` };
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      public_slug: slug,
      is_public: isPublic,
      title: title || null,
      bio: bio || null,
      specialties: specialties.length ? specialties : null,
      languages: languages.length ? languages : null,
    })
    .eq("id", gate.targetId);

  if (error) {
    console.error("saveAgentProfile", error);
    // Yarış durumunda (aynı anda iki kayıt) kısmi unique index 23505 verir.
    if (error.code === "23505") {
      return { error: `"${slug}" adresi az önce başkası tarafından alındı. Farklı bir adres deneyin.` };
    }
    return { error: "Kartvizit kaydedilemedi. Lütfen tekrar deneyin." };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "agent_profile.update",
    entityType: "profiles",
    entityId: gate.targetId,
    newValue: { public_slug: slug, is_public: isPublic, specialties: specialties.length },
  });

  revalidatePath("/app/ekip/kartvizitim");
  revalidatePath("/app/ekip");
  revalidatePath(`/danisman/${slug}`);
  if (current.public_slug && current.public_slug !== slug) revalidatePath(`/danisman/${current.public_slug}`);

  return { ok: true, slug };
}

/**
 * Portre fotoğrafını Supabase Storage'a yükler (bucket: agent-photos, public).
 *
 * NEDEN SERVICE ROLE: bucket migration ile açıldı, storage.objects üzerinde
 * kiracı bazlı politika yok. Yetki kontrolü zaten `gateForTarget` ile yapıldı;
 * yol `{tenantId}/{userId}.{ext}` olduğundan kiracı/kişi izolasyonu korunur
 * (tenant-logos deseninin service role varyantı).
 */
export async function uploadAgentPhoto(fd: FormData): Promise<AgentProfileResult> {
  const gate = await gateForTarget(String(fd.get("target_id") ?? ""));
  if (!gate.ok) return { error: gate.error };

  const file = fd.get("photo") as File | null;
  if (!file || file.size === 0) return { error: "Dosya seçilmedi." };
  if (file.size > PHOTO_MAX_SIZE) return { error: "Maksimum dosya boyutu 3MB." };
  // İçerik imzası doğrulaması — bildirilen MIME'a güvenmez.
  const verified = await verifyImageFile(file, PHOTO_ALLOWED);
  if (!verified.ok) return { error: verified.error };

  const ext = verified.type === "image/png" ? "png" : verified.type === "image/webp" ? "webp" : "jpg";
  const path = `${gate.tenantId}/${gate.targetId}.${ext}`;

  const admin = createAdminClient();
  const { error: upErr } = await admin.storage
    .from(PHOTO_BUCKET)
    .upload(path, await file.arrayBuffer(), { contentType: verified.type, upsert: true });

  if (upErr) {
    console.error("uploadAgentPhoto storage", upErr);
    return { error: "Yükleme başarısız. Lütfen tekrar deneyin." };
  }

  const { data: pub } = admin.storage.from(PHOTO_BUCKET).getPublicUrl(path);
  // Aynı yola upsert edildiği için CDN eski görseli tutabilir — sürüm damgası ekle.
  const url = `${pub.publicUrl}?v=${now()}`;

  const supabase = await createClient();
  const { error: dbErr } = await supabase.from("profiles").update({ photo_url: url }).eq("id", gate.targetId);
  if (dbErr) {
    console.error("uploadAgentPhoto db", dbErr);
    return { error: "Fotoğraf adresi kaydedilemedi." };
  }

  revalidatePath("/app/ekip/kartvizitim");
  return { ok: true, url };
}

/** Portre fotoğrafını kaldırır — kartvizit baş harf monogramına döner. */
export async function removeAgentPhoto(fd: FormData): Promise<AgentProfileResult> {
  const gate = await gateForTarget(String(fd.get("target_id") ?? ""));
  if (!gate.ok) return { error: gate.error };

  const admin = createAdminClient();
  await admin.storage
    .from(PHOTO_BUCKET)
    .remove(["jpg", "png", "webp"].map((ext) => `${gate.tenantId}/${gate.targetId}.${ext}`));

  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update({ photo_url: null }).eq("id", gate.targetId);
  if (error) {
    console.error("removeAgentPhoto", error);
    return { error: "Fotoğraf kaldırılamadı." };
  }

  revalidatePath("/app/ekip/kartvizitim");
  return { ok: true };
}
