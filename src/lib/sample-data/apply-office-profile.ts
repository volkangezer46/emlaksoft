import type { SupabaseClient } from "@supabase/supabase-js";
import { randomInt } from "node:crypto";
import { logActivity } from "@/lib/activity";
import { now } from "@/lib/clock";
import { verifyImageFile } from "@/lib/file-validation";
import { getBaseUrl } from "@/lib/base-url";
import { getDistrict, getProvince } from "@/lib/geo/reader";
import { parsePhoneStrict } from "@/lib/phone-rules";
import { provisionTeamMember } from "@/lib/team/provision-member";
import type { WizardOfficeProfile } from "./office-profile";

/**
 * Kayıt sihirbazı → yeni ofise profil uygulama (SUNUCU; `signUp` provizyondan SONRA çağırır).
 *
 * Hiçbir adım kayıt akışını kesmez: her yazma best-effort'tur, hata uyarı listesine düşer ve etkinlik günlüğüne
 * yazılır (kullanıcı Ayarlar'dan tamamlar). `admin` çağıranın (signUp) elindeki service_role istemcisidir;
 * yeni createAdminClient çağrısı YOKTUR. Yazılanlar:
 *  1. tenants: il/ilçe (+ `city` metni), marka rengi; genişletme sütunları (office_type, focus_segments,
 *     work_district_ids) yalnız migration 20261006000600 uygulanmışsa — yoksa sessizce atlanır.
 *  2. Logo: içerik imzası doğrulanır (SVG yok), `tenant-logos/{tenantId}/logo.{ext}` (Ayarlar > Logo ile aynı yol).
 *  3. Ekip daveti: en çok 3 e-posta; üye `provisionTeamMember` çekirdeğiyle açılır (koltuk/şube doğrulaması aynı),
 *     erişim bağlantısı şifre sıfırlama e-postasıyla gider (Ekip > Yeni danışman "E-posta daveti" ile aynı yol).
 */

const LOGO_BUCKET = "tenant-logos";
const LOGO_MAX = 2 * 1024 * 1024;
const LOGO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export type ApplyProfileResult = { warnings: string[]; invited: number };

/** Sütun yok (42703 / PGRST204) → genişletme migration'ı uygulanmamış; hata değil "etkin değil". */
function isMissingColumn(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  const code = String(error.code ?? "");
  return code === "42703" || code === "PGRST204" || String(error.message ?? "").toLowerCase().includes("column");
}

const TEMP_PASSWORD_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
function tempPassword(): string {
  let out = "";
  for (let i = 0; i < 14; i += 1) out += TEMP_PASSWORD_CHARS[randomInt(TEMP_PASSWORD_CHARS.length)];
  return out;
}

/** "ayse.yilmaz@x.com" → "Ayse Yilmaz" (davetli kendi adını ilk girişte düzeltir). */
export function displayNameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "";
  const words = local
    .split(/[._\-+]+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((w) => w.charAt(0).toLocaleUpperCase("tr-TR") + w.slice(1));
  return words.join(" ") || "Davetli danışman";
}

