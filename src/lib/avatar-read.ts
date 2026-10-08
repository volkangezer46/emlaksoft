import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

export type AvatarFields = { avatar_url: string | null; avatar_preset: string | null };

/** Personelin kendi avatarı (RLS: platform_staff_self_select). Hata/yoksa null → baş harf. */
export async function loadStaffAvatar(staffId: string): Promise<AvatarFields | null> {
  try {
    const supabase = await createClient();
    const { data } = await supabase.from("platform_staff").select("avatar_url, avatar_preset").eq("id", staffId).maybeSingle();
    return (data as AvatarFields | null) ?? null;
  } catch {
    return null;
  }
}

/** Ofis kullanıcısının kendi avatarı (RLS: kendi satırı). Hata/yoksa null → baş harf. */
export async function loadOwnProfileAvatar(userId: string): Promise<AvatarFields | null> {
  try {
    const supabase = await createClient();
    const { data } = await supabase.from("profiles").select("avatar_url, avatar_preset").eq("id", userId).maybeSingle();
    return (data as AvatarFields | null) ?? null;
  } catch {
    return null;
  }
}

/**
 * Kimlik listesi için {id → alanlar} haritası (aynı kiracı; RLS kiracı dışını göstermez).
 * Liste ekranlarının mevcut sorgusunu bozmamak için ayrı, tek IN sorgusudur.
 */
export async function loadAvatarMap(
  userIds: readonly (string | null | undefined)[],
  client?: SupabaseClient,
): Promise<Map<string, AvatarFields>> {
  const ids = [...new Set(userIds.filter((x): x is string => Boolean(x)))];
  const map = new Map<string, AvatarFields>();
  if (ids.length === 0) return map;
  try {
    const supabase = client ?? (await createClient());
    const { data } = await supabase.from("profiles").select("id, avatar_url, avatar_preset").in("id", ids.slice(0, 300));
    for (const r of data ?? []) map.set(r.id as string, { avatar_url: r.avatar_url ?? null, avatar_preset: r.avatar_preset ?? null });
  } catch {
    // avatar süs: hata listeyi bozmaz
  }
  return map;
}
