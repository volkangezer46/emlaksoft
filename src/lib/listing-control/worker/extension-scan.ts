import type { StoreItem, StoreListResult } from "../adapters/html/parse-core";

/**
 * GÜNLÜK MAĞAZA TARAMASI (SAF, testli; saat dışarıdan verilir). Eklenti, ofisin KENDİ "ilanlarım" listesini (sayfalama dahil)
 * günde en az bir kez okur ve EmlakSoft'a yükler. Vaat: "tarayıcı açıldıktan sonra günde en az bir kez; kaçırılırsa ilk
 * açılışta." (Chrome kapalıyken/bilgisayar uykudayken alarm çalışmaz.)
 *
 * DÜRÜSTLÜK: bir liste ancak (a) sayfalama kendiliğinden bittiyse (sonraki sayfa yok), (b) portalın gösterdiği TOPLAM ilan sayısı
 * okunabildiyse ve (c) okunan ilan sayısı toplama ulaştıysa "tam"dır. Aksi halde "listede yok" gözlemi üretilmez (sunucu da
 * aynı kuralı ayrıca uygular). Okunamayan yapı (`no_items`) "ayrıştırılamadı" sayacı olarak telemetriye düşer.
 */

export const SCAN_LIMITS = {
  /** Son TAM taramadan bu kadar sonra yeniden başlar (günde en az bir kez; 4 saat tolerans). */
  dueAfterMs: 20 * 3_600_000,
  /** Başarısız/eksik denemeden sonra en erken yeniden deneme. */
  retryAfterMs: 2 * 3_600_000,
  maxPages: 30,
  maxItems: 1000,
  pendingMax: 6,
  pendingTtlMs: 3 * 24 * 3_600_000,
} as const;

export type ScanResultKind = "complete" | "partial" | "unreadable" | "blocked";

export type ScanPortalState = {
  lastFullAt: number | null;
  lastTryAt: number | null;
  lastResult: ScanResultKind | null;
  lastRead: number;
  lastExpected: number | null;
};
export type ScanStates = Record<string, ScanPortalState>;

export const EMPTY_PORTAL_STATE: ScanPortalState = { lastFullAt: null, lastTryAt: null, lastResult: null, lastRead: 0, lastExpected: null };

/** Taramaya hazır portallar (tam tarama zamanı geldi ve yeniden deneme beklemesi bitti). */
export function duePortals(states: ScanStates, portalIds: readonly string[], isEnabled: (id: string) => boolean, nowMs: number): string[] {
  return portalIds.filter((id) => {
    if (!isEnabled(id)) return false;
    const s = states[id] ?? EMPTY_PORTAL_STATE;
    const fullDue = s.lastFullAt === null || nowMs - s.lastFullAt >= SCAN_LIMITS.dueAfterMs;
    const retryOk = s.lastTryAt === null || nowMs - s.lastTryAt >= SCAN_LIMITS.retryAfterMs;
    return fullDue && retryOk;
  });
}

/** Yüklenen ilan (küçük resim ve ham HTML GİTMEZ). */
export type ScanItem = {
  externalId: string;
  url: string;
  title: string | null;
  price: number | null;
  sqm: number | null;
  rooms: string | null;
  location: string | null;
  status: "active" | "passive";
};

export type ScanProgress = {
  portal: string;
  startedAt: number;
  nextUrl: string;
  visited: string[];
  pages: number;
  items: ScanItem[];
  totalCount: number | null;
};

export function startScan(portal: string, startUrl: string, nowMs: number): ScanProgress {
  return { portal, startedAt: nowMs, nextUrl: startUrl, visited: [], pages: 0, items: [], totalCount: null };
}

export type ScanOutcome = {
  portal: string;
  startedAt: number;
  kind: ScanResultKind;
  complete: boolean;
  expected: number | null;
  read: number;
  pages: number;
  items: ScanItem[];
  /** Hata kodu (ör. `no_items`, `captcha`, `http_403`) ya da eksik kalma nedeni (`no_total`, `short`, `page_limit`). */
  reason: string | null;
};

