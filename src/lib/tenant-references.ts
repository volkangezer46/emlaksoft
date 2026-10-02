import { createAdminClient } from "@/lib/supabase/admin";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type TenantReferenceInput = {
  customerId?: string | null;
  propertyId?: string | null;
  profileId?: string | null;
};

export type TenantReferenceValidation =
  | { ok: true }
  | { ok: false; error: string };

type ReferenceTarget = {
  kind: "customer" | "property" | "profile";
  id: string;
  missingError: string;
};

/**
 * Re-resolves every caller-supplied relation inside the trusted tenant
 * boundary. Child-row RLS only validates child.tenant_id; without this check a
 * well-formed UUID could still point at another tenant's globally keyed row.
 *
 * The database composite foreign keys are the final invariant. This helper is
 * the action-layer guard that returns a useful, non-enumerating error before a
 * mutation reaches that constraint.
 */
export async function validateTenantReferences(
  tenantId: string,
  references: TenantReferenceInput,
): Promise<TenantReferenceValidation> {
  const targets: ReferenceTarget[] = [];
  if (references.customerId) {
    targets.push({
      kind: "customer",
      id: references.customerId.trim(),
      missingError: "Seçilen müşteri bulunamadı.",
    });
  }
  if (references.propertyId) {
    targets.push({
      kind: "property",
      id: references.propertyId.trim(),
      missingError: "Seçilen portföy bulunamadı.",
    });
  }
  if (references.profileId) {
    targets.push({
      kind: "profile",
      id: references.profileId.trim(),
      missingError: "Seçilen ekip üyesi bulunamadı.",
    });
  }
  if (targets.length === 0) return { ok: true };

  if (!UUID_RE.test(tenantId) || targets.some((target) => !UUID_RE.test(target.id))) {
    return { ok: false, error: "Seçilen ilişkili kayıt geçersiz." };
  }

  const admin = createAdminClient();
  const results = await Promise.all(
    targets.map(async (target) => {
      if (target.kind === "customer") {
        return admin
          .from("customers")
          .select("id")
          .eq("id", target.id)
          .eq("tenant_id", tenantId)
          .is("deleted_at", null)
          .maybeSingle();
      }
      if (target.kind === "property") {
        return admin
          .from("properties")
          .select("id")
          .eq("id", target.id)
          .eq("tenant_id", tenantId)
          .is("deleted_at", null)
          .maybeSingle();
      }
      return admin
        .from("profiles")
        .select("id")
        .eq("id", target.id)
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
        .maybeSingle();
    }),
  );

  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    const target = targets[index];
    if (result.error) {
      console.error("validateTenantReferences", {
        kind: target.kind,
        code: result.error.code || "unknown",
      });
      return { ok: false, error: "İlişkili kayıtlar güvenli şekilde doğrulanamadı." };
    }
    if (!result.data) return { ok: false, error: target.missingError };
  }

  return { ok: true };
}
