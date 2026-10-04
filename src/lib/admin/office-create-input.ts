import { z } from "zod";
import { isPlanId, normalizeBillingCycle, type BillingCycle, type PlanId } from "@/lib/billing/plans";
import type { RegistrationTeamSize } from "@/lib/billing/registration-plan";
import { parsePhone, PHONE_ERROR_MESSAGE, TR_MOBILE_ERROR_MESSAGE } from "@/lib/phone";
import { emailSchema } from "@/lib/validation/contact";
import {
  OFFICE_ACCESS_MODES,
  OFFICE_INITIAL_STATUSES,
  OFFICE_TRIAL_DEFAULT_DAYS,
  OFFICE_TRIAL_MAX_DAYS,
  OFFICE_TRIAL_MIN_DAYS,
  OFFICE_USER_ROLES,
  TAX_NUMBER_RE,
  teamSizeForPlan,
  type OfficeAccessMode,
  type OfficeInitialStatus,
  type OfficeUserRole,
} from "./office-create-rules";
import { slugifyOffice, validateOfficeSlug } from "./office-slug";

/**
 * Platform yönetiminden ofis açma girdisi (zod). Form alan adları `office-tabs.ts` ile birebirdir.
 * Telefonlar `parsePhone` ile saklama biçimine, e-posta `normalizeEmail` ile küçük harfe çevrilir.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const text = (v: unknown) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "");

function requiredText(label: string, min: number, max: number) {
  return z.unknown().transform((v, ctx) => {
    const s = text(v);
    if (s.length < min) {
      ctx.addIssue({ code: "custom", message: s ? `${label} en az ${min} karakter olmalı.` : `${label} zorunlu.` });
      return z.NEVER;
    }
    if (s.length > max) {
      ctx.addIssue({ code: "custom", message: `${label} en çok ${max} karakter olabilir.` });
      return z.NEVER;
    }
    return s;
  });
}

function optionalText(label: string, max: number) {
  return z.unknown().transform((v, ctx): string | null => {
    const s = text(v);
    if (s.length > max) {
      ctx.addIssue({ code: "custom", message: `${label} en çok ${max} karakter olabilir.` });
      return z.NEVER;
    }
    return s || null;
  });
}

function optionalUuid(label: string) {
  return z.unknown().transform((v, ctx): string | null => {
    const s = text(v);
    if (!s) return null;
    if (!UUID_RE.test(s)) {
      ctx.addIssue({ code: "custom", message: `${label} seçimi geçersiz.` });
      return z.NEVER;
    }
    return s;
  });
}

function oneOf<T extends string>(label: string, values: readonly T[], fallback: T) {
  return z.unknown().transform((v, ctx): T => {
    const s = text(v);
    if (!s) return fallback;
    if (!(values as readonly string[]).includes(s)) {
      ctx.addIssue({ code: "custom", message: `${label} geçersiz.` });
      return z.NEVER;
    }
    return s as T;
  });
}

/** Ofis telefonu: her ülke (tenants.phone kısıtsız); saklama biçimi. */
const officePhone = z.unknown().transform((v, ctx): string | null => {
  const s = text(v);
  if (!s) return null;
  const p = parsePhone(s);
  if (!p.ok) {
    ctx.addIssue({ code: "custom", message: `Ofis telefonu: ${p.error ?? PHONE_ERROR_MESSAGE}` });
    return z.NEVER;
  }
  return p.stored;
});

/**
 * Sahip telefonu: profiles.phone yalnız TR cep kabul eder (profiles_phone_tr_format; SMS 2FA Netgsm ile gider).
 * Kayıt akışındaki (signUp) kuralın aynısı.
 */
function trMobile(label: string) {
  return z.unknown().transform((v, ctx): string | null => {
    const s = text(v);
    if (!s) return null;
    const p = parsePhone(s);
    if (!p.ok || p.country !== "TR" || p.kind !== "mobile") {
      ctx.addIssue({ code: "custom", message: `${label}: ${TR_MOBILE_ERROR_MESSAGE}` });
      return z.NEVER;
    }
    return p.stored;
  });
}
const ownerPhone = trMobile("Sahip telefonu");

const trialDays = z.unknown().transform((v, ctx): number => {
  const s = text(v);
  if (!s) return OFFICE_TRIAL_DEFAULT_DAYS;
  const n = Number(s);
  if (!Number.isInteger(n) || n < OFFICE_TRIAL_MIN_DAYS || n > OFFICE_TRIAL_MAX_DAYS) {
    ctx.addIssue({
      code: "custom",
      message: `Deneme süresi ${OFFICE_TRIAL_MIN_DAYS} ile ${OFFICE_TRIAL_MAX_DAYS} gün arasında tam sayı olmalı.`,
    });
    return z.NEVER;
  }
  return n;
});

const plan = z.unknown().transform((v, ctx): PlanId => {
  const s = text(v) || "office";
  if (!isPlanId(s)) {
    ctx.addIssue({ code: "custom", message: "Paket seçimi geçersiz." });
    return z.NEVER;
  }
  return s;
});

