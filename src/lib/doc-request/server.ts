import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { isPublicTenantActive } from "@/lib/public-tenant";
import { isPublicFeatureClosed } from "@/lib/modules/public";
import { now } from "@/lib/clock";
import { evaluateRequestState, isWellFormedToken, type RequestState } from "@/lib/doc-request/doc-request";

export const DOC_REQUEST_BUCKET = "customer-files";

/** 32 rastgele bayt → 43 karakterlik base64url token. */
export function generateRequestToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Ham token asla saklanmaz; arama ve kayıt bu özetle yapılır. */
export function hashRequestToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type PublicDocRequest = {
  id: string;
  tenant_id: string;
  customer_id: string | null;
  property_id: string | null;
  title: string;
  requested_types: string[];
  max_files: number;
  file_count: number;
  status: string;
  expires_at: string;
};

export type PublicRequestLookup =
  | {
      ok: true;
      request: PublicDocRequest;
      tenantName: string;
      logoUrl: string | null;
      brandColor: string | null;
      state: RequestState;
    }
  | { ok: false; reason: "invalid" | "closed" };

/**
 * Token'dan linki çözer. Hepsi aynı "invalid" cevabına iner (sızıntı yok):
 * biçim dışı token, bilinmeyen özet, örnek (is_sample) veri, askıdaki/pasif ofis.
 * Modül kapalıysa "closed". Tablo yoksa (migration uygulanmamış) "invalid".
 */
export async function lookupPublicRequest(token: unknown): Promise<PublicRequestLookup> {
  if (!isWellFormedToken(token)) return { ok: false, reason: "invalid" };
  const admin = createAdminClient();
  const { data: request, error } = await admin
    .from("document_requests")
    .select(
      "id, tenant_id, customer_id, property_id, title, requested_types, max_files, file_count, status, expires_at, is_sample",
    )
    .eq("token_hash", hashRequestToken(token))
    .maybeSingle();
  if (error || !request || request.is_sample) return { ok: false, reason: "invalid" };

  const { data: tenant } = await admin
    .from("tenants")
    .select("id, name, status, logo_url, brand_color")
    .eq("id", request.tenant_id)
    .maybeSingle();
  if (!tenant || !isPublicTenantActive(tenant.status)) return { ok: false, reason: "invalid" };

  // Bağlı müşteri / portföy örnek veriyse link public yüzeyde geçersizdir.
  if (request.customer_id) {
    const { data: c } = await admin
      .from("customers")
      .select("is_sample")
      .eq("id", request.customer_id)
      .eq("tenant_id", request.tenant_id)
      .maybeSingle();
    if (c?.is_sample) return { ok: false, reason: "invalid" };
  }
  if (request.property_id) {
    const { data: p } = await admin
      .from("properties")
      .select("is_sample")
      .eq("id", request.property_id)
      .eq("tenant_id", request.tenant_id)
      .maybeSingle();
    if (p?.is_sample) return { ok: false, reason: "invalid" };
  }

  if (await isPublicFeatureClosed(admin, request.tenant_id, "documents")) return { ok: false, reason: "closed" };

  const state = evaluateRequestState(request, now());
  return {
    ok: true,
    tenantName: tenant.name as string,
    logoUrl: (tenant.logo_url as string | null) ?? null,
    brandColor: (tenant.brand_color as string | null) ?? null,
    state,
    request: {
      id: request.id,
      tenant_id: request.tenant_id,
      customer_id: request.customer_id,
      property_id: request.property_id,
      title: request.title,
      requested_types: request.requested_types ?? [],
      max_files: request.max_files,
      file_count: request.file_count,
      status: request.status,
      expires_at: request.expires_at,
    },
  };
}
