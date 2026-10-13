/**
 * Portföy yetki (EİDS) durumu ve "Yetki kuyruğu" kuralları (SAF; istemci/sunucu güvenli).
 *
 * Durum modeli (20261013007100): kayıtlı durum `unknown` bilinmiyor / `pending` bekliyor / `approved` onaylandı /
 * `expired` süresi doldu / `revoked` iptal edildi / `rejected` reddedildi. "Bitiyor" (`expiring`) SAKLANMAZ, onaylı
 * yetkinin `authorization_end` tarihinden hesaplanır; bitiş tarihi geçmişse kayıtlı durum ne olursa olsun "süresi doldu"
 * gösterilir (tek kaynak: `evaluateAuthorityTerm`). Bu bir RESMİ EİDS SORGUSU DEĞİLDİR: durum Bakanlık e-postası (EP3),
 * e-Devlet ekran görüntüsü, portal kontrolü ya da ofisin elle girişiyle yazılır; tek yazma noktası `applyAuthorityEvent`
 * (src/lib/eids/ledger.ts) ve her değişiklik `eids_authority_events` defterinde iz bırakır.
 *
 * İstisna (`eids_exempt_reason`: tapu yok / e-Devlet erişimi olmayan yabancı malik): portföy EİDS kontrolünden çıkar
 * (bekleyen/iptal/bilinmiyor/teyitsiz kovalarına girmez); yazılı yetki süresi kovaları (bitiyor/dolmuş/belgesiz) sürer.
 *
 * Kuyruk kovaları (bir portföy birden çok kovada olabilir):
 *   bekleyen   → mal sahibi e-Devlet onayı bekleniyor (durum bekliyor) ve süresi dolmamış
 *   bitiyor    → yetki 15 gün içinde bitiyor
 *   dolmus     → yetki süresi dolmuş (tarihten ya da kayıtlı "expired")
 *   iptal      → malik yetkiyi iptal etmiş ya da reddetmiş
 *   bilinmiyor → yetki durumu hiç işlenmemiş
 *   teyitsiz   → "onaylandı" ama hiç Bakanlık e-postası / belge / portal teyidi görülmemiş (yalnız ölçülebiliyorsa)
 *   belgesiz   → yetki belgesi numarası girilmemiş
 * "Eşleştir" kuyruğu portföy kovası DEĞİLDİR: eşleşmeyen bildirimlerden beslenir (sayfada ayrı sekme).
 */
import { addMonthsDay, evaluateAuthorityTerm, MIN_AUTHORITY_MONTHS, type AuthorityTerm } from "./authority-term";
import { isEidsInScope } from "./status";
import { DAY_MS, trDayKey } from "@/lib/clock";

export const EIDS_STATUS_VALUES = ["unknown", "pending", "approved", "expired", "revoked", "rejected"] as const;
export type EidsVerifyStatus = (typeof EIDS_STATUS_VALUES)[number];
export type EidsDisplayStatus = EidsVerifyStatus | "expiring" | "exempt";

export const EIDS_STATUS_LABELS: Record<EidsDisplayStatus, string> = {
  unknown: "Bilinmiyor",
  pending: "Bekliyor",
  approved: "Onaylandı",
  expiring: "Bitiyor",
  expired: "Süresi doldu",
  revoked: "İptal edildi",
  rejected: "Reddedildi",
  exempt: "İstisna (EİDS dışı)",
};

/** Elle seçilebilen durumlar (kart ve kuyruk). "expiring" hesaplanır, seçilemez. */
export const EIDS_MANUAL_STATUSES: readonly EidsVerifyStatus[] = ["approved", "pending", "revoked", "expired", "rejected", "unknown"];

export const EIDS_SOURCE_VALUES = ["email_verified", "email_unverified", "manual", "document", "portal_check"] as const;
export type EidsSource = (typeof EIDS_SOURCE_VALUES)[number];
export const EIDS_SOURCE_LABELS: Record<EidsSource, string> = {
  email_verified: "Bakanlık e-postası (doğrulanmış)",
  email_unverified: "Bakanlık e-postası (doğrulanamadı)",
  manual: "Elle giriş",
  document: "Belge (e-Devlet ekran görüntüsü)",
  portal_check: "Portalda doğrulandı",
};
/** Elle giriş kartında seçilebilen kaynaklar (e-posta kaynakları yalnız EP3 alıcısından gelir). */
export const EIDS_MANUAL_SOURCES: readonly EidsSource[] = ["manual", "document", "portal_check"];

