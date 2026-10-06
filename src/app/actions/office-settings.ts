"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/require-permission";
import { getSettingHistory } from "@/lib/settings/history";
import { getSettingDef } from "@/lib/settings/registry";
import type { SettingHistoryEntry } from "@/lib/settings/types";
import { resetSetting, revertSettingToVersion, writeSetting } from "@/lib/settings/write";

/**
 * Ofis Tanımları Merkezi sunucu eylemleri. İnce kabuk: yetki (`requirePermission("settings", "edit")`), doğrulama,
 * geçmiş yazımı ve ofis izolasyonu `lib/settings/write.ts` içindedir. Yalnız scope=tenant ayarlar kabul edilir;
 * platform anahtarı bu yoldan ASLA yazılmaz. Ofis kimliği oturumdan gelir (istemciden alınmaz).
 */

export type OfficeSettingResult = { ok?: boolean; error?: string; changed?: boolean };

const PAGE = "/app/ayarlar/merkez";

function officeDef(key: string) {
  const def = getSettingDef(String(key));
  return def && def.scope === "tenant" ? def : null;
}

/** Ön kapı: ayar ofis kapsamlı mı + `settings:edit` (asıl kapı ayrıca lib/settings/write.ts içinde). */
async function editGate(key: string): Promise<OfficeSettingResult | null> {
  if (!officeDef(key)) return { error: "Bilinmeyen ofis ayarı." };
  const gate = await requirePermission("settings", "edit");
  return gate.ok ? null : { error: gate.error };
}

function done(res: Awaited<ReturnType<typeof writeSetting>>): OfficeSettingResult {
  if (!res.ok) return { error: res.error };
  revalidatePath(PAGE);
  // Ayarın okunduğu ekranlar bir sonraki açılışta taze değeri görsün.
  for (const p of ["/app/anlasmalar", "/app/talepler", "/app/komisyon", "/app/raporlar/lead-hizi", "/app/ayarlar"]) revalidatePath(p);
  return { ok: true, changed: res.changed };
}

export async function saveOfficeSettingAction(key: string, value: string, reason: string): Promise<OfficeSettingResult> {
  const denied = await editGate(key);
  if (denied) return denied;
  return done(await writeSetting({ key: String(key), scope: "tenant", value: String(value), reason: String(reason ?? "").trim() }));
}

/** Varsayılana dön (null yazar; ofis satırı silinir, geçmişe işlenir). */
export async function resetOfficeSettingAction(key: string, reason: string): Promise<OfficeSettingResult> {
  const denied = await editGate(key);
  if (denied) return denied;
  return done(await resetSetting(String(key), String(reason ?? "").trim(), "tenant"));
}

export async function revertOfficeSettingAction(key: string, version: number, reason: string): Promise<OfficeSettingResult> {
  const denied = await editGate(key);
  if (denied) return denied;
  return done(await revertSettingToVersion(String(key), Number(version), String(reason ?? "").trim()));
}

export async function officeSettingHistoryAction(key: string): Promise<{ entries: SettingHistoryEntry[]; error?: string }> {
  const gate = await requirePermission("settings", "view");
  if (!gate.ok) return { entries: [], error: gate.error };
  if (!officeDef(key)) return { entries: [], error: "Bilinmeyen ofis ayarı." };
  return { entries: await getSettingHistory(String(key), { scope: "tenant", tenantId: gate.tenantId, limit: 30 }) };
}
