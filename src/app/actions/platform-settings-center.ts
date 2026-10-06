"use server";

import { revalidatePath } from "next/cache";
import { guardPlatformAction } from "@/lib/platform-guards";
import { getSettingHistory } from "@/lib/settings/history";
import { getSettingDef } from "@/lib/settings/registry";
import type { SettingHistoryEntry } from "@/lib/settings/types";
import {
  encryptPlaintextSecrets,
  resetSetting,
  revertSettingToVersion,
  writeSetting,
  type EncryptPlaintextReport,
} from "@/lib/settings/write";

/**
 * Sistem Ayarları Merkezi sunucu eylemleri. Yetki/hız sınırı/doğrulama/gerekçe/geçmiş/denetim `lib/settings/write.ts`
 * içindedir; burası yalnız ince bir kabuktur (kapı orada, tek yerde).
 */

export type CenterResult = { ok?: boolean; error?: string; changed?: boolean; degraded?: boolean };

const REVALIDATE = "/admin/ayarlar/merkez";

function done(res: Awaited<ReturnType<typeof writeSetting>>): CenterResult {
  if (!res.ok) return { error: res.error };
  revalidatePath(REVALIDATE);
  revalidatePath("/admin/ayarlar");
  return { ok: true, changed: res.changed, degraded: res.degraded };
}

/** Merkez yalnız platform ekibi içindir; ayrıntılı yetki/hız sınırı lib/settings/write.ts içinde (burada ön kapı). */
async function centerGate(): Promise<CenterResult | null> {
  const gate = await guardPlatformAction({ module: "sistem" });
  return "error" in gate ? { error: gate.error } : null;
}

export async function saveSettingAction(key: string, value: string, reason: string): Promise<CenterResult> {
  const denied = await centerGate();
  if (denied) return denied;
  return done(await writeSetting({ key: String(key), value: String(value), reason: String(reason ?? "").trim() }));
}

/** Gizli anahtarı siler / ayarı varsayılana döndürür (null yazar; geçmişe işlenir). */
export async function resetSettingAction(key: string, reason: string): Promise<CenterResult> {
  const denied = await centerGate();
  if (denied) return denied;
  return done(await resetSetting(String(key), String(reason ?? "").trim()));
}

export async function revertSettingAction(key: string, version: number, reason: string): Promise<CenterResult> {
  const denied = await centerGate();
  if (denied) return denied;
  return done(await revertSettingToVersion(String(key), Number(version), String(reason ?? "").trim()));
}

export async function settingHistoryAction(key: string): Promise<{ entries: SettingHistoryEntry[]; error?: string }> {
  const gate = await guardPlatformAction({ module: "sistem" });
  if ("error" in gate) return { entries: [], error: gate.error };
  if (!getSettingDef(String(key))) return { entries: [], error: "Bilinmeyen ayar." };
  return { entries: await getSettingHistory(String(key), { limit: 30 }) };
}

/** Tek seferlik düz metin sır şifreleme. `confirm` tam olarak "ŞİFRELE" olmalıdır; `dryRun` yalnız durumu listeler. */
export async function encryptSecretsAction(input: { dryRun: boolean; confirm?: string }): Promise<EncryptPlaintextReport> {
  const gate = await guardPlatformAction({ module: "sistem", roles: ["super_admin"] });
  if ("error" in gate) return { ok: false, dryRun: Boolean(input.dryRun), error: gate.error, found: [], encrypted: [], failed: [] };
  if (!input.dryRun && input.confirm !== "ŞİFRELE") {
    return { ok: false, dryRun: false, error: "Onay için ŞİFRELE yazın.", found: [], encrypted: [], failed: [] };
  }
  const res = await encryptPlaintextSecrets({ dryRun: Boolean(input.dryRun) });
  if (!input.dryRun) revalidatePath(REVALIDATE);
  return res;
}