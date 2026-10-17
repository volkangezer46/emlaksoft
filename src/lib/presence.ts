import { DAY_MS, formatTrTime, trDayKey, trDayStartMs } from "@/lib/clock";

/**
 * EKİP DURUMU — SAF model (istemci ve sunucu ortak; DB'ye dokunmaz). Tablo: `user_presence` (migration 20261024030000).
 *
 * Kurallar:
 *  - Durum gün sonunda (Europe/Istanbul) BİTER: satırın günü bugün değilse etkin durum "Çevrimdışı" olur, son görülme
 *    satırın zamanıdır (satır silinmez; ertesi gün kullanıcı yeniden seçer).
 *  - Örnek (is_sample) satırlar demo ekibi canlı göstermek içindir: günü geçse de durumu korunur, yaşı 6 saatlik pencerede
 *    döner (demo her gün "az önce / 1 saat önce" görünür). Gerçek satır asla bu yoldan geçmez.
 *  - Zaman etiketi: <5 dk "Şu an aktif", <60 dk "N dk önce", <3 sa "N saat önce", bugün "HH:MM", dün "Dün HH:MM",
 *    sonrası "N gün önce".
 */
export const PRESENCE_STATUSES = ["office", "meeting", "field", "break", "away", "offline"] as const;
export type PresenceStatus = (typeof PRESENCE_STATUSES)[number];

export const PRESENCE_LABEL: Record<PresenceStatus, string> = {
  office: "Ofiste",
  meeting: "Görüşmede",
  field: "Sahada",
  break: "Mola",
  away: "Uzakta",
  offline: "Çevrimdışı",
};

/** Hap tonu (home.css `.kh-pres.is-*` ve menü noktası `.pres-dot.is-*`). */
export const PRESENCE_TONE: Record<PresenceStatus, "green" | "violet" | "blue" | "amber" | "gray" | "muted"> = {
  office: "green",
  meeting: "violet",
  field: "blue",
  break: "amber",
  away: "gray",
  offline: "muted",
};

/** Nokta rengi (menü ve avatar rozeti; iki temada da okunur orta tonlar). */
export const PRESENCE_DOT: Record<PresenceStatus, string> = {
  office: "#22c55e",
  meeting: "#8b5cf6",
  field: "#3b82f6",
  break: "#f59e0b",
  away: "#94a3b8",
  offline: "#94a3b8",
};

/** Kullanıcı menüsüne giden kendi durum özeti (`status: null` = bugün seçilmemiş). */
export type OwnPresence = { status: PresenceStatus | null; note: string | null };

export const PRESENCE_NOTE_MAX = 60;
const SAMPLE_WINDOW_MS = 6 * 3_600_000;

export function isPresenceStatus(v: unknown): v is PresenceStatus {
  return typeof v === "string" && (PRESENCE_STATUSES as readonly string[]).includes(v);
}

/** Not: kırpılmış, boşluk sadeleşmiş, en çok 60 karakter; boşsa null. */
export function cleanPresenceNote(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.replace(/\s+/g, " ").trim();
  if (!s) return null;
  return Array.from(s).slice(0, PRESENCE_NOTE_MAX).join("");
}

export type PresenceRow = { status: string; note?: string | null; updated_at: string; is_sample?: boolean | null };
export type EffectivePresence = { status: PresenceStatus; note: string | null; atMs: number; expired: boolean };

/** Satırın BUGÜN geçerli durumu (gün sonu bitişi + örnek satır kuralı). Satır yoksa / bozuksa null. */
export function effectivePresence(row: PresenceRow | null | undefined, nowMs: number): EffectivePresence | null {
  if (!row || !isPresenceStatus(row.status)) return null;
  const at = Date.parse(row.updated_at);
  if (!Number.isFinite(at)) return null;
  if (row.is_sample) {
    const age = ((nowMs - at) % SAMPLE_WINDOW_MS + SAMPLE_WINDOW_MS) % SAMPLE_WINDOW_MS;
    return { status: row.status, note: row.note ?? null, atMs: nowMs - age, expired: false };
  }
  const expired = trDayKey(at) !== trDayKey(nowMs);
  return expired ? { status: "offline", note: null, atMs: at, expired: true } : { status: row.status, note: row.note ?? null, atMs: at, expired: false };
}

/** "Şu an aktif" · "15 dk önce" · "1 saat önce" · "14:32" · "Dün 18:05" · "3 gün önce". */
export function presenceTimeLabel(atMs: number, nowMs: number): string {
  if (!Number.isFinite(atMs)) return "";
  const diff = Math.max(0, nowMs - atMs);
  if (diff < 5 * 60_000) return "Şu an aktif";
  if (diff < 60 * 60_000) return `${Math.floor(diff / 60_000)} dk önce`;
  if (diff < 3 * 3_600_000) return `${Math.floor(diff / 3_600_000)} saat önce`;
  const today = trDayKey(nowMs);
  if (trDayKey(atMs) === today) return formatTrTime(atMs);
  if (trDayKey(atMs + DAY_MS) === today) return `Dün ${formatTrTime(atMs)}`;
  const days = Math.max(2, Math.round((trDayStartMs(nowMs) - trDayStartMs(atMs)) / DAY_MS));
  return `${days} gün önce`;
}

/** Ekip listesi sırası: etkin durumlar önde (Ofiste → Görüşmede → Sahada → Mola → Uzakta), sonra durumsuz, en sonda çevrimdışı. */
export function presenceRank(status: PresenceStatus | null): number {
  if (status === null) return PRESENCE_STATUSES.length - 1;
  return status === "offline" ? PRESENCE_STATUSES.length : PRESENCE_STATUSES.indexOf(status);
}

/** Saha modu (/app/hizli) açılınca "Sahada"ya geçilir mi: bugün seçilmiş durum yoksa ya da Ofiste/Çevrimdışı ise. */
export function shouldAutoField(current: EffectivePresence | null): boolean {
  if (!current || current.expired) return true;
  return current.status === "office" || current.status === "offline";
}
