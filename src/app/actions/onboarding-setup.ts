"use server";

import { revalidatePath, updateTag } from "next/cache";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { now } from "@/lib/clock";
import { PHONE_ERROR_MESSAGE } from "@/lib/phone";
import { normalizeBuyerIdentityNumber } from "@/lib/billing/buyer";
import { parsePhoneStrict } from "@/lib/phone-rules";
import { resolveOfficeGeo } from "@/lib/geo/resolve";
import { isOnboardingStepId } from "@/lib/onboarding-checklist";
import { getOfficeTemplate, isOfficeTemplateKey } from "@/lib/onboarding-templates";
import {
  parseSkipped,
  serializeSkipped,
  setupSkipCookieName,
  SETUP_COOKIE_MAX_AGE,
  toggleSkipped,
  welcomeDoneCookieName,
} from "@/lib/setup-skip";

export type OnboardingSetupResult = { error?: string; ok?: boolean };

/**
 * Kurulum sihirbazı — ofis bilgileri (ad, telefon, şehir, adres/ilçe, ruhsat no). Yalnız GÖNDERİLEN
 * mevcut tenants alanlarını günceller (gönderilmeyene dokunmaz); IBAN, vergi vb. ayarlar
 * sayfasındaki formda kalır. Ofis adı boş bırakılamaz ama gönderilmezse değişmez.
 */
export async function saveOfficeProfile(formData: FormData): Promise<OnboardingSetupResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };

  const phone = String(formData.get("phone") ?? "").trim().slice(0, 40);
  const provinceId = String(formData.get("province_id") ?? "").trim();
  const districtId = String(formData.get("district_id") ?? "").trim();
  const legacyCity = String(formData.get("city") ?? "").trim().slice(0, 80);
  const licenseNo = String(formData.get("license_no") ?? "").trim().slice(0, 60);
  const name = String(formData.get("name") ?? "").trim().slice(0, 120);
  const addressLine = String(formData.get("address_line") ?? "").trim().slice(0, 200);
  const taxRaw = String(formData.get("tax_number") ?? "").trim();
  const taxNumber = taxRaw ? normalizeBuyerIdentityNumber(taxRaw) : null;
  if (taxRaw && !taxNumber) return { error: "Geçerli bir vergi no (10 hane) ya da T.C. kimlik no (11 hane) girin." };
  if (addressLine && addressLine.length < 10) return { error: "Açık adres fatura için en az 10 karakter olmalıdır." };

  if (formData.has("name") && !name) return { error: "Ofis adı boş bırakılamaz." };
  if (!phone && !provinceId && !legacyCity && !licenseNo && !name && !addressLine && !taxNumber) return { error: "En az bir alanı doldurun." };
  const parsedPhone = phone ? parsePhoneStrict(phone) : null;
  if (parsedPhone && !parsedPhone.ok) return { error: parsedPhone.error ?? PHONE_ERROR_MESSAGE };

  // İl/ilçe kimlikleri TEK MERKEZDE doğrulanır (eski serbest metin gelirse servisle çözülür).
  const geo = await resolveOfficeGeo({ provinceId, districtId, legacyCity });
  if ("error" in geo) return { error: geo.error };

  const patch: Record<string, string | null> = { updated_at: new Date(now()).toISOString() };
  if (parsedPhone?.ok) patch.phone = parsedPhone.stored;
  if (geo.provinceId && geo.provinceName) {
    patch.city = geo.provinceName;
    patch.province_id = geo.provinceId;
    patch.district_id = geo.districtId;
  }
  if (licenseNo) patch.license_no = licenseNo;
  if (name) patch.name = name;
  if (addressLine) patch.address_line = addressLine;
  if (taxNumber) patch.tax_number = taxNumber;

  const supabase = await createClient();
  const { error } = await supabase.from("tenants").update(patch).eq("id", gate.tenantId);
  if (error) {
    console.error("saveOfficeProfile", error);
    return { error: "Ofis profili kaydedilemedi." };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "settings.update",
    entityType: "tenant",
    entityId: gate.tenantId,
    newValue: {
      name: name || null,
      phone: parsedPhone?.stored || null,
      city: geo.provinceName,
      license_no: licenseNo || null,
    },
  });

  revalidatePath("/app/baslangic");
  revalidatePath("/app/ayarlar");
  revalidatePath("/app");
  return { ok: true };
}

/**
 * "Sonra yaparım" tercihi — kullanıcıya özel çerez; veri/şema değişmez. Atlanan adım
 * tamamlanmış sayılmaz, yalnız "sıradaki" önerisinden ve ana ekran şeridinden çıkar.
 */
