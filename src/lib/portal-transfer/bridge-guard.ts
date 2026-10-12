import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/supabase/auth-cache";
import { checkRateLimit } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/require-permission";
import { isSameOriginBridgeRequest } from "@/lib/listing-control/worker/bridge-request";

/**
 * Portal aktarım uçlarının ORTAK kapısı (eklentinin içerik betiği EmlakSoft sayfasında kullanıcının açık oturumuyla çağırır):
 * aynı köken + özel başlık (CSRF) → oturum → hız sınırı (deny) → `requirePermission`. Sırası `portfoy-avi/kaydet` ile aynıdır.
 */
export const NO_STORE = { "Cache-Control": "no-store, max-age=0" } as const;

export type Gate = Extract<Awaited<ReturnType<typeof requirePermission>>, { ok: true }>;

export async function guardBridgeRequest(
  request: Request,
  opts: { rateKey: string; limit: number; permissions: readonly (readonly ["portals" | "properties", "view" | "create" | "edit"])[] },
): Promise<{ ok: true; userId: string; gate: Gate } | { ok: false; response: NextResponse }> {
  const fail = (error: string, status: number, extra?: Record<string, string>) =>
    ({ ok: false as const, response: NextResponse.json({ ok: false, error }, { status, headers: { ...NO_STORE, ...extra } }) });
  if (!isSameOriginBridgeRequest(request)) return fail("origin", 403);
  const user = await getRequestUser();
  if (!user) return fail("session", 401);
  const limit = await checkRateLimit(`${opts.rateKey}:${user.id}`, { limit: opts.limit, windowSec: 60, failurePolicy: "deny" });
  if (!limit.allowed) return fail("rate_limited", 429, { "Retry-After": "60" });
  let first: Gate | null = null;
  for (const [mod, action] of opts.permissions) {
    const gate = await requirePermission(mod, action);
    if (!gate.ok) return fail("forbidden", 403);
    first ??= gate;
  }
  if (!first) return fail("forbidden", 403);
  return { ok: true, userId: user.id, gate: first };
}
