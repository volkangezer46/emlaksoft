"use server";

import { requirePermission } from "@/lib/require-permission";
import { getTapusorParcelInsight, isTapusorConfiguredFull, type TapusorParcelInsight } from "@/lib/integrations/tapusor";

export type TapuInquiryResult =
  | { ok: true; configured: true; insight: TapusorParcelInsight }
  | { ok: true; configured: false }
  | { ok: false; error: string };

/**
 * TAKBİS/Tapusor ada-parsel sorgusu — danışman portföy detayından çağırır.
 * Anahtar yoksa "configured: false" döner (UI kurulum yönlendirmesi gösterir).
 */
export async function queryTapuInsight(input: {
  provinceName: string;
  districtName?: string | null;
  neighborhoodName?: string | null;
  ada?: string | null;
  parsel?: string | null;
}): Promise<TapuInquiryResult> {
  const gate = await requirePermission("valuation", "view");
  if (!gate.ok) return { ok: false, error: gate.error };

  if (!input.provinceName?.trim()) return { ok: false, error: "İl bilgisi zorunludur." };

  if (!(await isTapusorConfiguredFull())) {
    return { ok: true, configured: false };
  }

  try {
    const insight = await getTapusorParcelInsight(input);
    return { ok: true, configured: true, insight };
  } catch (e) {
    console.error("queryTapuInsight", e);
    return { ok: false, error: "Tapu sorgusu yapılamadı. Anahtarı/erişimi kontrol edin." };
  }
}
