import { describe, expect, it, vi } from "vitest";
import {
  clearDraft,
  enqueueOutbox,
  flushOutbox,
  loadDraft,
  memoryStore,
  outcomeFromResult,
  readOutbox,
  saveDraft,
  DRAFT_TTL_MS,
  OUTBOX_TTL_MS,
  clearFieldCaptureStorage,
  countUnsentOnDevice,
  outboxKey,
  pruneOutbox,
  removeOutboxItem,
  CONFLICT_HINT,
  DUPLICATE_ERROR,
  type EnumerableStore,
  type OutboxItem,
} from "./outbox";
import { onceByRequest, scopeMismatchError, SCOPE_MISMATCH_ERROR, type SubmissionKey, type SubmissionStore } from "./submission-guard";

vi.mock("@/lib/clock", () => ({ now: () => 1_760_000_000_000 }));

/** Sunucudaki client_submissions tablosunun bellek içi eşi (birincil anahtar = kiracı+kullanıcı+istek). */
function memorySubmissions(): SubmissionStore & { rows: Map<string, { completed_at: string | null; result_id: string | null; created_at: string }> } {
  const rows = new Map<string, { completed_at: string | null; result_id: string | null; created_at: string }>();
  const k = (key: SubmissionKey) => `${key.tenantId}|${key.userId}|${key.requestId}`;
  return {
    rows,
    async claim(key) {
      if (rows.has(k(key))) return { error: { code: "23505" } };
      rows.set(k(key), { completed_at: null, result_id: null, created_at: new Date(1_760_000_000_000).toISOString() });
      return { error: null };
    },
    async read(key) {
      return rows.get(k(key)) ?? null;
    },
    async touch(key, at) {
      const r = rows.get(k(key));
      if (r && !r.completed_at) r.created_at = at;
    },
    async complete(key, resultId, at) {
      const r = rows.get(k(key));
      if (r) Object.assign(r, { completed_at: at, result_id: resultId });
    },
    async release(key) {
      if (!rows.get(k(key))?.completed_at) rows.delete(k(key));
    },
    async prune() {},
  };
}

const CTX = { tenantId: "t1", userId: "u1" };
const RID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const NOW = 1000;

