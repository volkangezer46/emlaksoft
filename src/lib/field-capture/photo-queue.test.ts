import { describe, expect, it } from "vitest";
import {
  attachBatch,
  coverSeq,
  discardBatch,
  MAX_AUTO_ATTEMPTS,
  memoryPhotoStore,
  nextSeq,
  orphanBatches,
  PHOTO_TTL_MS,
  resetAttempts,
  summarizeUploads,
  syncPhotos,
  uploadQueue,
  type StoredPhoto,
  type UploadOutcome,
} from "./photo-queue";
import { fitWithin, outputName } from "./photo-resize";

const A = { tenantId: "t1", userId: "u1" };
const B = { tenantId: "t1", userId: "u2" };
const T0 = 1_800_000_000_000;

function photo(id: string, over: Partial<StoredPhoto> = {}): StoredPhoto {
  return {
    id,
    batchId: "b1",
    tenantId: A.tenantId,
    userId: A.userId,
    blob: new Blob(["x"], { type: "image/webp" }),
    name: `saha-${id}.webp`,
    width: 1600,
    height: 1200,
    createdAt: T0,
    seq: 0,
    propertyId: null,
    attempts: 0,
    ...over,
  };
}

describe("fitWithin / outputName", () => {
  it("uzun kenarı 1600'e sığdırır, oranı korur, büyütmez", () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3000, 4000)).toEqual({ width: 1200, height: 1600 });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(0, 600)).toEqual({ width: 0, height: 0 });
  });
  it("uzantı türle uyumlu", () => {
    expect(outputName(3, "image/webp")).toBe("saha-3.webp");
    expect(outputName(3, "image/jpeg")).toBe("saha-3.jpg");
  });
});

