/**
 * Portföy yetki (EİDS) durumu ve "Yetki kuyruğu" kuralları (SAF; istemci/sunucu güvenli).
 *
 * Durum modeli: kayıtlı EİDS doğrulama durumu üçlüdür (`pending` bekliyor / `approved` onaylandı / `rejected` reddedildi);
 * "süresi doldu" SAKLANMAZ, `authorization_end` tarihinden türetilir (tek kaynak: `evaluateAuthorityTerm`). Bu bir RESMİ EİDS
 * SORGUSU DEĞİLDİR: durum ofis tarafından (mal sahibi e-Devlet'te onayladıkça) işaretlenir.
 *
 * Kuyruk kovaları (bir portföy birden çok kovada olabilir):
 *   bekleyen  → mal sahibi e-Devlet onayı alınmamış (durum bekliyor) ve süresi dolmamış
 *   bitiyor   → yetki 15 gün içinde bitiyor (mevcut 15 günlük pencereyle aynı)
 *   dolmus    → yetki süresi dolmuş
 *   belgesiz  → yetki belgesi numarası girilmemiş
 */
import { evaluateAuthorityTerm, type AuthorityTerm } from "./authority-term";
import { isEidsInScope } from "./status";

export const EIDS_STATUS_VALUES = ["pending", "approved", "rejected"] as const;
export type EidsVerifyStatus = (typeof EIDS_STATUS_VALUES)[number];
export type EidsDisplayStatus = EidsVerifyStatus | "expired";

export const EIDS_STATUS_LABELS: Record<EidsDisplayStatus, string> = {
  pending: "Bekliyor",
  approved: "Onaylandı",
  rejected: "Reddedildi",
  expired: "Süresi doldu",
};

export const AUTHORITY_QUEUE_FILTERS = ["bekleyen", "bitiyor", "dolmus", "belgesiz"] as const;
export type AuthorityQueueFilter = (typeof AUTHORITY_QUEUE_FILTERS)[number];

export const AUTHORITY_QUEUE_LABELS: Record<AuthorityQueueFilter, string> = {
  bekleyen: "Onayı bekleyen",
  bitiyor: "15 günde bitiyor",
  dolmus: "Süresi dolmuş",
  belgesiz: "Belgesi eksik",
};

export function isAuthorityQueueFilter(v: string | null | undefined): v is AuthorityQueueFilter {
  return !!v && (AUTHORITY_QUEUE_FILTERS as readonly string[]).includes(v);
}

export function isEidsVerifyStatus(v: unknown): v is EidsVerifyStatus {
  return typeof v === "string" && (EIDS_STATUS_VALUES as readonly string[]).includes(v);
}

export type AuthorityQueueRow = {
  id: string;
  status: string | null;
  authorization_start?: string | null;
  authorization_end: string | null;
  authority_doc_no: string | null;
  authority_eids_status: string | null;
  authority_owner_approved_at: string | null;
  authority_reminder_sent_at: string | null;
  authority_reminder_count: number | null;
};

export function eidsDisplayStatus(row: Pick<AuthorityQueueRow, "authority_eids_status" | "authorization_end" | "authorization_start">, nowMs: number): EidsDisplayStatus {
  const term = evaluateAuthorityTerm({ start: row.authorization_start ?? null, end: row.authorization_end }, nowMs);
  if (term.state === "expired") return "expired";
  return isEidsVerifyStatus(row.authority_eids_status) ? row.authority_eids_status : "pending";
}

/** Portföyün düştüğü kuyruk kovaları (kapsam dışı durumdaki portföy hiçbir kovada değildir). */
export function classifyAuthority(row: AuthorityQueueRow, nowMs: number): { buckets: AuthorityQueueFilter[]; term: AuthorityTerm; display: EidsDisplayStatus } {
  const term = evaluateAuthorityTerm({ start: row.authorization_start ?? null, end: row.authorization_end }, nowMs);
  const display = eidsDisplayStatus(row, nowMs);
  const buckets: AuthorityQueueFilter[] = [];
  if (!isEidsInScope(row.status)) return { buckets, term, display };
  if (display === "pending") buckets.push("bekleyen");
  if (term.state === "expiring") buckets.push("bitiyor");
  if (term.state === "expired") buckets.push("dolmus");
  if (!(row.authority_doc_no ?? "").trim()) buckets.push("belgesiz");
  return { buckets, term, display };
}

