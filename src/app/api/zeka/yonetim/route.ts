import { NextResponse } from "next/server";
import { getPlatformStaff } from "@/lib/platform";
import { platformCanAccess, platformModulesFor } from "@/lib/platform-access";
import { adminPaletteFor } from "@/lib/admin/nav";
import { buildAdvisorContext } from "@/lib/ai-advisor";
import { platformQuotaGateOpen } from "@/lib/ai/platform-quota";
import { checkRateLimit } from "@/lib/rate-limit";
import { log } from "@/lib/log";
import { errorFields } from "@/lib/log-error";
import { getKnowledgeBase } from "@/lib/ai/zeka/knowledge/store";
import { ADMIN_RULES, adminMetricTool, adminNavTool, answerLocalAdmin, ZEKA_ADMIN_TOOL_DEFS, type AdminEnv } from "@/lib/ai/zeka/surfaces/admin";
import { serveSurface } from "@/lib/ai/zeka/surfaces/serve";
import { ZEKA_MAX_QUERY } from "@/lib/ai/zeka/types";

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * POST /api/zeka/yonetim {q, mode} — yönetim paneli Zeka'sı (komut çubuğu + palet). Yalnız platform personeli; SALT
 * OKUNUR. Platform sayıları yalnız `advisor` modülünü görene; sayfa önerileri personelin görebildiği menüden. Hız sınırı
 * personel başına (altyapı yoksa REDDEDER). GPT kipinde platform AI kotası (`zeka.admin`); kiracı kredisi kullanılmaz.
 */
export async function POST(req: Request) {
  let body: { q?: unknown; mode?: unknown };
  try {
    const text = await req.text();
    if (text.length > 2_000) return json({ error: "İstek çok büyük." }, 413);
    body = JSON.parse(text);
  } catch {
    return json({ error: "Geçersiz istek." }, 400);
  }
  const q = typeof body.q === "string" ? body.q.trim() : "";
  const mode = body.mode === "suggest" ? "suggest" : "answer";
  if (q.length < 2) return json({ error: "En az 2 karakter yazın." }, 400);
  if (q.length > ZEKA_MAX_QUERY) return json({ error: `En çok ${ZEKA_MAX_QUERY} karakter yazabilirsiniz.` }, 400);

  const staff = await getPlatformStaff();
  if (!staff) return json({ error: "Oturum bulunamadı. Lütfen tekrar giriş yapın." }, 401);
  const rl = await checkRateLimit(mode === "suggest" ? `zeka-admin-suggest:${staff.id}` : `zeka-admin:${staff.id}`, { limit: mode === "suggest" ? 90 : 20, windowSec: 60, failurePolicy: "deny" });
  if (!rl.allowed) return json({ error: "Çok fazla istek gönderildi. Lütfen biraz sonra tekrar deneyin." }, 429);

  try {
    const kb = await getKnowledgeBase("admin");
    const links = adminPaletteFor(platformModulesFor(staff)).map((l) => ({ href: l.href, label: l.label, description: l.description }));
    let ctxP: ReturnType<typeof buildAdvisorContext> | null = null;
    const env: AdminEnv = {
      kb,
      links,
      context: platformCanAccess(staff, "advisor") ? () => (ctxP ??= buildAdvisorContext().catch(() => null as never)) : null,
    };
    const result = await serveSurface(q, mode, {
      surface: "admin",
      local: () => (mode === "suggest" ? answerLocalAdmin(q, { ...env, context: null }) : answerLocalAdmin(q, env)),
      tools: ZEKA_ADMIN_TOOL_DEFS,
      runTool: async (name, args) => {
        const query = args && typeof args === "object" && typeof (args as { query?: unknown }).query === "string" ? (args as { query: string }).query.slice(0, 300) : "";
        if (!query) return null;
        if (name === "platform_summary") return adminMetricTool(env, query);
        if (name === "navigate") return adminNavTool(env, query);
        return null;
      },
      rules: ADMIN_RULES,
      audit: { platform: true, purpose: "zeka.admin", actorId: staff.id },
      quotaOpen: () => platformQuotaGateOpen("zeka.admin"),
      defaultIntent: "navigate",
    }, req.signal);
    if ("disabled" in result) return json({ error: "Zeka yönetim panelinde kapalı." }, 404);
    return json(result);
  } catch (error) {
    log.error("zeka_admin_failed", { route: "/api/zeka/yonetim", ...errorFields(error) });
    return json({ error: "Zeka şu an yanıt veremedi." }, 500);
  }
}
