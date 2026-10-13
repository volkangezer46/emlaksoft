"use server";

import { createClient } from "@/lib/supabase/server";
import { getRequestUser } from "@/lib/supabase/auth-cache";
import { now } from "@/lib/clock";

/**
 * Ofis paneli: platform banner'ı kapatma ve "Yenilikler" çekmecesi (AD8). Kullanıcının KENDİ oturumuyla (RLS):
 * yalnız kendisine görünen kapatılabilir banner'ı kapatabilir, yalnız yayınlanmış girdileri okur, yalnız kendi
 * "son görülme" satırını yazar. service_role kullanılmaz.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function dismissPlatformBanner(id: string): Promise<{ ok?: boolean; error?: string }> {
  const user = await getRequestUser();
  if (!user) return { error: "Oturum gerekli." };
  if (!UUID_RE.test(id)) return { error: "Geçersiz banner." };
  const supabase = await createClient();
  const { error } = await supabase.from("platform_banner_dismissals").upsert({ banner_id: id, user_id: user.id }, { onConflict: "banner_id,user_id", ignoreDuplicates: true });
  if (error) return { error: "Banner kapatılamadı." };
  return { ok: true };
}

export type WhatsNewEntry = { id: string; title: string; body: string | null; category: string; href: string | null; published_at: string; unread: boolean };

/** Çekmece açılınca: son 30 yayınlanmış girdi + okunmamış işareti; ardından "son görülme" şimdiye çekilir (rozet söner). */
export async function openWhatsNew(): Promise<{ entries: WhatsNewEntry[]; error?: string }> {
  const user = await getRequestUser();
  if (!user) return { entries: [], error: "Oturum gerekli." };
  const supabase = await createClient();
  const [{ data, error }, { data: seen }] = await Promise.all([
    supabase
      .from("changelog_entries")
      .select("id, title, body, category, href, published_at")
      .not("published_at", "is", null)
      .order("published_at", { ascending: false })
      .limit(30),
    supabase.from("changelog_reads").select("last_seen_at").eq("user_id", user.id).maybeSingle(),
  ]);
  if (error) return { entries: [], error: "Yenilikler yüklenemedi." };
  const nowMs = now();
  const lastSeen = seen?.last_seen_at ? new Date(seen.last_seen_at as string).getTime() : nowMs - 30 * 86_400_000;
  const entries = ((data ?? []) as Omit<WhatsNewEntry, "unread">[]).map((e) => ({ ...e, unread: new Date(e.published_at).getTime() > lastSeen }));
  await supabase.from("changelog_reads").upsert({ user_id: user.id, last_seen_at: new Date(nowMs).toISOString() }, { onConflict: "user_id" });
  return { entries };
}
