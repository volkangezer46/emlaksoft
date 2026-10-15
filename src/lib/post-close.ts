import type { SupabaseClient } from "@supabase/supabase-js";
import { logActivity } from "@/lib/activity";
import { trDayKey } from "@/lib/clock";
import { notifyTenant } from "@/lib/notify";
import { OPEN_DEMAND_STATUSES, UNCLOSED_APPOINTMENT_STATUSES, type DemandStatus } from "@/lib/workflow-state";
import {
  POST_CLOSE_LIST_LIMIT,
  PENDING_OFFER_STATUSES,
  advisorNoticeText,
  anniversaryNoteFor,
  excludeBuyer,
  groupAdvisorNotices,
  pickDemandsToClose,
  propertyLabel,
  type AppointmentRow,
  type DemandRow,
  type OfferRow,
  type PostCloseDealType,
  type PostCloseSummary,
} from "@/lib/post-close-model";

export { normalizeDealType, type PostCloseSummary } from "@/lib/post-close-model";

/**
 * Satış / kiralama kapanışı sonrası temizlik (anlaşma "won" olduktan SONRA çağrılır).
 *
 * (a) Alıcı/kiracının aynı işlem türündeki açık talepleri "closed" yapılır; müşterinin yıldönümü
 *     boşsa kapanış günü + "Satın alma"/"Kiralama" notu yazılır. Tek audit satırı düşülür.
 *     Talep kapanışı müşteriye ileti GÖNDERMEZ (memnuniyet anketi "kaybedilen talep" adayı, kazanılmış
 *     anlaşması olan müşteriyi zaten atlar).
 * (b) Satılan/kiralanan portföyün gelecekteki kapanmamış randevuları ve bekleyen teklifleri bulunur;
 *     ilgili danışmanlar bildirilir. Bunlar SESSİZCE iptal edilmez: kapanış ekranı tek tıkla
 *     "Randevuları iptal et / Teklifleri reddet" önerir (kullanıcının kendi yetkisiyle).
 *
 * Alıcının kendi randevusu/teklifi (ör. imza randevusu) listeye alınmaz.
 */

type Db = SupabaseClient;

export type PostCloseInput = {
  db: Db;
  tenantId: string;
  actorId: string;
  dealId: string;
  dealType: PostCloseDealType;
  customerId: string | null;
  propertyId: string | null;
  now?: Date;
};

/**
 * (a) talep kapatma + yıldönümü, (b) portföyde kalan randevu/teklif tespiti. Hata ana işlemi bozmaz:
 * okunamayan parça boş sayılır ve günlüğe yazılır. `db` çağıranın (kiracı kapısını geçmiş) istemcisidir;
 * her sorgu tenant_id ile süzülür.
 */
