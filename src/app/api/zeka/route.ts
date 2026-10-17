import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/require-permission";
import { getEffectivePermissions, immutableReadonlyPermissions } from "@/lib/permissions-effective";
import { getClosedFeatures } from "@/lib/modules/state";
import { checkRateLimit } from "@/lib/rate-limit";
import { log } from "@/lib/log";
import { errorFields } from "@/lib/log-error";
import { answerApp } from "@/lib/ai/zeka/app";
import { makeScope } from "@/lib/ai/zeka/scope";
import { ZEKA_MAX_QUERY } from "@/lib/ai/zeka/types";

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * POST /api/zeka {q, mode: "suggest" | "answer"} — ofis paneli Zeka'sı (ana ekran komut çubuğu + komut paleti).
 * Kapı: aktif ofis + oturum (`requirePermission("dashboard","view")`); destek oturumu salt okunur izinle. Hız sınırı
 * kullanıcı başına (öneri 90/dk, yanıt 20/dk; altyapı yoksa REDDEDER). Girdi en çok 300 karakter. Zeka hiçbir iş kaydı
 * YAZMAZ; yalnız kişisel verisi maskelenmiş sorgu günlüğü (`zeka_log_query`) yazılır.
 */
export async function POST(req: Request) {
  let body: { q?: unknown; mode?: unknown };
  try {
    const text = await req.text();
    if (text.length > 4_000) return json({ error: "İstek çok büyük." }, 413);
    body = JSON.parse(text);
  } catch {
    return json({ error: "Geçersiz istek." }, 400);
  }
  const q = typeof body.q === "string" ? body.q.trim() : "";
  const mode = body.mode === "suggest" ? "suggest" : "answer";
  if (q.length < 2) return json({ error: "En az 2 karakter yazın." }, 400);
  if (q.length > ZEKA_MAX_QUERY) return json({ error: `En çok ${ZEKA_MAX_QUERY} karakter yazabilirsiniz.` }, 400);

  const gate = await requirePermission("dashboard", "view");
  if (!gate.ok) return json({ error: gate.error }, 403);

  const rl =
    mode === "suggest"
      ? await checkRateLimit(`zeka-suggest:${gate.userId}`, { limit: 90, windowSec: 60, failurePolicy: "deny" })
      : await checkRateLimit(`zeka:${gate.userId}`, { limit: 20, windowSec: 60, failurePolicy: "deny" });
  if (!rl.allowed) return json({ error: "Çok fazla istek gönderildi. Lütfen biraz sonra tekrar deneyin." }, 429);

  try {
    const [perms, closed] = await Promise.all([
      gate.impersonating ? Promise.resolve(immutableReadonlyPermissions()) : getEffectivePermissions(gate.tenantId, gate.role, gate.userId),
      getClosedFeatures(gate.tenantId).catch(() => []),
    ]);
    const scope = makeScope({
      userId: gate.userId,
      tenantId: gate.tenantId,
      role: gate.impersonating ? "readonly" : gate.role,
      perms,
      closed,
      locked: [],
      readOnly: gate.impersonating || gate.role === "readonly",
    });
    const result = await answerApp(q, scope, { mode, signal: req.signal });
    return json(result);
  } catch (error) {
    log.error("zeka_app_failed", { route: "/api/zeka", ...errorFields(error) });
    return json({ error: "Zeka şu an yanıt veremedi. Lütfen tekrar deneyin." }, 500);
  }
}