export type AuthorityQueueSummary = {
  ids: Record<AuthorityQueueFilter, string[]>;
  counts: Record<AuthorityQueueFilter, number>;
  /** En az bir kovada olan benzersiz portföy sayısı. */
  total: number;
};

export function summarizeAuthorityQueue(rows: readonly AuthorityQueueRow[], nowMs: number): AuthorityQueueSummary {
  const ids: Record<AuthorityQueueFilter, string[]> = { bekleyen: [], bitiyor: [], dolmus: [], belgesiz: [] };
  const any = new Set<string>();
  for (const r of rows) {
    const { buckets } = classifyAuthority(r, nowMs);
    for (const b of buckets) ids[b].push(r.id);
    if (buckets.length > 0) any.add(r.id);
  }
  const counts = Object.fromEntries(AUTHORITY_QUEUE_FILTERS.map((k) => [k, ids[k].length])) as Record<AuthorityQueueFilter, number>;
  return { ids, counts, total: any.size };
}

/** Hatırlatma aralığı: aynı mal sahibine 24 saatten sık hatırlatma gönderilmez. */
export const REMINDER_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export function reminderCooldownLeftMs(lastSentIso: string | null | undefined, nowMs: number): number {
  if (!lastSentIso) return 0;
  const last = Date.parse(lastSentIso);
  if (!Number.isFinite(last)) return 0;
  return Math.max(0, last + REMINDER_COOLDOWN_MS - nowMs);
}

/** Satırdan hatırlatma gönderilebilir mi? (onay zaten alınmışsa gerekmez) */
export function canSendReminder(row: Pick<AuthorityQueueRow, "authority_eids_status" | "authority_reminder_sent_at" | "authorization_end" | "authorization_start">, nowMs: number): { ok: boolean; reason: string | null } {
  if (row.authority_eids_status === "approved") return { ok: false, reason: "Mal sahibi onayı zaten alınmış." };
  const left = reminderCooldownLeftMs(row.authority_reminder_sent_at, nowMs);
  if (left > 0) return { ok: false, reason: `Son hatırlatma 24 saatten yeni; ${Math.ceil(left / 3_600_000)} saat sonra tekrar gönderilebilir.` };
  return { ok: true, reason: null };
}

const MAX_SMS = 460;

/** Mal sahibine e-Devlet onay hatırlatma metni (SMS/WhatsApp ortak; işlem hatırlatması, reklam içermez). */
export function buildAuthorityReminderText(input: { ownerName?: string | null; office?: string | null; propertyLabel: string; endDate?: string | null }): string {
  const hello = input.ownerName?.trim() ? `Sayın ${input.ownerName.trim()}, ` : "Merhaba, ";
  const office = input.office?.trim() ? `${input.office.trim()} olarak ` : "";
  const end = input.endDate ? ` (yetki bitiş: ${input.endDate.slice(0, 10).split("-").reverse().join(".")})` : "";
  const text = `${hello}${office}${input.propertyLabel} için verdiğiniz satış/kiralama yetkisini e-Devlet "EİDS Yetki İşlemleri" ekranından onaylamanızı rica ederiz${end}. Onay verildiğinde ilanınız yayında kalabilir.`;
  return text.length > MAX_SMS ? `${text.slice(0, MAX_SMS - 1)}…` : text;
}

/**
 * Portala yayın öncesi yetki uyarısı (engellemez, uyarır). Yetkisiz / süresi dolmuş / reddedilmiş / onayı alınmamış portföyün
 * portala çıkması EİDS kurallarına aykırı olabilir; kullanıcı bilgilendirilir ve yayın kararı onun elindedir.
 */
export function authorityPublishWarning(
  row: Pick<AuthorityQueueRow, "authority_eids_status" | "authorization_end" | "authorization_start">,
  nowMs: number,
): string | null {
  const term = evaluateAuthorityTerm({ start: row.authorization_start ?? null, end: row.authorization_end }, nowMs);
  if (term.state === "expired") return "Uyarı: yetki süresi dolmuş; yetki yenilenmeden yayınlanan ilan yetkisiz sayılabilir.";
  if (row.authority_eids_status === "rejected") return "Uyarı: mal sahibi EİDS yetkisini reddetmiş görünüyor; yayın öncesi kontrol edin.";
  if (term.state === "missing") return "Uyarı: yetki bitiş tarihi girilmemiş; yetki belgesini kaydedin.";
  if (row.authority_eids_status !== "approved") return "Uyarı: mal sahibinin e-Devlet EİDS yetki onayı henüz alınmadı (Yetki kuyruğu).";
  return null;
}
