"use server";

import { revalidatePath } from "next/cache";
import { guardPlatformAction } from "@/lib/platform-guards";
import { afterSafe } from "@/lib/after-safe";
import { runAfterPublish } from "@/lib/publishing/after-publish";
import { SUPPORT_CONTACT_KEYS } from "@/lib/settings/registry/legal";
import { STATIC_ROUTES } from "@/lib/static-home/registry";
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

const REVALIDATE = "/admin/ayarlar";

/**
 * Destek iletişimi (`support.*`) herkese açık sayfalarda sunucuda okunur (ana sayfa SSS'si, üst menü, alt bilgi, yasal
 * sayfalar). Bu sayfalar statik kopyadan da sunulabildiği için değişiklikte sayfa önbelleği düşer ve yayın sonrası
 * zinciri (statik tazeleme + doğrulama) çalışır; eski adres statik HTML'de kalmaz.
 */
function refreshSupportSurfaces(key: string, actorId: string | null) {
  if (!(SUPPORT_CONTACT_KEYS as readonly string[]).includes(key)) return;
  const livePaths = STATIC_ROUTES.map((r) => r.path);
  for (const p of livePaths) revalidatePath(p);
  afterSafe(
    () => runAfterPublish({ surface: "settings", kind: "publish", publishRef: key, livePaths, actorId, source: "staff" }),
    "destek iletişimi statik tazeleme",
  );
}

function done(res: Awaited<ReturnType<typeof writeSetting>>, key: string, actorId: string | null): CenterResult {
  if (!res.ok) return { error: res.error };
  revalidatePath(REVALIDATE);
  if (res.changed !== false) refreshSupportSurfaces(key, actorId);
  return { ok: true, changed: res.changed, degraded: res.degraded };
}

/** Merkez yalnız platform ekibi içindir; ayrıntılı yetki/hız sınırı lib/settings/write.ts içinde (burada ön kapı). */
async function centerGate(): Promise<{ error: string } | { actorId: string }> {
  const gate = await guardPlatformAction({ module: "sistem" });
  return "error" in gate ? { error: gate.error } : { actorId: gate.staff.id };
}

export async function saveSettingAction(key: string, value: string, reason: string): Promise<CenterResult> {
  const gate = await centerGate();
  if ("error" in gate) return gate;
  return done(await writeSetting({ key: String(key), value: String(value), reason: String(reason ?? "").trim() }), String(key), gate.actorId);
}

/** Gizli anahtarı siler / ayarı varsayılana döndürür (null yazar; geçmişe işlenir). */
export async function resetSettingAction(key: string, reason: string): Promise<CenterResult> {
  const gate = await centerGate();
  if ("error" in gate) return gate;
  return done(await resetSetting(String(key), String(reason ?? "").trim()), String(key), gate.actorId);
}

export async function revertSettingAction(key: string, version: number, reason: string): Promise<CenterResult> {
  const gate = await centerGate();
  if ("error" in gate) return gate;
  return done(await revertSettingToVersion(String(key), Number(version), String(reason ?? "").trim()), String(key), gate.actorId);
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