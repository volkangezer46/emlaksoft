"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformModule } from "@/lib/platform";
import { logPlatformActivity } from "@/lib/platform-activity";
import { checkRateLimit } from "@/lib/rate-limit";
import { actionErrorMessage } from "@/lib/action-errors";
import { now } from "@/lib/clock";
import { CHANNEL_LABEL } from "@/lib/measure/channel";
import { isSpendChannel, parseSpendAmount, parseSpendMonth } from "@/lib/channel-roi/model";

/**
 * Kanal ROI > pazarlama harcaması (marketing_spend). Kapı: `requirePlatformModule("billing")` (gelir analitiği ile aynı
 * modül); ay + kanal başına tek satır (aynı ay/kanal yeniden girilirse tutar güncellenir). Google Ads maliyeti otomatik
 * okunur; burada yalnız elle tutulan harcama (ajans, sosyal medya, etkinlik, ek reklam) girilir.
 */

export type SpendResult = { ok?: boolean; error?: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SETUP_PENDING = "Pazarlama harcaması tablosu henüz kurulmadı (migration 20261014005000 bekliyor). Google Ads maliyeti yine otomatik sayılır.";
const missingTable = (e: { code?: string } | null) => Boolean(e && (e.code === "42P01" || e.code === "PGRST205"));
const PATH = "/admin/billing/kanal-roi";

async function gate(): Promise<{ staffId: string } | { error: string }> {
  const staff = await requirePlatformModule("billing");
  const { allowed } = await checkRateLimit(`channel-roi-spend:${staff.id}`, { limit: 60, windowSec: 600, failurePolicy: "deny" });
  if (!allowed) return { error: "Çok sık işlem yapıldı. Lütfen biraz sonra tekrar deneyin." };
  return { staffId: staff.id };
}

export async function saveMarketingSpend(fd: FormData): Promise<SpendResult> {
  const g = await gate();
  if ("error" in g) return g;
  const month = parseSpendMonth(String(fd.get("month") ?? ""));
  if (!month) return { error: "Ayı seçin (YYYY-AA)." };
  const channel = String(fd.get("channel") ?? "");
  if (!isSpendChannel(channel)) return { error: "Geçerli bir kanal seçin." };
  const amount = parseSpendAmount(String(fd.get("amount") ?? ""));
  if (amount === null) return { error: "Tutarı TL olarak girin (ör. 12.500 ya da 12500,50)." };
  const note = String(fd.get("note") ?? "").trim().slice(0, 300) || null;
  const stamp = new Date(now()).toISOString();
  const admin = createAdminClient();
  const { error } = await admin
    .from("marketing_spend")
    .upsert({ month, channel, amount_try: amount, note, created_by: g.staffId, updated_by: g.staffId, updated_at: stamp }, { onConflict: "month,channel" });
  if (error) return { error: missingTable(error) ? SETUP_PENDING : actionErrorMessage(error, "Harcama kaydedilemedi.") };
  await logPlatformActivity({
    actorId: g.staffId,
    action: "marketing_spend.save",
    entityType: "marketing_spend",
    meta: { month: month.slice(0, 7), channel, channelLabel: CHANNEL_LABEL[channel], amount },
  });
  revalidatePath(PATH);
  return { ok: true };
}

export async function deleteMarketingSpend(id: string): Promise<SpendResult> {
  const g = await gate();
  if ("error" in g) return g;
  if (!UUID_RE.test(id ?? "")) return { error: "Kayıt bulunamadı." };
  const admin = createAdminClient();
  const { data, error } = await admin.from("marketing_spend").delete().eq("id", id).select("month, channel, amount_try").maybeSingle();
  if (error) return { error: missingTable(error) ? SETUP_PENDING : actionErrorMessage(error, "Harcama silinemedi.") };
  if (!data) return { error: "Kayıt bulunamadı (başka biri silmiş olabilir). Sayfayı yenileyin." };
  await logPlatformActivity({
    actorId: g.staffId,
    action: "marketing_spend.delete",
    entityType: "marketing_spend",
    entityId: id,
    meta: { month: String(data.month).slice(0, 7), channel: data.channel, amount: Number(data.amount_try) },
  });
  revalidatePath(PATH);
  return { ok: true };
}
