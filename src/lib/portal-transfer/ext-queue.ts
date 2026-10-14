/**
 * Eklenti → EmlakSoft GENEL gönderim kuyruğu (SAF, testli; `fsbo` kuyruğunun deseni). Kullanıcı eylemiyle (popup düğmesi)
 * kuyruğa yazılan kayıtlar, açık EmlakSoft sekmesindeki içerik betiğince oturumlu uca gönderilir. Başarısızsa üstel geri
 * çekilmeyle yeniden denenir; 24 saat ya da 8 denemeden sonra düşer. Aynı `key` tekrar yazılırsa kayıt GÜNCELLENİR (çift yok).
 */
import { CURRENT_PORTALS, type CurrentPortal } from "@/lib/portals/catalog";

export type QueueEntry<T> = { id: string; key: string; payload: T; attempts: number; nextAttemptAt: number; queuedAt: number };

export const QUEUE_MAX = 20;
export const QUEUE_MAX_ATTEMPTS = 8;
export const QUEUE_TTL_MS = 24 * 3_600_000;

export function backoffMs(attempts: number): number {
  return Math.min(2 * 3_600_000, 60_000 * 2 ** Math.max(0, attempts - 1));
}

export function pruneQueue<T>(list: readonly QueueEntry<T>[], nowMs: number): QueueEntry<T>[] {
  return list.filter((e) => nowMs - e.queuedAt < QUEUE_TTL_MS && e.attempts < QUEUE_MAX_ATTEMPTS).slice(-QUEUE_MAX);
}

export function enqueueEntry<T>(list: readonly QueueEntry<T>[], key: string, payload: T, nowMs: number, id: string): QueueEntry<T>[] {
  const without = list.filter((e) => e.key !== key);
  return pruneQueue([...without, { id, key, payload, attempts: 0, nextAttemptAt: nowMs, queuedAt: nowMs }], nowMs);
}

export function dueEntries<T>(list: readonly QueueEntry<T>[], nowMs: number): QueueEntry<T>[] {
  return pruneQueue(list, nowMs).filter((e) => e.nextAttemptAt <= nowMs);
}

export function doneEntry<T>(list: readonly QueueEntry<T>[], id: string): QueueEntry<T>[] {
  return list.filter((e) => e.id !== id);
}

export function failEntry<T>(list: readonly QueueEntry<T>[], id: string, nowMs: number): QueueEntry<T>[] {
  return list.map((e) => (e.id === id ? { ...e, attempts: e.attempts + 1, nextAttemptAt: nowMs + backoffMs(e.attempts + 1) } : e));
}

// ---------------------------------------------------------------- yükler (eklenti sınırı doğrulaması)

export type DonePayload = {
  sessionId: string;
  portal: CurrentPortal;
  state: "filled" | "published" | "failed";
  externalId: string | null;
  url: string | null;
  report: Record<string, string>;
};

export type ImportPayload = {
  portal: CurrentPortal;
  items: {
    externalId: string;
    url: string | null;
    title: string | null;
    price: number | null;
    sqm: number | null;
    rooms: string | null;
    location: string | null;
    status: "active" | "passive";
  }[];
};

const PORTALS = CURRENT_PORTALS;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const num = (v: unknown, min: number, max: number): number | null => (typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : null);

export function sanitizeDonePayload(raw: unknown): DonePayload | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const portal = PORTALS.find((p) => p === r.portal);
  const state = r.state === "filled" || r.state === "published" || r.state === "failed" ? r.state : null;
  if (!portal || !state || typeof r.sessionId !== "string" || !UUID.test(r.sessionId)) return null;
  const url = str(r.url, 2048);
  if (url && !/^https:\/\//i.test(url)) return null;
  const report: Record<string, string> = {};
  if (typeof r.report === "object" && r.report !== null) {
    for (const [k, v] of Object.entries(r.report as Record<string, unknown>).slice(0, 40)) {
      if (typeof v === "string" && /^[a-z_]{1,40}$/.test(k)) report[k] = v.slice(0, 40);
    }
  }
  return { sessionId: r.sessionId, portal, state, externalId: str(r.externalId, 40), url, report };
}

export function sanitizeImportPayload(raw: unknown): ImportPayload | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const portal = PORTALS.find((p) => p === r.portal);
  if (!portal || !Array.isArray(r.items)) return null;
  const items: ImportPayload["items"] = [];
  const seen = new Set<string>();
  for (const x of r.items.slice(0, 100)) {
    const it = (x ?? {}) as Record<string, unknown>;
    const externalId = str(it.externalId, 40);
    const url = str(it.url, 2048);
    if (!externalId || seen.has(externalId) || (url && !/^https:\/\//i.test(url))) continue;
    seen.add(externalId);
    items.push({
      externalId,
      url,
      title: str(it.title, 300),
      price: num(it.price, 1, 1e12),
      sqm: num(it.sqm, 10, 20_000),
      rooms: typeof it.rooms === "string" && /^\d{1,2}\+\d{1,2}$/.test(it.rooms) ? it.rooms : null,
      location: str(it.location, 160),
      status: it.status === "passive" ? "passive" : "active",
    });
  }
  return items.length > 0 ? { portal, items } : null;
}

export const doneKey = (p: DonePayload) => `${p.sessionId}:${p.state}`;
export const importKey = (p: ImportPayload) => `${p.portal}:${p.items.map((i) => i.externalId).sort().join(",")}`.slice(0, 600);

// ---------------------------------------------------------------- aktarım paketi (sunucudan gelen) saklama biçimi

export type StoredTransfer = {
  sessionId: string;
  portal: CurrentPortal;
  propertyId: string;
  propertyCode: string;
  propertyTitle: string;
  receivedAt: number;
  payload: unknown;
  photoIds: { id: string; name: string; type: string }[];
  /** Eklenti belleğine alınan fotoğraf sayısı ve atlananlar. */
  photosStored: number;
  photosSkipped: number;
  photosDone: boolean;
};

/** Sunucu yanıtından (güvenmeden) saklanacak paketi doğrular. */
export function sanitizeTransferResponse(raw: unknown, nowMs: number): StoredTransfer | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as { sessionId?: unknown; payload?: unknown };
  if (typeof r.sessionId !== "string" || !UUID.test(r.sessionId)) return null;
  const p = (typeof r.payload === "object" && r.payload !== null ? r.payload : null) as Record<string, unknown> | null;
  if (!p) return null;
  const portal = PORTALS.find((x) => x === p.portal);
  const prop = (typeof p.property === "object" && p.property !== null ? p.property : null) as Record<string, unknown> | null;
  if (!portal || !prop || typeof p.fields !== "object" || p.fields === null) return null;
  const photos = Array.isArray(p.photos) ? p.photos : [];
  const photoIds: StoredTransfer["photoIds"] = [];
  for (const x of photos.slice(0, 40)) {
    const ph = (x ?? {}) as Record<string, unknown>;
    if (typeof ph.id === "string" && UUID.test(ph.id)) photoIds.push({ id: ph.id, name: str(ph.fileName, 120) ?? "foto.jpg", type: str(ph.type, 40) ?? "image/jpeg" });
  }
  return {
    sessionId: r.sessionId,
    portal,
    propertyId: str(prop.id, 60) ?? "",
    propertyCode: str(prop.code, 60) ?? "",
    propertyTitle: str(prop.title, 200) ?? "",
    receivedAt: nowMs,
    payload: p,
    photoIds,
    photosStored: 0,
    photosSkipped: 0,
    photosDone: photoIds.length === 0,
  };
}
