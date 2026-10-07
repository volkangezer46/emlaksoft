"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { MATCHING_WEIGHT_KEYS, type MatchingWeights } from "@/lib/matching";
import { PHONE_ERROR_MESSAGE } from "@/lib/phone";
import { parsePhoneStrict } from "@/lib/phone-rules";
import { resolveOfficeGeo } from "@/lib/geo/resolve";
import {
  LICENSE_AMENDMENT_DAYS,
  licenseAmendmentChanges,
  licenseAmendmentMessage,
  normalizeLicenseNo,
  normalizeLicenseTitle,
  normalizeLicenseValidUntil,
} from "@/lib/license";
import { daysFromNowIso } from "@/lib/clock";
import { notifyTenant } from "@/lib/notify";
import { actionErrorMessage } from "@/lib/action-errors";

export type SettingsResult = { error?: string; ok?: boolean };

/**
 * Eşleştirme kriter ağırlıklarını kaydeder (tenants.matching_weights).
 * reset=1 → null (varsayılan sete dönülür). Firma bilgileri formuyla aynı yol:
 * RLS'li authenticated client tenants satırını günceller.
 */
export async function updateMatchingWeights(formData: FormData): Promise<SettingsResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };
  const tenantId = gate.tenantId;

  const reset = String(formData.get("reset") ?? "") === "1";

  let weights: MatchingWeights | null = null;
  if (!reset) {
    const parsed = {} as MatchingWeights;
    for (const key of MATCHING_WEIGHT_KEYS) {
      const n = Number(String(formData.get(key) ?? "").trim());
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        return { error: "Ağırlıklar 0–100 arası sayı olmalı." };
      }
      parsed[key] = Math.round(n);
    }
    const sum = MATCHING_WEIGHT_KEYS.reduce((s, k) => s + parsed[k], 0);
    if (sum <= 0) return { error: "En az bir kriterin ağırlığı 0'dan büyük olmalı." };
    weights = parsed;
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("tenants")
    .update({ matching_weights: weights, updated_at: new Date().toISOString() })
    .eq("id", tenantId);

  if (error) {
    console.error("updateMatchingWeights", error);
    return { error: actionErrorMessage(error, "Eşleştirme ağırlıkları kaydedilemedi.") };
  }

  await logActivity({
    tenantId,
    actorId: gate.userId,
    action: "settings.matching_weights",
    entityType: "tenant",
    entityId: tenantId,
    newValue: { matching_weights: weights },
  });

  revalidatePath("/app/ayarlar");
  revalidatePath("/app/eslestirme");
  revalidatePath("/app/talepler");
  return { ok: true };
}

