/**
 * Saha FOTOĞRAF KUYRUĞU — saf çekirdek (depo arayüzü + sıralama/özet/gönderim kuralları; tarayıcı API'si yok, testte
 * bellek deposuyla çalışır). IndexedDB eşi `photo-idb.ts`, tarayıcı motoru `photo-sync.ts`.
 *
 * Akış: hızlı portföy formunda çekilen/seçilen her fotoğraf istemcide küçültülüp (`photo-resize.ts`) HEMEN bu cihazda
 * saklanır; form bir "çekim partisi" kimliği (`photo_batch`) taşır. Portföy kaydı açılınca (çevrimiçi gönderim ya da
 * çevrimdışı kuyruğun boşaltılması) parti dönen portföy kimliğine BAĞLANIR (`attachBatch`) ve fotoğraflar mevcut medya
 * yükleme yoluyla sırayla gönderilir; yüklenen fotoğraf cihazdan silinir. İlk fotoğraf ilk yüklenir: portföyün kapağı olur.
 *
 * KAPSAM ve KVKK: her kayıt kiracı + kullanıcı taşır, başka oturumun fotoğrafı okunmaz/gönderilmez; cihazda en çok 7 gün
 * kalır (çevrimdışı kuyrukla aynı sınır) ve çıkışta silinir (`clearFieldCaptureStorage`). Küçültme yeniden kodlama
 * olduğu için EXIF (GPS konumu dahil) cihazdan çıkmaz.
 */

import { OUTBOX_TTL_MS, type CaptureScope } from "./outbox";

/** Fotoğraf cihazda en çok bu kadar kalır (çevrimdışı kuyrukla aynı KVKK sınırı). */
export const PHOTO_TTL_MS = OUTBOX_TTL_MS;
/** Otomatik yeniden deneme sınırı; aşan fotoğraf "Tekrar dene" bekler. */
export const MAX_AUTO_ATTEMPTS = 3;
/** Bir portföy kaydında sahadan en çok bu kadar fotoğraf (cihaz deposu + yükleme süresi). */
export const MAX_BATCH_PHOTOS = 40;

/** Form alanları: çekim partisi kimliği ve sayısı (sunucu yok sayar; kuyruk etiketi ve bağlama için). */
export const PHOTO_BATCH_FIELD = "photo_batch";
export const PHOTO_COUNT_FIELD = "photo_count";

export type StoredPhoto = {
  id: string;
  batchId: string;
  tenantId: string;
  userId: string;
  blob: Blob;
  /** Uzantı türle uyumlu (sunucu ad/uzantı denetimi): `saha-3.webp`, `saha-3.jpg`. */
  name: string;
  width: number;
  height: number;
  createdAt: number;
  /** Sıra (küçük önce; ilk fotoğraf kapak). */
  seq: number;
  /** Bağlandığı portföy (kayıt açılmadan önce null). */
  propertyId: string | null;
  /** Kuyruk panelinde gösterilecek kısa ad. */
  propertyLabel?: string;
  attempts: number;
  lastError?: string;
};

/** Depo arayüzü (IndexedDB ya da bellek). Tüm okuma kapsamlıdır. */
export type PhotoStore = {
  /** Kalıcı mı (IndexedDB) — değilse sayfa kapanınca fotoğraflar gider; arayüz kullanıcıya söyler. */
  persistent: boolean;
  list(scope: CaptureScope): Promise<StoredPhoto[]>;
  put(photo: StoredPhoto): Promise<void>;
  patch(id: string, patch: Partial<StoredPhoto>): Promise<void>;
  remove(ids: readonly string[]): Promise<void>;
};

/** Bellek içi depo (testler ve IndexedDB erişilemediğinde). */
export function memoryPhotoStore(): PhotoStore {
  const m = new Map<string, StoredPhoto>();
  return {
    persistent: false,
    async list(scope) {
      return [...m.values()].filter((p) => p.tenantId === scope.tenantId && p.userId === scope.userId);
    },
    async put(photo) {
      m.set(photo.id, photo);
    },
    async patch(id, patch) {
      const cur = m.get(id);
      if (cur) m.set(id, { ...cur, ...patch });
    },
    async remove(ids) {
      for (const id of ids) m.delete(id);
    },
  };
}