export const EIDS_EXEMPT_REASONS = ["no_deed", "foreign_owner"] as const;
export type EidsExemptReason = (typeof EIDS_EXEMPT_REASONS)[number];
export const EIDS_EXEMPT_LABELS: Record<EidsExemptReason, string> = {
  no_deed: "Tapum yok",
  foreign_owner: "e-Devlet erişimi olmayan yabancı malik",
};
/** İstisna işaretlenince gösterilen yanıltıcı beyan uyarısı. */
export const EIDS_EXEMPT_RISK =
  "Dikkat: istisna yalnız gerçekten EİDS onayı alınamayan taşınmazlar içindir. Yanlış beyan, yetkisiz ilan sayılabilir ve idari para cezasına yol açabilir; dayanak belgeyi saklayın.";

export const AUTHORITY_QUEUE_FILTERS = ["bekleyen", "bitiyor", "dolmus", "iptal", "bilinmiyor", "teyitsiz", "belgesiz"] as const;
export type AuthorityQueueFilter = (typeof AUTHORITY_QUEUE_FILTERS)[number];

export const AUTHORITY_QUEUE_LABELS: Record<AuthorityQueueFilter, string> = {
  bekleyen: "Onayı bekleyen",
  bitiyor: "15 günde bitiyor",
  dolmus: "Süresi dolmuş",
  iptal: "İptal / reddedildi",
  bilinmiyor: "Durumu bilinmiyor",
  teyitsiz: "Onaylı, e-postası görülmemiş",
  belgesiz: "Belgesi eksik",
};

export function isAuthorityQueueFilter(v: string | null | undefined): v is AuthorityQueueFilter {
  return !!v && (AUTHORITY_QUEUE_FILTERS as readonly string[]).includes(v);
}

export function isEidsVerifyStatus(v: unknown): v is EidsVerifyStatus {
  return typeof v === "string" && (EIDS_STATUS_VALUES as readonly string[]).includes(v);
}
export function isEidsSource(v: unknown): v is EidsSource {
  return typeof v === "string" && (EIDS_SOURCE_VALUES as readonly string[]).includes(v);
}
export function isEidsExemptReason(v: unknown): v is EidsExemptReason {
  return typeof v === "string" && (EIDS_EXEMPT_REASONS as readonly string[]).includes(v);
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
  /** 20261013007100 sütunları: `undefined` = okunamadı (migration uygulanmamış) → ilgili kova ÖLÇÜLMEZ. */
  authority_eids_source?: string | null;
  authority_eids_verified_at?: string | null;
  authority_last_email_at?: string | null;
  eids_exempt_reason?: string | null;
};

type DisplayInput = Pick<AuthorityQueueRow, "authority_eids_status" | "authorization_end" | "authorization_start"> & {
  eids_exempt_reason?: string | null;
};

export function eidsDisplayStatus(row: DisplayInput, nowMs: number): EidsDisplayStatus {
  const term = evaluateAuthorityTerm({ start: row.authorization_start ?? null, end: row.authorization_end }, nowMs);
  const stored = row.authority_eids_status;
  if (stored === "revoked") return "revoked";
  if (term.state === "expired" || stored === "expired") return "expired";
  if (isEidsExemptReason(row.eids_exempt_reason)) return "exempt";
  if (!isEidsVerifyStatus(stored)) return "pending";
  if (stored === "approved" && term.state === "expiring") return "expiring";
  return stored;
}

