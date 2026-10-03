import { createAdminClient } from "@/lib/supabase/admin";
import { notifyTenant } from "@/lib/notify";
import { fetchTenantMatchingWeights, scoreDemandProperty, type MatchDemand, type MatchProperty } from "@/lib/matching";

type MatchCustomer = { full_name?: string; assigned_to?: string | null };

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
    // Ofise özel ağırlıklar — döngü DIŞINDA tek sorgu; tanımsızsa varsayılan davranış.
    const weightsPromise = fetchTenantMatchingWeights(admin, tenantId);
    const { data: demands } = await admin
      .from("customer_demands")
      .select("id, transaction_type, property_type, province_id, district_id, neighborhood_id, budget_min, budget_max, rooms, min_sqm, urgency, status, criteria, customer:customers!customer_demands_customer_id_fkey(full_name, assigned_to)")
      .eq("tenant_id", tenantId)
      .in("status", ["new", "active", "matched"])
      .limit(500);

    if (!demands?.length) return 0;

    const weights = await weightsPromise;
    const MATCH_THRESHOLD = 60; // "iyi/güçlü" eşleşme
    const matched: { name: string; score: number; ownerId: string | null; demandId: string }[] = [];
    for (const d of demands) {
      const result = scoreDemandProperty(d as unknown as MatchDemand, property, weights);
      // Elenen (olmazsa olmaz tutmayan) eşleşmeler zaten skor <= 20; eşik altında kalır.
      if (!result.eliminated && result.score >= MATCH_THRESHOLD) {
        const c = d.customer as MatchCustomer | MatchCustomer[] | null;
        const customer = Array.isArray(c) ? c[0] : c;
        matched.push({
          name: customer?.full_name ?? "Müşteri",
          score: result.score,
          ownerId: customer?.assigned_to ?? null,
          demandId: d.id as string,
        });
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

    // Ters eşleştirme: talep sahibi danışmana da bildirim (mevcut bildirim akışı genişler).
    // Mükerrer üretme yok: portföyü ekleyen kişi zaten yukarıdaki toplu bildirimi aldı (atlanır);
    // her danışmana TEK bildirim (kendi müşterilerinin eşleşen talepleri). Hata diğerlerini bozmaz.
    const byOwner = new Map<string, typeof matched>();
    for (const m of matched) {
      if (!m.ownerId || m.ownerId === notifyUserId) continue;
      const list = byOwner.get(m.ownerId) ?? [];
      list.push(m);
      byOwner.set(m.ownerId, list);
    }
    for (const [ownerId, list] of byOwner) {
      try {
        const names = [...new Set(list.map((m) => m.name))];
        const shown = names.slice(0, 3).join(", ");
        const more = names.length > 3 ? ` +${names.length - 3} daha` : "";
        await notifyTenant({
          tenantId,
          userId: ownerId,
          title: `Müşterinizin talebi yeni portföyle eşleşti`,
          body: `${shown}${more}: ${property.title ?? property.property_code} (${property.property_code}) talebe uyuyor. Eşleştirme ekranından öneriyi inceleyin.`,
          href: `/app/eslestirme?property=${property.id}`,
          kind: "success",
        });
      } catch (e) {
        console.error("notifyMatchingDemandsForProperty owner", e);
      }
    }

    return matched.length;
  } catch (e) {
    console.error("notifyMatchingDemandsForProperty", e);
    return 0;
  }
}