export async function runPostCloseCleanup(input: PostCloseInput): Promise<PostCloseSummary> {
  const { db, tenantId, dealId, dealType, customerId, propertyId } = input;
  const now = input.now ?? new Date();
  const summary: PostCloseSummary = {
    dealId,
    dealType,
    customerId,
    propertyId,
    closedDemands: [],
    anniversary: null,
    appointmentIds: [],
    offerIds: [],
  };

  let propertyType: string | null = null;
  if (propertyId) {
    const { data } = await db
      .from("properties")
      .select("property_type")
      .eq("id", propertyId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    propertyType = typeof data?.property_type === "string" ? data.property_type : null;
  }

  if (customerId) {
    const { data: demands, error: demandError } = await db
      .from("customer_demands")
      .select("id, status, transaction_type, property_type")
      .eq("tenant_id", tenantId)
      .eq("customer_id", customerId)
      .in("status", [...OPEN_DEMAND_STATUSES]);
    if (demandError) console.error("postClose demands", { code: demandError.code });
    const toClose = pickDemandsToClose((demands ?? []) as DemandRow[], dealType, propertyType);
    if (toClose.length > 0) {
      const { data: closed, error } = await db
        .from("customer_demands")
        .update({ status: "closed" satisfies DemandStatus })
        .eq("tenant_id", tenantId)
        .in("id", toClose.map((d) => d.id))
        .in("status", [...OPEN_DEMAND_STATUSES])
        .select("id");
      if (error) console.error("postClose close demands", { code: error.code });
      const closedIds = new Set(((closed ?? []) as { id: string }[]).map((r) => r.id));
      summary.closedDemands = toClose.filter((d) => closedIds.has(d.id));
    }

    const date = trDayKey(now);
    const note = anniversaryNoteFor(dealType);
    const { data: customer, error: annError } = await db
      .from("customers")
      .update({ anniversary_date: date, anniversary_note: note })
      .eq("id", customerId)
      .eq("tenant_id", tenantId)
      .is("anniversary_date", null)
      .is("deleted_at", null)
      .select("id")
      .maybeSingle();
    if (annError) console.error("postClose anniversary", { code: annError.code });
    if (customer) summary.anniversary = { customerId, date, note };
  }

  if (propertyId) {
    const [appts, offers] = await Promise.all([
      db
        .from("appointments")
        .select("id, customer_id, assigned_to, created_by")
        .eq("tenant_id", tenantId)
        .eq("property_id", propertyId)
        .in("status", [...UNCLOSED_APPOINTMENT_STATUSES])
        .gte("scheduled_at", now.toISOString())
        .order("scheduled_at", { ascending: true })
        .limit(POST_CLOSE_LIST_LIMIT),
      db
        .from("offers")
        .select("id, customer_id, created_by")
        .eq("tenant_id", tenantId)
        .eq("property_id", propertyId)
        .in("status", [...PENDING_OFFER_STATUSES])
        .order("created_at", { ascending: false })
        .limit(POST_CLOSE_LIST_LIMIT),
    ]);
    if (appts.error) console.error("postClose appointments", { code: appts.error.code });
    if (offers.error) console.error("postClose offers", { code: offers.error.code });
    summary.appointmentIds = excludeBuyer((appts.data ?? []) as AppointmentRow[], customerId).map((a) => a.id);
    summary.offerIds = excludeBuyer((offers.data ?? []) as OfferRow[], customerId).map((o) => o.id);
  }

  if (summary.closedDemands.length > 0 || summary.anniversary) {
    await logActivity({
      tenantId,
      actorId: input.actorId,
      action: "deal.post_close_cleanup",
      entityType: "deal",
      entityId: dealId,
      oldValue: {
        demands: summary.closedDemands.map((d) => ({ id: d.id, status: d.previousStatus })),
        ...(summary.anniversary ? { anniversary_date: null } : {}),
      },
      newValue: {
        customer_id: customerId,
        closed_demand_ids: summary.closedDemands.map((d) => d.id),
        anniversary: summary.anniversary,
      },
    });
  }

  return summary;
}

/**
 * (b) bildirimleri: danışman başına tek bildirim (dedupe anahtarlı; tekrar kazanmada çift yazılmaz).
 * Yanıtı bekletmemek için çağıran `afterSafe` içinde çalıştırır.
 */
export async function notifyPostCloseAdvisors(input: {
  db: Db;
  tenantId: string;
  actorId: string;
  summary: PostCloseSummary;
}): Promise<number> {
  const { db, tenantId, summary } = input;
  const propertyId = summary.propertyId;
  if (!propertyId || (summary.appointmentIds.length === 0 && summary.offerIds.length === 0)) return 0;

  const [appts, offers, property] = await Promise.all([
    summary.appointmentIds.length > 0
      ? db.from("appointments").select("id, customer_id, assigned_to, created_by").eq("tenant_id", tenantId).in("id", summary.appointmentIds)
      : Promise.resolve({ data: [] as AppointmentRow[] }),
    summary.offerIds.length > 0
      ? db.from("offers").select("id, customer_id, created_by").eq("tenant_id", tenantId).in("id", summary.offerIds)
      : Promise.resolve({ data: [] as OfferRow[] }),
    db.from("properties").select("property_code, title").eq("id", propertyId).eq("tenant_id", tenantId).maybeSingle(),
  ]);
  const notices = groupAdvisorNotices(
    (appts.data ?? []) as AppointmentRow[],
    (offers.data ?? []) as OfferRow[],
    input.actorId,
  );
  const label = propertyLabel(property.data as { property_code?: string | null; title?: string | null } | null);
  let sent = 0;
  for (const n of notices) {
    const text = advisorNoticeText(n, label, summary.dealType, propertyId);
    try {
      await notifyTenant({
        tenantId,
        userId: n.userId,
        title: text.title,
        body: text.body,
        href: text.href,
        kind: "warning",
        prefKey: n.appointmentIds.length > 0 ? "appointment" : undefined,
        dedupeKey: `deal-post-close:${summary.dealId}:${n.userId}`,
      });
      sent += 1;
    } catch (e) {
      console.error("postClose notify", e instanceof Error ? e.message : e);
    }
  }
  return sent;
}
