"use server";

import { randomInt } from "node:crypto";
import { revalidatePath } from "next/cache";
import { updateTenantPlanStatus } from "@/app/actions/platform";
import { convertDemoToTenant } from "@/app/actions/platform-sales";
import { generatePassword } from "@/app/admin/personel/staff-model";
import { logActivity } from "@/lib/activity";
import { OFFICE_ADMIN_DENIED, officeAdminCan } from "@/lib/admin/office-admin-access";
import {
  parseOfficeCreateInput,
  parseOfficeProfileInput,
  parseOfficeUserInput,
} from "@/lib/admin/office-create-input";
import {
  OFFICE_ADMIN_CREATE_SOURCE,
  OFFICE_TRIAL_DEFAULT_DAYS,
  confirmationMatches,
  trialEndIso,
} from "@/lib/admin/office-create-rules";
import { officeSlugCandidates, provisionSafeCompanyName, validateOfficeSlug } from "@/lib/admin/office-slug";
import { getBaseUrl } from "@/lib/base-url";
import { getDistrict, getProvince } from "@/lib/geo/reader";
import { getPlan, planLabel } from "@/lib/billing/plans";
import { planLimitErrorMessage } from "@/lib/billing/plan-limit-error";
import { EMAIL_ERROR_MESSAGE, isValidEmail, normalizeEmail } from "@/lib/email";
import { requirePlatformModule } from "@/lib/platform";
import { logPlatformActivity } from "@/lib/platform-activity";
import { checkRateLimit } from "@/lib/rate-limit";
import { insertSampleRecords, SAMPLE_DATA_COUNTS } from "@/lib/sample-data-seed";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Platform yönetimi: ofis (tenant) açma ve ofis yönetimi action'ları.
 *
 * Kurallar:
 *  - Her action `requirePlatformModule` + rol matrisi (`src/lib/admin/office-admin-access.ts`) ile kapılıdır.
 *  - Ofis açma, demo dönüşümünün ATOMİK provizyon yolunu yeniden kullanır (`convertDemoToTenant` ->
 *    `convert_demo_request_to_tenant` RPC). Burada tenant/profil/abonelik INSERT'i YOKTUR.
 *  - Paket/durum geçişleri mevcut `updateTenantPlanStatus` (atomik RPC + denetim kaydı) üzerinden gider.
 *  - Ofisin MÜŞTERİ kişisel verisi hiçbir action'da okunmaz; yalnız ofis ve personel bilgisi.
 *  - Geçici parola sunucuda üretilir, sonuçta BİR KEZ döner; denetim kaydına ve loglara yazılmaz.
 */

export type OfficeActionResult = { ok?: boolean; error?: string; message?: string };

export type SlugCheckResult = {
  ok: boolean;
  available?: boolean;
  slug?: string;
  error?: string;
  suggestions?: string[];
};

export type CreateOfficeResult = {
  ok?: boolean;
  error?: string;
  /** Hatanın ait olduğu form alanı (ilgili sekmeyi açmak için). */
  field?: string | null;
  tenantId?: string;
  tenantName?: string;
  slug?: string;
  ownerEmail?: string;
  accessLinkSent?: boolean;
  /** Yalnız "geçici parola" seçildiyse; bir kez gösterilir. */
  tempPassword?: string;
  /** Ofis açıldı ama ikincil bir adım tamamlanamadı (ofis geçerlidir; Yönetim sekmesinden tamamlanır). */
  warnings?: string[];
};

export type OfficeUserResult = OfficeActionResult & {
  userId?: string;
  accessLinkSent?: boolean;
  tempPassword?: string;
};

type Admin = ReturnType<typeof createAdminClient>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_MS = 86_400_000;
const NOT_FOUND = "Ofis bulunamadı.";
const RATE_LIMITED = "Çok sık işlem yapıldı. Lütfen biraz sonra tekrar deneyin.";

function field(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

function uuidField(formData: FormData, key: string): string {
  const v = field(formData, key);
  return UUID_RE.test(v) ? v : "";
}

function formRecord(formData: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string") out[k] = v;
  return out;
}

/** Yazma işlemleri: altyapı hatasında REDDET (güvenlik kritik). */
async function rateLimited(bucket: string, staffId: string, limit: number, windowSec: number): Promise<boolean> {
  const { allowed } = await checkRateLimit(`platform-office:${bucket}:${staffId}`, {
    limit,
    windowSec,
    failurePolicy: "deny",
  });
  return !allowed;
}

function tempPassword(): string {
  return generatePassword((max) => randomInt(max), 16);
}

async function sendAccessLink(admin: Admin, email: string): Promise<boolean> {
  const { error } = await admin.auth.resetPasswordForEmail(email, {
    redirectTo: `${getBaseUrl()}/sifre-yenile`,
  });
  if (error) {
    console.error("platform-tenants:access-link", { code: error.code, status: error.status });
    return false;
  }
  return true;
}

type GeoResolved = { ok: true; provinceName: string | null } | { ok: false; error: string };

async function resolveGeo(provinceId: string | null, districtId: string | null): Promise<GeoResolved> {
  if (!provinceId) return { ok: true, provinceName: null };
  const [province, district] = await Promise.all([
    getProvince(provinceId),
    districtId ? getDistrict(districtId) : Promise.resolve(null),
  ]);
  if (!province) return { ok: false, error: "Seçilen il bulunamadı." };
  if (districtId && (!district || district.provinceId !== provinceId)) {
    return { ok: false, error: "Seçilen ilçe bu ile ait değil." };
  }
  return { ok: true, provinceName: province.name };
}

async function findOwners(admin: Admin, tenantId: string) {
  const { data, error } = await admin
    .from("profiles")
    .select("id, full_name, is_active, created_at")
    .eq("tenant_id", tenantId)
    .eq("role", "owner")
    .order("created_at", { ascending: true })
    .limit(5);
  if (error) return null;
  return (data ?? []) as { id: string; full_name: string | null; is_active: boolean; created_at: string }[];
}

/** Auth claim'ini kanonik profile eşitler (team.ts `updateTeamMember` deseni). */
async function syncRoleClaim(admin: Admin, userId: string, tenantId: string, role: string): Promise<boolean> {
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data.user) return false;
  const meta = (data.user.app_metadata ?? {}) as Record<string, unknown>;
  const { error: claimError } = await admin.auth.admin.updateUserById(userId, {
    app_metadata: { ...meta, tenant_id: tenantId, role },
  });
  return !claimError;
}