export type ScanStep = { kind: "continue"; progress: ScanProgress } | { kind: "finished"; outcome: ScanOutcome };

const BLOCK_CODES = /^(http_(401|403|429)|captcha|login_required)$/;

function toScanItem(i: StoreItem): ScanItem {
  return {
    externalId: i.externalId,
    url: i.url,
    title: i.title ?? null,
    price: typeof i.price === "number" && i.price > 0 ? i.price : null,
    sqm: typeof i.sqm === "number" && i.sqm > 0 ? i.sqm : null,
    rooms: i.rooms ?? null,
    location: i.location ?? null,
    status: i.status === "passive" ? "passive" : "active",
  };
}

function finish(p: ScanProgress, kind: ScanResultKind, complete: boolean, reason: string | null): ScanStep {
  return {
    kind: "finished",
    outcome: { portal: p.portal, startedAt: p.startedAt, kind, complete, expected: p.totalCount, read: p.items.length, pages: p.pages, items: p.items, reason },
  };
}

/** Okunan bir liste sayfasını ilerlemeye işler: devam (sonraki sayfa) ya da bitti (tam / eksik / okunamadı / engel). */
export function applyPage(progress: ScanProgress, page: StoreListResult): ScanStep {
  if (page.error) {
    if (BLOCK_CODES.test(page.error)) return finish(progress, "blocked", false, page.error);
    if (progress.items.length === 0) return finish(progress, "unreadable", false, page.error);
    return finish(progress, "partial", false, page.error);
  }
  const seen = new Set(progress.items.map((i) => i.externalId));
  const items = [...progress.items];
  for (const it of page.items) {
    if (seen.has(it.externalId) || items.length >= SCAN_LIMITS.maxItems) continue;
    seen.add(it.externalId);
    items.push(toScanItem(it));
  }
  const total = page.totalCount ?? progress.totalCount;
  const visited = [...progress.visited, progress.nextUrl].slice(-SCAN_LIMITS.maxPages);
  const next: ScanProgress = { ...progress, items, totalCount: total, pages: progress.pages + 1, visited };
  const nextUrl = page.nextUrl;
  if (nextUrl && !visited.includes(nextUrl) && next.pages < SCAN_LIMITS.maxPages && items.length < SCAN_LIMITS.maxItems) {
    return { kind: "continue", progress: { ...next, nextUrl } };
  }
  if (nextUrl) return finish(next, "partial", false, "page_limit");
  if (total === null) return finish(next, "partial", false, "no_total");
  if (items.length < total) return finish(next, "partial", false, "short");
  return finish(next, "complete", true, null);
}

// ---------------------------------------------------------------- tarama sonucu → yükleme kuyruğu

export type ScanUpload = {
  id: string;
  portal: string;
  scannedAtMs: number;
  kind: ScanResultKind;
  complete: boolean;
  expected: number | null;
  read: number;
  reason: string | null;
  items: ScanItem[];
  parserVersion: string;
  queuedAt: number;
  attempts: number;
  nextAttemptAt: number;
};

export function buildUpload(outcome: ScanOutcome, parserVersion: string, nowMs: number): ScanUpload {
  return {
    id: `${outcome.portal}-${outcome.startedAt}`,
    portal: outcome.portal,
    scannedAtMs: nowMs,
    kind: outcome.kind,
    complete: outcome.complete,
    expected: outcome.expected,
    read: outcome.read,
    reason: outcome.reason,
    items: outcome.items,
    parserVersion,
    queuedAt: nowMs,
    attempts: 0,
    nextAttemptAt: nowMs,
  };
}

export function pruneUploads(list: readonly ScanUpload[], nowMs: number): ScanUpload[] {
  return list.filter((u) => nowMs - u.queuedAt < SCAN_LIMITS.pendingTtlMs && u.attempts < 12).slice(-SCAN_LIMITS.pendingMax);
}

export function enqueueUpload(list: readonly ScanUpload[], u: ScanUpload, nowMs: number): ScanUpload[] {
  // Aynı portalın eski bekleyen yüklemesi yenisiyle değişir (en güncel liste yeter).
  return pruneUploads([...list.filter((x) => x.portal !== u.portal), u], nowMs);
}

