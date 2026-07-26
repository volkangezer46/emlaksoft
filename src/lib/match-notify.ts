import { createAdminClient } from "@/lib/supabase/admin";
import { notifyTenant } from "@/lib/notify";
import { scoreDemandProperty, type MatchDemand, type MatchProperty } from "@/lib/matching";

/**
 * Yeni bir portföy eklendiğinde, aktif taleplerle anlık eşleştirir ve güçlü
 * eşleşme varsa portföyü ekleyen danışmana ofis-içi bildirim + web push gönderir.
 * Fire-and-forget: hata portföy oluşturmayı bloklamaz.
 *
 * @returns eşleşen talep sayısı
 */
export async function notifyMatchingDemandsForProperty(
  tenantId: string,
  notifyUserId: string,
  property: MatchProperty,
): Promise<number> {
  try {
    const admin = createAdminClient();
    const { data: demands } = await admin
      .from("customer_demands")
      .select("id, transaction_type, property_type, province_id, district_id, budget_min, budget_max, rooms, min_sqm, urgency, status, customer:customers(full_name)")
      .eq("tenant_id", tenantId)
      .in("status", ["new", "active", "matched"])
      .limit(500);

    if (!demands?.length) return 0;

    const MATCH_THRESHOLD = 60; // "iyi/güçlü" eşleşme
    const matched: { name: string; score: number }[] = [];
    for (const d of demands) {
      const result = scoreDemandProperty(d as unknown as MatchDemand, property);
      if (result.score >= MATCH_THRESHOLD) {
        const c = d.customer as { full_name?: string } | { full_name?: string }[] | null;
        const name = (Array.isArray(c) ? c[0]?.full_name : c?.full_name) ?? "Müşteri";
        matched.push({ name, score: result.score });
      }
    }

    if (!matched.length) return 0;
    matched.sort((a, b) => b.score - a.score);

    const top = matched.slice(0, 3).map((m) => m.name).join(", ");
    const extra = matched.length > 3 ? ` +${matched.length - 3} daha` : "";
    const title = `${matched.length} talep bu portföyle eşleşti`;
    const body = `Güçlü eşleşme: ${top}${extra}. Eşleştirme ekranından teklif akışını başlatın.`;

    await notifyTenant({
      tenantId,
      userId: notifyUserId,
      title,
      body,
      href: `/app/eslestirme?property=${property.id}`,
      kind: "success",
    });

    return matched.length;
  } catch (e) {
    console.error("notifyMatchingDemandsForProperty", e);
    return 0;
  }
}