export async function setSetupStepSkipped(stepId: string, skip: boolean): Promise<OnboardingSetupResult> {
  const gate = await requirePermission("dashboard", "view");
  if (!gate.ok) return { error: gate.error };
  if (!isOnboardingStepId(stepId)) return { error: "Geçersiz adım." };
  const jar = await cookies();
  const name = setupSkipCookieName(gate.userId);
  const next = toggleSkipped(parseSkipped(jar.get(name)?.value), stepId, skip);
  jar.set(name, serializeSkipped(next), {
    path: "/app",
    maxAge: SETUP_COOKIE_MAX_AGE,
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  });
  revalidatePath("/app/baslangic");
  revalidatePath("/app");
  return { ok: true };
}

/** Yeni danışman "Hoş geldin" akışı bitti/kapatıldı: bir daha gösterilmez (kullanıcı çerezi). */
export async function completeWelcomeFlow(): Promise<OnboardingSetupResult> {
  const gate = await requirePermission("dashboard", "view");
  if (!gate.ok) return { error: gate.error };
  const jar = await cookies();
  jar.set(welcomeDoneCookieName(gate.userId), "1", {
    path: "/app",
    maxAge: SETUP_COOKIE_MAX_AGE,
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  });
  return { ok: true };
}

/** Hoş geldin akışı: danışmanın KENDİ telefon numarası (profiles.phone; yalnız kendi satırı). */
export async function saveOwnPhone(formData: FormData): Promise<OnboardingSetupResult> {
  const gate = await requirePermission("dashboard", "view");
  if (!gate.ok) return { error: gate.error };
  const phone = String(formData.get("phone") ?? "").trim().slice(0, 40);
  if (!phone) return { error: "Telefon numarası girin." };
  const parsed = parsePhoneStrict(phone);
  if (!parsed.ok) return { error: parsed.error ?? PHONE_ERROR_MESSAGE };
  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ phone: parsed.stored })
    .eq("id", gate.userId)
    .eq("tenant_id", gate.tenantId);
  if (error) {
    console.error("saveOwnPhone", error);
    return { error: "Telefon kaydedilemedi." };
  }
  revalidatePath("/app/hos-geldin");
  revalidatePath("/app/ekip");
  return { ok: true };
}

/**
 * Ofis tipi şablonu: seçilen odağa göre ofise ÖZEL kayıp nedeni ve müşteri kaynağı tanımları ekler.
 * Var olan (global veya ofise ait) değerler atlanır; tekrar çalıştırmak güvenlidir (idempotent).
 * Sistem anahtarlarına dokunmaz. Sihirbazın "dolu demo / boş başla" seçimi bunu çağırır.
 */
export async function applyOfficeTemplate(kind: string): Promise<OnboardingSetupResult & { added?: number }> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!isOfficeTemplateKey(kind)) return { error: "Geçersiz ofis tipi." };
  const template = getOfficeTemplate(kind);

  const supabase = await createClient();
  const { data: existing, error: readError } = await supabase
    .from("definitions")
    .select("category, value, sort_order")
    .in("category", ["loss_reason", "customer_source"]);
  if (readError) {
    console.error("applyOfficeTemplate:read", readError);
    return { error: "Mevcut tanımlar okunamadı." };
  }
  const have = new Set((existing ?? []).map((r) => `${r.category}\u0000${String(r.value).toLocaleLowerCase("tr-TR")}`));
  const maxSort = (category: string) =>
    (existing ?? []).filter((r) => r.category === category).reduce((m, r) => Math.max(m, Number(r.sort_order) || 0), 0);

  const rows: { tenant_id: string; category: string; value: string; label: string; sort_order: number }[] = [];
  let lossSort = maxSort("loss_reason");
  for (const label of template.lossReasons) {
    if (have.has(`loss_reason\u0000${label.toLocaleLowerCase("tr-TR")}`)) continue;
    rows.push({ tenant_id: gate.tenantId, category: "loss_reason", value: label, label, sort_order: ++lossSort });
  }
  let sourceSort = maxSort("customer_source");
  for (const src of template.customerSources) {
    if (have.has(`customer_source\u0000${src.value.toLocaleLowerCase("tr-TR")}`)) continue;
    rows.push({ tenant_id: gate.tenantId, category: "customer_source", value: src.value, label: src.label, sort_order: ++sourceSort });
  }

  let added = 0;
  if (rows.length > 0) {
    const { error } = await supabase.from("definitions").insert(rows);
    if (error) {
      console.error("applyOfficeTemplate:insert", error);
      return { error: "Ofis tipi şablonu uygulanamadı." };
    }
    added = rows.length;
    updateTag(`definitions:${gate.tenantId}`);
    updateTag("definitions");
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "settings.update",
    entityType: "tenant",
    entityId: gate.tenantId,
    newValue: { office_template: kind, definitions_added: added },
  });
  revalidatePath("/app/baslangic");
  revalidatePath("/app/ayarlar/tanimlar");
  return { ok: true, added };
}
