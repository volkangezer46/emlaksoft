import { isTicketTransitionAllowed, TICKET_OPEN_STATUSES } from "@/lib/support/ticket-contract";

export { TICKET_OPEN_STATUSES };

export const TICKET_STATUS_KEYS = [
  "open",
  "in_progress",
  "waiting",
  "resolved",
  "closed",
] as const;

export function bulkStatusTargetsFor(currentStatuses: readonly string[]) {
  // Boş seçim BİLİNÇLİ olarak tüm açık durumları döner (varsayılan dropdown
  // durumu — bkz. ticket-list-model.test.ts). Toolbar zaten yalnız gerçek bir
  // seçim varken render edilir; asıl risk sayfa değişince ESKİ seçimin
  // ekranda olmayan id'leri işaret etmesiydi — bu ticket-queue-view.tsx'teki
  // rows-değişince-buda efektiyle giderildi.
  return TICKET_OPEN_STATUSES.filter((target) =>
    currentStatuses.every((current) =>
      isTicketTransitionAllowed(current, target, "staff"),
    ),
  );
}

export const TICKET_PRIORITY_KEYS = ["urgent", "high", "normal", "low"] as const;

export const TICKET_CATEGORY_KEYS = [
  "general",
  "billing",
  "bug",
  "feature",
  "compliance",
  "onboarding",
] as const;

export const TICKET_STATUS_LABEL: Record<string, string> = {
  open: "Açık",
  in_progress: "İşleniyor",
  waiting: "Yanıt bekliyor",
  resolved: "Çözüldü",
  closed: "Kapalı",
};

export const TICKET_PRIORITY_LABEL: Record<string, string> = {
  low: "Düşük",
  normal: "Normal",
  high: "Yüksek",
  urgent: "Acil",
};

export const TICKET_CATEGORY_LABEL: Record<string, string> = {
  general: "Genel",
  billing: "Fatura",
  bug: "Hata",
  feature: "Özellik isteği",
  compliance: "Uyum",
  onboarding: "Kurulum",
};

/**
 * "İlk yanıt bekliyor" süzgeci (B123): açık durumdaki (open / in_progress / waiting) ve HİÇ personel yanıtı almamış
 * (`first_response_at is null`) talepler. Ofisin ek mesajı artık talebi "İşleniyor"a çekmediği için (reply v3) bu küme
 * "Açık" ile büyük ölçüde örtüşür; yine de atanan personelin elle "İşleniyor" yaptığı ama yanıtlamadığı talepleri de
 * yakalar. Destek ana sayfası bu kümeyi öne alır.
 */
export const FIRST_RESPONSE_FILTER = "ilk-yanit";

/** Talep ilk yanıt mı bekliyor? (açık durum + ilk yanıt yok) */
export function awaitingFirstResponse(t: { status: string; first_response_at?: string | null }): boolean {
  return (TICKET_OPEN_STATUSES as readonly string[]).includes(t.status) && !t.first_response_at;
}

export type TicketSortKey = "queue" | "created_at" | "updated_at" | "subject" | "status";
export type TicketSortDirection = "asc" | "desc";
export type TicketSlaFilter = "normal" | "warning" | "breached";

export type TicketListFilters = {
  q?: string;
  durum?: string;
  oncelik?: string;
  kategori?: string;
  atanan?: string;
  tenant?: string;
  /** Bilet etiketi (AD9); kanonik kuyruk RPC'si etiket bilmez, bu yüzden doğrudan sorguya düşer. */
  etiket?: string;
  sla?: TicketSlaFilter;
  sirala?: TicketSortKey;
  yon?: TicketSortDirection;
  sayfa?: number;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string | undefined): value is string {
  return Boolean(value && UUID_RE.test(value));
}

