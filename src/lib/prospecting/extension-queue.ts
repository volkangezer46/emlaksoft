/**
 * Eklenti → EmlakSoft "sahibinden ilan" gönderim kuyruğu (SAF, testli; `scanUploads` desenine paralel).
 * Kullanıcı onayladığı tek ilan kuyruğa yazılır; açık EmlakSoft sekmesindeki içerik betiği oturumlu uca gönderir. Aynı
 * ilan (portal bağlantısı) tekrar kaydedilirse kuyruktaki kayıt GÜNCELLENİR (çift gönderim yok); sunucu da idempotenttir.
 * Otomatik yeniden kontrol YOK (v2): kuyruk yalnız gönderilemeyen kayıtları yeniden dener.
 */
export type FsboPayload = {
  url: string;
  title: string | null;
  price: number | null;
  rooms: string | null;
  grossM2: number | null;
  locationText: string | null;
  listedAt: string | null;
  transactionType: "sale" | "rent";
  ownerName: string | null;
  /** Yalnız kullanıcı "numarayı ilanda gördüm" onayı verdiyse dolu. */
  phone: string | null;
};

export type FsboPending = { id: string; payload: FsboPayload; attempts: number; nextAttemptAt: number; queuedAt: number };

export const FSBO_QUEUE_MAX = 20;
export const FSBO_MAX_ATTEMPTS = 8;
export const FSBO_TTL_MS = 24 * 3_600_000;

export function fsboBackoffMs(attempts: number): number {
  return Math.min(2 * 3_600_000, 60_000 * 2 ** Math.max(0, attempts - 1));
}

function keyOf(p: FsboPayload): string {
  return p.url.toLowerCase();
}

const str = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v < 1e12 ? v : null);

/** İletiden gelen yükü doğrular (içerik betiği/popup sınırı). Geçersizse null. */
export function sanitizeFsboPayload(raw: unknown): FsboPayload | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const url = str(r.url, 600);
  if (!url || !/^https:\/\//i.test(url)) return null;
  const listedAt = typeof r.listedAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.listedAt) ? r.listedAt : null;
  return {
    url,
    title: str(r.title, 200),
    price: num(r.price),
    rooms: str(r.rooms, 20),
    grossM2: num(r.grossM2),
    locationText: str(r.locationText, 200),
    listedAt,
    transactionType: r.transactionType === "rent" ? "rent" : "sale",
    ownerName: str(r.ownerName, 120),
    phone: str(r.phone, 40),
  };
}

export function pruneFsbo(list: readonly FsboPending[], nowMs: number): FsboPending[] {
  return list.filter((e) => nowMs - e.queuedAt < FSBO_TTL_MS && e.attempts < FSBO_MAX_ATTEMPTS).slice(-FSBO_QUEUE_MAX);
}

export function enqueueFsbo(list: readonly FsboPending[], payload: FsboPayload, nowMs: number, id: string): FsboPending[] {
  const without = list.filter((e) => keyOf(e.payload) !== keyOf(payload));
  return pruneFsbo([...without, { id, payload, attempts: 0, nextAttemptAt: nowMs, queuedAt: nowMs }], nowMs);
}

export function dueFsbo(list: readonly FsboPending[], nowMs: number): FsboPending[] {
  return pruneFsbo(list, nowMs).filter((e) => e.nextAttemptAt <= nowMs);
}

export function markFsboDone(list: readonly FsboPending[], id: string): FsboPending[] {
  return list.filter((e) => e.id !== id);
}

export function markFsboFailed(list: readonly FsboPending[], id: string, nowMs: number): FsboPending[] {
  return list.map((e) => (e.id === id ? { ...e, attempts: e.attempts + 1, nextAttemptAt: nowMs + fsboBackoffMs(e.attempts + 1) } : e));
}
