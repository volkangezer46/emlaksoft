import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { isPublicTenantActive } from "@/lib/public-tenant";

/**
 * Süresi dolmuş müşteri / malik portalı bağlantısı (PUB-7). Bilinmeyen token gerçek 404'te kalır (sayfa `notFound()`);
 * yalnız KAYITLI ama süresi geçmiş token için ofis adı + iletişim + "Yeni bağlantı iste" ekranı çizilir. Bu ekranda
 * kişisel veri (müşteri/malik adı, portföy) GÖSTERİLMEZ; yalnız ofis kimliği.
 */
export type PortalLinkKind = "customer" | "owner";

export const PORTAL_TOKEN_RE = /^[0-9a-f]{64}$/;

export type ExpiredPortalLink = {
  kind: PortalLinkKind;
  tenantId: string;
  officeName: string;
  officePhone: string | null;
  officeSlug: string | null;
  /** Bildirim/görev hedefi (ekrana basılmaz). */
  advisorId: string | null;
  customerId: string | null;
  propertyId: string | null;
};

type TokenRow = { tenant_id: string; expires_at: string; created_by: string | null; customer_id?: string; property_id?: string };
type TenantRow = { name: string | null; phone: string | null; slug: string | null; status: string | null };

export async function loadExpiredPortalLink(kind: PortalLinkKind, token: string, nowMs: number): Promise<ExpiredPortalLink | null> {
  if (!PORTAL_TOKEN_RE.test(token)) return null;
  const admin = createAdminClient();
  const table = kind === "customer" ? "customer_portal_tokens" : "owner_portal_tokens";
  const cols = kind === "customer" ? "tenant_id, expires_at, created_by, customer_id" : "tenant_id, expires_at, created_by, property_id";
  const { data } = await admin.from(table).select(cols).eq("token", token).maybeSingle();
  const row = data as TokenRow | null;
  if (!row || Date.parse(row.expires_at) >= nowMs) return null;

  const owner =
    kind === "customer"
      ? admin.from("customers").select("assigned_to").eq("id", row.customer_id ?? "").eq("tenant_id", row.tenant_id).is("deleted_at", null).maybeSingle()
      : admin.from("properties").select("assigned_to").eq("id", row.property_id ?? "").eq("tenant_id", row.tenant_id).is("deleted_at", null).maybeSingle();
  const [{ data: tenant }, { data: subject }] = await Promise.all([
    admin.from("tenants").select("name, phone, slug, status").eq("id", row.tenant_id).maybeSingle(),
    owner,
  ]);
  const t = tenant as TenantRow | null;
  if (!t || !isPublicTenantActive(t.status)) return null;
  return {
    kind,
    tenantId: row.tenant_id,
    officeName: t.name ?? "Ofis",
    officePhone: t.phone ?? null,
    officeSlug: t.slug ?? null,
    advisorId: (subject as { assigned_to?: string | null } | null)?.assigned_to ?? row.created_by ?? null,
    customerId: kind === "customer" ? (row.customer_id ?? null) : null,
    propertyId: kind === "owner" ? (row.property_id ?? null) : null,
  };
}
