"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { hasOfficeWideDataScope } from "@/lib/permission-data-scope";
import type { DuplicateHit, PropertyProbe } from "@/lib/duplicate-match";
import { findCustomerDuplicates, findPropertyDuplicates, findSimilarOpenDemands } from "@/lib/duplicate-finders";

/**
 * Giriş anı mükerrer uyarısı — SALT-OKUNUR action'lar. Hiçbiri yazma yapmaz.
 * Kapsam dışı kayıtlarda kimlik bilgisi dönmez (yalnız "var" bilgisi: DuplicateHit.visible=false).
 */
export type DuplicateCheckResult = { ok: boolean; hits: DuplicateHit[]; error?: string };

const s = (v: unknown, max = 200) => String(v ?? "").trim().slice(0, max);

export async function checkCustomerDuplicate(input: { phone?: string; email?: string }): Promise<DuplicateCheckResult> {
  const gate = await requirePermission("customers", "view");
  if (!gate.ok) return { ok: false, hits: [], error: gate.error };
  const supabase = await createClient();
  const hits = await findCustomerDuplicates(
    supabase,
    { tenantId: gate.tenantId, phone: s(input.phone, 40), email: s(input.email, 200) },
    { userId: gate.userId, officeWide: hasOfficeWideDataScope(gate.role) },
  );
  return { ok: true, hits };
}

export async function checkPropertyDuplicate(input: Partial<PropertyProbe>): Promise<DuplicateCheckResult> {
  const gate = await requirePermission("properties", "view");
  if (!gate.ok) return { ok: false, hits: [], error: gate.error };
  const supabase = await createClient();
  const hits = await findPropertyDuplicates(
    supabase,
    {
      tenantId: gate.tenantId,
      probe: {
        title: s(input.title),
        address: s(input.address),
        block: s(input.block, 20),
        lot: s(input.lot, 20),
        propertyType: s(input.propertyType, 60),
        transactionType: s(input.transactionType, 60),
        districtId: s(input.districtId, 60),
        neighborhoodId: s(input.neighborhoodId, 60),
      },
    },
    { userId: gate.userId, officeWide: hasOfficeWideDataScope(gate.role) },
  );
  return { ok: true, hits };
}

export async function checkDemandDuplicate(input: {
  customerId?: string;
  transactionType?: string;
  propertyType?: string;
  districtId?: string;
}): Promise<DuplicateCheckResult> {
  const gate = await requirePermission("demands", "view");
  if (!gate.ok) return { ok: false, hits: [], error: gate.error };
  const supabase = await createClient();
  const hits = await findSimilarOpenDemands(
    supabase,
    {
      tenantId: gate.tenantId,
      customerId: s(input.customerId, 60),
      transactionType: s(input.transactionType, 60),
      propertyType: s(input.propertyType, 60),
      districtId: s(input.districtId, 60),
    },
    { userId: gate.userId, officeWide: hasOfficeWideDataScope(gate.role) },
  );
  return { ok: true, hits };
}
