import { NextResponse } from "next/server";
import { getPlatformStaff } from "@/lib/platform";
import { createAdminClient } from "@/lib/supabase/admin";

/** Topbar bildirim zili — mevcut personelin son bildirimleri + okunmamış sayısı. */
export async function GET() {
  const staff = await getPlatformStaff();
  if (!staff) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const [{ data: items }, { count }] = await Promise.all([
    admin
      .from("platform_notifications")
      .select("id, title, body, href, kind, read_at, created_at")
      .eq("staff_id", staff.id)
      .order("created_at", { ascending: false })
      .limit(15),
    admin
      .from("platform_notifications")
      .select("id", { count: "exact", head: true })
      .eq("staff_id", staff.id)
      .is("read_at", null),
  ]);

  return NextResponse.json({ items: items ?? [], unread: count ?? 0 });
}