const taxNumber = z.unknown().transform((v, ctx): string | null => {
  const s = text(v).replace(/\s+/g, "");
  if (!s) return null;
  if (!TAX_NUMBER_RE.test(s)) {
    ctx.addIssue({ code: "custom", message: "Vergi numarası 10 (VKN) ya da 11 (TCKN) haneli olmalı." });
    return z.NEVER;
  }
  return s;
});

const licenseNo = z.unknown().transform((v, ctx): string | null => {
  const s = text(v);
  if (!s) return null;
  if (s.length > 40 || !/^[\p{L}\p{N} ./-]+$/u.test(s)) {
    ctx.addIssue({ code: "custom", message: "Yetki belgesi numarası yalnız harf, rakam, boşluk, nokta, tire ve eğik çizgi içerebilir (en çok 40 karakter)." });
    return z.NEVER;
  }
  return s;
});

export const officeCreateSchema = z
  .object({
    office_name: requiredText("Ofis adı", 2, 160),
    slug: z.unknown().transform((v) => text(v).toLowerCase()),
    office_phone: officePhone,
    province_id: optionalUuid("İl"),
    district_id: optionalUuid("İlçe"),
    address_line: optionalText("Adres", 300),
    license_no: licenseNo,
    owner_name: requiredText("Sahip adı soyadı", 2, 120),
    owner_email: emailSchema,
    owner_phone: ownerPhone,
    access_mode: oneOf<OfficeAccessMode>("Erişim yöntemi", OFFICE_ACCESS_MODES, "link"),
    plan,
    trial_days: trialDays,
    billing_cycle: z.unknown().transform((v): BillingCycle => normalizeBillingCycle(text(v))),
    initial_status: oneOf<OfficeInitialStatus>("Başlangıç durumu", OFFICE_INITIAL_STATUSES, "trial"),
    tax_office: optionalText("Vergi dairesi", 80),
    tax_number: taxNumber,
    seed_sample: z.unknown().transform((v) => {
      const s = text(v).toLowerCase();
      return s === "1" || s === "on" || s === "true" || s === "evet";
    }),
  })
  .transform((v, ctx) => {
    // Vitrin adresi boşsa ofis adından üretilir; doluysa yazıldığı gibi denetlenir.
    const candidate = v.slug || slugifyOffice(v.office_name);
    const check = validateOfficeSlug(candidate);
    if (!check.ok) {
      ctx.addIssue({
        code: "custom",
        path: ["slug"],
        message: v.slug ? check.error : "Ofis adından vitrin adresi üretilemedi; adresi elle girin.",
      });
      return z.NEVER;
    }
    if (v.district_id && !v.province_id) {
      ctx.addIssue({ code: "custom", path: ["district_id"], message: "İlçe için önce il seçin." });
      return z.NEVER;
    }
    return { ...v, slug: check.slug };
  });

export type OfficeCreateInput = {
  officeName: string;
  slug: string;
  officePhone: string | null;
  provinceId: string | null;
  districtId: string | null;
  addressLine: string | null;
  licenseNo: string | null;
  ownerName: string;
  ownerEmail: string;
  ownerPhone: string | null;
  accessMode: OfficeAccessMode;
  plan: PlanId;
  teamSize: RegistrationTeamSize;
  trialDays: number;
  billingCycle: BillingCycle;
  initialStatus: OfficeInitialStatus;
  taxOffice: string | null;
  taxNumber: string | null;
  seedSample: boolean;
};

export type OfficeCreateParse =
  | { ok: true; data: OfficeCreateInput }
  | { ok: false; error: string; field: string | null };

/** FormData/kayıt -> doğrulanmış girdi. İlk hatayı (alan adıyla) döndürür. */
export function parseOfficeCreateInput(raw: Record<string, unknown>): OfficeCreateParse {
  // Formda gönderilmeyen alan (işaretsiz onay kutusu, boş bırakılan isteğe bağlı alan) undefined gelir.
  const keys = [
    "office_name", "slug", "office_phone", "province_id", "district_id", "address_line", "license_no",
    "owner_name", "owner_email", "owner_phone", "access_mode", "plan", "trial_days", "billing_cycle",
    "initial_status", "tax_office", "tax_number", "seed_sample",
  ] as const;
  const shaped: Record<string, unknown> = {};
  for (const k of keys) shaped[k] = typeof raw[k] === "string" ? raw[k] : "";

  const parsed = officeCreateSchema.safeParse(shaped);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue && typeof issue.path[0] === "string" ? issue.path[0] : null;
    return { ok: false, error: issue?.message ?? "Form bilgileri doğrulanamadı.", field };
  }
  const v = parsed.data;
  return {
    ok: true,
    data: {
      officeName: v.office_name,
      slug: v.slug,
      officePhone: v.office_phone,
      provinceId: v.province_id,
      districtId: v.district_id,
      addressLine: v.address_line,
      licenseNo: v.license_no,
      ownerName: v.owner_name,
      ownerEmail: v.owner_email,
      ownerPhone: v.owner_phone,
      accessMode: v.access_mode,
      plan: v.plan,
      teamSize: teamSizeForPlan(v.plan),
      trialDays: v.trial_days,
      billingCycle: v.billing_cycle,
      initialStatus: v.initial_status,
      taxOffice: v.tax_office,
      taxNumber: v.tax_number,
      seedSample: v.seed_sample,
    },
  };
}

