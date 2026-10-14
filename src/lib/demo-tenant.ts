import { isDemoIdentityEmail } from "@/lib/auth/google-auth";

/**
 * DEMO KİRACI KİMLİĞİ (SAF; ağ/DB yok). Demo kiracı yalnız `tenants.slug` ile tanınır: hızlı demo girişi
 * (`demo-login.ts`), `npm run seed:demo`, gönderim sandbox'ı (`demo-sandbox.ts`) ve gece sıfırlaması
 * (`demo-reset.ts`) aynı listeyi kullanır. Ad ya da plan ile EŞLEŞTİRME YAPILMAZ: gerçek bir ofis "Demo" adını
 * alabilir, bu slug'ı alamaz.
 */
export const DEMO_TENANT_SLUG = "demo-ofis";
export const DEMO_TENANT_NAME = "Demo Emlak Ofisi";
export const DEMO_TENANT_SLUGS: readonly string[] = [DEMO_TENANT_SLUG];

export function isDemoTenantSlug(slug: string | null | undefined): boolean {
  return typeof slug === "string" && DEMO_TENANT_SLUGS.includes(slug.trim().toLowerCase());
}

/**
 * "Ofis adına gör" (destek erişimi) kapısı: demo platform kişilikleri (giriş sayfasındaki süper admin / operasyon /
 * destek kartları, `@demo.emlaksoft.test`) YALNIZ demo kiracısına girebilir. Kartı bilen herkes bu kimliğe
 * girebildiği için gerçek ofis verisine bu yoldan erişim sunucuda reddedilir. Gerçek personel için kural değişmez.
 */
export function impersonationAllowedForStaff(staffEmail: string | null | undefined, tenantSlug: string | null | undefined): boolean {
  if (!isDemoIdentityEmail(staffEmail)) return true;
  return isDemoTenantSlug(tenantSlug);
}

/** Demo kiracıdan dışarı gidecek her gönderimin yerine günlüğe düşen kayıt (SMS/WhatsApp/e-posta). */
export const DEMO_SANDBOX_CODE = "demo_sandbox";
export const DEMO_SANDBOX_MESSAGE = "demo: gönderilmedi";
/** Demo kiracıda kapalı işlemlerin kullanıcıya dönen açıklaması (API anahtarı, webhook). */
export const DEMO_SANDBOX_BLOCKED = "Demo ofiste bu işlem kapalıdır: dışarıya bağlantı açılmaz (demo: gönderilmedi).";