function revalidateOffice(tenantId: string) {
  revalidatePath("/admin");
  revalidatePath("/admin/tenants");
  revalidatePath(`/admin/tenants/${tenantId}`);
}

function revalidateVitrin(...slugs: (string | null | undefined)[]) {
  revalidatePath("/vitrin/[slug]", "page");
  revalidatePath("/vitrin/[slug]/[id]", "page");
  revalidatePath("/sitemap.xml");
  for (const slug of slugs) if (slug) revalidatePath(`/vitrin/${slug}`);
}

// ---------------------------------------------------------------------------
// Vitrin adresi: salt-okunur benzersizlik denetimi (form, debounce ile çağırır)
// ---------------------------------------------------------------------------

export async function checkOfficeSlugAvailability(formData: FormData): Promise<SlugCheckResult> {
  const staff = await requirePlatformModule("tenants");
  const check = validateOfficeSlug(field(formData, "slug").toLowerCase());
  if (!check.ok) return { ok: false, error: check.error };
  const excludeId = uuidField(formData, "exclude");
  const city = field(formData, "city").slice(0, 80);

  // Salt-okunur yardımcı: altyapı hatasında formu kilitleme (asıl denetim kayıtta yeniden yapılır).
  const { allowed } = await checkRateLimit(`platform-office:slug-check:${staff.id}`, {
    limit: 90,
    windowSec: 60,
    failurePolicy: "allow",
  });
  if (!allowed) return { ok: false, error: RATE_LIMITED };

  const admin = createAdminClient();
  const candidates = officeSlugCandidates(check.slug, city);
  const { data, error } = await admin
    .from("tenants")
    .select("id, slug")
    .in("slug", [check.slug, ...candidates])
    .limit(20);
  if (error) return { ok: false, error: "Vitrin adresi şu an denetlenemedi." };

  const taken = new Set(
    ((data ?? []) as { id: string; slug: string }[]).filter((row) => row.id !== excludeId).map((row) => row.slug),
  );
  const available = !taken.has(check.slug);
  return {
    ok: true,
    available,
    slug: check.slug,
    suggestions: available ? [] : candidates.filter((c) => !taken.has(c)).slice(0, 3),
  };
}

// ---------------------------------------------------------------------------
// OFİS AÇMA
// ---------------------------------------------------------------------------

/**
 * Platform yönetiminden yeni ofis açar.
 *
 * Akış: (1) kapı + doğrulama + hız sınırı, (2) benzersizlik (vitrin adresi, personel e-postası),
 * (3) "platformdan açıldı" kaynaklı satış kaydı, (4) MEVCUT atomik demo dönüşümü (Auth kullanıcısı +
 * tek RPC işlemi; başarısızlıkta Auth kullanıcısını kendisi temizler), (5) dönüşmediyse satış kaydını sil,
 * (6) ikincil ayarlar (ofis profili, vitrin adresi, deneme süresi, döngü, durum, geçici parola, örnek veri),
 * (7) denetim kaydı. (6)'daki bir hata ofisi geçersiz kılmaz; uyarı olarak döner.
 */
