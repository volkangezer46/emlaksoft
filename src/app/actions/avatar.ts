"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { clearOwnAvatar, storeOwnAvatar, storeOwnPreset, type AvatarResult } from "@/lib/avatar-server";

/**
 * Ofis kullanıcısının KENDİ avatarı. Hedef daima oturumdaki kullanıcıdır (parametre yok → başkasına dokunulamaz).
 * Yetki: kendi kartı için ekip modülü gerekmez; her aktif ofis üyesi `dashboard:view` ile erişir. Destek (bürünme)
 * oturumu salt okunurdur: kapı reddeder, DB RPC'si de ayrıca reddeder.
 */
async function gate() {
  const g = await requirePermission("dashboard", "view");
  if (!g.ok) return { error: g.error } as const;
  if (g.impersonating) return { error: "Destek oturumunda profil değiştirilemez." } as const;
  return { userId: g.userId, tenantId: g.tenantId } as const;
}

function refresh() {
  revalidatePath("/app", "layout");
}

export async function uploadOwnAvatar(fd: FormData): Promise<AvatarResult> {
  const g = await gate();
  if ("error" in g) return { error: g.error };
  const res = await storeOwnAvatar(await createClient(), g.tenantId, g.userId, fd);
  if (res.ok) refresh();
  return res;
}

export async function setOwnAvatarPreset(preset: string): Promise<AvatarResult> {
  const g = await gate();
  if ("error" in g) return { error: g.error };
  const res = await storeOwnPreset(await createClient(), g.tenantId, g.userId, preset);
  if (res.ok) refresh();
  return res;
}

export async function removeOwnAvatar(): Promise<AvatarResult> {
  const g = await gate();
  if ("error" in g) return { error: g.error };
  const res = await clearOwnAvatar(await createClient(), g.tenantId, g.userId);
  if (res.ok) refresh();
  return res;
}
