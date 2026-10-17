import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { clientIpFromHeaders, opaqueRateLimitPart } from "@/lib/public-request-security";
import { recordZekaFeedback } from "@/lib/ai/zeka/log";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/zeka/geri-bildirim {id, vote: 1 | -1} — Zeka yanıtına 👍/👎 (öğrenme döngüsü). Kural RPC'de: satır başına bir
 * kez, 24 saat içinde; ofis satırına yalnız soran kullanıcı oy verir. IP başına hız sınırı (altyapı yoksa REDDEDER).
 */
export async function POST(req: Request) {
  let body: { id?: unknown; vote?: unknown };
  try {
    const text = await req.text();
    if (text.length > 500) return NextResponse.json({ ok: false }, { status: 413 });
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const id = typeof body.id === "string" && UUID_RE.test(body.id) ? body.id : "";
  const vote = body.vote === 1 || body.vote === -1 ? body.vote : 0;
  if (!id || !vote) return NextResponse.json({ ok: false }, { status: 400 });
  const ip = opaqueRateLimitPart(clientIpFromHeaders(req.headers));
  const rl = await checkRateLimit(`zeka-feedback:${ip}`, { limit: 30, windowSec: 600, failurePolicy: "deny" });
  if (!rl.allowed) return NextResponse.json({ ok: false }, { status: 429 });
  const ok = await recordZekaFeedback(id, vote);
  return NextResponse.json({ ok }, { headers: { "Cache-Control": "no-store" } });
}
