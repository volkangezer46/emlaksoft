"use server";

import { cookies } from "next/headers";
import { checkRateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { getRequestUser } from "@/lib/supabase/auth-cache";
import {
  FONT_SCALE_COOKIE,
  FONT_SCALE_COOKIE_MAX_AGE,
  FONT_SCALE_META_KEY,
  isFontScale,
  serializeFontCookie,
  type FontScale,
} from "@/lib/font-scale";
import { actionErrorMessage } from "@/lib/action-errors";

export type FontScaleResult = { ok: true; scale: FontScale } | { ok: false; error: string };

/**
 * Giriş yapmış kullanıcının KENDİ yazı boyutunu kaydeder (auth user_metadata + kullanıcıya bağlı çerez).
 * Değer beyaz listeden (sm|md|lg) doğrulanır; başka kullanıcının ayarı yazılamaz (kimlik oturumdan gelir).
 */
export async function saveFontScale(value: unknown): Promise<FontScaleResult> {
  const user = await getRequestUser();
  if (!user) return { ok: false, error: "Oturum bulunamadı. Lütfen yeniden giriş yapın." };
  if (user.app_metadata?.impersonating === true) {
    return { ok: false, error: "Destek oturumunda yazı boyutu değiştirilemez." };
  }
  if (!isFontScale(value)) return { ok: false, error: "Geçersiz yazı boyutu." };

  const { allowed } = await checkRateLimit(`fontscale:${user.id}`, { limit: 30, windowSec: 600, failurePolicy: "deny" });
  if (!allowed) return { ok: false, error: "Çok sık değiştirdiniz. Birkaç dakika sonra tekrar deneyin." };

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ data: { [FONT_SCALE_META_KEY]: value } });
  if (error) return { ok: false, error: actionErrorMessage(error, "Yazı boyutu kaydedilemedi. Lütfen tekrar deneyin.") };

  const jar = await cookies();
  jar.set(FONT_SCALE_COOKIE, serializeFontCookie(user.id, value), {
    path: "/",
    maxAge: FONT_SCALE_COOKIE_MAX_AGE,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  return { ok: true, scale: value };
}
