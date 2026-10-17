import { describe, expect, it } from "vitest";
import { clearConversation, conversationKey, loadConversation, saveConversation, ZEKA_CONV_MAX_TURNS, type StoredTurn } from "./conversation";
import type { ZekaResult } from "./types";

/** Sohbet konuşması deposu (sessionStorage): kullanıcı kapsamlı anahtar, doğrulama, kırpma, depo hatasına dayanıklılık. */

class MemoryStorage {
  map = new Map<string, string>();
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}
const throwing = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceeded");
  },
  removeItem: () => {
    throw new Error("SecurityError");
  },
};

const RESULT: ZekaResult = { surface: "app", engine: "local", intent: "data", answer: "7", cards: [], actions: [], followUps: [], confidence: 0.9, answered: true };
const turn = (id: number, extra: Partial<StoredTurn> = {}): StoredTurn => ({ id, q: `soru ${id}`, at: 1_700_000_000_000 + id, status: "done", text: "7", result: RESULT, error: null, ...extra });

describe("Zeka konuşma deposu", () => {
  it("anahtar kullanıcı kapsamlıdır; kapsamsız oturumlu yüzey saklanmaz", () => {
    expect(conversationKey("app", "zeka_recent:app:t1:u1")).toBe("zeka_conv:app:t1:u1");
    expect(conversationKey("admin", "zeka_recent:admin:admin:s1")).toBe("zeka_conv:admin:admin:s1");
    expect(conversationKey("app", null)).toBeNull();
    expect(conversationKey("app", "baska-anahtar")).toBeNull();
    expect(conversationKey("vitrin", null, "ofis-a")).toBe("zeka_conv:vitrin:ofis-a");
    expect(conversationKey("vitrin", null, null)).toBeNull();
    expect(conversationKey("public", null)).toBe("zeka_conv:public");
  });

  it("yazar ve geri okur (oy, motor, sınır işareti korunur)", () => {
    const s = new MemoryStorage();
    const turns = [turn(1, { vote: 1, engine: "gpt" }), turn(2, { status: "error", result: null, error: "Bugünkü soru sınırına ulaşıldı.", limited: true }), turn(3, { status: "stopped", result: null, text: "yarım" })];
    expect(saveConversation(s, "k", turns)).toBe(true);
    expect(loadConversation(s, "k")).toEqual(turns);
  });

  it("bitmemiş turlar ve bozuk kayıtlar atılır; en çok 20 tur", () => {
    const s = new MemoryStorage();
    const pending = { ...turn(99), status: "pending" } as unknown as StoredTurn;
    saveConversation(s, "k", [...Array.from({ length: 25 }, (_, i) => turn(i + 1)), pending]);
    const back = loadConversation(s, "k");
    expect(back).toHaveLength(ZEKA_CONV_MAX_TURNS);
    expect(back[0]!.id).toBe(6);
    expect(back.some((t) => t.id === 99)).toBe(false);

    s.setItem("bozuk", JSON.stringify({ turns: [{ id: "x" }, { id: 1, q: "a", status: "done", result: { answer: 3 } }, turn(4), null, "metin"] }));
    expect(loadConversation(s, "bozuk").map((t) => t.id)).toEqual([4]);
    s.setItem("json-degil", "{{{");
    expect(loadConversation(s, "json-degil")).toEqual([]);
  });

  it("boyut sınırını aşan konuşmada en eski turlar atılır", () => {
    const s = new MemoryStorage();
    const big = "x".repeat(7_000);
    saveConversation(s, "k", Array.from({ length: 20 }, (_, i) => turn(i + 1, { text: big, result: { ...RESULT, answer: big } })));
    const back = loadConversation(s, "k");
    expect(back.length).toBeGreaterThan(0);
    expect(back.length).toBeLessThan(20);
    expect(back[back.length - 1]!.id).toBe(20);
    expect(s.getItem("k")!.length).toBeLessThanOrEqual(120_000);
  });

  it("boş liste anahtarı siler; temizleme çalışır", () => {
    const s = new MemoryStorage();
    saveConversation(s, "k", [turn(1)]);
    saveConversation(s, "k", []);
    expect(s.getItem("k")).toBeNull();
    saveConversation(s, "k", [turn(1)]);
    clearConversation(s, "k");
    expect(s.getItem("k")).toBeNull();
  });

  it("depo yoksa ya da hata verirse sessizce bellekte kalır (istisna yok)", () => {
    expect(loadConversation(null, "k")).toEqual([]);
    expect(loadConversation(throwing, "k")).toEqual([]);
    expect(saveConversation(throwing, "k", [turn(1)])).toBe(false);
    expect(() => clearConversation(throwing, "k")).not.toThrow();
    expect(saveConversation(new MemoryStorage(), null, [turn(1)])).toBe(false);
  });
});
