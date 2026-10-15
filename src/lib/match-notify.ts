import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyTenant } from "@/lib/notify";
import { trDayKey } from "@/lib/clock";
import { fetchTenantMatchingWeights, scoreDemandProperty, type MatchDemand, type MatchingWeights, type MatchProperty } from "@/lib/matching";
import { fetchMatchFeedback, loadDemandMatches, MATCH_NOTIFY_MIN } from "@/lib/match-candidates";
import { isHiddenMatchState, matchPairKey, wasSent, type MatchStateRow } from "@/lib/match-state";
import { recordSuggestedMatches } from "@/lib/match-state-store";
import { OPEN_DEMAND_STATUSES } from "@/lib/workflow-state";

/**
 * Otomatik yeniden eşleştirme (CRM-G5) — portföy oluşturma, fiyat düşüşü, yayına alma ve talep kaydı/güncellemesi
 * aynı skor kuralıyla (lib/matching + lib/match-candidates) danışmana bildirim üretir.
 *
 * Gürültü kuralları:
 *  - Eşik tek: MATCH_NOTIFY_MIN (60). Elenen (olmazsa olmaz tutmayan) çift bildirilmez.
 *  - Danışmanın "uygun değil" dediği ve müşterinin beğenmediği çift bildirilmez.
 *  - Fiyat düşüşünde YALNIZ yeni fiyatla eşiği geçen (eskiden geçmeyen) talepler ve bu portföyün daha önce GÖNDERİLDİĞİ
 *    talepler bildirilir; zaten eşleşen ve haberdar olunan çift tekrar gelmez.
 *  - dedupeKey: (olay, portföy/talep, danışman, gün) başına tek bildirim. prefKey ile kullanıcı kapatabilir.
 * Fire-and-forget: çağıranlar `afterSafe` içinde çağırır, hata kaydı bekletmez/bozmaz.
 */

/** Bildirim taramasında en fazla talep; aşılırsa en yeni talepler (created_at desc) taranır. */
export const MATCH_NOTIFY_DEMAND_LIMIT = 500;

type MatchCustomer = { id?: string; full_name?: string | null; assigned_to?: string | null };

type Hit = { demandId: string; customerId: string | null; name: string; ownerId: string | null; score: number };

function customerRel(rel: unknown): MatchCustomer | null {
  const c = rel as MatchCustomer | MatchCustomer[] | null;
  return (Array.isArray(c) ? c[0] : c) ?? null;
}

/** Ofisin açık talepleri (müşteri + danışman gömülü). */
async function openDemands(admin: SupabaseClient, tenantId: string) {
  const { data, error: demandsError } = await admin
    .from("customer_demands")
    .select(
      "id, transaction_type, property_type, province_id, district_id, neighborhood_id, budget_min, budget_max, rooms, min_sqm, urgency, status, criteria, customer:customers!customer_demands_customer_id_fkey(id, full_name, assigned_to)",
    )
    .eq("tenant_id", tenantId)
    .in("status", [...OPEN_DEMAND_STATUSES])
    .order("created_at", { ascending: false }) // B15: kırpma belirleyici (en yeni talepler)
    .limit(MATCH_NOTIFY_DEMAND_LIMIT);
  if (demandsError) {
    console.error("match-notify demands", { code: demandsError.code });
    return [];
  }
  if ((data?.length ?? 0) >= MATCH_NOTIFY_DEMAND_LIMIT) {
    console.warn(`match-notify: talep sayısı ${MATCH_NOTIFY_DEMAND_LIMIT} sınırına ulaştı; yalnız en yeni talepler eşleştirildi`, { tenantId });
  }
  return (data ?? []) as unknown as (MatchDemand & { customer: unknown })[];
}

/**
 * SAF: tek portföyün talep kümesindeki bildirilecek eşleşmeleri. `prevProperty` verilirse (fiyat düşüşü) yalnız eşiği
 * YENİ geçenler + daha önce gönderilmiş çiftler döner.
 */
export function propertyMatchHits(input: {
  property: MatchProperty;
  prevProperty?: MatchProperty | null;
  demands: readonly (MatchDemand & { customer?: unknown })[];
  weights?: MatchingWeights | null;
  states?: readonly MatchStateRow[];
  dislikedPairs?: ReadonlySet<string>;
}): Hit[] {
  const states = new Map((input.states ?? []).map((s) => [matchPairKey(s.demand_id, s.property_id), s]));
  const hits: Hit[] = [];
  for (const d of input.demands) {
    const now = scoreDemandProperty(d, input.property, input.weights);
    if (now.eliminated || now.score < MATCH_NOTIFY_MIN) continue;
    const c = customerRel(d.customer);
    const state = states.get(matchPairKey(d.id, input.property.id)) ?? null;
    if (isHiddenMatchState(state?.state)) continue;
    if (c?.id && input.dislikedPairs?.has(`${c.id}:${input.property.id}`)) continue;
    if (input.prevProperty) {
      const before = scoreDemandProperty(d, input.prevProperty, input.weights);
      const crossed = before.eliminated || before.score < MATCH_NOTIFY_MIN;
      if (!crossed && !wasSent(state)) continue;
    }
    hits.push({
      demandId: d.id,
      customerId: c?.id ?? null,
      name: c?.full_name ?? "Müşteri",
      ownerId: c?.assigned_to ?? null,
      score: now.score,
    });
  }
  return hits.sort((a, b) => b.score - a.score);
}

