import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { clientIpFromHeaders, opaqueRateLimitPart } from "@/lib/public-request-security";
import { isSameOrigin } from "@/lib/measure/beacon";
import { platformQuotaGateOpen } from "@/lib/ai/platform-quota";
import { log } from "@/lib/log";
import { errorFields } from "@/lib/log-error";
import { getKnowledgeBase } from "@/lib/ai/zeka/knowledge/store";
import { answerLocalPublic, publicTool, PUBLIC_RULES, ZEKA_PUBLIC_TOOL_DEFS } from "@/lib/ai/zeka/surfaces/public";
import { serveSurface } from "@/lib/ai/zeka/surfaces/serve";
import { ZEKA_MAX_QUERY } from "@/lib/ai/zeka/types";
import { sanitizeHistory, sanitizePage } from "@/lib/ai/zeka/context";
import { ZEKA_DAILY_LIMIT_MESSAGE } from "@/lib/ai/zeka/policy";

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * POST /api/zeka/genel {q, mode} — platform sitesi (ilk ziyaret sayfaları) "EmlakSoft'a sor". Oturumsuz; YALNIZ herkese
 * açık ürün içeriği (paket/fiyat, özellik, yardım, KVKK). Kiracı verisi yok. Bot koruması: aynı köken + tarayıcı kimliği
 * zorunlu; IP başına hız sınırı (öneri 60/dk, yanıt 20/10 dk; altyapı yoksa REDDEDER). GPT kipinde platform AI kotası
 * (`zeka.public`, platform_settings) uygulanır; kiracı kredisi kullanılmaz.
 */
export async function POST(req: Request) {
  if (!isSameOrigin(req.headers) || !req.headers.get("user-agent")) return json({ error: "İzin verilmeyen istek." }, 403);
  let body: { q?: unknown; mode?: unknown; history?: unknown; page?: unknown };
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

  const ip = opaqueRateLimitPart(clientIpFromHeaders(req.headers));
  const rl =
    mode === "suggest"
      ? await checkRateLimit(`zeka-public-suggest:${ip}`, { limit: 60, windowSec: 60, failurePolicy: "deny" })
      : await checkRateLimit(`zeka-public:${ip}`, { limit: 20, windowSec: 600, failurePolicy: "deny" });
  if (!rl.allowed) return json({ error: "Çok fazla soru gönderildi; biraz sonra tekrar deneyin." }, 429);

  try {
    const kb = await getKnowledgeBase("public");
    const env = { kb };
    const result = await serveSurface(q, mode, {
      surface: "public",
      local: () => answerLocalPublic(q, env),
      tools: ZEKA_PUBLIC_TOOL_DEFS,
      runTool: (name, args) => publicTool(env, name, args),
      rules: PUBLIC_RULES,
      audit: { platform: true, purpose: "zeka.public", actorId: null },
      quotaOpen: () => platformQuotaGateOpen("zeka.public"),
      defaultIntent: "howto",
      history: sanitizeHistory(body.history),
      page: sanitizePage(body.page),
      limitKeys: { user: ip },
    }, req.signal);
    if ("disabled" in result) return json({ error: "Asistan şu an kapalı." }, 404);
    if ("limited" in result) return json({ error: ZEKA_DAILY_LIMIT_MESSAGE }, 429);
    return json(result);
  } catch (error) {
    log.error("zeka_public_failed", { route: "/api/zeka/genel", ...errorFields(error) });
    return json({ error: "Asistan şu an yanıt veremedi." }, 500);
  }
}