export async function updateTenantInfo(formData: FormData): Promise<SettingsResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };
  const tenantId = gate.tenantId;

  const supabase = await createClient();

  const name        = String(formData.get("name")         ?? "").trim();
  const taxOffice   = String(formData.get("tax_office")   ?? "").trim();
  const taxNumber   = String(formData.get("tax_number")   ?? "").trim();
  const licenseNoRaw = formData.get("license_no");
  const brandColor  = String(formData.get("brand_color")  ?? "").trim();
  const iban        = String(formData.get("iban")         ?? "").trim().replace(/\s/g, "");
  const phone       = String(formData.get("phone")        ?? "").trim();
  const addressLine = String(formData.get("address_line") ?? "").trim();
  const provinceId  = String(formData.get("province_id")  ?? "").trim();
  const districtId  = String(formData.get("district_id")  ?? "").trim();
  const legacyCity  = String(formData.get("city")         ?? "").trim();
  const website     = String(formData.get("website")      ?? "").trim();

  if (!name) return { error: "Ofis adı zorunlu." };

  // Yetki belgesi: esnek biçim (boşluk/harf serbest), unvan ve geçerlilik tarihi opsiyonel.
  const lic = normalizeLicenseNo(licenseNoRaw);
  if (!lic.ok) return { error: lic.error };
  const licenseNo = lic.value ?? "";
  const hasLicenseExtras = formData.has("license_title") || formData.has("license_valid_until");
  const licTitle = normalizeLicenseTitle(formData.get("license_title"));
  if (!licTitle.ok) return { error: licTitle.error };
  const licUntil = normalizeLicenseValidUntil(formData.get("license_valid_until"));
  if (!licUntil.ok) return { error: licUntil.error };

  const parsedPhone = phone ? parsePhoneStrict(phone) : null;
  if (parsedPhone && !parsedPhone.ok) return { error: parsedPhone.error ?? PHONE_ERROR_MESSAGE };

  // İl/ilçe: kimlikler TEK MERKEZDE doğrulanır; kimlik + gösterim adı birlikte saklanır.
  // Eski istemciler serbest metin "city" gönderirse coğrafya servisiyle çözülür (çözülemezse reddedilir).
  const geo = await resolveOfficeGeo({ provinceId, districtId, legacyCity });
  if ("error" in geo) return { error: geo.error };

  // IBAN format kontrolü — TR ile başlayan 26 karakter (opsiyonel)
  if (iban && !/^TR\d{24}$/i.test(iban)) {
    return { error: "IBAN formatı geçersiz. Örnek: TR330006100519786457841326" };
  }

  // Yetki belgesi tadil hatırlatması için ÖNCEKİ değerler (unvan sütunu yoksa yalnız temel alanlar).
  const prevFull = await supabase.from("tenants").select("name, address_line, province_id, district_id, license_no, license_title").eq("id", tenantId).maybeSingle();
  const prevRow = (prevFull.error
    ? (await supabase.from("tenants").select("name, address_line, province_id, district_id, license_no").eq("id", tenantId).maybeSingle()).data
    : prevFull.data) as { name?: string | null; address_line?: string | null; province_id?: string | null; district_id?: string | null; license_no?: string | null; license_title?: string | null } | null;

  const { error } = await supabase
    .from("tenants")
    .update({
      name,
      tax_office:   taxOffice   || null,
      tax_number:   taxNumber   || null,
      license_no:   licenseNo   || null,
      brand_color:  brandColor  || null,
      iban:         iban        || null,
      phone:        parsedPhone?.stored || null,
      address_line: addressLine || null,
      // İl seçilmediyse mevcut şehir/il/ilçe değerine dokunulmaz.
      ...(geo.provinceId ? { city: geo.provinceName, province_id: geo.provinceId, district_id: geo.districtId } : {}),
      website:      website     || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", tenantId);

  if (error) {
    console.error("updateTenantInfo", error);
    return { error: actionErrorMessage(error, "Ofis bilgileri güncellenemedi.") };
  }

  // Unvan + geçerlilik tarihi: migration 20260826001800 uygulanmadıysa sütunlar yoktur; ana kayıt zaten yapıldı,
  // bu ikinci güncelleme hatası kullanıcıya açıkça bildirilir (sessiz kayıp YOK).
  if (hasLicenseExtras) {
    const { error: extraError } = await supabase
      .from("tenants")
      .update({ license_title: licTitle.value, license_valid_until: licUntil.value })
      .eq("id", tenantId);
    if (extraError) {
      console.error("updateTenantInfo license extras", { code: extraError.code });
      revalidatePath("/app/ayarlar");
      return { error: "Ofis bilgileri kaydedildi ancak belge unvanı/geçerlilik tarihi kaydedilemedi (alanlar henüz etkin değil olabilir)." };
    }
  }

  await logActivity({
    tenantId,
    actorId: gate.userId,
    action: "settings.update",
    entityType: "tenant",
    entityId: tenantId,
    newValue: { name },
  });

  // Ünvan/adres değişti ve ofisin yetki belgesi varsa: tadil için görev (vade LICENSE_AMENDMENT_DAYS) + bildirim.
  if (prevRow && (licenseNo || prevRow.license_no)) {
    const changes = licenseAmendmentChanges(
      {
        name: prevRow.name ?? null,
        addressLine: prevRow.address_line ?? null,
        licenseTitle: prevRow.license_title ?? null,
        provinceId: prevRow.province_id ?? null,
        districtId: prevRow.district_id ?? null,
      },
      {
        name,
        addressLine: addressLine || null,
        licenseTitle: hasLicenseExtras ? licTitle.value : (prevRow.license_title ?? null),
        provinceId: geo.provinceId ?? prevRow.province_id ?? null,
        districtId: geo.provinceId ? (geo.districtId ?? null) : (prevRow.district_id ?? null),
      },
    );
    if (changes.length > 0) {
      const msg = licenseAmendmentMessage(changes);
      const { error: taskError } = await supabase.from("tasks").insert({
        tenant_id: tenantId,
        title: msg.title,
        notes: msg.body,
        kind: "followup",
        priority: "high",
        status: "open",
        due_at: daysFromNowIso(LICENSE_AMENDMENT_DAYS),
        assigned_to: gate.userId,
        created_by: gate.userId,
      });
      if (taskError) console.error("updateTenantInfo amendment task", { code: taskError.code });
      await notifyTenant({ tenantId, userId: gate.userId, title: msg.title, body: msg.body, href: "/app/gorevler", kind: "warning" }).catch(() => undefined);
    }
  }

  revalidatePath("/app/ayarlar");
  revalidatePath("/app");
  return { ok: true };
}
