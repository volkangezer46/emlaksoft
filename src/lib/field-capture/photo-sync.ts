/**
 * Saha fotoğraf kuyruğu MOTORU (tarayıcı; sekme başına tek örnek). Saf kurallar `photo-queue.ts`, depo `photo-idb.ts`.
 *
 * - Bağlı fotoğrafları sırayla yükler; bağlantı gelince, sayfa açılınca ve sekme görünür olunca yeniden dener.
 * - Tek uçuşludur: aynı anda iki yükleme turu çalışmaz (aynı fotoğraf iki kez gitmez).
 * - Hata alan fotoğraf artan beklemeyle (5 sn, 15 sn) yeniden denenir; sınırdan sonra kullanıcı "Tekrar dene" der.
 * - Arayüz `subscribe` + `snapshot` (useSyncExternalStore) ile ilerlemeyi okur.
 */

import { now } from "@/lib/clock";
import { browserStore, writePendingPhotoCount, type CaptureScope } from "./outbox";
import { fieldPhotoStore } from "./photo-idb";
import {
  attachBatch,
  discardBatch,
  dropPropertyPhotos,
  MAX_AUTO_ATTEMPTS,
  resetAttempts,
  summarizeUploads,
  syncPhotos,
  uploadQueue,
  type PhotoUploader,
  type PropertyUploadSummary,
  type StoredPhoto,
} from "./photo-queue";

export type PhotoSyncSnapshot = {
  /** Kapsamın tüm fotoğrafları (blob'suz okuma için ad/boyut/sıra; blob da durur, URL üretimi bileşende). */
  photos: StoredPhoto[];
  summaries: PropertyUploadSummary[];
  /** Şu an yüklenen fotoğraf. */
  currentId: string | null;
  running: boolean;
  persistent: boolean;
  /** Ekranda kendi ilerlemesiyle gösterilen portföy (üst panel onu tekrar göstermez). */
  foreground: string | null;
};

const EMPTY: PhotoSyncSnapshot = { photos: [], summaries: [], currentId: null, running: false, persistent: true, foreground: null };

let snapshot: PhotoSyncSnapshot = EMPTY;
let scope: CaptureScope | null = null;
let uploader: PhotoUploader | null = null;
const uploadedCount: Record<string, number> = {};
const labels: Record<string, string> = {};
const listeners = new Set<() => void>();
let inflight: Promise<void> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let wired = false;

function emit(patch: Partial<PhotoSyncSnapshot>) {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach((l) => l());
}

export function subscribePhotoSync(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function photoSyncSnapshot(): PhotoSyncSnapshot {
  return snapshot;
}

export function photoSyncServerSnapshot(): PhotoSyncSnapshot {
  return EMPTY;
}

/** Depodan yeniden okur ve aboneleri uyarır. */
export async function refreshPhotos(): Promise<void> {
  if (!scope) return;
  const store = await fieldPhotoStore();
  const photos = await store.list(scope);
  // Çıkış uyarısı için: fotoğrafı yüklenmeyi bekleyen portföy sayısı (eşzamanlı okunur).
  writePendingPhotoCount(browserStore(), scope, new Set(photos.filter((p) => p.propertyId).map((p) => p.propertyId)).size);
  emit({ photos, summaries: summarizeUploads(photos, uploadedCount, labels), persistent: store.persistent });
}

function online(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

function scheduleRetry(photos: readonly StoredPhoto[]) {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  const next = uploadQueue(photos);
  if (next.length === 0 || !online()) return;
  const attempts = Math.min(...next.map((p) => p.attempts));
  if (attempts === 0) return;
  retryTimer = setTimeout(() => void runPhotoSync(), attempts >= MAX_AUTO_ATTEMPTS - 1 ? 15_000 : 5_000);
}

/** Bekleyen yüklemeleri başlatır (tek uçuşlu; zaten çalışıyorsa aynı tura bağlanır). */
export function runPhotoSync(): Promise<void> {
  if (inflight) return inflight;
  if (!scope || !uploader || !online()) return refreshPhotos();
  const s = scope;
  const up = uploader;
  inflight = (async () => {
    const store = await fieldPhotoStore();
    emit({ running: true });
    try {
      await syncPhotos(store, s, up, now(), (photo, outcome) => {
        if (outcome === "start") emit({ currentId: photo.id });
        else if (outcome.kind === "ok" && photo.propertyId) {
          uploadedCount[photo.propertyId] = (uploadedCount[photo.propertyId] ?? 0) + 1;
          if (photo.propertyLabel) labels[photo.propertyId] = photo.propertyLabel;
        }
        void refreshPhotos();
      });
    } finally {
      emit({ running: false, currentId: null });
      inflight = null;
      await refreshPhotos();
      scheduleRetry(snapshot.photos);
    }
  })();
  return inflight;
}

/**
 * Motoru oturuma bağlar (hızlı kayıt sayfası açılınca). Kapsam değiştiyse önceki oturumun ilerlemesi unutulur.
 * Çevrimiçi olayı ve sekme görünürlüğü bir kez dinlenir.
 */
export function configurePhotoSync(next: CaptureScope, upload: PhotoUploader) {
  if (!scope || scope.tenantId !== next.tenantId || scope.userId !== next.userId) {
    for (const k of Object.keys(uploadedCount)) delete uploadedCount[k];
    snapshot = EMPTY;
  }
  scope = next;
  uploader = upload;
  if (!wired && typeof window !== "undefined") {
    wired = true;
    const kick = () => {
      if (document.visibilityState !== "hidden") void runPhotoSync();
    };
    window.addEventListener("online", kick);
    document.addEventListener("visibilitychange", kick);
  }
  void runPhotoSync();
}

/** Partiyi kaydı açılan portföye bağlar ve yüklemeyi başlatır. */
export async function attachPhotoBatch(batchId: string, propertyId: string, label?: string): Promise<number> {
  if (!scope || !batchId) return 0;
  if (label) labels[propertyId] = label;
  const n = await attachBatch(await fieldPhotoStore(), scope, batchId, propertyId, label);
  void runPhotoSync();
  return n;
}

/** Partiyi siler (kuyruk öğesi ya da taslak silindi). */
export async function discardPhotoBatch(batchId: string): Promise<void> {
  if (!scope || !batchId) return;
  await discardBatch(await fieldPhotoStore(), scope, batchId);
  await refreshPhotos();
}

export async function retryPropertyPhotos(propertyId: string): Promise<void> {
  if (!scope) return;
  await resetAttempts(await fieldPhotoStore(), scope, propertyId);
  await runPhotoSync();
}

export async function dropFailedPropertyPhotos(propertyId: string): Promise<void> {
  if (!scope) return;
  await dropPropertyPhotos(await fieldPhotoStore(), scope, propertyId);
  delete uploadedCount[propertyId];
  await refreshPhotos();
}

/** Ekranda kendi ilerlemesiyle gösterilen portföyü işaretler (null = yok). */
export function setForegroundProperty(propertyId: string | null) {
  if (snapshot.foreground !== propertyId) emit({ foreground: propertyId });
}

/** Tamamlanan portföyün ilerleme özetini kapatır (kullanıcı "Tamam" dedi). */
export function dismissPropertySummary(propertyId: string) {
  delete uploadedCount[propertyId];
  emit({ summaries: summarizeUploads(snapshot.photos, uploadedCount, labels) });
}

/** Aktif oturum kapsamı (bileşenler fotoğraf eklerken kullanır). */
export function photoSyncScope(): CaptureScope | null {
  return scope;
}
