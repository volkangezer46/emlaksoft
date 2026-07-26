import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_IDS = 60;

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

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
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

  const admin = createAdminClient();
  const { data: tenant } = await admin.from("tenants").select("id").eq("slug", slug).maybeSingle();
  if (!tenant) return NextResponse.json({ error: "Ofis bulunamadı." }, { status: 404 });

  // Tenant doğrulaması sorguda: başka ofisin id'si istense bile satır dönmez.
  const { data: props } = await admin
    .from("properties")
    .select(
      "id, title, property_code, transaction_type, list_price, features, province:geo_provinces(name), district:geo_districts(name)",
    )
    .eq("tenant_id", tenant.id)
    .eq("status", "live")
    .is("deleted_at", null)
    .in("id", ids);

  const rows = props ?? [];
  const coverMap = new Map<string, string>();
  if (rows.length) {
    const { data: media } = await admin
      .from("property_media")
      .select("id, property_id, is_cover, sort_order")
      .eq("kind", "image")
      .in("property_id", rows.map((p) => p.id))
      .order("is_cover", { ascending: false })
      .order("sort_order", { ascending: true });
    for (const m of media ?? []) {
      if (!coverMap.has(m.property_id)) coverMap.set(m.property_id, m.id);
    }
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
}
