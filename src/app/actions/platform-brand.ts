"use server";

import { revalidatePath, updateTag } from "next/cache";
import { requirePlatformModule } from "@/lib/platform";
import { logPlatformActivity } from "@/lib/platform-activity";
import { checkRateLimit } from "@/lib/rate-limit";
import { BRAND_CACHE_TAG, resetBrandSlots, saveBrandAsset } from "@/lib/brand/store";
import { BRAND_SLOTS, isBrandSlot } from "@/lib/brand/slots";
import { checkBrandUpload } from "@/lib/brand/upload-validation";

export type BrandActionResult = { ok?: boolean; error?: string };

const HARD_FILE_LIMIT = 512 * 1024; // belleğe okumadan önce üst sınır (slot sınırları daha sıkı)

function refresh() {
  updateTag(BRAND_CACHE_TAG);
  revalidatePath("/admin/marka");
  revalidatePath("/", "layout");
}

/** Süper admin: slot'a logo/sembol/favicon yükler (SVG katı doğrulama, PNG imza + boyut kontrolü). */
export async function uploadBrandAsset(fd: FormData): Promise<BrandActionResult> {
  const staff = await requirePlatformModule("marka");

  const rl = await checkRateLimit(`brand-upload:${staff.id}`, { limit: 12, windowSec: 600, failurePolicy: "deny" });
  if (!rl.allowed) return { error: "Çok sık yükleme yaptınız; birkaç dakika sonra tekrar deneyin." };

  const slot = String(fd.get("slot") ?? "");
  if (!isBrandSlot(slot)) return { error: "Geçersiz marka alanı." };
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Dosya seçilmedi." };
  if (file.size > HARD_FILE_LIMIT) return { error: "Dosya çok büyük." };

  const bytes = new Uint8Array(await file.arrayBuffer());
  const checked = checkBrandUpload(slot, bytes);
  if (!checked.ok) return { error: checked.error };

  const saved = await saveBrandAsset(slot, { type: checked.type, data: checked.data }, checked.bytes, staff.id);
  if (!saved.ok) return { error: saved.error };

  await logPlatformActivity({
    actorId: staff.id,
    action: "brand.upload",
    entityType: "brand",
    entityId: slot,
    meta: { slot, type: checked.type, bytes: checked.bytes },
  });
  refresh();
  return { ok: true };
}

/** Bir slotu (veya `all`) varsayılan markaya döndürür. */
export async function resetBrandAsset(fd: FormData): Promise<BrandActionResult> {
  const staff = await requirePlatformModule("marka");
  const rl = await checkRateLimit(`brand-reset:${staff.id}`, { limit: 20, windowSec: 600, failurePolicy: "deny" });
  if (!rl.allowed) return { error: "Çok sık işlem yaptınız; birkaç dakika sonra tekrar deneyin." };

  const slot = String(fd.get("slot") ?? "");
  const targets = slot === "all" ? BRAND_SLOTS : isBrandSlot(slot) ? [slot] : null;
  if (!targets) return { error: "Geçersiz marka alanı." };

  const res = await resetBrandSlots(targets, staff.id);
  if (!res.ok) return { error: res.error };

  await logPlatformActivity({
    actorId: staff.id,
    action: "brand.reset",
    entityType: "brand",
    entityId: slot,
    meta: { slots: [...targets] },
  });
  refresh();
  return { ok: true };
}
