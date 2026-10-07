"use server";

import { revalidatePath } from "next/cache";
import { guardPlatformAction } from "@/lib/platform-guards";
import { logPlatformActivity } from "@/lib/platform-activity";
import { getPlatformSetting, setPlatformSetting } from "@/lib/platform-settings";
import {
  EF_WHOLESALE_SETTING_KEY,
  parseEfWholesale,
  parseWholesaleTl,
  serializeEfWholesale,
} from "@/lib/accounting/ef-economics";
import { actionErrorMessage } from "@/lib/action-errors";

export type AccountingOpResult = { ok?: boolean; error?: string; notice?: string };

/**
 * EmlakFiyati toptan maliyeti (işlem başı TL, KDV hariç). YALNIZ süper admin; denetim kaydı yazılır.
 * Sıfır geçerlidir (EmlakFiyati kullanım tarifesi 0 TL iken varsayılan budur).
 */
export async function saveEfWholesale(formData: FormData): Promise<AccountingOpResult> {
  const g = await guardPlatformAction({
    module: "billing",
    roles: ["super_admin"],
    rate: { key: "acct:ef-wholesale", limit: 20, windowSec: 600 },
  });
  if ("error" in g) return { error: g.error };

  const valuationTl = parseWholesaleTl(String(formData.get("valuation_tl") ?? ""));
  const pdfTl = parseWholesaleTl(String(formData.get("pdf_tl") ?? ""));
  if (valuationTl === null || pdfTl === null) {
    return { error: "Tutarlar geçersiz: 0 veya pozitif, en fazla 4 ondalık (örn. 0 ya da 1,25)." };
  }

  const before = parseEfWholesale(await getPlatformSetting(EF_WHOLESALE_SETTING_KEY));
  const next = { valuationTl, pdfTl };
  if (before.valuationTl === next.valuationTl && before.pdfTl === next.pdfTl) {
    return { ok: true, notice: "Değişiklik yok." };
  }

  const ok = await setPlatformSetting(EF_WHOLESALE_SETTING_KEY, serializeEfWholesale(next), g.staff.id);
  if (!ok) return { error: actionErrorMessage(null, "Maliyet kaydedilemedi.") };

  await logPlatformActivity({
    actorId: g.staff.id,
    action: "accounting.ef_wholesale.update",
    entityType: "platform_setting",
    entityId: EF_WHOLESALE_SETTING_KEY,
    meta: { before, after: next },
  });
  revalidatePath("/admin/muhasebe");
  revalidatePath("/admin/ef-kontor");
  return { ok: true, notice: "Toptan maliyet kaydedildi." };
}