export async function applyWizardOfficeProfile(
  admin: SupabaseClient,
  /** Anonim sunucu istemcisi (davet e-postası `resetPasswordForEmail` ile gider). */
  publicClient: Pick<SupabaseClient, "auth">,
  input: { tenantId: string; ownerId: string; profile: WizardOfficeProfile; logo: File | null },
): Promise<ApplyProfileResult> {
  const warnings: string[] = [];
  const { tenantId, ownerId, profile } = input;

  // 1) Temel ofis alanları (sütunlar init'ten beri var).
  const base: Record<string, unknown> = {};
  if (profile.provinceId) {
    base.province_id = profile.provinceId;
    const prov = await getProvince(profile.provinceId).catch(() => null);
    if (prov?.name) base.city = prov.name;
    if (profile.districtId) {
      const dist = await getDistrict(profile.districtId).catch(() => null);
      // İlçe ile il uyumsuzsa ilçe yazılmaz (istemci kurcalaması / eski seçim).
      if (dist && dist.provinceId === profile.provinceId) base.district_id = profile.districtId;
    }
  }
  if (profile.brandColor) base.brand_color = profile.brandColor;
  // İletişim ve yasal kimlik (isteğe bağlı): telefon yalnız katı doğrulamadan geçerse saklama biçimiyle yazılır.
  if (profile.officePhoneRaw) {
    const phone = parsePhoneStrict(profile.officePhoneRaw);
    if (phone.ok) base.phone = phone.stored;
    else warnings.push("Ofis telefonu geçersiz olduğu için kaydedilmedi; Ayarlar > Ofis bilgileri'nden ekleyin.");
  }
  if (profile.addressLine) base.address_line = profile.addressLine;
  if (profile.licenseNo) base.license_no = profile.licenseNo;
  if (Object.keys(base).length > 0) {
    const { error } = await admin.from("tenants").update({ ...base, updated_at: new Date(now()).toISOString() }).eq("id", tenantId);
    if (error) {
      console.error("applyWizardOfficeProfile base", error);
      warnings.push("Konum/marka rengi kaydedilemedi; Ayarlar > Marka & kimlik'ten tamamlayın.");
    }
  }

  // 2) Genişletme sütunları (migration 20261006000600) — yoksa sessiz.
  const ext: Record<string, unknown> = {};
  if (profile.officeType) ext.office_type = profile.officeType;
  if (profile.focus.length > 0) ext.focus_segments = profile.focus;
  if (profile.workDistrictIds.length > 0) ext.work_district_ids = profile.workDistrictIds;
  if (Object.keys(ext).length > 0) {
    const { error } = await admin.from("tenants").update(ext).eq("id", tenantId);
    if (error && !isMissingColumn(error)) {
      console.error("applyWizardOfficeProfile ext", error);
      warnings.push("Ofis türü / odak bilgisi kaydedilemedi.");
    }
  }

  // 3) Logo (isteğe bağlı).
  if (input.logo && input.logo.size > 0) {
    if (input.logo.size > LOGO_MAX) {
      warnings.push("Logo 2 MB'ı aşıyor; Ayarlar'dan daha küçük bir dosya yükleyin.");
    } else {
      const verified = await verifyImageFile(input.logo, LOGO_TYPES);
      if (!verified.ok) {
        warnings.push(`Logo yüklenmedi: ${verified.error}`);
      } else {
        const ext2 = verified.type === "image/webp" ? "webp" : verified.type === "image/png" ? "png" : "jpg";
        const path = `${tenantId}/logo.${ext2}`;
        const bytes = await input.logo.arrayBuffer();
        const { error: upErr } = await admin.storage.from(LOGO_BUCKET).upload(path, bytes, { contentType: verified.type, upsert: true });
        if (upErr) {
          console.error("applyWizardOfficeProfile logo", upErr);
          warnings.push("Logo yüklenemedi; Ayarlar > Marka & kimlik'ten tekrar deneyin.");
        } else {
          const { data: pub } = admin.storage.from(LOGO_BUCKET).getPublicUrl(path);
          const { error: dbErr } = await admin.from("tenants").update({ logo_url: pub.publicUrl }).eq("id", tenantId);
          if (dbErr) warnings.push("Logo yüklendi ancak ofise bağlanamadı; Ayarlar'dan tekrar yükleyin.");
        }
      }
    }
  }

  // 4) Ekip daveti (isteğe bağlı, en çok 3).
  let invited = 0;
  // Kayıt akışında davet gönderilmez: readWizardOfficeProfile inviteEmails'i her zaman boş döner (kimliksiz davet kapalı).
  for (const email of profile.inviteEmails) {
    const created = await provisionTeamMember(admin, {
      tenantId,
      fullName: displayNameFromEmail(email),
      email,
      phone: "",
      password: tempPassword(),
      role: "advisor",
      branchId: "",
    });
    if (!created.ok) {
      warnings.push(`${email} davet edilemedi: ${created.error}`);
      continue;
    }
    invited += 1;
    try {
      const { error } = await publicClient.auth.resetPasswordForEmail(email, { redirectTo: `${getBaseUrl()}/sifre-yenile` });
      if (error) warnings.push(`${email} için davet e-postası gönderilemedi; Ekip sayfasından "Daveti yinele".`);
    } catch (e) {
      console.error("applyWizardOfficeProfile invite mail", e);
      warnings.push(`${email} için davet e-postası gönderilemedi; Ekip sayfasından "Daveti yinele".`);
    }
    await logActivity({
      tenantId,
      actorId: ownerId,
      action: "team.advisor_created",
      entityType: "profile",
      entityId: created.id,
      newValue: { role: "advisor", invite_mode: "email", by: "registration_wizard" },
    });
  }

  await logActivity({
    tenantId,
    actorId: ownerId,
    action: "settings.update",
    entityType: "tenant",
    entityId: tenantId,
    newValue: {
      by: "registration_wizard",
      office_type: profile.officeType,
      focus: profile.focus,
      work_districts: profile.workDistrictIds.length,
      brand_color: profile.brandColor,
      logo: Boolean(input.logo && input.logo.size > 0),
      invited,
      warnings,
    },
  });

  return { warnings, invited };
}
