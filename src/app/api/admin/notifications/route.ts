import { NextResponse } from "next/server";
import { getPlatformStaff } from "@/lib/platform";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { recordRpcOutcome, rpcKnownMissing } from "@/lib/supabase/rpc-probe";

const FEED_RPC = "platform_notification_feed";
const LIMIT = 15;

type FeedItem = { id: string; title: string; body: string | null; href: string | null; kind: string; read_at: string | null; created_at: string };
type Feed = { items: FeedItem[]; unread: number };

function parseFeed(data: unknown): Feed | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const d = data as { items?: unknown; unread?: unknown };
  if (!Array.isArray(d.items) || typeof d.unread !== "number") return null;
  return { items: d.items as FeedItem[], unread: d.unread };
}

/**
 * Tek tur: personelin KENDİ oturum istemcisiyle (RLS: staff_id = auth.uid(); service_role yok). Fonksiyon yoksa
 * (migration öncesi) ya da hata/bozuk yanıtta null → çağıran eski iki sorguya düşer.
 */
async function readFeedRpc(): Promise<Feed | null> {
  if (rpcKnownMissing(FEED_RPC)) return null;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc(FEED_RPC, { p_limit: LIMIT });
    recordRpcOutcome(FEED_RPC, error);
    return error ? null : parseFeed(data);
  } catch {
    return null;
  }
}

/**
 * Topbar bildirim zili — mevcut personelin son bildirimleri + okunmamış sayısı.
 *
 * SK1/B040: kimlik proxy'nin yerel doğrulamasından (imzalı başlık; Auth sunucusuna tur YOK, bkz. verified-request.ts);
 * veri TEK sorgu (`platform_notification_feed`). Fonksiyon yoksa eski iki paralel service_role sorgusuna düşülür.
 */
export async function GET() {
  const staff = await getPlatformStaff();
  if (!staff) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const feed = await readFeedRpc();
  if (feed) return NextResponse.json(feed);

  const admin = createAdminClient();
  const [{ data: items }, { count }] = await Promise.all([
    admin
      .from("platform_notifications")
      .select("id, title, body, href, kind, read_at, created_at")
      .eq("staff_id", staff.id)
      .order("created_at", { ascending: false })
      .limit(LIMIT),
    admin
      .from("platform_notifications")
      .select("id", { count: "exact", head: true })
      .eq("staff_id", staff.id)
      .is("read_at", null),
  ]);

  return NextResponse.json({ items: items ?? [], unread: count ?? 0 });
}
