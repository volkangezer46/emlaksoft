import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { clientIpFromHeaders, opaqueRateLimitPart } from "@/lib/public-request-security";
import { isSameOrigin } from "@/lib/measure/beacon";
import { canAutoCallAi } from "@/lib/ai/auto-call-gate";
import { loadNlProvincesAndDistricts } from "@/lib/nl-search/geo-source";
import { now } from "@/lib/clock";
import { log } from "@/lib/log";
import { errorFields } from "@/lib/log-error";
import { answerLocalVitrin, vitrinRules, vitrinSearch, ZEKA_VITRIN_TOOL_DEFS, type VitrinEnv } from "@/lib/ai/zeka/surfaces/vitrin";
import { countVitrinListings, resolveVitrinOffice } from "@/lib/ai/zeka/surfaces/vitrin-server";
import { serveSurface } from "@/lib/ai/zeka/surfaces/serve";
import { ZEKA_MAX_QUERY } from "@/lib/ai/zeka/types";
import { buildCarry, isFollowUp, sanitizeHistory, sanitizePage, stripFollowParticles } from "@/lib/ai/zeka/context";
import { extractSlots } from "@/lib/ai/zeka/slots";
import { ZEKA_DAILY_LIMIT_MESSAGE } from "@/lib/ai/zeka/policy";

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * POST /api/zeka/vitrin {q, mode, slug} — ofis vitrininde doğal dille ilan arama. Oturumsuz; YALNIZ o ofisin yayındaki
 * ilanları. Talep bırakma vitrindeki mevcut formla ve ziyaretçinin kendi onayıyla (Zeka göndermez). Bot koruması: aynı
 * köken + tarayıcı kimliği; IP + ofis başına hız sınırı (altyapı yoksa REDDEDER). GPT yalnız ofisin vitrin sohbet
 * asistanı ayarı açık ve AI kredisi varken; ölçüm ofis kredisinden.
 */
export async function POST(req: Request) {
  if (!isSameOrigin(req.headers) || !req.headers.get("user-agent")) return json({ error: "İzin verilmeyen istek." }, 403);
  let body: { q?: unknown; mode?: unknown; slug?: unknown; history?: unknown; page?: unknown };
  try {
    const text = await req.text();
    if (text.length > 4_000) return json({ error: "İstek çok büyük." }, 413);
    body = JSON.parse(text);
  } catch {
    return json({ error: "Geçersiz istek." }, 400);
  }
  const q = typeof body.q === "string" ? body.q.trim() : "";
  const slug = typeof body.slug === "string" ? body.slug.trim().toLowerCase().slice(0, 120) : "";
  const mode = body.mode === "suggest" ? "suggest" : "answer";
  if (!slug || q.length < 2) return json({ error: "En az 2 karakter yazın." }, 400);
  if (q.length > ZEKA_MAX_QUERY) return json({ error: `En çok ${ZEKA_MAX_QUERY} karakter yazabilirsiniz.` }, 400);

  const ip = opaqueRateLimitPart(clientIpFromHeaders(req.headers));
  const [perIp, perOffice] = await Promise.all([
    checkRateLimit(mode === "suggest" ? `zeka-vitrin-suggest:${ip}` : `zeka-vitrin:${ip}`, { limit: mode === "suggest" ? 60 : 30, windowSec: mode === "suggest" ? 60 : 600, failurePolicy: "deny" }),
    checkRateLimit(`zeka-vitrin-office:${slug}`, { limit: 600, windowSec: 3600, failurePolicy: "deny" }),
  ]);
  if (!perIp.allowed || !perOffice.allowed) return json({ error: "Çok fazla istek gönderildi; lütfen biraz sonra tekrar deneyin." }, 429);

  try {
    const office = await resolveVitrinOffice(slug);
    if (!office) return json({ error: "Vitrin bulunamadı." }, 404);
    const geo = await loadNlProvincesAndDistricts().catch(() => undefined);
    const history = sanitizeHistory(body.history);
    const nowMs = now();
    const carry = history.length ? buildCarry(history, { nowMs, geo }) : null;
    const env: VitrinEnv = { slug: office.slug, office: office.name, geo, nowMs, carry: carry && isFollowUp(q, extractSlots(stripFollowParticles(q), { nowMs, geo })) ? carry : null, count: (f) => (mode === "suggest" ? Promise.resolve(null) : countVitrinListings(office.tenantId, f)) };
    const result = await serveSurface(q, mode, {
      surface: "vitrin",
      local: () => answerLocalVitrin(q, env),
      tools: ZEKA_VITRIN_TOOL_DEFS,
      runTool: (name, args) => {
        const query = args && typeof args === "object" && typeof (args as { query?: unknown }).query === "string" ? (args as { query: string }).query.slice(0, 300) : "";
        return name === "search_listings" && query ? vitrinSearch(env, query) : null;
      },
      rules: vitrinRules(office.name),
      audit: { tenantId: office.tenantId, actorId: null },
      quotaOpen: async () => office.aiChat && (await canAutoCallAi(office.tenantId)),
      tenantId: office.tenantId,
      defaultIntent: "search",
      history,
      page: sanitizePage(body.page),
      limitKeys: { user: ip, office: office.tenantId },
    }, req.signal);
    if ("disabled" in result) return json({ error: "Asistan şu an kapalı." }, 404);
    if ("limited" in result) return json({ error: ZEKA_DAILY_LIMIT_MESSAGE }, 429);
    return json(result);
  } catch (error) {
    log.error("zeka_vitrin_failed", { route: "/api/zeka/vitrin", ...errorFields(error) });
    return json({ error: "Asistan şu an yanıt veremedi." }, 500);
  }
}