export function shortTicketId(id: string) {
  return `#${id.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

export function normalizeTicketFilters(raw: {
  q?: string;
  durum?: string;
  oncelik?: string;
  kategori?: string;
  atanan?: string;
  tenant?: string;
  etiket?: string;
  sla?: string;
  sirala?: string;
  yon?: string;
  sayfa?: string;
}): TicketListFilters {
  const q = (raw.q ?? "").trim().slice(0, 80);
  const durum =
    raw.durum === "acik" ||
    raw.durum === "cozulmus" ||
    raw.durum === FIRST_RESPONSE_FILTER ||
    TICKET_STATUS_KEYS.includes(raw.durum as (typeof TICKET_STATUS_KEYS)[number])
      ? raw.durum
      : undefined;
  const oncelik = TICKET_PRIORITY_KEYS.includes(raw.oncelik as (typeof TICKET_PRIORITY_KEYS)[number])
    ? raw.oncelik
    : undefined;
  const rawCategory = (raw.kategori ?? "").trim();
  const kategori = rawCategory.length > 0 && rawCategory.length <= 80 && !/[\u0000-\u001f\u007f]/.test(rawCategory)
    ? rawCategory
    : undefined;
  const atanan = raw.atanan === "atanmadi" || isUuid(raw.atanan) ? raw.atanan : undefined;
  const tenant = isUuid(raw.tenant) ? raw.tenant : undefined;
  const rawTag = (raw.etiket ?? "").trim().toLocaleLowerCase("tr-TR");
  const etiket = /^[\p{L}\p{N}][\p{L}\p{N} _-]{0,31}$/u.test(rawTag) ? rawTag : undefined;
  const sla = (["normal", "warning", "breached"] as const).includes(raw.sla as TicketSlaFilter)
    ? (raw.sla as TicketSlaFilter)
    : undefined;
  const requestedSort = (["queue", "created_at", "updated_at", "subject", "status"] as const).includes(raw.sirala as TicketSortKey)
    ? (raw.sirala as TicketSortKey)
    : "queue";
  // SLA görünümleri operasyon kuyruğunun kanonik risk sırasını korur. Etiket ve "İlk yanıt bekliyor" süzgeçleri kanonik
  // kuyruk RPC'sinde yok: doğrudan sorguya düşer (ilk yanıt bekleyenlerde varsayılan en eski önce).
  const firstResponse = durum === FIRST_RESPONSE_FILTER;
  const sirala = sla && !firstResponse ? "queue" : (etiket || firstResponse) && requestedSort === "queue" ? "created_at" : requestedSort;
  const yon =
    sirala === "queue" ? "desc" : raw.yon === "asc" || raw.yon === "desc" ? raw.yon : firstResponse && requestedSort === "queue" ? "asc" : "desc";
  const parsedPage = Number(raw.sayfa);
  const sayfa = Number.isInteger(parsedPage) && parsedPage > 1 ? parsedPage : 1;

  return {
    q: q || undefined,
    durum,
    oncelik,
    kategori,
    atanan,
    tenant,
    ...(etiket ? { etiket } : {}),
    sla,
    sirala,
    yon,
    sayfa,
  };
}

export function buildTicketListHref(
  current: TicketListFilters,
  patch: Partial<Record<keyof TicketListFilters, string | number | null | undefined>> = {},
) {
  const next: TicketListFilters = { ...current, ...patch } as TicketListFilters;
  const changesListing = Object.keys(patch).some((key) => key !== "sayfa");
  if (changesListing && !("sayfa" in patch)) next.sayfa = 1;

  const params = new URLSearchParams();
  if (next.q) params.set("q", next.q);
  if (next.durum) params.set("durum", next.durum);
  if (next.oncelik) params.set("oncelik", next.oncelik);
  if (next.kategori) params.set("kategori", next.kategori);
  if (next.atanan) params.set("atanan", next.atanan);
  if (next.tenant) params.set("tenant", next.tenant);
  if (next.etiket) params.set("etiket", next.etiket);
  if (next.sla) params.set("sla", next.sla);
  if (next.sirala && next.sirala !== "queue") params.set("sirala", next.sirala);
  if (next.yon && next.yon !== "desc") params.set("yon", next.yon);
  if (next.sayfa && next.sayfa > 1) params.set("sayfa", String(next.sayfa));
  const query = params.toString();
  return query ? `/admin/tickets?${query}` : "/admin/tickets";
}

export function averageResolutionHours(
  rows: readonly { created_at: string; resolved_at: string | null }[],
) {
  const durations = rows.flatMap((row) => {
    if (!row.resolved_at) return [];
    const created = new Date(row.created_at).getTime();
    const resolved = new Date(row.resolved_at).getTime();
    if (!Number.isFinite(created) || !Number.isFinite(resolved) || resolved < created) return [];
    return [(resolved - created) / 3_600_000];
  });
  if (durations.length === 0) return null;
  return Math.round(durations.reduce((sum, hours) => sum + hours, 0) / durations.length);
}

export function formatDurationHours(hours: number | null) {
  if (hours === null) return "—";
  if (hours < 1) return "< 1 saat";
  if (hours < 48) return `${hours} saat`;
  return `${Math.round(hours / 24)} gün`;
}

export function resolutionRate(total: number, resolved: number) {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((resolved / total) * 100)));
}
