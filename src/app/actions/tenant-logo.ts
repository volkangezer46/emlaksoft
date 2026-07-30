"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { verifyImageFile } from "@/lib/file-validation";

export type LogoResult = { ok?: boolean; error?: string; url?: string };

const BUCKET = "tenant-logos";
const MAX_SIZE = 2 * 1024 * 1024; // 2MB
// SVG KALDIRILDI: SVG script taşıyabilir (stored XSS). Yalnız raster görsel.
const ALLOWED = ["image/jpeg", "image/png", "image/webp"] as const;

/**
 * Ofis logosunu Supabase Storage'a yükler, tenants.logo_url günceller.
 * Bucket: tenant-logos (public read, tenant-isolated write)
 */
export async function uploadTenantLogo(formData: FormData): Promise<LogoResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };

  const file = formData.get("logo") as File | null;
  if (!file || file.size === 0) return { error: "Dosya seçilmedi." };
  if (file.size > MAX_SIZE) {
    return { error: "Maksimum dosya boyutu 2MB." };
  }
  // İçerik imzası doğrulaması — client'ın bildirdiği MIME'a güvenmez.
  const verified = await verifyImageFile(file, ALLOWED);
  if (!verified.ok) return { error: verified.error };

  const supabase = await createClient();

  // Tenant-isolated path: {tenantId}/logo.{ext} — tespit edilen GERÇEK türe göre.
  const ext = verified.type === "image/webp" ? "webp" : verified.type === "image/png" ? "png" : "jpg";
  const path = `${gate.tenantId}/logo.${ext}`;

  const bytes = await file.arrayBuffer();
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, bytes, {
      contentType: verified.type,
      upsert: true, // logo değiştirilince üzerine yaz
    });

  if (upErr) {
    console.error("uploadTenantLogo storage", upErr);
    return { error: "Yükleme başarısız. Storage bucket kontrolü yapın." };
  }

  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
  const url = pub.publicUrl;

  const { error: dbErr } = await supabase
    .from("tenants")
    .update({ logo_url: url, updated_at: new Date().toISOString() })
    .eq("id", gate.tenantId);

  if (dbErr) {
    console.error("uploadTenantLogo db", dbErr);
    return { error: "Logo URL kaydedilemedi." };
  }

  revalidatePath("/app/ayarlar");
  revalidatePath("/app");
  return { ok: true, url };
}

/**
 * Mevcut logoyu sil.
 */
export async function deleteTenantLogo(): Promise<LogoResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };

  const supabase = await createClient();

  // Tüm ext varyantlarını dene
  const exts = ["png", "jpg", "webp", "svg"];
  for (const ext of exts) {
    await supabase.storage.from(BUCKET).remove([`${gate.tenantId}/logo.${ext}`]);
  }

  await supabase
    .from("tenants")
    .update({ logo_url: null, updated_at: new Date().toISOString() })
    .eq("id", gate.tenantId);

  revalidatePath("/app/ayarlar");
  revalidatePath("/app");
  return { ok: true };
}
