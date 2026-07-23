"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { generateContent, type ContentKind } from "@/lib/ai/content";

export type AiContentResult = { text?: string; source?: "ai" | "template"; error?: string };

const KINDS: ContentKind[] = ["listing", "whatsapp", "social", "email"];

export async function generatePropertyContent(propertyId: string, kind: ContentKind): Promise<AiContentResult> {
  const gate = await requirePermission("properties", "view");
  if (!gate.ok) return { error: gate.error };
  if (!KINDS.includes(kind)) return { error: "Geçersiz içerik türü." };

  const supabase = await createClient();
  const { data: property } = await supabase
    .from("properties")
    .select(
      "title, transaction_type, property_type, list_price, address_line, features, assigned_to:profiles(full_name, phone), province:geo_provinces(name), district:geo_districts(name)",
    )
    .eq("id", propertyId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();

  if (!property) return { error: "Portföy bulunamadı." };

  const { data: tenant } = await supabase
    .from("tenants")
    .select("name")
    .eq("id", gate.tenantId)
    .maybeSingle();

  const rel = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
  const agent = rel(property.assigned_to as { full_name?: string; phone?: string } | { full_name?: string; phone?: string }[] | null);
  const province = rel(property.province as { name?: string } | { name?: string }[] | null);
  const district = rel(property.district as { name?: string } | { name?: string }[] | null);
  const features = (property.features ?? {}) as { rooms?: string | null; sqm?: number | null };

  const { text, source } = await generateContent(kind, {
    title: property.title,
    transactionType: property.transaction_type,
    propertyType: property.property_type,
    listPrice: property.list_price != null ? Number(property.list_price) : null,
    rooms: features.rooms ?? null,
    sqm: features.sqm != null ? Number(features.sqm) : null,
    province: province?.name ?? null,
    district: district?.name ?? null,
    address: property.address_line,
    officeName: tenant?.name ?? null,
    agentName: agent?.full_name ?? null,
    agentPhone: agent?.phone ?? null,
    features,
  });

  return { text, source };
}
