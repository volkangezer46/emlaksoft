"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { revalidatePath } from "next/cache";
import { generateContent, translateListingText, type ContentKind } from "@/lib/ai/content";
import { TRANSLATE_MAX_SOURCE_CHARS, isTranslateLang } from "@/lib/ai/translate-logic";
import { logActivity } from "@/lib/activity";
import { parsePropertyDescription, withDescription } from "@/lib/property-description";

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
      "title, transaction_type, property_type, list_price, address_line, features, assigned_to:profiles!properties_assigned_to_fkey(full_name, phone), province:geo_provinces(name), district:geo_districts(name)",
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
  }, { tenantId: gate.tenantId, actorId: gate.userId });

  return { text, source };
}

export type TranslateResult = { text?: string; error?: string };

/**
 * Üretilen/düzenlenen metni EN/DE/AR/RU'ya çevirir. Çıktı yalnız taslaktır: hiçbir kayda yazılmaz,
 * kullanıcı panelde düzenleyip kopyalar. Kişisel veri maskeleme `openAiChat` içinde yapılır.
 */
export async function translatePropertyContent(propertyId: string, text: string, lang: string): Promise<TranslateResult> {
  const gate = await requirePermission("properties", "view");
  if (!gate.ok) return { error: gate.error };
  if (!isTranslateLang(lang)) return { error: "Desteklenmeyen dil." };
  const source = (text ?? "").trim();
  if (!source) return { error: "Çevrilecek metin boş." };
  if (source.length > TRANSLATE_MAX_SOURCE_CHARS) {
    return { error: `Metin çok uzun (en fazla ${TRANSLATE_MAX_SOURCE_CHARS} karakter).` };
  }

  // Portföy bu ofise ait olmalı (tenant izolasyonu); yalnız varlık doğrulanır, veri okunmaz.
  const supabase = await createClient();
  const { data: property } = await supabase
    .from("properties")
    .select("id")
    .eq("id", propertyId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  if (!property) return { error: "Portföy bulunamadı." };

  const res = await translateListingText(source, lang, { tenantId: gate.tenantId, actorId: gate.userId });
  return res.ok ? { text: res.text } : { error: res.error };
}

export type SaveDescriptionResult = { ok?: boolean; error?: string };

/**
 * AI içerik panelinden üretilen (ve düzenlenen) ilan metnini portföyün açıklamasına yazar.
 * Düzenleme panelindeki "Açıklama" alanıyla AYNI depo ve AYNI doğrulama (lib/property-description.ts):
 * tek akış, mükerrer yazma yeri yok. Yalnız features.description değişir; diğer anahtarlar korunur.
 */
export async function savePropertyDescription(propertyId: string, text: string): Promise<SaveDescriptionResult> {
  const gate = await requirePermission("properties", "edit");
  if (!gate.ok) return { error: gate.error };
  const parsed = parsePropertyDescription(text);
  if (!parsed.ok) return { error: parsed.error };

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("properties")
    .select("features")
    .eq("id", propertyId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  if (!existing) return { error: "Portföy bulunamadı." };

  const features = withDescription((existing.features ?? {}) as Record<string, unknown>, parsed.value);
  const { error } = await supabase
    .from("properties")
    .update({ features })
    .eq("id", propertyId)
    .eq("tenant_id", gate.tenantId);
  if (error) {
    console.error("savePropertyDescription", error);
    return { error: "Açıklama kaydedilemedi. Lütfen tekrar deneyin." };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "property.description_update",
    entityType: "property",
    entityId: propertyId,
    newValue: { length: parsed.value?.length ?? 0 },
  });
  revalidatePath(`/app/portfoyler/${propertyId}`);
  revalidatePath("/vitrin/[slug]/[id]", "page");
  return { ok: true };
}