export function byOrder(a: Pick<StoredPhoto, "seq" | "createdAt">, b: Pick<StoredPhoto, "seq" | "createdAt">): number {
  return a.seq - b.seq || a.createdAt - b.createdAt;
}

export function isPhotoExpired(p: Pick<StoredPhoto, "createdAt">, nowMs: number): boolean {
  return nowMs - p.createdAt > PHOTO_TTL_MS;
}

/** Partinin fotoğrafları (sıralı). */
export function batchPhotos(photos: readonly StoredPhoto[], batchId: string): StoredPhoto[] {
  return photos.filter((p) => p.batchId === batchId).sort(byOrder);
}

/** Otomatik gönderilecekler: portföye bağlı, deneme sınırı aşılmamış; portföy kayıt sırası, sonra fotoğraf sırası. */
export function uploadQueue(photos: readonly StoredPhoto[]): StoredPhoto[] {
  return photos.filter((p) => p.propertyId && p.attempts < MAX_AUTO_ATTEMPTS).sort(byOrder);
}

/** Sonraki sıra numarası (partinin sonuna). */
export function nextSeq(photos: readonly StoredPhoto[], batchId: string): number {
  return batchPhotos(photos, batchId).reduce((max, p) => Math.max(max, p.seq + 1), 0);
}

/** Kapak yap: fotoğraf partinin başına alınır (ilk yüklenen kapak olur). */
export function coverSeq(photos: readonly StoredPhoto[], batchId: string): number {
  const list = batchPhotos(photos, batchId);
  return list.length === 0 ? 0 : list[0].seq - 1;
}

/**
 * Sahipsiz partiler: henüz portföye bağlanmamış ve ne formda ne kuyrukta anılan partiler (ör. fotoğraf çekildi ama
 * başka alan yazılmadan sayfa kapandı). En yenisi önce; form bunu "önceki çekim" olarak geri alır.
 */
export function orphanBatches(photos: readonly StoredPhoto[], referenced: ReadonlySet<string>): { batchId: string; count: number; lastAt: number }[] {
  const map = new Map<string, { batchId: string; count: number; lastAt: number }>();
  for (const p of photos) {
    if (p.propertyId || referenced.has(p.batchId)) continue;
    const cur = map.get(p.batchId) ?? { batchId: p.batchId, count: 0, lastAt: 0 };
    cur.count += 1;
    cur.lastAt = Math.max(cur.lastAt, p.createdAt);
    map.set(p.batchId, cur);
  }
  return [...map.values()].sort((a, b) => b.lastAt - a.lastAt);
}

export type PropertyUploadSummary = {
  propertyId: string;
  label: string;
  /** Bu oturumda yüklenen + kalan (ilerleme çubuğu paydası). */
  total: number;
  uploaded: number;
  remaining: number;
  /** Deneme sınırını aşan (kullanıcı "Tekrar dene" der). */
  failed: number;
  lastError?: string;
};

/** Portföy başına yükleme özeti (kuyrukta fotoğrafı ya da bu oturumda yüklemesi olanlar). */
export function summarizeUploads(photos: readonly StoredPhoto[], uploaded: Readonly<Record<string, number>>, labels: Readonly<Record<string, string>> = {}): PropertyUploadSummary[] {
  const map = new Map<string, PropertyUploadSummary>();
  const ensure = (pid: string) => {
    let s = map.get(pid);
    if (!s) {
      s = { propertyId: pid, label: labels[pid] ?? "", total: 0, uploaded: uploaded[pid] ?? 0, remaining: 0, failed: 0 };
      s.total = s.uploaded;
      map.set(pid, s);
    }
    return s;
  };
  for (const p of [...photos].sort(byOrder)) {
    if (!p.propertyId) continue;
    const s = ensure(p.propertyId);
    s.remaining += 1;
    s.total += 1;
    if (!s.label && p.propertyLabel) s.label = p.propertyLabel;
    if (p.attempts >= MAX_AUTO_ATTEMPTS) {
      s.failed += 1;
      s.lastError ??= p.lastError;
    }
  }
  for (const pid of Object.keys(uploaded)) if ((uploaded[pid] ?? 0) > 0) ensure(pid);
  return [...map.values()];
}