export async function createTenantByAdmin(formData: FormData): Promise<CreateOfficeResult> {
  // Kapı demo dönüşümüyle (`convertDemoToTenant`) AYNI: "sales" modülü.
  const staff = await requirePlatformModule("sales");
  if (!officeAdminCan(staff.role, "create")) return { error: OFFICE_ADMIN_DENIED };

  const parsed = parseOfficeCreateInput(formRecord(formData));
  if (!parsed.ok) return { error: parsed.error, field: parsed.field };
  const input = parsed.data;

  if (input.initialStatus === "active" && !officeAdminCan(staff.role, "create_active")) {
    return {
      error: "Ofisi doğrudan aktif açmak için faturalama yetkisi gerekir. Deneme olarak açın; paket ekibi aktifleştirir.",
      field: "initial_status",
    };
  }

  if (await rateLimited("create", staff.id, 12, 3600)) {
    return { error: "Bir saatte çok fazla ofis açma denemesi yapıldı. Lütfen daha sonra tekrar deneyin." };
  }

  const admin = createAdminClient();

  const [slugRow, staffRow, geo] = await Promise.all([
    admin.from("tenants").select("id").eq("slug", input.slug).maybeSingle(),
    admin.from("platform_staff").select("id").eq("email", input.ownerEmail).maybeSingle(),
    resolveGeo(input.provinceId, input.districtId),
  ]);
  if (slugRow.error || staffRow.error) return { error: "Benzersizlik denetimi yapılamadı. Lütfen tekrar deneyin." };
  if (slugRow.data) {
    return { error: `"${input.slug}" vitrin adresi başka bir ofiste kullanılıyor.`, field: "slug" };
  }
  if (staffRow.data) {
    return { error: "Bu e-posta platform personeline ait; ofis sahibi için farklı bir e-posta kullanın.", field: "owner_email" };
  }
  if (!geo.ok) return { error: geo.error, field: "province_id" };

  // Provizyon RPC'si adres tabanını ofis adından üretir; çok uzun adlarda güvenli kısaltma kullanılır,
  // tam ad provizyondan sonra yazılır.
  const provisionName = provisionSafeCompanyName(input.officeName);
  const stamp = new Date().toLocaleString("tr-TR", {
    timeZone: "Europe/Istanbul",
    dateStyle: "short",
    timeStyle: "short",
  });

  const { data: demo, error: demoError } = await admin
    .from("demo_requests")
    .insert({
      full_name: input.ownerName,
      phone: input.ownerPhone,
      email: input.ownerEmail,
      company: provisionName,
      city: geo.provinceName,
      team_size: input.teamSize,
      source: OFFICE_ADMIN_CREATE_SOURCE,
      status: "qualified",
      assigned_to: staff.id,
      notes: `[${stamp} • ${staff.full_name}] Ofis platform yönetiminden doğrudan açıldı.`,
    })
    .select("id")
    .single();
  if (demoError || !demo) {
    console.error("createTenantByAdmin:sales-record", demoError);
    return { error: "Ofis açma kaydı oluşturulamadı. Lütfen tekrar deneyin." };
  }

  const conversionForm = new FormData();
  conversionForm.set("id", String(demo.id));
  const conversion = await convertDemoToTenant(conversionForm);

  if (!conversion.ok || !conversion.tenantId) {
    // Yarım kayıt bırakma: dönüşmediyse satış kaydını sil. RPC bağladıysa (belirsiz ağ hatası) dokunma.
    const { error: cleanupError } = await admin
      .from("demo_requests")
      .delete()
      .eq("id", demo.id)
      .is("converted_tenant_id", null);
    if (cleanupError) console.error("createTenantByAdmin:sales-record-cleanup", cleanupError);
    const message = conversion.error ?? "Ofis açılamadı. Lütfen tekrar deneyin.";
    return {
      error: message,
      field: /e-posta/i.test(message) ? "owner_email" : null,
    };
  }

  const tenantId = conversion.tenantId;
  const warnings: string[] = [];
  const nowIso = new Date().toISOString();
  let finalSlug = conversion.slug ?? input.slug;

  // (6a) Ofis profili
  const profilePatch: Record<string, unknown> = {
    phone: input.officePhone,
    province_id: input.provinceId,
    district_id: input.districtId,
    address_line: input.addressLine,
    license_no: input.licenseNo,
    tax_office: input.taxOffice,
    tax_number: input.taxNumber,
    updated_at: nowIso,
  };
  if (geo.provinceName) profilePatch.city = geo.provinceName;
  if (provisionName !== input.officeName) profilePatch.name = input.officeName;
  const { error: profileError } = await admin.from("tenants").update(profilePatch).eq("id", tenantId);
  if (profileError) {
    console.error("createTenantByAdmin:profile", profileError);
    warnings.push("Ofis iletişim ve fatura bilgileri kaydedilemedi; Yönetim sekmesinden girin.");
  }

  // (6b) Vitrin adresi (RPC ofis adından ürettiği adresi yazdı; istenen farklıysa güncelle)
  if (finalSlug !== input.slug) {
    const { error: slugError } = await admin
      .from("tenants")
      .update({ slug: input.slug, updated_at: nowIso })
      .eq("id", tenantId);
    if (slugError) {
      console.error("createTenantByAdmin:slug", slugError);
      warnings.push(`İstenen vitrin adresi atanamadı; ofis "${finalSlug}" adresiyle açıldı.`);
    } else {
      finalSlug = input.slug;
    }
  }

  // (6c) Deneme süresi (varsayılan 14 gün RPC'de yazıldı)
  if (input.trialDays !== OFFICE_TRIAL_DEFAULT_DAYS) {
    const endsAt = trialEndIso(Date.now(), input.trialDays);
    const [subResult, tenantResult] = await Promise.all([
      admin
        .from("subscriptions")
        .update({ trial_ends_at: endsAt, current_period_end: endsAt, updated_at: nowIso })
        .eq("tenant_id", tenantId),
      admin.from("tenants").update({ trial_ends_at: endsAt, updated_at: nowIso }).eq("id", tenantId),
    ]);
    if (subResult.error || tenantResult.error) {
      console.error("createTenantByAdmin:trial", subResult.error ?? tenantResult.error);
      warnings.push(`Deneme süresi ${input.trialDays} güne ayarlanamadı; ${OFFICE_TRIAL_DEFAULT_DAYS} gün olarak kaldı.`);
    }
  }

  // (6d) Faturalama döngüsü
  if (input.billingCycle === "yearly") {
    const { error: cycleError } = await admin
      .from("subscriptions")
      .update({ billing_cycle: "yearly", updated_at: nowIso })
      .eq("tenant_id", tenantId);
    if (cycleError) {
      console.error("createTenantByAdmin:cycle", cycleError);
      warnings.push("Faturalama döngüsü yıllık yapılamadı; aylık olarak kaldı.");
    }
  }

  // (6e) Başlangıç durumu: aktif (mevcut atomik paket/durum yolu; denetim kaydını RPC yazar)
  if (input.initialStatus === "active") {
    const statusForm = new FormData();
    statusForm.set("id", tenantId);
    statusForm.set("status", "active");
    const statusResult = await updateTenantPlanStatus(statusForm);
    if (!statusResult.ok) {
      console.error("createTenantByAdmin:status", statusResult.error);
      warnings.push("Ofis aktif duruma alınamadı; deneme olarak açıldı.");
    }
  }

  // (6f) Geçici parola + (6g) örnek veri: ikisi de sahibin kullanıcı kimliğini ister
  let oneTimePassword: string | undefined;
  if (input.accessMode === "link_temp" || input.seedSample) {
    const owners = await findOwners(admin, tenantId);
    const ownerId = owners?.[0]?.id ?? null;
    if (!ownerId) {
      warnings.push("Ofis sahibi kaydı okunamadı; geçici parola ve örnek veri adımı atlandı.");
    } else {
      if (input.accessMode === "link_temp") {
        const candidate = tempPassword();
        const { error: passwordError } = await admin.auth.admin.updateUserById(ownerId, { password: candidate });
        if (passwordError) {
          console.error("createTenantByAdmin:temp-password", { code: passwordError.code, status: passwordError.status });
          warnings.push("Geçici parola atanamadı; sahip e-postadaki bağlantıyla şifresini belirleyebilir.");
        } else {
          oneTimePassword = candidate;
        }
      }
      if (input.seedSample) {
        try {
          await insertSampleRecords(admin, tenantId, ownerId);
          const { error: markError } = await admin
            .from("tenants")
            .update({ sample_seeded_at: new Date().toISOString() })
            .eq("id", tenantId);
          if (markError) throw markError;
          await logActivity({
            tenantId,
            actorId: staff.id,
            action: "sample_data.seed",
            entityType: "tenant",
            entityId: tenantId,
            newValue: { ...SAMPLE_DATA_COUNTS, by: "platform" },
          });
        } catch (seedError) {
          console.error("createTenantByAdmin:sample-data", seedError);
          warnings.push("Örnek veriler yüklenemedi; ofis sahibi ana ekrandaki düğmeyle yükleyebilir.");
        }
      }
    }
  }

  if (!conversion.accessLinkSent) {
    warnings.push("Şifre belirleme e-postası gönderilemedi; Yönetim sekmesinden yeniden gönderin.");
  }

  await logPlatformActivity({
    actorId: staff.id,
    action: "tenant.create",
    entityType: "tenant",
    entityId: tenantId,
    meta: {
      via: "admin",
      slug: finalSlug,
      plan: input.plan,
      trial_days: input.trialDays,
      billing_cycle: input.billingCycle,
      initial_status: input.initialStatus,
      access_mode: input.accessMode,
      sample_data: input.seedSample,
      sales_record_id: demo.id,
      warnings: warnings.length,
    },
  });

  revalidateOffice(tenantId);
  revalidatePath("/admin/satis");

  return {
    ok: true,
    tenantId,
    tenantName: input.officeName,
    slug: finalSlug,
    ownerEmail: input.ownerEmail,
    accessLinkSent: Boolean(conversion.accessLinkSent),
    tempPassword: oneTimePassword,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// OFİS BİLGİLERİ
// ---------------------------------------------------------------------------

export async function updateTenantProfileByAdmin(formData: FormData): Promise<OfficeActionResult> {
  const staff = await requirePlatformModule("tenants");
  const scope = {
    profile: officeAdminCan(staff.role, "edit_profile"),
    billing: officeAdminCan(staff.role, "edit_billing_profile"),
  };
  if (!scope.profile && !scope.billing) return { error: OFFICE_ADMIN_DENIED };

  const tenantId = uuidField(formData, "id");
  if (!tenantId) return { error: NOT_FOUND };
  const parsed = parseOfficeProfileInput(formRecord(formData), scope);
  if (!parsed.ok) return { error: parsed.error };
  if (await rateLimited("profile", staff.id, 40, 600)) return { error: RATE_LIMITED };

  const admin = createAdminClient();
  const { data: tenant, error: readError } = await admin
    .from("tenants")
    .select("id, name, slug, phone, city, province_id, district_id, address_line, license_no, tax_office, tax_number")
    .eq("id", tenantId)
    .maybeSingle();
  if (readError || !tenant) return { error: NOT_FOUND };

  const patch: Record<string, unknown> = {};
  if (parsed.data.profile) {
    const p = parsed.data.profile;
    const geo = await resolveGeo(p.provinceId, p.districtId);
    if (!geo.ok) return { error: geo.error };
    patch.name = p.name;
    patch.phone = p.phone;
    patch.province_id = p.provinceId;
    patch.district_id = p.districtId;
    patch.address_line = p.addressLine;
    patch.license_no = p.licenseNo;
    // Şehir metni yalnız il seçilince güncellenir; ofisin kendi yazdığı şehir boş seçimle silinmez.
    if (geo.provinceName) patch.city = geo.provinceName;
  }
  if (parsed.data.billing) {
    patch.tax_office = parsed.data.billing.taxOffice;
    patch.tax_number = parsed.data.billing.taxNumber;
  }

  const current = tenant as Record<string, unknown>;
  const changed = Object.keys(patch).filter((k) => (patch[k] ?? null) !== (current[k] ?? null));
  if (changed.length === 0) return { ok: true, message: "Değişiklik yok." };

  const { error } = await admin
    .from("tenants")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", tenantId);
  if (error) {
    console.error("updateTenantProfileByAdmin", error);
    return { error: "Ofis bilgileri kaydedilemedi." };
  }

  await logPlatformActivity({
    actorId: staff.id,
    action: "tenant.update",
    entityType: "tenant",
    entityId: tenantId,
    meta: {
      changed,
      ...(changed.includes("name") ? { old_name: tenant.name, new_name: patch.name } : {}),
    },
  });

  revalidateOffice(tenantId);
  if (changed.includes("name") || changed.includes("phone")) revalidateVitrin(String(tenant.slug));
  return { ok: true, message: "Ofis bilgileri güncellendi." };
}

/** Vitrin adresi değişimi: eski bağlantılar kırılır (yönlendirme yok) — yalnız süper admin, açık onayla. */
export async function changeTenantSlugByAdmin(formData: FormData): Promise<OfficeActionResult> {
  const staff = await requirePlatformModule("tenants");
  if (!officeAdminCan(staff.role, "change_slug")) return { error: OFFICE_ADMIN_DENIED };

  const tenantId = uuidField(formData, "id");
  if (!tenantId) return { error: NOT_FOUND };
  const check = validateOfficeSlug(field(formData, "slug").toLowerCase());
  if (!check.ok) return { error: check.error };
  if (field(formData, "ack") !== "1") {
    return { error: "Eski vitrin bağlantılarının çalışmayacağını onaylamadan adres değiştirilemez." };
  }
  if (await rateLimited("slug", staff.id, 10, 3600)) return { error: RATE_LIMITED };

  const admin = createAdminClient();
  const { data: tenant, error: readError } = await admin
    .from("tenants")
    .select("id, slug")
    .eq("id", tenantId)
    .maybeSingle();
  if (readError || !tenant) return { error: NOT_FOUND };
  const oldSlug = String(tenant.slug);
  if (oldSlug === check.slug) return { ok: true, message: "Vitrin adresi zaten bu." };

  const { data: clash } = await admin.from("tenants").select("id").eq("slug", check.slug).maybeSingle();
  if (clash) return { error: `"${check.slug}" vitrin adresi başka bir ofiste kullanılıyor.` };

  const { error } = await admin
    .from("tenants")
    .update({ slug: check.slug, updated_at: new Date().toISOString() })
    .eq("id", tenantId);
  if (error) {
    console.error("changeTenantSlugByAdmin", error);
    return {
      error: error.code === "23505" ? `"${check.slug}" vitrin adresi başka bir ofiste kullanılıyor.` : "Vitrin adresi değiştirilemedi.",
    };
  }

  await logPlatformActivity({
    actorId: staff.id,
    action: "tenant.slug_change",
    entityType: "tenant",
    entityId: tenantId,
    meta: { old_slug: oldSlug, new_slug: check.slug },
  });

  revalidateOffice(tenantId);
  revalidateVitrin(oldSlug, check.slug);
  return { ok: true, message: "Vitrin adresi değiştirildi. Eski bağlantılar artık çalışmaz." };
}

// ---------------------------------------------------------------------------
// DENEME SÜRESİ + YAŞAM DÖNGÜSÜ (askıya alma / etkinleştirme / arşiv / geri yükleme)
// ---------------------------------------------------------------------------

export async function extendTenantTrialByAdmin(formData: FormData): Promise<OfficeActionResult> {
  const staff = await requirePlatformModule("tenants");
  if (!officeAdminCan(staff.role, "extend_trial")) return { error: OFFICE_ADMIN_DENIED };

  const tenantId = uuidField(formData, "id");
  if (!tenantId) return { error: NOT_FOUND };
  const dateRaw = field(formData, "trial_ends_on");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) return { error: "Geçerli bir bitiş tarihi seçin." };
  // Seçilen günün sonu, Türkiye saatiyle.
  const endMs = Date.parse(`${dateRaw}T23:59:59+03:00`);
  const nowMs = Date.now();
  if (!Number.isFinite(endMs) || endMs <= nowMs) return { error: "Deneme bitişi bugünden sonraki bir tarih olmalı." };
  if (endMs > nowMs + 365 * DAY_MS) return { error: "Deneme bitişi en çok bir yıl sonrası olabilir." };
  if (await rateLimited("trial", staff.id, 20, 600)) return { error: RATE_LIMITED };

  const admin = createAdminClient();
  const { data: tenant, error: readError } = await admin
    .from("tenants")
    .select("id, status, trial_ends_at")
    .eq("id", tenantId)
    .maybeSingle();
  if (readError || !tenant) return { error: NOT_FOUND };
  if (tenant.status !== "trial" && tenant.status !== "past_due") {
    return { error: "Deneme süresi yalnız denemedeki ya da süresi dolmuş (ödeme gecikmiş) ofiste uzatılır." };
  }

  // Süresi dolmuş ofis: önce deneme durumuna geri alınır (atomik RPC; denetim kaydını kendisi yazar).
  const reopened = tenant.status === "past_due";
  if (reopened) {
    const statusForm = new FormData();
    statusForm.set("id", tenantId);
    statusForm.set("status", "trial");
    const statusResult = await updateTenantPlanStatus(statusForm);
    if (!statusResult.ok) return { error: statusResult.error ?? "Ofis deneme durumuna alınamadı." };
  }

  const endsAt = new Date(endMs).toISOString();
  const nowIso = new Date(nowMs).toISOString();
  // Deneme bitişini cron `subscriptions.trial_ends_at` üzerinden okur: önce abonelik.
  const { data: subRows, error: subError } = await admin
    .from("subscriptions")
    .update({ trial_ends_at: endsAt, current_period_end: endsAt, updated_at: nowIso })
    .eq("tenant_id", tenantId)
    .select("id");
  if (subError || (subRows?.length ?? 0) !== 1) {
    console.error("extendTenantTrialByAdmin:subscription", subError);
    return { error: "Abonelik kaydı güncellenemedi; deneme süresi değişmedi." };
  }
  const { error: tenantError } = await admin
    .from("tenants")
    .update({ trial_ends_at: endsAt, updated_at: nowIso })
    .eq("id", tenantId);
  if (tenantError) {
    console.error("extendTenantTrialByAdmin:tenant", tenantError);
    return { error: "Deneme süresi abonelikte uzatıldı ancak ofis kaydına yazılamadı. İşlemi tekrar deneyin." };
  }

  await logPlatformActivity({
    actorId: staff.id,
    action: "tenant.trial_extend",
    entityType: "tenant",
    entityId: tenantId,
    meta: { old_trial_ends_at: tenant.trial_ends_at ?? null, new_trial_ends_at: endsAt, reopened },
  });

  revalidateOffice(tenantId);
  revalidatePath("/admin/billing");
  return { ok: true, message: reopened ? "Ofis yeniden denemeye alındı ve süre uzatıldı." : "Deneme süresi uzatıldı." };
}

const LIFECYCLE = {
  suspend: { gate: "suspend", status: "suspended", audit: "tenant.suspend", needsName: true, needsReason: true },
  reactivate: { gate: "reactivate", status: null, audit: "tenant.reactivate", needsName: false, needsReason: false },
  archive: { gate: "archive", status: "cancelled", audit: "tenant.archive", needsName: true, needsReason: true },
  restore: { gate: "restore", status: null, audit: "tenant.restore", needsName: false, needsReason: false },
} as const;

type LifecycleMode = keyof typeof LIFECYCLE;

/**
 * Askıya al / yeniden etkinleştir / arşivle (iptal durumu; veri silinmez) / arşivden geri yükle.
 * Kalıcı silme YOKTUR. Durum geçişi mevcut atomik `updateTenantPlanStatus` yolundan yapılır.
 */
export async function setTenantLifecycleByAdmin(formData: FormData): Promise<OfficeActionResult> {
  const staff = await requirePlatformModule("tenants");
  const modeRaw = field(formData, "mode");
  if (!(modeRaw in LIFECYCLE)) return { error: "Geçersiz işlem." };
  const mode = modeRaw as LifecycleMode;
  const rule = LIFECYCLE[mode];
  if (!officeAdminCan(staff.role, rule.gate)) return { error: OFFICE_ADMIN_DENIED };

  const tenantId = uuidField(formData, "id");
  if (!tenantId) return { error: NOT_FOUND };
  const reason = field(formData, "reason").slice(0, 500);
  if (rule.needsReason && reason.length < 5) return { error: "Gerekçe yazın (en az 5 karakter)." };
  const target = field(formData, "target_status");
  const nextStatus = rule.status ?? (target === "trial" ? "trial" : "active");
  if (await rateLimited("lifecycle", staff.id, 20, 600)) return { error: RATE_LIMITED };

  const admin = createAdminClient();
  const { data: tenant, error: readError } = await admin
    .from("tenants")
    .select("id, name, status")
    .eq("id", tenantId)
    .maybeSingle();
  if (readError || !tenant) return { error: NOT_FOUND };

  if (rule.needsName && !confirmationMatches(field(formData, "confirm_name"), String(tenant.name))) {
    return { error: "Onay için ofis adını aynen yazın." };
  }
  if (mode === "suspend" && tenant.status === "suspended") return { error: "Ofis zaten askıda." };
  if (mode === "archive" && tenant.status === "cancelled") return { error: "Ofis zaten arşivde." };
  if (mode === "reactivate" && tenant.status !== "suspended") return { error: "Yalnız askıdaki ofis yeniden etkinleştirilir." };
  if (mode === "restore" && tenant.status !== "cancelled") return { error: "Yalnız arşivdeki ofis geri yüklenir." };

  const statusForm = new FormData();
  statusForm.set("id", tenantId);
  statusForm.set("status", nextStatus);
  const result = await updateTenantPlanStatus(statusForm);
  if (!result.ok) return { error: result.error ?? "Ofis durumu değiştirilemedi." };

  await logPlatformActivity({
    actorId: staff.id,
    action: rule.audit,
    entityType: "tenant",
    entityId: tenantId,
    meta: { previous_status: tenant.status, status: nextStatus, ...(reason ? { reason } : {}) },
  });

  revalidateOffice(tenantId);
  const messages: Record<LifecycleMode, string> = {
    suspend: "Ofis askıya alındı; panele erişim kesildi.",
    reactivate: "Ofis yeniden etkinleştirildi.",
    archive: "Ofis arşivlendi. Veriler silinmedi; geri yüklenebilir.",
    restore: "Ofis arşivden geri yüklendi.",
  };
  return { ok: true, message: messages[mode] };
}

// ---------------------------------------------------------------------------
// OFİS SAHİBİ
// ---------------------------------------------------------------------------

export async function resendTenantOwnerAccessLink(formData: FormData): Promise<OfficeActionResult> {
  const staff = await requirePlatformModule("tenants");
  if (!officeAdminCan(staff.role, "resend_access")) return { error: OFFICE_ADMIN_DENIED };
  const tenantId = uuidField(formData, "id");
  if (!tenantId) return { error: NOT_FOUND };
  if (await rateLimited(`access-link:${tenantId}`, staff.id, 3, 900)) {
    return { error: "Bu ofis için kısa sürede çok fazla erişim e-postası istendi. 15 dakika sonra tekrar deneyin." };
  }

  const admin = createAdminClient();
  const owners = await findOwners(admin, tenantId);
  const owner = owners?.find((o) => o.is_active) ?? null;
  if (!owner) return { error: "Aktif ofis sahibi bulunamadı." };

  const { data: authUser, error: authError } = await admin.auth.admin.getUserById(owner.id);
  const email = normalizeEmail(authUser.user?.email ?? "");
  if (authError || !email) return { error: "Ofis sahibinin e-postası bulunamadı." };

  if (!(await sendAccessLink(admin, email))) {
    return { error: "Erişim e-postası gönderilemedi. E-posta sağlayıcısını kontrol edin." };
  }

  await logPlatformActivity({
    actorId: staff.id,
    action: "tenant.owner_access_link",
    entityType: "tenant",
    entityId: tenantId,
    meta: { owner_user_id: owner.id },
  });
  return { ok: true, message: "Şifre belirleme bağlantısı ofis sahibinin e-postasına gönderildi." };
}

/** Sahip e-postası hesabın anahtarıdır: yalnız süper admin, ofis adını yazarak onayla. */
export async function changeTenantOwnerEmailByAdmin(formData: FormData): Promise<OfficeActionResult> {
  const staff = await requirePlatformModule("tenants");
  if (!officeAdminCan(staff.role, "change_owner_email")) return { error: OFFICE_ADMIN_DENIED };

  const tenantId = uuidField(formData, "id");
  if (!tenantId) return { error: NOT_FOUND };
  const newEmail = normalizeEmail(field(formData, "new_email"));
  if (!newEmail || !isValidEmail(newEmail)) return { error: EMAIL_ERROR_MESSAGE };
  const resetPassword = field(formData, "reset_password") === "1";
  if (await rateLimited("owner-email", staff.id, 6, 3600)) return { error: RATE_LIMITED };

  const admin = createAdminClient();
  const { data: tenant, error: readError } = await admin
    .from("tenants")
    .select("id, name")
    .eq("id", tenantId)
    .maybeSingle();
  if (readError || !tenant) return { error: NOT_FOUND };
  if (!confirmationMatches(field(formData, "confirm_name"), String(tenant.name))) {
    return { error: "Onay için ofis adını aynen yazın." };
  }

  const owners = await findOwners(admin, tenantId);
  if (!owners || owners.length === 0) return { error: "Ofis sahibi bulunamadı." };
  if (owners.length > 1) return { error: "Bu ofiste birden fazla sahip kaydı var; önce sahipliği tek kullanıcıya devredin." };
  const owner = owners[0]!;

  const [{ data: authUser, error: authError }, { data: staffClash }] = await Promise.all([
    admin.auth.admin.getUserById(owner.id),
    admin.from("platform_staff").select("id").eq("email", newEmail).maybeSingle(),
  ]);
  const oldEmail = normalizeEmail(authUser.user?.email ?? "");
  if (authError || !authUser.user) return { error: "Ofis sahibinin kimlik kaydı okunamadı." };
  if (oldEmail === newEmail) return { error: "Yeni e-posta mevcut e-postayla aynı." };
  if (staffClash) return { error: "Bu e-posta platform personeline ait; farklı bir e-posta kullanın." };

  const { error: updateError } = await admin.auth.admin.updateUserById(owner.id, {
    email: newEmail,
    email_confirm: true,
    ...(resetPassword ? { password: generatePassword((max) => randomInt(max), 24) } : {}),
  });
  if (updateError) {
    console.error("changeTenantOwnerEmailByAdmin", { code: updateError.code, status: updateError.status });
    return {
      error: /already|registered|exists/i.test(updateError.message ?? "")
        ? "Bu e-posta başka bir hesapta kayıtlı."
        : "Sahip e-postası değiştirilemedi.",
    };
  }

  const linkSent = await sendAccessLink(admin, newEmail);

  await logPlatformActivity({
    actorId: staff.id,
    action: "tenant.owner_email_change",
    entityType: "tenant",
    entityId: tenantId,
    meta: { owner_user_id: owner.id, old_email: oldEmail, new_email: newEmail, password_reset: resetPassword, link_sent: linkSent },
  });
  await logActivity({
    tenantId,
    actorId: staff.id,
    action: "team.owner_email_change",
    entityType: "profile",
    entityId: owner.id,
    newValue: { by: "platform", password_reset: resetPassword },
  });

  revalidateOffice(tenantId);
  return {
    ok: true,
    message: linkSent
      ? "Sahip e-postası değiştirildi; yeni adrese şifre belirleme bağlantısı gönderildi."
      : "Sahip e-postası değiştirildi ancak erişim e-postası gönderilemedi; bağlantıyı yeniden gönderin.",
  };
}

/**
 * Sahipliği ofisteki başka bir aktif kullanıcıya devreder. Güvenli sıra: ÖNCE yeni sahip atanır
 * (ofis hiçbir an sahipsiz kalmaz), SONRA eski sahip Genel müdür yapılır. Auth claim'i her adımda
 * profile eşitlenir; eşitlenemeyen adım geri alınır. Yarıda kalan devir aynı seçimle tekrarlanabilir.
 */
export async function transferTenantOwnershipByAdmin(formData: FormData): Promise<OfficeActionResult> {
  const staff = await requirePlatformModule("tenants");
  if (!officeAdminCan(staff.role, "transfer_ownership")) return { error: OFFICE_ADMIN_DENIED };

  const tenantId = uuidField(formData, "id");
  const newOwnerId = uuidField(formData, "new_owner_id");
  if (!tenantId) return { error: NOT_FOUND };
  if (!newOwnerId) return { error: "Yeni sahibi seçin." };
  if (await rateLimited("owner-transfer", staff.id, 6, 3600)) return { error: RATE_LIMITED };

  const admin = createAdminClient();
  const [{ data: tenant, error: readError }, { data: rows, error: rowsError }] = await Promise.all([
    admin.from("tenants").select("id, name").eq("id", tenantId).maybeSingle(),
    admin
      .from("profiles")
      .select("id, role, is_active, full_name")
      .eq("tenant_id", tenantId)
      .or(`role.eq.owner,id.eq.${newOwnerId}`)
      .limit(20),
  ]);
  if (readError || !tenant) return { error: NOT_FOUND };
  if (rowsError) return { error: "Ofis kullanıcıları okunamadı." };
  if (!confirmationMatches(field(formData, "confirm_name"), String(tenant.name))) {
    return { error: "Onay için ofis adını aynen yazın." };
  }

  const members = (rows ?? []) as { id: string; role: string; is_active: boolean; full_name: string | null }[];
  const target = members.find((m) => m.id === newOwnerId);
  if (!target) return { error: "Seçilen kullanıcı bu ofise ait değil." };
  if (!target.is_active) return { error: "Pasif kullanıcıya sahiplik devredilemez." };
  const previousOwners = members.filter((m) => m.role === "owner" && m.id !== newOwnerId);
  if (target.role === "owner" && previousOwners.length === 0) return { error: "Seçilen kullanıcı zaten ofis sahibi." };

  // 1) Yeni sahip
  if (target.role !== "owner") {
    const { error: promoteError } = await admin
      .from("profiles")
      .update({ role: "owner" })
      .eq("id", newOwnerId)
      .eq("tenant_id", tenantId);
    if (promoteError) {
      console.error("transferTenantOwnershipByAdmin:promote", promoteError);
      return { error: "Yeni sahip atanamadı; değişiklik yapılmadı." };
    }
    if (!(await syncRoleClaim(admin, newOwnerId, tenantId, "owner"))) {
      await admin.from("profiles").update({ role: target.role }).eq("id", newOwnerId).eq("tenant_id", tenantId);
      return { error: "Yeni sahibin kimlik rolü güncellenemedi; değişiklik geri alındı." };
    }
  }

  // 2) Eski sahip(ler) -> Genel müdür
  const failed: string[] = [];
  for (const previous of previousOwners) {
    const { error: demoteError } = await admin
      .from("profiles")
      .update({ role: "gm" })
      .eq("id", previous.id)
      .eq("tenant_id", tenantId);
    if (demoteError) {
      failed.push(previous.id);
      continue;
    }
    if (!(await syncRoleClaim(admin, previous.id, tenantId, "gm"))) {
      await admin.from("profiles").update({ role: "owner" }).eq("id", previous.id).eq("tenant_id", tenantId);
      failed.push(previous.id);
    }
  }

  await logPlatformActivity({
    actorId: staff.id,
    action: "tenant.owner_transfer",
    entityType: "tenant",
    entityId: tenantId,
    meta: {
      new_owner_user_id: newOwnerId,
      previous_owner_user_ids: previousOwners.map((p) => p.id),
      previous_owner_new_role: "gm",
      incomplete: failed.length > 0,
    },
  });
  await logActivity({
    tenantId,
    actorId: staff.id,
    action: "team.owner_transfer",
    entityType: "profile",
    entityId: newOwnerId,
    oldValue: { owner_user_ids: previousOwners.map((p) => p.id) },
    newValue: { owner_user_id: newOwnerId, by: "platform" },
  });

  revalidateOffice(tenantId);
  if (failed.length > 0) {
    return {
      error: "Yeni sahip atandı ancak eski sahibin rolü düşürülemedi (ofiste şu an iki sahip var). Aynı seçimle tekrar deneyin.",
    };
  }
  return { ok: true, message: "Sahiplik devredildi. Eski sahip Genel müdür rolüne alındı; roller bir sonraki oturum yenilemesinde geçerli olur." };
}

// ---------------------------------------------------------------------------
// OFİS KULLANICILARI (ofis adına)
// ---------------------------------------------------------------------------

async function seatAvailable(admin: Admin, tenantId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const [{ data: tenant, error: tenantError }, { count, error: countError }] = await Promise.all([
    admin.from("tenants").select("plan, status").eq("id", tenantId).maybeSingle(),
    admin.from("profiles").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("is_active", true),
  ]);
  if (tenantError || countError || !tenant) return { ok: false, error: "Paket ve kullanıcı kapasitesi doğrulanamadı." };
  if (tenant.status === "suspended" || tenant.status === "cancelled") {
    return { ok: false, error: "Askıdaki ya da arşivdeki ofise kullanıcı eklenemez." };
  }
  const limit = getPlan(String(tenant.plan)).limits.seats;
  if ((count ?? 0) >= limit) {
    return {
      ok: false,
      error: `${planLabel(String(tenant.plan))} paketi en fazla ${limit} aktif kullanıcı destekliyor. Önce paketi yükseltin ya da bir kullanıcıyı pasife alın.`,
    };
  }
  return { ok: true };
}

export async function addTenantUserByAdmin(formData: FormData): Promise<OfficeUserResult> {
  const staff = await requirePlatformModule("tenants");
  if (!officeAdminCan(staff.role, "add_user")) return { error: OFFICE_ADMIN_DENIED };

  const tenantId = uuidField(formData, "id");
  if (!tenantId) return { error: NOT_FOUND };
  const parsed = parseOfficeUserInput(formRecord(formData));
  if (!parsed.ok) return { error: parsed.error };
  const input = parsed.data;
  if (await rateLimited("user-add", staff.id, 30, 3600)) return { error: RATE_LIMITED };

  const admin = createAdminClient();
  const seat = await seatAvailable(admin, tenantId);
  if (!seat.ok) return { error: seat.error };

  const password = tempPassword();
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: input.email,
    password,
    email_confirm: true,
    user_metadata: { full_name: input.fullName, phone: input.phone ?? "" },
    app_metadata: { tenant_id: tenantId, role: input.role },
  });
  if (createError || !created.user) {
    return {
      error: /already|registered|exists/i.test(createError?.message ?? "")
        ? "Bu e-posta zaten kayıtlı."
        : "Kullanıcı oluşturulamadı.",
    };
  }

  const userId = created.user.id;
  const { error: profileError } = await admin.from("profiles").insert({
    id: userId,
    tenant_id: tenantId,
    full_name: input.fullName,
    phone: input.phone,
    role: input.role,
  });
  if (profileError) {
    // Yarım kayıt bırakma: profil oluşmadıysa Auth kullanıcısını sil.
    const { error: cleanupError } = await admin.auth.admin.deleteUser(userId);
    if (cleanupError) console.error("addTenantUserByAdmin:auth-cleanup", { userId, cleanupError });
    return { error: planLimitErrorMessage(profileError) ?? "Kullanıcı profili oluşturulamadı." };
  }

  const accessLinkSent = await sendAccessLink(admin, input.email);

  await logPlatformActivity({
    actorId: staff.id,
    action: "tenant.user_add",
    entityType: "tenant",
    entityId: tenantId,
    meta: { user_id: userId, role: input.role, access_mode: input.accessMode, link_sent: accessLinkSent },
  });
  await logActivity({
    tenantId,
    actorId: staff.id,
    action: "team.member_created",
    entityType: "profile",
    entityId: userId,
    newValue: { role: input.role, by: "platform" },
  });

  revalidateOffice(tenantId);
  revalidatePath("/admin/members");
  return {
    ok: true,
    userId,
    accessLinkSent,
    tempPassword: input.accessMode === "link_temp" ? password : undefined,
    message: accessLinkSent
      ? "Kullanıcı eklendi; şifre belirleme bağlantısı e-postasına gönderildi."
      : "Kullanıcı eklendi ancak erişim e-postası gönderilemedi.",
  };
}

