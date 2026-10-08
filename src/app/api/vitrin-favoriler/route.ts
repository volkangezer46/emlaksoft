import { NextRequest, NextResponse } from "next/server";
import { OPEN_LISTING_OR_FILTER } from "@/lib/closed-listing";
import { createAdminClient } from "@/lib/supabase/admin";
import { isVitrinEnabled } from "@/lib/vitrin-settings";
import { isPublicTenantActive } from "@/lib/public-tenant";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  PUBLIC_COVER_COLUMNS,
  firstPublicImageByProperty,
  selectWithDocumentFlag,
  type PublicCoverCandidate,
} from "@/lib/public-property-media";
import {
  clientIpFromHeaders,
  readRequestBodyLimited,
  requestBodyTooLarge,
} from "@/lib/public-request-security";

/**
 * Vitrin favorileri çözümleme ucu (public, oturumsuz).
 *
 * /vitrin/[slug]/favoriler sayfası localStorage'daki ilan id listesini POST'lar;
 * yanıt YALNIZCA o tenant'ın YAYINDAKİ ilanlarının kart DTO'sudur. Maskeleme:
 * vitrin kartında zaten görünen alanlardan fazlası dönmez (adres satırı,
 * koordinat, iç notlar vb. YOK). Yayından kalkan/silinen id'ler sessizce düşer —
 * client tarafı bunları "yayında değil" diye ayrıştırabilir.
 */

type Body = { slug?: unknown; ids?: unknown };
type DatabaseOperation = "client_init" | "tenant_lookup" | "property_lookup" | "media_lookup";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_IDS = 60;
export const VITRIN_FAVORITES_MAX_BYTES = 8 * 1024;

type Rel = { name?: string } | { name?: string }[] | null;
function relName(v: Rel) {
  if (!v) return null;
  const r = Array.isArray(v) ? v[0] : v;
  return r?.name ?? null;
}

export type VitrinFavItem = {
  id: string;
  title: string;
  transactionType: string | null;
  price: number | null;
  rooms: string | null;
  sqm: number | null;
  district: string | null;
  province: string | null;
  coverId: string | null;
};

function isBody(value: unknown): value is Body {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function databaseUnavailable(operation: DatabaseOperation, error?: unknown) {
  const rawCode =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : "unknown";
  const code = /^[a-z0-9_]{1,32}$/i.test(rawCode) ? rawCode : "unknown";
  // Never log provider messages, query values, tenant slugs, IPs or property IDs.
  console.error("vitrin favorites database unavailable", { operation, code });
  return NextResponse.json(
    { error: "Hizmet geçici olarak kullanılamıyor. Lütfen daha sonra tekrar deneyin." },
    { status: 503 },
  );
}

export async function POST(req: NextRequest) {
  if (requestBodyTooLarge(req.headers, VITRIN_FAVORITES_MAX_BYTES)) {
    return NextResponse.json({ error: "İstek gövdesi çok büyük." }, { status: 413 });
  }

  let body: Body;
  try {
    const bytes = await readRequestBodyLimited(req, VITRIN_FAVORITES_MAX_BYTES);
    if (bytes === null) {
      return NextResponse.json({ error: "İstek gövdesi çok büyük." }, { status: 413 });
    }
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!isBody(parsed)) {
      return NextResponse.json({ error: "Geçersiz istek." }, { status: 400 });
    }
    body = parsed;
  } catch {
    return NextResponse.json({ error: "Geçersiz istek." }, { status: 400 });
  }

  const slug = typeof body.slug === "string" ? body.slug.trim() : "";
  const rawIds = Array.isArray(body.ids) ? body.ids : [];
  const ids = [...new Set(rawIds.filter((x): x is string => typeof x === "string" && UUID_RE.test(x)))].slice(
    0,
    MAX_IDS,
  );

  if (!slug || slug.length > 80) return NextResponse.json({ error: "Geçersiz istek." }, { status: 400 });
  if (ids.length === 0) return NextResponse.json({ items: [] });

  const ip = clientIpFromHeaders(req.headers);
  const { allowed } = await checkRateLimit(`vitrin-favoriler:${ip}`, {
    limit: 60,
    windowSec: 60,
    failurePolicy: "deny",
  });
  if (!allowed) {
    return NextResponse.json(
      { error: "Çok fazla istek. Lütfen kısa süre sonra tekrar deneyin." },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  let operation: DatabaseOperation = "client_init";
  try {
    const admin = createAdminClient();
    operation = "tenant_lookup";
    const { data: tenant, error: tenantError } = await admin
      .from("tenants")
      .select("id, status")
      .eq("slug", slug)
      .maybeSingle();
    if (tenantError) return databaseUnavailable(operation, tenantError);
    if (!tenant || !isPublicTenantActive(tenant.status) || !(await isVitrinEnabled(admin, tenant.id))) {
      return NextResponse.json({ error: "Ofis bulunamadı." }, { status: 404 });
    }

    // Tenant doğrulaması sorguda: başka ofisin id'si istense bile satır dönmez.
    operation = "property_lookup";
    const { data: props, error: propertiesError } = await admin
      .from("properties")
      .select(
        "id, title, property_code, transaction_type, list_price, features, province:geo_provinces(name), district:geo_districts(name)",
      )
      .eq("tenant_id", tenant.id)
      .eq("status", "live")
      .eq("is_sample", false)
      .or(OPEN_LISTING_OR_FILTER)
      .is("deleted_at", null)
      .in("id", ids);
    if (propertiesError) return databaseUnavailable(operation, propertiesError);

    const rows = props ?? [];
    let coverMap = new Map<string, string>();
    if (rows.length) {
      operation = "media_lookup";
      // KVKK P0-9: kapak belge olamaz (is_document; sütun yoksa ad kuralı) -> ilk public görsel.
      const { data: media, error: mediaError } = await selectWithDocumentFlag<PublicCoverCandidate[]>(
        PUBLIC_COVER_COLUMNS,
        (columns) =>
          admin
            .from("property_media")
            .select(columns)
            .eq("kind", "image")
            .in("property_id", rows.map((p) => p.id))
            .order("is_cover", { ascending: false })
            .order("sort_order", { ascending: true }),
      );
      if (mediaError) return databaseUnavailable(operation, mediaError);
      coverMap = firstPublicImageByProperty(media);
    }

    // İstenen sıra korunur (ziyaretçinin favori ekleme sırası)
    const byId = new Map(rows.map((p) => [p.id, p]));
    const items: VitrinFavItem[] = [];
    for (const id of ids) {
      const p = byId.get(id);
      if (!p) continue;
      const feat = (p.features ?? {}) as { rooms?: string; sqm?: number };
      items.push({
        id: p.id,
        title: p.title || p.property_code,
        transactionType: p.transaction_type,
        price: p.list_price != null ? Number(p.list_price) : null,
        rooms: feat.rooms ?? null,
        sqm: feat.sqm ?? null,
        district: relName(p.district as Rel),
        province: relName(p.province as Rel),
        coverId: coverMap.get(p.id) ?? null,
      });
    }

    return NextResponse.json({ items });
  } catch {
    return databaseUnavailable(operation);
  }
}