describe("photo-queue", () => {
  it("kapsam dışı fotoğraf okunmaz", async () => {
    const store = memoryPhotoStore();
    await store.put(photo("p1"));
    await store.put(photo("p2", { userId: B.userId }));
    expect((await store.list(A)).map((p) => p.id)).toEqual(["p1"]);
    expect((await store.list(B)).map((p) => p.id)).toEqual(["p2"]);
  });

  it("sıra ve kapak: kapak yap partinin başına alır", () => {
    const list = [photo("p1", { seq: 0 }), photo("p2", { seq: 1 })];
    expect(nextSeq(list, "b1")).toBe(2);
    expect(nextSeq(list, "yok")).toBe(0);
    expect(coverSeq(list, "b1")).toBe(-1);
  });

  it("bağlanmamış fotoğraf yüklenmez; bağlanınca sırayla yüklenir ve cihazdan silinir", async () => {
    const store = memoryPhotoStore();
    await store.put(photo("p2", { seq: 1 }));
    await store.put(photo("p1", { seq: 0 }));
    const seen: string[] = [];
    const up = async (p: StoredPhoto): Promise<UploadOutcome> => {
      seen.push(`${p.id}@${p.propertyId}`);
      return { kind: "ok" };
    };
    let r = await syncPhotos(store, A, up, T0);
    expect(r.uploaded).toHaveLength(0);
    expect(await attachBatch(store, A, "b1", "prop-1", "3+1 Daire")).toBe(2);
    // ikinci bağlama yeni fotoğraf bağlamaz
    expect(await attachBatch(store, A, "b1", "prop-2")).toBe(0);
    r = await syncPhotos(store, A, up, T0);
    expect(seen).toEqual(["p1@prop-1", "p2@prop-1"]);
    expect(r.uploaded).toHaveLength(2);
    expect(await store.list(A)).toHaveLength(0);
  });

  it("başka oturum partiyi bağlayamaz", async () => {
    const store = memoryPhotoStore();
    await store.put(photo("p1"));
    expect(await attachBatch(store, B, "b1", "prop-x")).toBe(0);
    expect((await store.list(A))[0].propertyId).toBeNull();
  });

  it("ağ yoksa durur ve deneme sayılmaz; hata deneme sayar, sınırdan sonra otomatik denenmez", async () => {
    const store = memoryPhotoStore();
    await store.put(photo("p1", { seq: 0, propertyId: "x" }));
    await store.put(photo("p2", { seq: 1, propertyId: "x" }));
    const offline = await syncPhotos(store, A, async () => ({ kind: "offline" }), T0);
    expect(offline.stoppedOffline).toBe(true);
    expect((await store.list(A)).every((p) => p.attempts === 0)).toBe(true);

    for (let i = 0; i < MAX_AUTO_ATTEMPTS; i += 1) await syncPhotos(store, A, async () => ({ kind: "error", error: "sunucu" }), T0);
    const list = await store.list(A);
    expect(list.every((p) => p.attempts === MAX_AUTO_ATTEMPTS)).toBe(true);
    expect(uploadQueue(list)).toHaveLength(0);
    const sum = summarizeUploads(list, {});
    expect(sum).toEqual([expect.objectContaining({ propertyId: "x", remaining: 2, failed: 2, lastError: "sunucu" })]);

    await resetAttempts(store, A, "x");
    expect(uploadQueue(await store.list(A))).toHaveLength(2);
  });

  it("özet bu oturumda yüklenenleri paya katar", () => {
    const sum = summarizeUploads([photo("p3", { propertyId: "x", propertyLabel: "Daire" })], { x: 2, y: 1 });
    expect(sum).toEqual([
      expect.objectContaining({ propertyId: "x", total: 3, uploaded: 2, remaining: 1, label: "Daire" }),
      expect.objectContaining({ propertyId: "y", total: 1, uploaded: 1, remaining: 0 }),
    ]);
  });

  it("7 günü aşan fotoğraf gönderilmeden silinir", async () => {
    const store = memoryPhotoStore();
    await store.put(photo("eski", { propertyId: "x", createdAt: T0 - PHOTO_TTL_MS - 1 }));
    const r = await syncPhotos(store, A, async () => ({ kind: "ok" }), T0);
    expect(r.expired).toBe(1);
    expect(r.uploaded).toHaveLength(0);
  });

  it("sahipsiz parti: formda/kuyrukta anılmayan, bağlanmamış partiler (en yeni önce)", () => {
    const list = [
      photo("a", { batchId: "eski", createdAt: T0 }),
      photo("b", { batchId: "yeni", createdAt: T0 + 5 }),
      photo("c", { batchId: "kuyrukta" }),
      photo("d", { batchId: "bagli", propertyId: "x" }),
    ];
    expect(orphanBatches(list, new Set(["kuyrukta"])).map((o) => o.batchId)).toEqual(["yeni", "eski"]);
  });

  it("parti silme yalnız bağlanmamış fotoğrafları siler", async () => {
    const store = memoryPhotoStore();
    await store.put(photo("p1"));
    await store.put(photo("p2", { propertyId: "x" }));
    await discardBatch(store, A, "b1");
    expect((await store.list(A)).map((p) => p.id)).toEqual(["p2"]);
  });
});

describe("çıkış uyarısı", () => {
  it("fotoğrafı bekleyen portföyler gönderilmemiş sayılır ve çıkışta silinir", async () => {
    const { countUnsentOnDevice, clearFieldCaptureStorage, memoryStore, writePendingPhotoCount } = await import("./outbox");
    const kv = memoryStore();
    writePendingPhotoCount(kv, A, 2);
    // memoryStore'u listelenebilir depoya çevir
    const keys = ["emlaksoft:saha-foto-bekleyen:v1:t1:u1"];
    const ls = {
      get length() {
        return keys.filter((k) => kv.get(k) !== null).length;
      },
      key: (i: number) => keys.filter((k) => kv.get(k) !== null)[i] ?? null,
      getItem: (k: string) => kv.get(k),
      removeItem: (k: string) => kv.remove(k),
    };
    expect(countUnsentOnDevice(ls)).toBe(2);
    clearFieldCaptureStorage(ls);
    expect(countUnsentOnDevice(ls)).toBe(0);
    writePendingPhotoCount(kv, A, 0);
    expect(kv.get(keys[0])).toBeNull();
  });
});
