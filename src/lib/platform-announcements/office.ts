import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export type OfficeBanner = {
  id: string;
  title: string;
  body: string | null;
  level: "info" | "warning" | "critical";
  display: "banner" | "modal";
  dismissible: boolean;
  href: string | null;
  ends_at: string | null;
};

export type OfficeBroadcastState = { banners: OfficeBanner[]; changelogUnread: number };

/**
 * Ofis kabuğu için banner + okunmamış Yenilikler sayısı: TEK RPC turu (`office_broadcast_state`, INVOKER: RLS hedef
 * ofisi ve yayın aralığını uygular). İstek başına bir kez (React cache); banner şeridi ve Yenilikler düğmesi paylaşır.
 * RPC yoksa (migration uygulanmadı) ya da hata olursa boş durum: kabuk hiçbir zaman bunun yüzünden beklemez/kırılmaz.
 */
export const loadOfficeBroadcastState = cache(async (): Promise<OfficeBroadcastState> => {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("office_broadcast_state");
    if (error || !data || typeof data !== "object") return { banners: [], changelogUnread: 0 };
    const d = data as { banners?: unknown; changelog_unread?: unknown };
    const banners = Array.isArray(d.banners) ? (d.banners as OfficeBanner[]) : [];
    const unread = typeof d.changelog_unread === "number" ? d.changelog_unread : 0;
    return { banners, changelogUnread: unread };
  } catch {
    return { banners: [], changelogUnread: 0 };
  }
});
