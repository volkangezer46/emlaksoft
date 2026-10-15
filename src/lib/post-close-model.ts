import { OFFER_REMINDER_STATUSES } from "@/lib/offer-expiry";
import { appointmentHref } from "@/lib/notification-text";
import { OPEN_DEMAND_STATUSES, isDemandStatus, type DemandStatus } from "@/lib/workflow-state";

/**
 * Kapanış sonrası temizliğin SAF kuralları (I/O yok; sunucu `post-close.ts` ve kapanış ekranı aynı metni kullanır).
 * Ayrıntı: `src/lib/post-close.ts`.
 */

export type PostCloseDealType = "sale" | "rent";

/** Bekleyen (yanıt bekleyen) teklif kümesi: hatırlatma kümesiyle aynı tanım (taslak/gönderildi/karşı teklif). */
export const PENDING_OFFER_STATUSES: readonly string[] = OFFER_REMINDER_STATUSES;

/** Tek seferde ele alınan en çok randevu/teklif (toplu teklif işlemi sınırıyla aynı). */
export const POST_CLOSE_LIST_LIMIT = 100;

export type ClosedDemand = { id: string; previousStatus: DemandStatus };

export type PostCloseSummary = {
  dealId: string;
  dealType: PostCloseDealType;
  customerId: string | null;
  propertyId: string | null;
  closedDemands: ClosedDemand[];
  /** Yıldönümü bu işlemde yazıldıysa (önceden boştu). */
  anniversary: { customerId: string; date: string; note: string } | null;
  appointmentIds: string[];
  offerIds: string[];
};

export type DemandRow = {
  id: string;
  status: string | null;
  transaction_type: string | null;
  property_type: string | null;
};

export type AppointmentRow = {
  id: string;
  customer_id: string | null;
  assigned_to: string | null;
  created_by: string | null;
};

export type OfferRow = {
  id: string;
  customer_id: string | null;
  created_by: string | null;
};

export function anniversaryNoteFor(dealType: PostCloseDealType): string {
  return dealType === "rent" ? "Kiralama" : "Satın alma";
}

export function normalizeDealType(value: unknown): PostCloseDealType {
  return value === "rent" ? "rent" : "sale";
}

/**
 * Kapanışla karşılanan talepler: açık durumda, aynı işlem türünde ve (iki tarafta da doluysa) aynı emlak tipinde.
 * Farklı tipte ikinci bir arayış (ör. ev aldı, dükkan da arıyor) açık kalır.
 */
export function pickDemandsToClose(
  demands: readonly DemandRow[],
  dealType: PostCloseDealType,
  propertyType: string | null,
): ClosedDemand[] {
  const open = new Set<string>(OPEN_DEMAND_STATUSES);
  const out: ClosedDemand[] = [];
  for (const d of demands) {
    const status = d.status ?? "";
    if (!open.has(status) || !isDemandStatus(status)) continue;
    if (d.transaction_type !== dealType) continue;
    if (propertyType && d.property_type && d.property_type !== propertyType) continue;
    out.push({ id: d.id, previousStatus: status });
  }
  return out;
}

/** Alıcının kendi kayıtları (imza randevusu, kabul edilecek teklif) temizlik listesine girmez. */
export function excludeBuyer<T extends { customer_id: string | null }>(rows: readonly T[], buyerId: string | null): T[] {
  return buyerId ? rows.filter((r) => r.customer_id !== buyerId) : [...rows];
}

export type AdvisorNotice = { userId: string; appointmentIds: string[]; offerIds: string[] };

/**
 * Bildirilecek danışmanlar: randevuda sorumlu (yoksa oluşturan), teklifte oluşturan. Kapanışı yapan
 * kullanıcı ekranda zaten görür; ona ayrıca bildirim yazılmaz.
 */
export function groupAdvisorNotices(
  appointments: readonly AppointmentRow[],
  offers: readonly OfferRow[],
  actorId: string,
): AdvisorNotice[] {
  const by = new Map<string, AdvisorNotice>();
  const get = (userId: string) => {
    let n = by.get(userId);
    if (!n) {
      n = { userId, appointmentIds: [], offerIds: [] };
      by.set(userId, n);
    }
    return n;
  };
  for (const a of appointments) {
    const owner = a.assigned_to ?? a.created_by;
    if (owner && owner !== actorId) get(owner).appointmentIds.push(a.id);
  }
  for (const o of offers) {
    if (o.created_by && o.created_by !== actorId) get(o.created_by).offerIds.push(o.id);
  }
  return [...by.values()];
}

export function propertyLabel(p: { property_code?: string | null; title?: string | null } | null): string {
  if (!p) return "Portföy";
  const code = p.property_code?.trim();
  const title = p.title?.trim();
  if (code && title) return `${code} · ${title}`;
  return code || title || "Portföy";
}

/** Danışman bildirimi: ne kaldığını ve nereden yönetileceğini söyler. */
export function advisorNoticeText(
  notice: AdvisorNotice,
  label: string,
  dealType: PostCloseDealType,
  propertyId: string,
): { title: string; body: string; href: string } {
  const verb = dealType === "rent" ? "kiralandı" : "satıldı";
  const parts: string[] = [];
  if (notice.appointmentIds.length > 0) parts.push(`${notice.appointmentIds.length} yaklaşan randevunuz`);
  if (notice.offerIds.length > 0) parts.push(`${notice.offerIds.length} bekleyen teklifiniz`);
  // Tek kayıt → kaydın kendisi; birden çok → hepsini birlikte gösteren portföy kartı.
  const total = notice.appointmentIds.length + notice.offerIds.length;
  const href = total === 1
    ? notice.offerIds.length === 1
      ? `/app/teklifler/${notice.offerIds[0]}`
      : appointmentHref(notice.appointmentIds[0])
    : `/app/portfoyler/${propertyId}`;
  return {
    title: `Portföy ${verb}: ${label}`,
    body: `Bu portföyde ${parts.join(" ve ")} var. Lütfen iptal edin veya müşterinize bilgi verin.`,
    href,
  };
}

/** Kapanış ekranındaki özet metni (yalnız değişen/bekleyen şeyler). */
export function postCloseMessage(s: Pick<PostCloseSummary, "closedDemands" | "anniversary" | "appointmentIds" | "offerIds">): string | null {
  const done: string[] = [];
  if (s.closedDemands.length > 0) done.push(`${s.closedDemands.length} açık talep kapatıldı`);
  if (s.anniversary) done.push(`müşterinin yıldönümü ${s.anniversary.date} (${s.anniversary.note}) olarak kaydedildi`);
  const pending: string[] = [];
  if (s.appointmentIds.length > 0) pending.push(`${s.appointmentIds.length} yaklaşan randevu`);
  if (s.offerIds.length > 0) pending.push(`${s.offerIds.length} bekleyen teklif`);
  const sentences: string[] = [];
  if (done.length > 0) {
    const text = done.join(", ");
    sentences.push(text.charAt(0).toLocaleUpperCase("tr-TR") + text.slice(1) + ".");
  }
  if (pending.length > 0) sentences.push(`Portföyde hâlâ ${pending.join(" ve ")} var; sorumlu diğer danışmanlara bildirim gönderilir.`);
  return sentences.length > 0 ? sentences.join(" ") : null;
}