/** Danışman başına gruplar (danışmansız müşteri → `fallbackUserId`). */
export function groupHitsByOwner(hits: readonly Hit[], fallbackUserId: string | null): Map<string, Hit[]> {
  const out = new Map<string, Hit[]>();
  for (const h of hits) {
    const owner = h.ownerId ?? fallbackUserId;
    if (!owner) continue;
    const list = out.get(owner) ?? [];
    list.push(h);
    out.set(owner, list);
  }
  return out;
}

function namesLine(list: readonly Hit[]): string {
  const names = [...new Set(list.map((m) => m.name))];
  return `${names.slice(0, 3).join(", ")}${names.length > 3 ? ` +${names.length - 3} daha` : ""}`;
}

async function safeNotify(input: Parameters<typeof notifyTenant>[0]) {
  try {
    await notifyTenant(input);
  } catch (e) {
    console.error("match-notify notifyTenant", e instanceof Error ? e.message : e);
  }
}

async function propertyContext(admin: SupabaseClient, tenantId: string, propertyId: string) {
  const [demands, weights, states] = await Promise.all([
    openDemands(admin, tenantId),
    fetchTenantMatchingWeights(admin, tenantId),
    admin
      .from("demand_property_matches")
      .select("demand_id, property_id, state, dismiss_reason, dismissed_at, sent_at, send_count, channel, share_token, updated_at")
      .eq("tenant_id", tenantId)
      .eq("property_id", propertyId)
      .then(({ data }) => (data ?? []) as MatchStateRow[], () => [] as MatchStateRow[]),
  ]);
  const customerIds = demands.map((d) => customerRel(d.customer)?.id).filter((x): x is string => Boolean(x));
  const feedback = await fetchMatchFeedback(admin, customerIds).catch(() => []);
  const dislikedPairs = new Set(
    feedback.filter((f) => f.property_id === propertyId && f.verdict === "disliked").map((f) => `${f.customer_id}:${f.property_id}`),
  );
  return { demands, weights, states, dislikedPairs };
}

/**
 * Yeni portföy eklendiğinde: güçlü eşleşen talepler için portföyü ekleyene toplu, talep sahibi danışmanlara kendi
 * müşterileri için TEK bildirim; çiftler "önerildi" olarak kaydedilir.
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
    const ctx = await propertyContext(admin, tenantId, property.id);
    const matched = propertyMatchHits({ property, ...ctx });
    if (!matched.length) return 0;

    await recordSuggestedMatches(
      admin,
      tenantId,
      matched.slice(0, 50).map((m) => ({ demandId: m.demandId, propertyId: property.id, customerId: m.customerId })),
    );

    const href = `/app/talepler?sekme=eslesme&property=${property.id}`;
    await safeNotify({
      tenantId,
      userId: notifyUserId,
      title: `${matched.length} talep bu portföyle eşleşti`,
      body: `Güçlü eşleşme: ${namesLine(matched)}. Eşleştirme ekranından teklif akışını başlatın.`,
      href,
      kind: "success",
      dedupeKey: `match-new:${property.id}:${notifyUserId}`,
    });
    // Ters eşleştirme: talep sahibi danışmanlara kendi müşterileri için TEK bildirim (ekleyen kişi atlanır).
    for (const [ownerId, list] of groupHitsByOwner(matched, null)) {
      if (ownerId === notifyUserId) continue;
      await safeNotify({
        tenantId,
        userId: ownerId,
        title: "Müşterinizin talebi yeni portföyle eşleşti",
        body: `${namesLine(list)}: ${property.title ?? property.property_code} (${property.property_code}) talebe uyuyor. Eşleştirme ekranından öneriyi inceleyin.`,
        href,
        kind: "success",
        dedupeKey: `match-new:${property.id}:${ownerId}`,
      });
    }
    return matched.length;
  } catch (e) {
    console.error("notifyMatchingDemandsForProperty", e instanceof Error ? e.message : e);
    return 0;
  }
}

/**
 * Portföy değişikliği: fiyat düşüşü (`price_drop`, önceki ₺ fiyatıyla) ya da yayına alma (`published`).
 * Danışman başına tek bildirim; fiyat düşüşü "priceDrop" tercihine bağlıdır.
 */
