"use server";

import { revalidatePath } from "next/cache";
import {
  probeEmlakFiyatiConnection,
  type EmlakFiyatiProbeState,
} from "@/lib/integrations/emlakfiyati/adapter";
import {
  clearStoredEmlakFiyatiKeys,
  dropPreviousEmlakFiyatiKey,
  EF_SETTING,
  storeNewEmlakFiyatiKey,
} from "@/lib/integrations/emlakfiyati/keys";
import { getOrtakProbeOkAt } from "@/lib/integrations/emlakfiyati/ortak";
import { runOrtakProbe, type OrtakProbeResult } from "@/lib/integrations/emlakfiyati/ortak-client";
import { isValidEmlakFiyatiKeyFormat } from "@/lib/integrations/emlakfiyati/policy";
import { logPlatformActivity } from "@/lib/platform-activity";
import { guardPlatformAction } from "@/lib/platform-guards";
import { PLATFORM_SECRETS_DISABLED_MESSAGE, platformSecretsEnabled } from "@/lib/platform-secrets";
import { setPlatformSetting } from "@/lib/platform-settings";

/**
 * EmlakFiyati API anahtarı yönetimi (Admin > Sistem > EmlakFiyati). YALNIZ süper admin yazar; ops salt okur (sayfada).
 * Anahtar değeri hiçbir sonuca, denetim kaydına, loga veya hata mesajına girmez (denetimde yalnız "değişti").
 */

export type EmlakFiyatiActionResult = { ok?: boolean; error?: string; rotated?: boolean };
export type EmlakFiyatiOrtakProbeResult = { ok?: boolean; error?: string; probe?: OrtakProbeResult };
export type EmlakFiyatiProbeResult = { ok?: boolean; error?: string; state?: EmlakFiyatiProbeState };

function gate(rateKey: string) {
  return guardPlatformAction({
    module: "sistem",
    roles: ["super_admin"],
    rate: { key: rateKey, limit: 12, windowSec: 600 },
  });
}

export async function saveEmlakFiyatiKey(fd: FormData): Promise<EmlakFiyatiActionResult> {
  const g = await gate("platform-emlakfiyati-key");
  if ("error" in g) return { error: g.error };

  if (!platformSecretsEnabled()) return { error: PLATFORM_SECRETS_DISABLED_MESSAGE };

  const value = String(fd.get("api_key") ?? "").trim();
  if (!isValidEmlakFiyatiKeyFormat(value)) {
    return { error: "Anahtar biçimi geçersiz: beklenen önekle başlamalı ve makul uzunlukta olmalıdır." };
  }

  const res = await storeNewEmlakFiyatiKey(value, g.staff.id);
  if (!res.ok) {
    if (res.error === "secrets_disabled") return { error: PLATFORM_SECRETS_DISABLED_MESSAGE };
    if (res.error === "same_key") return { error: "Bu anahtar zaten tanımlı." };
    return { error: "Anahtar kaydedilemedi." };
  }

  await logPlatformActivity({
    actorId: g.staff.id,
    action: "integration.emlakfiyati.key_change",
    entityType: "integration",
    meta: { changed: true, rotated: res.rotated },
  });
  revalidatePath("/admin/sistem");
  return { ok: true, rotated: res.rotated };
}

export async function deletePreviousEmlakFiyatiKey(): Promise<EmlakFiyatiActionResult> {
  const g = await gate("platform-emlakfiyati-key");
  if ("error" in g) return { error: g.error };
  if (!(await dropPreviousEmlakFiyatiKey(g.staff.id))) return { error: "Eski anahtar silinemedi." };
  await logPlatformActivity({
    actorId: g.staff.id,
    action: "integration.emlakfiyati.previous_delete",
    entityType: "integration",
  });
  revalidatePath("/admin/sistem");
  return { ok: true };
}

/** Admin'de kayıtlı anahtarları siler; ortam değişkeni yedeği (varsa) devreye girer. */
export async function clearEmlakFiyatiKey(): Promise<EmlakFiyatiActionResult> {
  const g = await gate("platform-emlakfiyati-key");
  if ("error" in g) return { error: g.error };
  if (!(await clearStoredEmlakFiyatiKeys(g.staff.id))) return { error: "Anahtar silinemedi." };
  await logPlatformActivity({
    actorId: g.staff.id,
    action: "integration.emlakfiyati.key_clear",
    entityType: "integration",
  });
  revalidatePath("/admin/sistem");
  return { ok: true };
}

/** Salt-okunur bağlantı yoklaması (GET /api/endeks?path=istanbul&tip=konut). Anahtar sonuca yazılmaz. */
export async function testEmlakFiyatiConnection(): Promise<EmlakFiyatiProbeResult> {
  const g = await gate("platform-emlakfiyati-test");
  if ("error" in g) return { error: g.error };
  const { state } = await probeEmlakFiyatiConnection();
  await logPlatformActivity({
    actorId: g.staff.id,
    action: "integration.emlakfiyati.test",
    entityType: "integration",
    meta: { state },
  });
  revalidatePath("/admin/sistem");
  return { ok: true, state };
}

/**
 * 'Ortak baglantiyi dene': GET /kullanim (ortak API, TEK deneme, kapısız). Başarıda son yoklama damgası (ISO) + sınırlar/tarife.surum
 * yazılır; başarısızlıkta damga SİLİNİR (ortak uçlar kendiliğinden kapanır). Anahtar sonuca/denetime yazılmaz.
 */
export async function testEmlakFiyatiOrtak(): Promise<EmlakFiyatiOrtakProbeResult> {
  const g = await gate("platform-emlakfiyati-ortak-probe");
  if ("error" in g) return { error: g.error };
  const probe = await runOrtakProbe(g.staff.id);
  await logPlatformActivity({
    actorId: g.staff.id,
    action: "integration.emlakfiyati.ortak_probe",
    entityType: "integration",
    meta: { state: probe.state, code: probe.code, status: probe.status, request_id: probe.requestId },
  });
  revalidatePath("/admin/sistem");
  return { ok: true, probe };
}

/**
 * 'Ortak uçlar (değerleme/PDF)' bayrağı. Varsayılan KAPALI. AÇMAK için son ortak yoklaması BAŞARILI olmalı (canlıda doğrulanmamış uçlar
 * yoklamasız açılamaz); kapatmak her zaman serbest. Yalnız süper admin; denetim kaydı yazılır.
 */
export async function setEmlakFiyatiOrtakFlag(enabled: boolean): Promise<EmlakFiyatiActionResult> {
  const g = await gate("platform-emlakfiyati-flag");
  if ("error" in g) return { error: g.error };
  if (enabled === true && !(await getOrtakProbeOkAt())) {
    return { error: "Önce 'Ortak bağlantıyı dene' başarılı olmalı: ortak uçlar canlıda doğrulanmadan etkinleştirilemez." };
  }
  const ok = await setPlatformSetting(EF_SETTING.ortakEnabled, enabled === true ? "1" : "0", g.staff.id);
  if (!ok) return { error: "Ayar kaydedilemedi." };
  await logPlatformActivity({
    actorId: g.staff.id,
    action: "integration.emlakfiyati.ortak_flag",
    entityType: "integration",
    meta: { enabled: enabled === true },
  });
  revalidatePath("/admin/sistem");
  return { ok: true };
}