export async function setTenantUserActiveByAdmin(formData: FormData): Promise<OfficeActionResult> {
  const staff = await requirePlatformModule("tenants");
  const next = field(formData, "active") === "true";
  if (!officeAdminCan(staff.role, next ? "reactivate_user" : "deactivate_user")) return { error: OFFICE_ADMIN_DENIED };

  const tenantId = uuidField(formData, "id");
  const memberId = uuidField(formData, "member_id");
  if (!tenantId || !memberId) return { error: "Kullanıcı bulunamadı." };
  if (await rateLimited("user-active", staff.id, 40, 600)) return { error: RATE_LIMITED };

  const admin = createAdminClient();
  const { data: target, error: readError } = await admin
    .from("profiles")
    .select("id, role, is_active")
    .eq("id", memberId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (readError || !target) return { error: "Kullanıcı bu ofise ait değil." };
  if (target.role === "owner" && !next) {
    return { error: "Ofis sahibi pasife alınamaz; önce sahipliği başka bir kullanıcıya devredin." };
  }
  if (target.is_active === next) return { ok: true, message: next ? "Kullanıcı zaten aktif." : "Kullanıcı zaten pasif." };

  if (next) {
    const seat = await seatAvailable(admin, tenantId);
    if (!seat.ok) return { error: seat.error };
  }

  const { data: authRecord, error: authError } = await admin.auth.admin.getUserById(memberId);
  if (authError || !authRecord.user) return { error: "Kullanıcının kimlik kaydı doğrulanamadı." };

  const { error: updateError } = await admin
    .from("profiles")
    .update({ is_active: next })
    .eq("id", memberId)
    .eq("tenant_id", tenantId);
  if (updateError) return { error: planLimitErrorMessage(updateError) ?? "Kullanıcı güncellenemedi." };

  const meta = (authRecord.user.app_metadata ?? {}) as Record<string, unknown>;
  const { error: claimError } = await admin.auth.admin.updateUserById(memberId, {
    app_metadata: {
      ...meta,
      tenant_id: tenantId,
      role: target.role,
      account_active: next,
      deactivated_at: next ? null : new Date().toISOString(),
    },
    ban_duration: next ? "none" : "876000h",
  });
  if (claimError) {
    await admin.from("profiles").update({ is_active: target.is_active }).eq("id", memberId).eq("tenant_id", tenantId);
    return { error: "Kullanıcının kimlik durumu güncellenemedi; değişiklik geri alındı." };
  }

  let sessionWarning = false;
  if (!next) {
    const { error: revokeError } = await admin.rpc("revoke_team_member_sessions", {
      p_user_id: memberId,
      p_tenant_id: tenantId,
    });
    if (revokeError) {
      // Güvenli tarafta kal: profil pasif ve Auth kullanıcısı yasaklı; yalnız açık oturum temizliği kaldı.
      console.error("setTenantUserActiveByAdmin:revoke", { memberId, error: revokeError.message });
      sessionWarning = true;
    }
  }

  await logPlatformActivity({
    actorId: staff.id,
    action: next ? "tenant.user_reactivate" : "tenant.user_deactivate",
    entityType: "tenant",
    entityId: tenantId,
    meta: { user_id: memberId, role: target.role },
  });
  await logActivity({
    tenantId,
    actorId: staff.id,
    action: next ? "team.member_reactivated" : "team.member_deactivated",
    entityType: "profile",
    entityId: memberId,
    newValue: { by: "platform" },
  });

  revalidateOffice(tenantId);
  revalidatePath("/admin/members");
  if (sessionWarning) return { error: "Kullanıcı pasife alındı; açık oturum temizliği tekrar denenmeli." };
  return { ok: true, message: next ? "Kullanıcı yeniden etkinleştirildi." : "Kullanıcı pasife alındı ve oturumları kapatıldı." };
}

// ---------------------------------------------------------------------------
// DAHİLİ NOT (platform_audit_logs tabanlı; ofis görmez, değiştirilemez)
// ---------------------------------------------------------------------------

export async function addTenantPlatformNote(formData: FormData): Promise<OfficeActionResult> {
  const staff = await requirePlatformModule("tenants");
  if (!officeAdminCan(staff.role, "note")) return { error: OFFICE_ADMIN_DENIED };

  const tenantId = uuidField(formData, "id");
  if (!tenantId) return { error: NOT_FOUND };
  const note = field(formData, "note").replace(/\r\n/g, "\n");
  if (note.length < 3) return { error: "Not en az 3 karakter olmalı." };
  if (note.length > 1000) return { error: "Not en çok 1000 karakter olabilir." };
  if (await rateLimited("note", staff.id, 30, 600)) return { error: RATE_LIMITED };

  const admin = createAdminClient();
  const { data: tenant } = await admin.from("tenants").select("id").eq("id", tenantId).maybeSingle();
  if (!tenant) return { error: NOT_FOUND };

  // Not, denetim kaydının KENDİSİDİR: yazılamadıysa hata döner (fire-and-forget değil).
  const { error } = await admin.from("platform_audit_logs").insert({
    actor_id: staff.id,
    action: "tenant.note",
    entity_type: "tenant",
    entity_id: tenantId,
    meta: { note },
  });
  if (error) {
    console.error("addTenantPlatformNote", error);
    return { error: "Not kaydedilemedi." };
  }

  revalidatePath(`/admin/tenants/${tenantId}`);
  return { ok: true, message: "Not eklendi." };
}