describe("çevrimdışı kuyruk + sunucu çift kayıt freni", () => {
  it("kabul: bağlantı kesikken girilen kayıt bağlantı gelince BİR KEZ kaydedilir", async () => {
    const device = memoryStore();
    const server = memorySubmissions();
    const created: string[] = [];
    let online = false;

    // Sunucudaki hızlı müşteri action'ı: fren + gerçek oluşturma.
    const action = (fd: FormData) =>
      onceByRequest(server, CTX, "customer", String(fd.get("client_request_id")), async () => {
        created.push(String(fd.get("full_name")));
        return { ok: true, id: "9b2d6a44-6f0e-4d38-9a51-6c1a1c0b7e11" };
      });
    // Ağ: çevrimdışıyken istek hiç gitmez; ilk çevrimiçi denemede istek ULAŞIR ama yanıt kaybolur.
    let dropFirstResponse = true;
    const send = async (item: OutboxItem) => {
      if (!online) throw new TypeError("Failed to fetch");
      const fd = new FormData();
      for (const [key, v] of item.fields) fd.set(key, v);
      fd.set("client_request_id", item.id);
      const res = await action(fd);
      if (dropFirstResponse) {
        dropFirstResponse = false;
        throw new TypeError("Failed to fetch");
      }
      return outcomeFromResult(res);
    };

    // 1) Çevrimdışı giriş → kuyruk
    expect(enqueueOutbox(device, CTX, { id: RID, kind: "customer", fields: [["full_name", "Ali Kaya"], ["phone", "05321234567"]], label: "Müşteri: Ali Kaya", nowMs: 1 })).toBe(true);
    // çift dokunma aynı öğeyi ikinci kez eklemez
    enqueueOutbox(device, CTX, { id: RID, kind: "customer", fields: [["full_name", "Ali Kaya"]], label: "x", nowMs: 2 });
    expect(readOutbox(device, CTX)).toHaveLength(1);

    // 2) Hâlâ çevrimdışı: boşaltma denemesi hiçbir şey kaydetmez, öğe sırada kalır
    expect((await flushOutbox(device, CTX, send, NOW)).pending).toBe(1);
    expect(created).toEqual([]);

    // 3) Bağlantı geldi: ilk deneme sunucuya ulaşır, yanıt kaybolur → öğe sırada kalır
    online = true;
    await flushOutbox(device, CTX, send, NOW);
    expect(created).toEqual(["Ali Kaya"]);
    expect(readOutbox(device, CTX)).toHaveLength(1);

    // 4) Yeniden boşaltma (çevrimiçi olayı + sayfa açılışı aynı anda): ikinci kayıt AÇILMAZ, öğe kuyruktan çıkar
    const [a, b] = await Promise.all([flushOutbox(device, CTX, send, NOW), flushOutbox(device, CTX, send, NOW)]);
    expect(a).toBe(b);
    expect(a.sent.map((i) => i.id)).toEqual([RID]);
    expect(created).toEqual(["Ali Kaya"]);
    expect(readOutbox(device, CTX)).toEqual([]);
  });

  it("iş kuralıyla reddedilen öğe otomatik yeniden denenmez ve fren satırı bırakılmaz", async () => {
    const device = memoryStore();
    const server = memorySubmissions();
    enqueueOutbox(device, CTX, { id: RID, kind: "appointment", fields: [["when", ""]], label: "Randevu", nowMs: 1 });
    const send = async (item: OutboxItem) =>
      outcomeFromResult(await onceByRequest(server, CTX, "appointment", item.id, async () => ({ error: "Geçerli bir tarih ve saat girin." })));
    const r = await flushOutbox(device, CTX, send, NOW);
    expect(r.rejected[0]?.lastError).toBe("Geçerli bir tarih ve saat girin.");
    expect(readOutbox(device, CTX)[0]?.state).toBe("failed");
    expect(server.rows.size).toBe(0);
    // ikinci boşaltma failed öğeyi göndermez
    const again = vi.fn(send);
    await flushOutbox(device, CTX, again, NOW);
    expect(again).not.toHaveBeenCalled();
  });

  it("eşzamanlı ikinci istek (tamamlanmamış talep) kayıt açmaz, geçici sonuç döner", async () => {
    const server = memorySubmissions();
    let release!: () => void;
    const slow = new Promise<void>((r) => (release = r));
    const created: number[] = [];
    const first = onceByRequest(server, CTX, "call", RID, async () => {
      await slow;
      created.push(1);
      return { ok: true };
    });
    const second = await onceByRequest(server, CTX, "call", RID, async () => {
      created.push(2);
      return { ok: true };
    });
    expect(outcomeFromResult(second).kind).toBe("retry");
    release();
    await first;
    expect(created).toEqual([1]);
    expect(await onceByRequest(server, CTX, "call", RID, async () => ({ ok: true }))).toEqual({ ok: true });
  });

  it("tablo yoksa fren atlanır (kayıt kaybolmaz)", async () => {
    const store = { ...memorySubmissions(), claim: async () => ({ error: { code: "42P01" } }) };
    const run = vi.fn(async () => ({ ok: true }));
    await onceByRequest(store, CTX, "customer", RID, run);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("taslak: kaydedilir, geri gelir, süresi dolunca ve kayıttan sonra silinir", () => {
    const store = memoryStore();
    saveDraft(store, CTX, "musteri", { full_name: "Ali", notes: "" }, 1000);
    expect(loadDraft(store, CTX, "musteri", 2000)).toEqual({ full_name: "Ali", notes: "" });
    expect(loadDraft(store, CTX, "musteri", 1000 + DRAFT_TTL_MS + 1)).toBeNull();
    saveDraft(store, CTX, "musteri", { full_name: "Ali" }, 1000);
    clearDraft(store, CTX, "musteri");
    expect(loadDraft(store, CTX, "musteri", 2000)).toBeNull();
    saveDraft(store, CTX, "bos", { full_name: "  " }, 1000);
    expect(loadDraft(store, CTX, "bos", 2000)).toBeNull();
  });
});

/** localStorage'ın bellek içi eşi (anahtar listeleyebilen). */
function memoryLocalStorage(): EnumerableStore & { setItem(k: string, v: string): void; keys(): string[] } {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    keys: () => [...m.keys()],
  };
}

describe("kapsam: kuyruk ve taslak kiracı + kullanıcıya bağlı", () => {
  const A = { tenantId: "ofis-x", userId: "kullanici-a" };
  const B = { tenantId: "ofis-y", userId: "kullanici-b" };
  const A_OTHER_OFFICE = { tenantId: "ofis-y", userId: "kullanici-a" };

  it("kullanıcı değişimi: B, A'nın kuyruğunu ve taslağını görmez ve göndermez", async () => {
    const device = memoryStore();
    enqueueOutbox(device, A, { id: RID, kind: "customer", fields: [["full_name", "Ali Kaya"], ["phone", "05321234567"]], label: "Müşteri: Ali Kaya", nowMs: NOW });
    saveDraft(device, A, "musteri", { full_name: "Yarım", phone: "0532" }, NOW);

    expect(readOutbox(device, B)).toEqual([]);
    expect(loadDraft(device, B, "musteri", NOW + 1)).toBeNull();
    const send = vi.fn(async () => ({ kind: "ok" as const }));
    const r = await flushOutbox(device, B, send, NOW + 1);
    expect(send).not.toHaveBeenCalled();
    expect(r.pending).toBe(0);
    // Aynı kullanıcı başka ofiste (aktif ofis değişimi / ofis adına gör) de görmez.
    expect(readOutbox(device, A_OTHER_OFFICE)).toEqual([]);
    // A'nın verisi yerinde: A geri dönünce gönderilir.
    expect(readOutbox(device, A)).toHaveLength(1);
    expect(readOutbox(device, A)[0]).toMatchObject({ tenantId: "ofis-x", userId: "kullanici-a" });
    expect(loadDraft(device, A, "musteri", NOW + 1)).toEqual({ full_name: "Yarım", phone: "0532" });
  });

  it("anahtarı kurcalanmış (başka kapsamın öğesi kopyalanmış) kuyruk okunmaz", () => {
    const device = memoryStore();
    enqueueOutbox(device, A, { id: RID, kind: "customer", fields: [], label: "x", nowMs: NOW });
    device.set(outboxKey(B), device.get(outboxKey(A)) ?? "");
    expect(readOutbox(device, B)).toEqual([]);
  });

  it("sunucu: istemcinin bildirdiği kapsam oturumla uyuşmazsa reddeder", () => {
    const fd = new FormData();
    expect(scopeMismatchError(fd, { tenantId: "ofis-y", userId: "kullanici-b" })).toBeNull();
    fd.set("client_tenant_id", "ofis-x");
    fd.set("client_user_id", "kullanici-a");
    expect(scopeMismatchError(fd, { tenantId: "ofis-y", userId: "kullanici-b" })).toBe(SCOPE_MISMATCH_ERROR);
    expect(scopeMismatchError(fd, { tenantId: "ofis-y", userId: "kullanici-a" })).toBe(SCOPE_MISMATCH_ERROR);
    expect(scopeMismatchError(fd, { tenantId: "ofis-x", userId: "kullanici-a" })).toBeNull();
    const onlyUser = new FormData();
    onlyUser.set("client_user_id", "kullanici-a");
    expect(scopeMismatchError(onlyUser, { tenantId: "ofis-x", userId: "kullanici-a" })).toBe(SCOPE_MISMATCH_ERROR);
  });

  it("çıkış: bu cihazdaki tüm saha anahtarları silinir, diğer anahtarlar kalır", () => {
    const ls = memoryLocalStorage();
    const device = { get: (k: string) => ls.getItem(k), set: (k: string, v: string) => ls.setItem(k, v), remove: (k: string) => ls.removeItem(k) };
    enqueueOutbox(device, A, { id: RID, kind: "customer", fields: [["full_name", "Ali"]], label: "Müşteri: Ali", nowMs: NOW });
    enqueueOutbox(device, B, { id: "1f8fad5b-d9cb-469f-a165-70867728950e", kind: "call", fields: [], label: "Görüşme", nowMs: NOW });
    saveDraft(device, A, "musteri", { full_name: "Yarım" }, NOW);
    ls.setItem("emlaksoft:tema", "koyu");
    expect(countUnsentOnDevice(ls)).toBe(2);
    clearFieldCaptureStorage(ls);
    expect(ls.keys()).toEqual(["emlaksoft:tema"]);
    expect(countUnsentOnDevice(ls)).toBe(0);
  });
});

describe("kuyruk saklama süresi (7 gün)", () => {
  it("süresi dolan bekleyen ve reddedilen öğeler budanır, gönderilmez", async () => {
    const device = memoryStore();
    enqueueOutbox(device, CTX, { id: "2f8fad5b-d9cb-469f-a165-70867728950e", kind: "appointment", fields: [], label: "Randevu", nowMs: NOW });
    enqueueOutbox(device, CTX, { id: RID, kind: "customer", fields: [["full_name", "Eski"]], label: "Müşteri: Eski", nowMs: NOW });
    const later = NOW + OUTBOX_TTL_MS - 1;
    enqueueOutbox(device, CTX, { id: "3f8fad5b-d9cb-469f-a165-70867728950e", kind: "call", fields: [], label: "Görüşme", nowMs: later });
    // randevu reddedilmiş, müşteri bekliyor olsun (geçici hata boşaltmayı durdurur)
    await flushOutbox(device, CTX, async (i) => (i.kind === "appointment" ? { kind: "rejected", error: "x" } : { kind: "retry" }), NOW + 1);
    expect(readOutbox(device, CTX).find((i) => i.kind === "appointment")?.state).toBe("failed");

    const expiredAt = NOW + OUTBOX_TTL_MS + 1;
    const send = vi.fn(async () => ({ kind: "ok" as const }));
    const r = await flushOutbox(device, CTX, send, expiredAt);
    expect(r.expired.map((i) => i.label).sort()).toEqual(["Müşteri: Eski", "Randevu"]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(readOutbox(device, CTX)).toEqual([]);
  });

  it("pruneOutbox süresi dolmamış öğeye dokunmaz", () => {
    const device = memoryStore();
    enqueueOutbox(device, CTX, { id: RID, kind: "customer", fields: [], label: "Yeni", nowMs: NOW });
    expect(pruneOutbox(device, CTX, NOW + OUTBOX_TTL_MS)).toEqual([]);
    expect(pruneOutbox(device, CTX, NOW + OUTBOX_TTL_MS + 1).map((i) => i.label)).toEqual(["Yeni"]);
    expect(readOutbox(device, CTX)).toEqual([]);
    removeOutboxItem(device, CTX, RID);
  });
});

describe("outcomeFromResult", () => {
  it("randevu çakışması gerçek nedeniyle reddedilir", () => {
    expect(outcomeFromResult({ conflictWarning: "Bu saatte Ali Kaya ile randevunuz var." })).toEqual({
      kind: "rejected",
      error: `Bu saatte Ali Kaya ile randevunuz var. ${CONFLICT_HINT}`,
    });
  });
  it("mükerrer portföy mükerrer olduğu söylenerek reddedilir", () => {
    expect(outcomeFromResult({ duplicate: true, error: "Benzer bir portföy zaten var." })).toEqual({ kind: "rejected", error: DUPLICATE_ERROR });
  });
  it("boş yanıt genel hata, geçici yanıt yeniden deneme", () => {
    expect(outcomeFromResult({})).toEqual({ kind: "rejected", error: "Kayıt gönderilemedi." });
    expect(outcomeFromResult({ error: "Bu kayıt az önce gönderildi; sonuç bekleniyor." }).kind).toBe("retry");
  });
});