export function dueUploads(list: readonly ScanUpload[], nowMs: number): ScanUpload[] {
  return pruneUploads(list, nowMs).filter((u) => u.nextAttemptAt <= nowMs);
}

export function markUploadFailed(list: readonly ScanUpload[], id: string, nowMs: number): ScanUpload[] {
  return pruneUploads(
    list.map((u) => (u.id === id ? { ...u, attempts: u.attempts + 1, nextAttemptAt: nowMs + Math.min(30 * 60_000, 60_000 * 2 ** u.attempts) } : u)),
    nowMs,
  );
}

export function markUploadDone(list: readonly ScanUpload[], id: string): ScanUpload[] {
  return list.filter((u) => u.id !== id);
}

/** Taramadan sonra portal durumunu günceller. */
export function nextPortalState(prev: ScanPortalState | undefined, outcome: ScanOutcome, nowMs: number): ScanPortalState {
  const base = prev ?? EMPTY_PORTAL_STATE;
  return {
    lastFullAt: outcome.complete ? nowMs : base.lastFullAt,
    lastTryAt: nowMs,
    lastResult: outcome.kind,
    lastRead: outcome.read,
    lastExpected: outcome.expected,
  };
}

// ---------------------------------------------------------------- sunucu tarafı doğrulama (yükleme ucu)

export const UPLOAD_LIMITS = { maxItems: SCAN_LIMITS.maxItems, maxBody: 600_000 } as const;

export type ValidUpload = {
  portal: string;
  kind: ScanResultKind;
  complete: boolean;
  expected: number | null;
  read: number;
  reason: string | null;
  items: ScanItem[];
  parserVersion: string;
};

const PORTAL_RE = /^[a-z0-9-]{2,40}$/;
const VERSION_RE = /^[A-Za-z0-9._@-]{1,40}$/;
const KINDS: readonly ScanResultKind[] = ["complete", "partial", "unreadable", "blocked"];

const txt = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const num = (v: unknown, min: number, max: number): number | null => (typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : null);

/** İstemciden gelen ham yüklemeyi doğrular ve temizler (geçersizse null). İstemciye güvenilmez: tamlık sunucuda yeniden hesaplanır. */
export function sanitizeUpload(raw: unknown): ValidUpload | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const portal = typeof o.portal === "string" ? o.portal.trim().toLowerCase() : "";
  const kind = o.kind as ScanResultKind;
  if (!PORTAL_RE.test(portal) || !KINDS.includes(kind)) return null;
  const parserVersion = typeof o.parserVersion === "string" && VERSION_RE.test(o.parserVersion) ? o.parserVersion : "";
  if (!Array.isArray(o.items) || o.items.length > UPLOAD_LIMITS.maxItems) return null;
  const items: ScanItem[] = [];
  const seen = new Set<string>();
  for (const r of o.items) {
    const it = (r ?? {}) as Record<string, unknown>;
    const id = typeof it.externalId === "string" ? it.externalId.trim() : "";
    if (!/^\d{6,12}$/.test(id) || seen.has(id)) continue;
    seen.add(id);
    items.push({
      externalId: id,
      url: txt(it.url, 2048) ?? "",
      title: txt(it.title, 300),
      price: num(it.price, 1, 1e12),
      sqm: num(it.sqm, 10, 20_000),
      rooms: typeof it.rooms === "string" && /^\d{1,2}\+\d{1,2}$/.test(it.rooms) ? it.rooms : null,
      location: txt(it.location, 160),
      status: it.status === "passive" ? "passive" : "active",
    });
  }
  const expected = num(o.expected, 0, 100_000);
  const read = items.length;
  // Tamlık YALNIZ sunucuda hesaplanır: istemcinin `complete` iddiası tek başına yetmez.
  const complete = o.complete === true && kind === "complete" && expected !== null && expected > 0 && read >= expected;
  return { portal, kind, complete, expected, read, reason: txt(o.reason, 40), items, parserVersion };
}
