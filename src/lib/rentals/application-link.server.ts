import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { isPublicTenantActive } from "@/lib/public-tenant";
import { isPublicFeatureClosed } from "@/lib/modules/public";
import { now } from "@/lib/clock";
import { TOKEN_RE } from "@/lib/rentals/applications";

/** 32 rastgele bayt → 43 karakterlik base64url (başvuru bağlantısı ve yükleme anahtarı). */
export function generateApplicationToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Yükleme anahtarı düz saklanmaz; yalnız SHA-256 özeti. */
export function hashUploadKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export type ApplicationLinkLookup =
  | {
      ok: true;
      state: "open" | "closed" | "expired";
      link: { id: string; tenant_id: string; property_id: string; asking_rent: number | null; expires_at: string };
      tenant: { name: string; logoUrl: string | null; brandColor: string | null; phone: string | null };
      property: { title: string | null; code: string | null; district: string | null; province: string | null; listPrice: number | null; assignedTo: string | null };
    }
  | { ok: false; reason: "invalid" | "module_closed"; officeName?: string };

type Rel<T> = T | T[] | null;
const one = <T,>(v: Rel<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

/**
 * Başvuru bağlantısını çözer (service_role; token portföye sabit). Biçim dışı, bilinmeyen, örnek veri, silinmiş portföy
 * ve pasif ofis aynı "invalid" cevabına iner (sızıntı yok). Mülk yönetimi modülü kapalıysa "module_closed".
 * Açık adres GÖSTERİLMEZ: yalnız ilçe/il (aday doğru ilana başvurduğunu anlasın).
 */
export async function resolveApplicationLink(token: unknown): Promise<ApplicationLinkLookup> {
  if (typeof token !== "string" || !TOKEN_RE.test(token)) return { ok: false, reason: "invalid" };
  const admin = createAdminClient();
  const { data: link, error } = await admin
    .from("rental_application_links")
    .select("id, tenant_id, property_id, status, asking_rent, expires_at, is_sample")
    .eq("token", token)
    .maybeSingle();
  if (error || !link || link.is_sample) return { ok: false, reason: "invalid" };

  const [{ data: tenant }, { data: property }] = await Promise.all([
    admin.from("tenants").select("name, status, logo_url, brand_color, phone").eq("id", link.tenant_id).maybeSingle(),
    admin
      .from("properties")
      .select("title, property_code, list_price, assigned_to, is_sample, deleted_at, province:geo_provinces(name), district:geo_districts(name)")
      .eq("id", link.property_id)
      .eq("tenant_id", link.tenant_id)
      .maybeSingle(),
  ]);
  if (!tenant || !isPublicTenantActive(tenant.status)) return { ok: false, reason: "invalid" };
  if (!property || property.is_sample || property.deleted_at) return { ok: false, reason: "invalid" };
  if (await isPublicFeatureClosed(admin, link.tenant_id, "rentals")) return { ok: false, reason: "module_closed", officeName: tenant.name as string };

  const state = link.status !== "active" ? "closed" : Date.parse(link.expires_at) <= now() ? "expired" : "open";
  return {
    ok: true,
    state,
    link: {
      id: link.id,
      tenant_id: link.tenant_id,
      property_id: link.property_id,
      asking_rent: link.asking_rent != null ? Number(link.asking_rent) : null,
      expires_at: link.expires_at,
    },
    tenant: {
      name: tenant.name as string,
      logoUrl: (tenant.logo_url as string | null) ?? null,
      brandColor: (tenant.brand_color as string | null) ?? null,
      phone: (tenant.phone as string | null) ?? null,
    },
    property: {
      title: (property.title as string | null) ?? null,
      code: (property.property_code as string | null) ?? null,
      district: one(property.district as Rel<{ name: string | null }>)?.name ?? null,
      province: one(property.province as Rel<{ name: string | null }>)?.name ?? null,
      listPrice: property.list_price != null ? Number(property.list_price) : null,
      assignedTo: (property.assigned_to as string | null) ?? null,
    },
  };
}