export async function notifyMatchesForPropertyChange(
  tenantId: string,
  actorId: string,
  property: MatchProperty,
  change: { reason: "price_drop"; prevPriceTry: number } | { reason: "published" },
): Promise<number> {
  try {
    const admin = createAdminClient();
    const ctx = await propertyContext(admin, tenantId, property.id);
    const prevProperty = change.reason === "price_drop" ? { ...property, list_price: change.prevPriceTry } : null;
    const hits = propertyMatchHits({ property, prevProperty, ...ctx });
    if (!hits.length) return 0;

    await recordSuggestedMatches(
      admin,
      tenantId,
      hits.slice(0, 50).map((m) => ({ demandId: m.demandId, propertyId: property.id, customerId: m.customerId })),
    );

    const label = property.title ?? property.property_code;
    const day = trDayKey();
    const fmt = (v: number) => new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(v);
    for (const [ownerId, list] of groupHitsByOwner(hits, actorId)) {
      if (change.reason === "price_drop") {
        await safeNotify({
          tenantId,
          userId: ownerId,
          title: `${label} fiyatı düştü: ₺${fmt(change.prevPriceTry)} → ₺${fmt(Number(property.list_price ?? 0))}`,
          body: `${namesLine(list)} talebiyle artık eşleşiyor. Müşterinize haber verin.`,
          href: `/app/talepler?sekme=eslesme&property=${property.id}`,
          kind: "info",
          prefKey: "priceDrop",
          dedupeKey: `match-price:${property.id}:${ownerId}:${day}`,
        });
      } else {
        await safeNotify({
          tenantId,
          userId: ownerId,
          title: `Yayına alınan portföy ${list.length} talebe uyuyor`,
          body: `${namesLine(list)}: ${label} (${property.property_code}). Eşleştirme ekranından müşterinize gönderin.`,
          href: `/app/talepler?sekme=eslesme&property=${property.id}`,
          kind: "success",
          dedupeKey: `match-pub:${property.id}:${ownerId}`,
        });
      }
    }
    return hits.length;
  } catch (e) {
    console.error("notifyMatchesForPropertyChange", e instanceof Error ? e.message : e);
    return 0;
  }
}

/** Yayına alınan portföyü (yalnız kimlikle) okuyup `published` bildirimini üretir. */
export async function notifyMatchesForPublishedProperty(tenantId: string, actorId: string, propertyId: string): Promise<number> {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("properties")
      .select("id, property_code, title, transaction_type, property_type, status, list_price, province_id, district_id, neighborhood_id, features")
      .eq("tenant_id", tenantId)
      .eq("id", propertyId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!data) return 0;
    const property = {
      ...data,
      list_price: data.list_price != null ? Number(data.list_price) : null,
      features: (data.features ?? {}) as MatchProperty["features"],
    } as MatchProperty;
    return await notifyMatchesForPropertyChange(tenantId, actorId, property, { reason: "published" });
  } catch (e) {
    console.error("notifyMatchesForPublishedProperty", e instanceof Error ? e.message : e);
    return 0;
  }
}

/**
 * Talep kaydı / güncellemesi: talebin ilk 3 güçlü eşleşmesi danışmana TEK bildirim; eşik üstü çiftler "önerildi"
 * yazılır. Aynı talep için günde en çok bir bildirim.
 */
export async function notifyMatchesForDemand(tenantId: string, actorId: string, demandId: string): Promise<number> {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("customer_demands")
      .select(
        "id, transaction_type, property_type, province_id, district_id, neighborhood_id, budget_min, budget_max, rooms, min_sqm, urgency, status, criteria, customer:customers!customer_demands_customer_id_fkey(id, full_name, assigned_to)",
      )
      .eq("tenant_id", tenantId)
      .eq("id", demandId)
      .maybeSingle();
    if (!data || !(OPEN_DEMAND_STATUSES as readonly string[]).includes(String(data.status))) return 0;
    const demand = {
      ...(data as unknown as MatchDemand & { customer: unknown }),
      budget_min: data.budget_min != null ? Number(data.budget_min) : null,
      budget_max: data.budget_max != null ? Number(data.budget_max) : null,
      min_sqm: data.min_sqm != null ? Number(data.min_sqm) : null,
    };
    const customer = customerRel(demand.customer);
    const result = await loadDemandMatches(admin, {
      demands: [demand],
      customerOf: () => customer?.id ?? null,
      tenantId,
    });
    const strong = result.pairs.filter((p) => p.score >= MATCH_NOTIFY_MIN && !p.state);
    if (strong.length === 0) return 0;

    await recordSuggestedMatches(
      admin,
      tenantId,
      strong.slice(0, 20).map((p) => ({ demandId, propertyId: p.property.id, customerId: customer?.id ?? null })),
    );
    const top = strong.slice(0, 3).map((p) => `${p.property.title ?? p.property.property_code} (${p.score})`);
    const more = strong.length > 3 ? ` +${strong.length - 3} daha` : "";
    await safeNotify({
      tenantId,
      userId: customer?.assigned_to ?? actorId,
      title: `${customer?.full_name ?? "Müşteri"} talebine ${strong.length} güçlü eşleşme`,
      body: `${top.join(", ")}${more}. Talep detayından müşterinize gönderin.`,
      href: `/app/talepler/${demandId}`,
      kind: "success",
      dedupeKey: `match-demand:${demandId}:${trDayKey()}`,
    });
    return strong.length;
  } catch (e) {
    console.error("notifyMatchesForDemand", e instanceof Error ? e.message : e);
    return 0;
  }
}
