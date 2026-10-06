import { randomBytes } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getBaseUrl } from "@/lib/base-url";
import { daysFromNowIso } from "@/lib/clock";

/**
 * Portföy paylaşım bağlantısı (share_links → /paylas/<token>) — TEK yazım yolu (yalnız sunucu, çağıranın oturumlu istemcisi;
 * RLS + tenant_id). Portföy detayı "Paylaş" ve eşleştirme "Müşteriye gönder" aynı yardımcıyı kullanır. Süre 30 gün.
 */
export const SHARE_LINK_DAYS = 30;

export function shareLinkUrl(token: string): string {
  return `${getBaseUrl()}/paylas/${token}`;
}

export async function insertPropertyShareLink(
  supabase: SupabaseClient,
  p: { tenantId: string; userId: string; propertyId: string; label: string },
): Promise<{ ok: true; token: string; url: string } | { ok: false }> {
  const token = randomBytes(12).toString("hex");
  const { error } = await supabase.from("share_links").insert({
    tenant_id: p.tenantId,
    token,
    entity_type: "property",
    entity_id: p.propertyId,
    label: p.label.slice(0, 120),
    created_by: p.userId,
    expires_at: daysFromNowIso(SHARE_LINK_DAYS),
  });
  if (error) {
    console.error("insertPropertyShareLink", { code: error.code });
    return { ok: false };
  }
  return { ok: true, token, url: shareLinkUrl(token) };
}
