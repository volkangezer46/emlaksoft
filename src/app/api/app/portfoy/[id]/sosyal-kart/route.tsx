import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { checkRateLimit } from "@/lib/rate-limit";
import { SOCIAL_LINK_REQUIRED_MESSAGE, isSocialCardFormat, pickListingLink } from "@/lib/social-card/core";
import { loadCoverDataUrl, loadSocialCardData } from "@/lib/social-card/load";
import { renderSocialCard } from "@/lib/social-card/render";
import { formatTryAmount } from "@/lib/format";

export const dynamic = "force-dynamic";

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * GET /api/app/portfoy/[id]/sosyal-kart?bicim=kare|hikaye&ilan=<portal_listing_id>[&indir=1]
 * Oturumlu; yetki properties/view; veri RLS'li istemciyle. EİDS doğrulamalı (yayındaki portal ilanı) bağlantı yoksa
 * görsel ÜRETİLMEZ (422). Yanıt önbelleğe alınmaz (kişisel ofis verisi).
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return jsonError("Portföy bulunamadı.", 404);

  const gate = await requirePermission("properties", "view");
  if (!gate.ok) return jsonError(gate.error, gate.error === "Oturum bulunamadı." ? 401 : 403);

  const limit = await checkRateLimit(`social-card:${gate.userId}`, { limit: 60, windowSec: 10 * 60, failurePolicy: "deny" });
  if (!limit.allowed) return jsonError("Çok fazla kart isteği. Birkaç dakika sonra tekrar deneyin.", 429);

  const url = new URL(req.url);
  const formatRaw = url.searchParams.get("bicim") ?? "kare";
  const format = isSocialCardFormat(formatRaw) ? formatRaw : "kare";

  const db = await createClient();
  const data = await loadSocialCardData(db, gate.tenantId, id);
  if (!data) return jsonError("Portföy bulunamadı.", 404);

  const link = pickListingLink(data.listings, url.searchParams.get("ilan"));
  if (!link?.portalUrl) return jsonError(SOCIAL_LINK_REQUIRED_MESSAGE, 422);

  const p = data.property;
  const tx = (p.transactionType ?? "").toLowerCase();
  const rent = tx === "rent" || tx.includes("kira");
  const price =
    p.listPrice != null && p.listPrice > 0
      ? `${formatTryAmount(p.listPrice)}${rent ? "/ay" : ""}`
      : null;

  const image = await renderSocialCard({
    format,
    coverDataUrl: await loadCoverDataUrl(db, gate.tenantId, id),
    badge: rent ? "Kiralık" : "Satılık",
    title: p.title || p.code || "Portföy",
    location: [p.district, p.province].filter(Boolean).join(", ") || null,
    price,
    specs: [p.rooms, p.sqm ? `${p.sqm} m²` : null].filter(Boolean) as string[],
    officeName: data.office.name,
    logoUrl: data.office.logoUrl,
    brandColor: data.office.brandColor,
    licenseNo: data.office.licenseNo,
    eidsNo: data.eidsNo,
    listingUrl: link.portalUrl,
  });

  const headers = new Headers(image.headers);
  headers.set("Cache-Control", "no-store, private");
  headers.set("X-Content-Type-Options", "nosniff");
  if (url.searchParams.get("indir") === "1") {
    const safeCode = (p.code ?? "portfoy").replace(/[^A-Za-z0-9-]/g, "") || "portfoy";
    headers.set("Content-Disposition", `attachment; filename="sosyal-kart-${safeCode}-${format}.png"`);
  }
  return new Response(image.body, { status: 200, headers });
}
