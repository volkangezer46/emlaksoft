/**
 * Navigation badge cache yenileme (5 dakikada çalışır)
 * Amaç: her sayfa yüklemesinde queries yerine cache snapshot'ından oku
 */

import { NextRequest } from "next/server";
import { authorizeCron } from "@/lib/cron-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordHeartbeat } from "@/lib/cron-heartbeat";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const denied = authorizeCron(request);
  if (denied) return denied;

  const supabase = createAdminClient();

  try {
    // 1. Tüm tenant'lar + etkin kullanıcılar al (son 30 gün etkin)
    const { data: activeUsers, error: usersError } = await supabase.rpc(
      "get_active_users_for_nav_badges",
      {},
    );

    if (usersError) {
      console.error("[nav-badges] RPC call failed:", usersError);
      await recordHeartbeat("nav-badges-refresh", "error", usersError.message);
      return new Response(JSON.stringify({ error: usersError.message }), { status: 500 });
    }

    const users = (activeUsers ?? []) as Array<{ tenant_id: string; user_id: string }>;

    if (!users.length) {
      // Hiç etkin kullanıcı yok
      await recordHeartbeat("nav-badges-refresh", "ok", "no_active_users");
      return new Response(JSON.stringify({ processed: 0 }), { status: 200 });
    }

    // 2. Her (tenant, user) çiftini paralel güncelle
    const refreshPromises = users.map((u) =>
      supabase.rpc("refresh_nav_badge_snapshot", { p_tenant_id: u.tenant_id, p_user_id: u.user_id }),
    );

    const results = await Promise.allSettled(refreshPromises);
    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;

    if (failed > 0) {
      console.warn(`[nav-badges] ${failed}/${results.length} snapshot refreshes failed`);
    }

    // 3. Eski snapshot'ları temizle
    const { error: cleanError } = await supabase.rpc("cleanup_stale_nav_badges", {});
    if (cleanError) {
      console.warn("[nav-badges] cleanup failed:", cleanError);
    }

    await recordHeartbeat("nav-badges-refresh", "ok", `${succeeded}_refreshed_${failed}_failed`);
    return new Response(JSON.stringify({ processed: succeeded, failed }), { status: 200 });
  } catch (error) {
    console.error("[nav-badges] Cron failed:", error);
    await recordHeartbeat("nav-badges-refresh", "error", String(error));
    return new Response(JSON.stringify({ error: String(error) }), { status: 500 });
  }
}
