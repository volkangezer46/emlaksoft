"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/require-permission";
import { TV_CONFIG_KEY } from "@/lib/settings/registry/tv";
import { writeSetting } from "@/lib/settings/write";
import { canViewTv, formatTvConfig, parseTvConfig, type TvConfig } from "@/lib/tv/tv-logic";

export type TvConfigResult = { ok?: boolean; error?: string };

/**
 * Ofis TV yayın ayarını kaydeder (köprü ayarı `office.tv.config`). Ön kapı: ofis geneli TV rolü + `settings:edit`;
 * asıl kapı, doğrulama, geçmiş ve ofis izolasyonu `writeSetting` içinde. İstemciden gelen değer `parseTvConfig` ile
 * güvenli kanonik biçime indirilir (bilinmeyen alan/sahne yazılmaz).
 */
export async function saveTvConfigAction(input: TvConfig): Promise<TvConfigResult> {
  const gate = await requirePermission("settings", "edit", { write: true });
  if (!gate.ok) return { error: "TV ayarlarını değiştirmek için ofis ayarlarını düzenleme yetkisi gerekir." };
  if (!canViewTv(gate.role)) return { error: "TV ayarlarını ofis sahibi, genel müdür veya şube müdürü değiştirir." };
  const value = formatTvConfig(parseTvConfig(input));
  const res = await writeSetting({ key: TV_CONFIG_KEY, scope: "tenant", value, reason: "Pano TV ayarları", fromBridge: true });
  if (!res.ok) return { error: res.error };
  revalidatePath("/app/pano-tv");
  return { ok: true };
}