/** Partiyi portföye bağlar (yalnız henüz bağlanmamış fotoğraflar; aynı parti iki kez bağlanmaz). Bağlanan sayıyı döner. */
export async function attachBatch(store: PhotoStore, scope: CaptureScope, batchId: string, propertyId: string, label?: string): Promise<number> {
  if (!batchId || !propertyId) return 0;
  const list = (await store.list(scope)).filter((p) => p.batchId === batchId && !p.propertyId);
  for (const p of list) await store.patch(p.id, { propertyId, ...(label ? { propertyLabel: label } : {}) });
  return list.length;
}

/** Partinin bu cihazdaki tüm fotoğraflarını siler (kuyruk öğesi ya da taslak silindi). */
export async function discardBatch(store: PhotoStore, scope: CaptureScope, batchId: string): Promise<void> {
  if (!batchId) return;
  const ids = (await store.list(scope)).filter((p) => p.batchId === batchId && !p.propertyId).map((p) => p.id);
  if (ids.length > 0) await store.remove(ids);
}

/** Süresi dolanları siler; silinen sayıyı döner. */
export async function prunePhotos(store: PhotoStore, scope: CaptureScope, nowMs: number): Promise<number> {
  const ids = (await store.list(scope)).filter((p) => isPhotoExpired(p, nowMs)).map((p) => p.id);
  if (ids.length > 0) await store.remove(ids);
  return ids.length;
}

export type UploadOutcome =
  | { kind: "ok" }
  /** Ağ yok / bağlantı koptu: deneme sayılmaz, gönderim durur (bağlantı gelince sürer). */
  | { kind: "offline"; error?: string }
  /** Sunucu ya da dosya hatası: deneme sayılır; sınırdan sonra kullanıcı "Tekrar dene" der. */
  | { kind: "error"; error: string };

export type PhotoUploader = (photo: StoredPhoto & { propertyId: string }) => Promise<UploadOutcome>;

export type SyncReport = { uploaded: StoredPhoto[]; errored: StoredPhoto[]; stoppedOffline: boolean; expired: number };

/**
 * Bağlı fotoğrafları SIRAYLA yükler (kapak sırası korunur; zayıf bağlantıda tek akış). Başarılı fotoğraf cihazdan
 * silinir; hata deneme sayısını artırır ve sıradakine geçilir; ağ yoksa durulur. `onStep` her adımdan sonra çağrılır.
 */
export async function syncPhotos(
  store: PhotoStore,
  scope: CaptureScope,
  upload: PhotoUploader,
  nowMs: number,
  onStep?: (photo: StoredPhoto, outcome: UploadOutcome | "start") => void,
): Promise<SyncReport> {
  const expired = await prunePhotos(store, scope, nowMs);
  const uploaded: StoredPhoto[] = [];
  const errored: StoredPhoto[] = [];
  for (const photo of uploadQueue(await store.list(scope))) {
    onStep?.(photo, "start");
    let outcome: UploadOutcome;
    try {
      outcome = await upload(photo as StoredPhoto & { propertyId: string });
    } catch {
      outcome = { kind: "error", error: "Yükleme başarısız." };
    }
    if (outcome.kind === "ok") {
      await store.remove([photo.id]);
      uploaded.push(photo);
    } else if (outcome.kind === "offline") {
      await store.patch(photo.id, { lastError: outcome.error ?? "Bağlantı yok." });
      onStep?.(photo, outcome);
      return { uploaded, errored, stoppedOffline: true, expired };
    } else {
      await store.patch(photo.id, { attempts: photo.attempts + 1, lastError: outcome.error });
      errored.push({ ...photo, attempts: photo.attempts + 1, lastError: outcome.error });
    }
    onStep?.(photo, outcome);
  }
  return { uploaded, errored, stoppedOffline: false, expired };
}

/** Kullanıcı "Tekrar dene" dedi: portföyün sınırı aşan fotoğrafları yeniden kuyruğa girer. */
export async function resetAttempts(store: PhotoStore, scope: CaptureScope, propertyId: string): Promise<void> {
  for (const p of await store.list(scope)) {
    if (p.propertyId === propertyId && p.attempts > 0) await store.patch(p.id, { attempts: 0, lastError: undefined });
  }
}

/** Portföyün yüklenemeyen fotoğraflarını cihazdan siler ("Vazgeç"). */
export async function dropPropertyPhotos(store: PhotoStore, scope: CaptureScope, propertyId: string): Promise<void> {
  const ids = (await store.list(scope)).filter((p) => p.propertyId === propertyId).map((p) => p.id);
  if (ids.length > 0) await store.remove(ids);
}