/** Portföyün düştüğü kuyruk kovaları (kapsam dışı durumdaki portföy hiçbir kovada değildir). */
export function classifyAuthority(row: AuthorityQueueRow, nowMs: number): { buckets: AuthorityQueueFilter[]; term: AuthorityTerm; display: EidsDisplayStatus } {
  const term = evaluateAuthorityTerm({ start: row.authorization_start ?? null, end: row.authorization_end }, nowMs);
  const display = eidsDisplayStatus(row, nowMs);
  const buckets: AuthorityQueueFilter[] = [];
  if (!isEidsInScope(row.status)) return { buckets, term, display };
  const exempt = isEidsExemptReason(row.eids_exempt_reason);
  if (!exempt && display === "pending") buckets.push("bekleyen");
  if (term.state === "expiring") buckets.push("bitiyor");
  if (display === "expired") buckets.push("dolmus");
  if (!exempt && (display === "revoked" || display === "rejected")) buckets.push("iptal");
  if (!exempt && display === "unknown") buckets.push("bilinmiyor");
  if (
    !exempt &&
    (display === "approved" || display === "expiring") &&
    row.authority_last_email_at === null &&
    row.authority_eids_verified_at === null
  ) {
    buckets.push("teyitsiz");
  }
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
  const ids = Object.fromEntries(AUTHORITY_QUEUE_FILTERS.map((k) => [k, [] as string[]])) as Record<AuthorityQueueFilter, string[]>;
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

/** Satırdan hatırlatma gönderilebilir mi? (onay zaten alınmışsa ya da portföy EİDS istisnasıysa gerekmez) */
export function canSendReminder(
  row: Pick<AuthorityQueueRow, "authority_eids_status" | "authority_reminder_sent_at" | "authorization_end" | "authorization_start"> & {
    eids_exempt_reason?: string | null;
  },
  nowMs: number,
): { ok: boolean; reason: string | null } {
  if (row.authority_eids_status === "approved") return { ok: false, reason: "Mal sahibi onayı zaten alınmış." };
  if (isEidsExemptReason(row.eids_exempt_reason)) return { ok: false, reason: "Portföy EİDS istisnası olarak işaretli; e-Devlet onayı istenmez." };
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
 * Portala yayın öncesi yetki uyarısı (engel değil). İptal edilmiş / süresi dolmuş yetki ayrıca `authorityPublishBlock`
 * (src/lib/authority-shield.ts) ile ENGELLENİR; bu metin onaysız ya da tarihsiz durumda kullanıcıyı bilgilendirir.
 */
export function authorityPublishWarning(
  row: DisplayInput,
  nowMs: number,
): string | null {
  const term = evaluateAuthorityTerm({ start: row.authorization_start ?? null, end: row.authorization_end }, nowMs);
  if (row.authority_eids_status === "revoked") return "Uyarı: malik EİDS yetkisini iptal etmiş; yetki yenilenmeden yayınlanan ilan yetkisiz sayılır.";
  if (term.state === "expired" || row.authority_eids_status === "expired") return "Uyarı: yetki süresi dolmuş; yetki yenilenmeden yayınlanan ilan yetkisiz sayılabilir.";
  if (isEidsExemptReason(row.eids_exempt_reason)) return null;
  if (row.authority_eids_status === "rejected") return "Uyarı: mal sahibi EİDS yetkisini reddetmiş görünüyor; yayın öncesi kontrol edin.";
  if (term.state === "missing") return "Uyarı: yetki bitiş tarihi girilmemiş; yetki belgesini kaydedin.";
  if (row.authority_eids_status !== "approved") return "Uyarı: mal sahibinin e-Devlet EİDS yetki onayı henüz alınmadı (Yetki kuyruğu).";
  return null;
}

function dayOf(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(ms) ? Math.floor(ms / DAY_MS) : null;
}
function trDate(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10).split("-").reverse().join(".");
}

/**
 * Elle girilen yetki bitişinin doğrulaması (SAF). EİDS yetkisi en az 3 ay olmalıdır (`MIN_AUTHORITY_MONTHS`,
 * authority-term.ts): veriliş tarihi (yoksa bugün) + 3 ay'dan önceki bitiş REDDEDİLİR. Hata "ne oldu, ne yapmalı"
 * biçimindedir. Bitiş boşsa (durum yetki vermiyorsa) geçerlidir.
 */
export function validateManualAuthorityTerm(
  input: { grantedOn?: string | null; validUntil?: string | null },
  nowMs: number,
): { ok: true } | { ok: false; error: string } {
  const end = (input.validUntil ?? "").trim();
  if (!end) return { ok: true };
  const endDay = dayOf(end);
  if (endDay === null) {
    return { ok: false, error: "Ne oldu: bitiş tarihi okunamadı. Ne yapmalı: tarihi takvimden GG.AA.YYYY olarak seçin." };
  }
  const startRaw = (input.grantedOn ?? "").trim();
  const startDay = startRaw ? dayOf(startRaw) : (dayOf(trDayKey(nowMs)) as number);
  if (startDay === null) {
    return { ok: false, error: "Ne oldu: yetki veriliş tarihi okunamadı. Ne yapmalı: tarihi takvimden seçin ya da boş bırakın (bugün sayılır)." };
  }
  if (endDay < startDay) {
    return { ok: false, error: "Ne oldu: bitiş tarihi veriliş tarihinden önce. Ne yapmalı: iki tarihi e-Devlet yetki ekranındaki gibi girin." };
  }
  const minDay = addMonthsDay(startDay, MIN_AUTHORITY_MONTHS);
  if (endDay < minDay) {
    return {
      ok: false,
      error: `Ne oldu: bitiş (${trDate(endDay)}) veriliş tarihinden (${trDate(startDay)}) itibaren ${MIN_AUTHORITY_MONTHS} aydan kısa; EİDS yetkisi en az ${MIN_AUTHORITY_MONTHS} ay olmalıdır. Ne yapmalı: e-Devlet ekranındaki bitişi kontrol edin; gerçekten kısaysa malikten yetkiyi en az ${trDate(minDay)} tarihine kadar yeniden vermesini isteyin.`,
    };
  }
  return { ok: true };
}
