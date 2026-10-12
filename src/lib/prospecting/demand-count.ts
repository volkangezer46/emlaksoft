import { applyScopeFilter, getListScope, isNarrowing } from "@/lib/access-control";
import { OPEN_DEMAND_STATUSES } from "@/lib/workflow-state";
import type { Db } from "./store";

/**
 * İlçede açık (kapanmamış) alıcı talebi sayısı. Sayı, tıklanınca açılan Talepler listesiyle AYNI kapsamda sayılır
 * (`/app/talepler?ilce=<id>`: danışman kapsamı + açık durumlar). Veri yoksa / sorgu başarısızsa `null` döner → kart ve script cümlesi yok.
 */
export async function countOpenBuyerDemandsInDistrict(
  db: Db,
  input: { tenantId: string; userId: string; role: string; districtId: string | null },
): Promise<number | null> {
  if (!input.districtId) return null;
  try {
    const scope = await getListScope({ userId: input.userId, tenantId: input.tenantId, role: input.role });
    const narrowing = isNarrowing(scope.filter);
    let q = db
      .from("customer_demands")
      .select(narrowing ? "id, customer:customers!customer_demands_customer_id_fkey!inner(id)" : "id", { count: "exact", head: true })
      .eq("tenant_id", input.tenantId)
      .eq("district_id", input.districtId)
      .in("status", [...OPEN_DEMAND_STATUSES]);
    q = applyScopeFilter(q, scope.filter, { ownerColumn: "customer.assigned_to" });
    const { count, error } = await q;
    if (error || !count || count <= 0) return null;
    return count;
  } catch {
    return null;
  }
}
