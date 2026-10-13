"use server";

import { revalidatePath, updateTag } from "next/cache";
import { z } from "zod";
import { requirePlatformModule } from "@/lib/platform";
import { logPlatformActivity } from "@/lib/platform-activity";
import { checkRateLimit } from "@/lib/rate-limit";
import { now } from "@/lib/clock";
import { MEASURE_CACHE_TAG, readMeasureSettingsFresh, writeMeasureSettings, type MeasureSettings } from "@/lib/measure/settings";

export type MeasureActionResult = { ok?: boolean; error?: string; message?: string };

const SUPER_ONLY = "Ölçüm ayarlarını yalnız süper admin değiştirebilir.";
const LEGAL_REQUIRED = "Kayıt kaynağını taşımayı açmak için aydınlatma metnine kayıt kaynağı maddesinin eklendiğini onaylayın.";

const InputSchema = z.object({
  pageviews: z.boolean(),
  vitals: z.boolean(),
  attribution: z.boolean(),
  legalConfirmed: z.boolean(),
});

const flag = (fd: FormData, name: string) => fd.get(name) === "on" || fd.get(name) === "true";

/**
 * Ölçüm ayarları (`measure.settings`). Yalnız süper admin. Atıf taşımayı AÇMAK "Aydınlatma metnine kayıt kaynağı
 * maddesi eklendi" onayını ister (P3); onay zamanı saklanır. Kapatmak onay istemez. Her değişiklik denetim izine yazılır.
 */
export async function saveMeasureSettings(fd: FormData): Promise<MeasureActionResult> {
  const staff = await requirePlatformModule("seo");
  if (staff.role !== "super_admin") return { error: SUPER_ONLY };
  const rl = await checkRateLimit(`measure-admin:${staff.id}`, { limit: 30, windowSec: 600, failurePolicy: "deny" });
  if (!rl.allowed) return { error: "Çok sık işlem yaptınız; birkaç dakika sonra tekrar deneyin." };

  const parsed = InputSchema.safeParse({
    pageviews: flag(fd, "pageviews"),
    vitals: flag(fd, "vitals"),
    attribution: flag(fd, "attribution"),
    legalConfirmed: flag(fd, "legalConfirmed"),
  });
  if (!parsed.success) return { error: "Geçersiz ayar." };
  const input = parsed.data;

  const prev = await readMeasureSettingsFresh();
  const turningOn = input.attribution && !prev.attribution;
  if (turningOn && !input.legalConfirmed) return { error: LEGAL_REQUIRED };

  const next: MeasureSettings = {
    pageviews: input.pageviews,
    vitals: input.vitals,
    attribution: input.attribution,
    attributionLegalAt: input.attribution ? (turningOn ? new Date(now()).toISOString() : prev.attributionLegalAt) : prev.attributionLegalAt,
  };
  const ok = await writeMeasureSettings(next, staff.id);
  if (!ok) return { error: "Ayar kaydedilemedi; tekrar deneyin." };

  await logPlatformActivity({
    actorId: staff.id,
    action: "measure.settings.update",
    entityType: "measure",
    entityId: "measure.settings",
    meta: { before: prev, after: next },
  });
  updateTag(MEASURE_CACHE_TAG);
  revalidatePath("/admin/site/reklam");
  revalidatePath("/", "layout");
  return { ok: true, message: "Ölçüm ayarları kaydedildi. Herkese açık sayfalar en geç birkaç dakika içinde güncellenir." };
}