// ---------------------------------------------------------------------------
// Ofis bilgilerini düzenleme (Ofis 360 > Yönetim)
// ---------------------------------------------------------------------------

const officeProfileSchema = z
  .object({
    name: requiredText("Ofis adı", 2, 160),
    phone: officePhone,
    province_id: optionalUuid("İl"),
    district_id: optionalUuid("İlçe"),
    address_line: optionalText("Adres", 300),
    license_no: licenseNo,
  })
  .transform((v, ctx) => {
    if (v.district_id && !v.province_id) {
      ctx.addIssue({ code: "custom", path: ["district_id"], message: "İlçe için önce il seçin." });
      return z.NEVER;
    }
    return v;
  });

const officeBillingProfileSchema = z.object({
  tax_office: optionalText("Vergi dairesi", 80),
  tax_number: taxNumber,
});

export type OfficeProfileInput = {
  /** Yalnız `scope.profile` doğruysa dolu. */
  profile: {
    name: string;
    phone: string | null;
    provinceId: string | null;
    districtId: string | null;
    addressLine: string | null;
    licenseNo: string | null;
  } | null;
  /** Yalnız `scope.billing` doğruysa dolu. */
  billing: { taxOffice: string | null; taxNumber: string | null } | null;
};

export type OfficeProfileParse = { ok: true; data: OfficeProfileInput } | { ok: false; error: string };

/**
 * Düzenleme girdisi. `scope` rol matrisinden gelir: yetkisi olmayan bölüm hiç okunmaz
 * (istemci o alanları gönderse bile yok sayılır).
 */
export function parseOfficeProfileInput(
  raw: Record<string, unknown>,
  scope: { profile: boolean; billing: boolean },
): OfficeProfileParse {
  const str = (k: string) => (typeof raw[k] === "string" ? raw[k] : "");
  const out: OfficeProfileInput = { profile: null, billing: null };
  if (scope.profile) {
    const p = officeProfileSchema.safeParse({
      name: str("name"),
      phone: str("phone"),
      province_id: str("province_id"),
      district_id: str("district_id"),
      address_line: str("address_line"),
      license_no: str("license_no"),
    });
    if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Ofis bilgileri doğrulanamadı." };
    out.profile = {
      name: p.data.name,
      phone: p.data.phone,
      provinceId: p.data.province_id,
      districtId: p.data.district_id,
      addressLine: p.data.address_line,
      licenseNo: p.data.license_no,
    };
  }
  if (scope.billing) {
    const b = officeBillingProfileSchema.safeParse({ tax_office: str("tax_office"), tax_number: str("tax_number") });
    if (!b.success) return { ok: false, error: b.error.issues[0]?.message ?? "Fatura profili doğrulanamadı." };
    out.billing = { taxOffice: b.data.tax_office, taxNumber: b.data.tax_number };
  }
  return { ok: true, data: out };
}

// ---------------------------------------------------------------------------
// Ofis adına kullanıcı ekleme
// ---------------------------------------------------------------------------

const officeUserSchema = z.object({
  full_name: requiredText("Ad soyad", 2, 120),
  email: emailSchema,
  // profiles.phone yalnız TR cep kabul eder (profiles_phone_tr_format).
  phone: trMobile("Telefon"),
  role: oneOf<OfficeUserRole>("Rol", OFFICE_USER_ROLES, "advisor"),
  access_mode: oneOf<OfficeAccessMode>("Erişim yöntemi", OFFICE_ACCESS_MODES, "link"),
});

export type OfficeUserInput = {
  fullName: string;
  email: string;
  phone: string | null;
  role: OfficeUserRole;
  accessMode: OfficeAccessMode;
};

export function parseOfficeUserInput(raw: Record<string, unknown>): { ok: true; data: OfficeUserInput } | { ok: false; error: string } {
  const str = (k: string) => (typeof raw[k] === "string" ? raw[k] : "");
  const p = officeUserSchema.safeParse({
    full_name: str("full_name"),
    email: str("email"),
    phone: str("phone"),
    role: str("role"),
    access_mode: str("access_mode"),
  });
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Kullanıcı bilgileri doğrulanamadı." };
  return {
    ok: true,
    data: { fullName: p.data.full_name, email: p.data.email, phone: p.data.phone, role: p.data.role, accessMode: p.data.access_mode },
  };
}
