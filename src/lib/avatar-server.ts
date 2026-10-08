import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { verifyImageFile } from "@/lib/file-validation";
import { AVATAR_MAX_BYTES, isAvatarPreset } from "@/lib/avatar-presets";
import { actionErrorMessage } from "@/lib/action-errors";
import { now } from "@/lib/clock";

export type AvatarResult = { ok?: boolean; error?: string; url?: string | null; preset?: string | null };

export const AVATAR_BUCKET = "avatars";
const ALLOWED = ["image/jpeg", "image/png", "image/webp"] as const;
const EXTS = ["jpg", "png", "webp"] as const;

/** Yol: {tenant_id|platform}/{user_id}.{ext} — storage RLS (avatar_object_allowed) bu biçimi zorlar. */
export function avatarPath(scope: string, userId: string, ext: string) {
  return `${scope}/${userId}.${ext}`;
}

/**
 * Kullanıcı kendi fotoğrafını yükler. Kullanıcı istemcisi (JWT) kullanılır: kova yazması storage RLS'ine,
 * satır yazması `set_my_avatar` RPC'sine (auth.uid) bağlıdır; service_role gerekmez.
 */
export async function storeOwnAvatar(
  supabase: SupabaseClient,
  scope: string,
  userId: string,
  fd: FormData,
): Promise<AvatarResult> {
  const file = fd.get("photo");
  if (!(file instanceof File) || file.size === 0) return { error: "Dosya seçilmedi." };
  if (file.size > AVATAR_MAX_BYTES) return { error: "Fotoğraf en çok 2 MB olabilir." };
  // İçerik imzası doğrulaması — bildirilen MIME'a güvenilmez.
  const verified = await verifyImageFile(file, ALLOWED);
  if (!verified.ok) return { error: verified.error };

  const ext = verified.type === "image/png" ? "png" : verified.type === "image/webp" ? "webp" : "jpg";
  const path = avatarPath(scope, userId, ext);
  const bucket = supabase.storage.from(AVATAR_BUCKET);

  const { error: upErr } = await bucket.upload(path, await file.arrayBuffer(), {
    contentType: verified.type,
    upsert: true,
  });
  if (upErr) {
    console.error("storeOwnAvatar storage", upErr);
    return { error: actionErrorMessage(upErr, "Yükleme başarısız. Lütfen tekrar deneyin.") };
  }

  // Eski uzantılı kalıntıları temizle (best-effort).
  const stale = EXTS.filter((e) => e !== ext).map((e) => avatarPath(scope, userId, e));
  await bucket.remove(stale).catch(() => undefined);

  // Aynı yola upsert edildiği için CDN eski görseli tutabilir — sürüm damgası.
  const url = `${bucket.getPublicUrl(path).data.publicUrl}?v=${now()}`;
  const { error: rpcErr } = await supabase.rpc("set_my_avatar", { p_url: url, p_preset: null });
  if (rpcErr) {
    console.error("storeOwnAvatar rpc", rpcErr);
    return { error: actionErrorMessage(rpcErr, "Fotoğraf kaydedilemedi.") };
  }
  return { ok: true, url, preset: null };
}

/** Hazır avatar seçer (fotoğraf temizlenir ve dosya silinir: tek kaynak karışmasın). */
export async function storeOwnPreset(
  supabase: SupabaseClient,
  scope: string,
  userId: string,
  preset: unknown,
): Promise<AvatarResult> {
  if (!isAvatarPreset(preset)) return { error: "Geçersiz hazır avatar." };
  await removeFiles(supabase, scope, userId);
  const { error } = await supabase.rpc("set_my_avatar", { p_url: null, p_preset: preset });
  if (error) {
    console.error("storeOwnPreset", error);
    return { error: actionErrorMessage(error, "Avatar kaydedilemedi.") };
  }
  return { ok: true, url: null, preset };
}

/** Fotoğrafı ve hazır avatarı kaldırır — baş harfe döner. */
export async function clearOwnAvatar(supabase: SupabaseClient, scope: string, userId: string): Promise<AvatarResult> {
  await removeFiles(supabase, scope, userId);
  const { error } = await supabase.rpc("set_my_avatar", { p_url: null, p_preset: null });
  if (error) {
    console.error("clearOwnAvatar", error);
    return { error: actionErrorMessage(error, "Avatar kaldırılamadı.") };
  }
  return { ok: true, url: null, preset: null };
}

async function removeFiles(supabase: SupabaseClient, scope: string, userId: string) {
  await supabase.storage
    .from(AVATAR_BUCKET)
    .remove(EXTS.map((e) => avatarPath(scope, userId, e)))
    .catch(() => undefined);
}
