"use server";

import { revalidatePath, updateTag } from "next/cache";
import { requirePlatformModule, type PlatformStaff } from "@/lib/platform";
import { logPlatformActivity } from "@/lib/platform-activity";
import { setPlatformSetting } from "@/lib/platform-settings";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  EF_PACKS_SETTING_KEY,
  EF_TARIFF_SETTING_KEY,
  efPacksSchema,
  efTariffSchema,
  serializeEfPacks,
  serializeEfTariff,
} from "@/lib/ef-credits/config";
import { EF_CONFIG_CACHE_TAG, getEfCreditReady } from "@/lib/ef-credits/credit-reader";
import { efAdminGrantSchema } from "@/lib/ef-credits/admin-grant";
import { grantEfCredit } from "@/lib/ef-credits/admin-data";

/**
 * EmlakFiyati kontör yönetimi action'ları. YETKİ: `billing` modülü + YAZMA yalnız super_admin (ops yalnız okur).
 * Her yazma logPlatformActivity ile denetim kaydı bırakır; kayıt sonrası önbellek updateTag ile anında düşer.
 */
export type EfKontorResult = { ok?: boolean; error?: string; message?: string };

const DENIED = "Kontör ayarlarını yalnız süper admin değiştirebilir.";

async function writer(): Promise<{ staff: PlatformStaff } | { error: string }> {
  const staff = await requirePlatformModule("billing");
  if (staff.role !== "super_admin") return { error: DENIED };
  return { staff };
}

function firstIssue(e: { issues: { message: string }[] }): string {
  return e.issues[0]?.message ?? "Geçersiz değer.";
}

function done() {
  updateTag(EF_CONFIG_CACHE_TAG);
  revalidatePath("/admin/ef-kontor");
  revalidatePath("/app/abonelik");
}

export async function saveEfTariff(formData: FormData): Promise<EfKontorResult> {
  const w = await writer();
  if ("error" in w) return w;
  const num = (k: string) => {
    const raw = String(formData.get(k) ?? "").trim();
    return raw === "" ? NaN : Number(raw);
  };
  const parsed = efTariffSchema.safeParse({
    valuationArsa: num("valuationArsa"),
    valuationKonut: num("valuationKonut"),
    pdfFirst: num("pdfFirst"),
    reportDetail: num("reportDetail"),
  });
  if (!parsed.success) return { error: "Tarife değerleri 0-1000 arası tam sayı olmalı." };
  const ok = await setPlatformSetting(EF_TARIFF_SETTING_KEY, serializeEfTariff(parsed.data), w.staff.id);
  if (!ok) return { error: "Tarife kaydedilemedi; tekrar deneyin." };
  await logPlatformActivity({
    actorId: w.staff.id,
    action: "ef_credits.tariff_update",
    entityType: "platform_setting",
    entityId: EF_TARIFF_SETTING_KEY,
    meta: { ...parsed.data },
  });
  done();
  return { ok: true, message: "Tarife kaydedildi." };
}

export async function saveEfPacks(formData: FormData): Promise<EfKontorResult> {
  const w = await writer();
  if ("error" in w) return w;
  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get("packs") ?? "[]"));
  } catch {
    return { error: "Paket listesi okunamadı." };
  }
  const parsed = efPacksSchema.safeParse(raw);
  if (!parsed.success) return { error: `Paket kataloğu geçersiz: ${firstIssue(parsed.error)}` };
  const ids = parsed.data.map((p) => p.id);
  if (new Set(ids).size !== ids.length) return { error: "Paket kimlikleri benzersiz olmalı." };
  const ok = await setPlatformSetting(EF_PACKS_SETTING_KEY, serializeEfPacks(parsed.data), w.staff.id);
  if (!ok) return { error: "Paket kataloğu kaydedilemedi; tekrar deneyin." };
  await logPlatformActivity({
    actorId: w.staff.id,
    action: "ef_credits.packs_update",
    entityType: "platform_setting",
    entityId: EF_PACKS_SETTING_KEY,
    meta: { count: parsed.data.length, active: parsed.data.filter((p) => p.active).length },
  });
  done();
  return { ok: true, message: "Paket kataloğu kaydedildi." };
}

/** Manuel yükleme/bonus/iade (yalnız pozitif). Gerekçe zorunlu; idempotency anahtarı formdan gelen tek kullanımlık anahtardır. */
export async function grantEfCreditAction(formData: FormData): Promise<EfKontorResult> {
  const w = await writer();
  if ("error" in w) return w;
  const parsed = efAdminGrantSchema.safeParse({
    tenantId: String(formData.get("tenantId") ?? "").trim(),
    units: String(formData.get("units") ?? "").trim(),
    kind: String(formData.get("kind") ?? "").trim(),
    reason: String(formData.get("reason") ?? ""),
    idemKey: String(formData.get("idemKey") ?? "").trim(),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { allowed } = await checkRateLimit(`efgrant:${w.staff.id}`, { limit: 10, windowSec: 600, failurePolicy: "deny" });
  if (!allowed) return { error: "Çok fazla yükleme denemesi. Birkaç dakika sonra tekrar deneyin." };
  if (!(await getEfCreditReady())) return { error: "Kontör cüzdanı henüz etkin değil." };
  const r = await grantEfCredit(parsed.data, w.staff.id);
  if (!r.ok) return { error: r.error ?? "Kontör yüklenemedi." };
  await logPlatformActivity({
    actorId: w.staff.id,
    action: "ef_credits.manual_grant",
    entityType: "tenant",
    entityId: parsed.data.tenantId,
    meta: { units: parsed.data.units, kind: parsed.data.kind, reason: parsed.data.reason },
  });
  revalidatePath("/admin/ef-kontor");
  return { ok: true, message: `${parsed.data.units} kontör yüklendi. Yeni bakiye: ${r.available ?? "-"}.` };
}
