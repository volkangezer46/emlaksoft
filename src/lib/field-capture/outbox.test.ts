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
  type OutboxItem,
} from "./outbox";
import { onceByRequest, type SubmissionKey, type SubmissionStore } from "./submission-guard";

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
    expect(enqueueOutbox(device, { id: RID, kind: "customer", fields: [["full_name", "Ali Kaya"], ["phone", "05321234567"]], label: "Müşteri: Ali Kaya", nowMs: 1 })).toBe(true);
    // çift dokunma aynı öğeyi ikinci kez eklemez
    enqueueOutbox(device, { id: RID, kind: "customer", fields: [["full_name", "Ali Kaya"]], label: "x", nowMs: 2 });
    expect(readOutbox(device)).toHaveLength(1);

    // 2) Hâlâ çevrimdışı: boşaltma denemesi hiçbir şey kaydetmez, öğe sırada kalır
    expect((await flushOutbox(device, send)).pending).toBe(1);
    expect(created).toEqual([]);

    // 3) Bağlantı geldi: ilk deneme sunucuya ulaşır, yanıt kaybolur → öğe sırada kalır
    online = true;
    await flushOutbox(device, send);
    expect(created).toEqual(["Ali Kaya"]);
    expect(readOutbox(device)).toHaveLength(1);

    // 4) Yeniden boşaltma (çevrimiçi olayı + sayfa açılışı aynı anda): ikinci kayıt AÇILMAZ, öğe kuyruktan çıkar
    const [a, b] = await Promise.all([flushOutbox(device, send), flushOutbox(device, send)]);
    expect(a).toBe(b);
    expect(a.sent.map((i) => i.id)).toEqual([RID]);
    expect(created).toEqual(["Ali Kaya"]);
    expect(readOutbox(device)).toEqual([]);
  });

  it("iş kuralıyla reddedilen öğe otomatik yeniden denenmez ve fren satırı bırakılmaz", async () => {
    const device = memoryStore();
    const server = memorySubmissions();
    enqueueOutbox(device, { id: RID, kind: "appointment", fields: [["when", ""]], label: "Randevu", nowMs: 1 });
    const send = async (item: OutboxItem) =>
      outcomeFromResult(await onceByRequest(server, CTX, "appointment", item.id, async () => ({ error: "Geçerli bir tarih ve saat girin." })));
    const r = await flushOutbox(device, send);
    expect(r.rejected[0]?.lastError).toBe("Geçerli bir tarih ve saat girin.");
    expect(readOutbox(device)[0]?.state).toBe("failed");
    expect(server.rows.size).toBe(0);
    // ikinci boşaltma failed öğeyi göndermez
    const again = vi.fn(send);
    await flushOutbox(device, again);
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
    saveDraft(store, "musteri", { full_name: "Ali", notes: "" }, 1000);
    expect(loadDraft(store, "musteri", 2000)).toEqual({ full_name: "Ali", notes: "" });
    expect(loadDraft(store, "musteri", 1000 + DRAFT_TTL_MS + 1)).toBeNull();
    saveDraft(store, "musteri", { full_name: "Ali" }, 1000);
    clearDraft(store, "musteri");
    expect(loadDraft(store, "musteri", 2000)).toBeNull();
    saveDraft(store, "bos", { full_name: "  " }, 1000);
    expect(loadDraft(store, "bos", 2000)).toBeNull();
  });
});
