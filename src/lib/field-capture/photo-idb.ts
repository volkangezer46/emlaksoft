/**
 * Saha fotoğraf kuyruğunun IndexedDB deposu (tarayıcı). Bağımlılıksız ince sarmalayıcı; açılamazsa (gizli pencere,
 * engelli site verisi, eski tarayıcı) bellek deposuna düşer ve arayüz "cihazda saklanamıyor" der.
 * Blob'lar IndexedDB'de dosya olarak tutulur (base64 yok): düşük bellekli Android'de 20 fotoğraf belleği şişirmez.
 */

import { FIELD_PHOTO_DB, type CaptureScope } from "./outbox";
import { memoryPhotoStore, type PhotoStore, type StoredPhoto } from "./photo-queue";

const STORE = "photos";

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(FIELD_PHOTO_DB, 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const s = db.createObjectStore(STORE, { keyPath: "id" });
        s.createIndex("scope", ["tenantId", "userId"], { unique: false });
      }
    };
    r.onsuccess = () => {
      // Çıkışta veritabanı silinirken açık bağlantı silmeyi bekletmesin.
      r.result.onversionchange = () => r.result.close();
      resolve(r.result);
    };
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error("blocked"));
  });
}

function idbStore(db: IDBDatabase): PhotoStore {
  return {
    persistent: true,
    async list(scope: CaptureScope) {
      const tx = db.transaction(STORE, "readonly");
      const rows = await req(tx.objectStore(STORE).index("scope").getAll([scope.tenantId, scope.userId]));
      return (rows as StoredPhoto[]).filter((p) => p && p.tenantId === scope.tenantId && p.userId === scope.userId);
    },
    async put(photo) {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(photo);
      await txDone(tx);
    },
    async patch(id, patch) {
      const tx = db.transaction(STORE, "readwrite");
      const s = tx.objectStore(STORE);
      const cur = (await req(s.get(id))) as StoredPhoto | undefined;
      if (cur) s.put({ ...cur, ...patch });
      await txDone(tx);
    },
    async remove(ids) {
      if (ids.length === 0) return;
      const tx = db.transaction(STORE, "readwrite");
      const s = tx.objectStore(STORE);
      for (const id of ids) s.delete(id);
      await txDone(tx);
    },
  };
}

let storePromise: Promise<PhotoStore> | null = null;

/** Sekme başına tek depo örneği (IndexedDB ya da bellek yedeği). */
export function fieldPhotoStore(): Promise<PhotoStore> {
  if (!storePromise) {
    storePromise = (async () => {
      try {
        if (typeof indexedDB === "undefined") return memoryPhotoStore();
        return idbStore(await openDb());
      } catch {
        return memoryPhotoStore();
      }
    })();
  }
  return storePromise;
}

/**
 * Cihaz deposu az mı (fotoğraf eklemeden önce uyarı). Tahmin yoksa false (boş vaat yok). Ayrıca tarayıcıdan kalıcı
 * depo istenir: Android Chrome depo baskısında kuyruğu silmesin.
 */
export async function lowDeviceStorage(minFreeBytes = 60 * 1024 * 1024): Promise<boolean> {
  try {
    const est = await navigator.storage?.estimate?.();
    void navigator.storage?.persist?.().catch(() => false);
    if (!est || typeof est.quota !== "number" || typeof est.usage !== "number") return false;
    return est.quota - est.usage < minFreeBytes;
  } catch {
    return false;
  }
}
