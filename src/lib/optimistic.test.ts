import { describe, expect, it, vi } from "vitest";
import { markAllRead, markReadById, runOptimistic, toggleId } from "./optimistic";

describe("runOptimistic", () => {
  it("başarıda geri almaz", async () => {
    const apply = vi.fn();
    const rollback = vi.fn();
    const onError = vi.fn();
    const out = await runOptimistic({ apply, commit: async () => ({ ok: true }), rollback, onError });
    expect(out).toEqual({ ok: true });
    expect(apply).toHaveBeenCalledOnce();
    expect(rollback).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("{ error } sonucunda geri alır ve mesajı iletir", async () => {
    const rollback = vi.fn();
    const onError = vi.fn();
    const out = await runOptimistic({
      apply: () => {},
      commit: async () => ({ error: "Yetkiniz yok" }),
      rollback,
      onError,
    });
    expect(out).toEqual({ ok: false, message: "Yetkiniz yok" });
    expect(rollback).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith("Yetkiniz yok");
  });

  it("fırlatmada geri alır ve varsayılan mesajı kullanır", async () => {
    const rollback = vi.fn();
    const onError = vi.fn();
    const out = await runOptimistic({
      apply: () => {},
      commit: async () => {
        throw new Error("ağ");
      },
      rollback,
      onError,
      fallbackError: "Olmadı",
    });
    expect(out).toEqual({ ok: false, message: "Olmadı" });
    expect(rollback).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith("Olmadı");
  });

  it("void sonuç başarı sayılır", async () => {
    const rollback = vi.fn();
    const out = await runOptimistic({ apply: () => {}, commit: async () => undefined, rollback });
    expect(out.ok).toBe(true);
    expect(rollback).not.toHaveBeenCalled();
  });
});

describe("liste yardımcıları", () => {
  const items = [
    { id: "a", read_at: null as string | null },
    { id: "b", read_at: "2026-01-01T00:00:00Z" as string | null },
  ];

  it("markReadById yalnız hedefi işaretler", () => {
    const next = markReadById(items, "a", "NOW");
    expect(next[0].read_at).toBe("NOW");
    expect(next[1].read_at).toBe("2026-01-01T00:00:00Z");
    expect(items[0].read_at).toBeNull();
  });

  it("markReadById okunmuş/bilinmeyen kayıtta aynı diziyi döndürür", () => {
    expect(markReadById(items, "b", "NOW")).toBe(items);
    expect(markReadById(items, "zzz", "NOW")).toBe(items);
  });

  it("markAllRead mevcut okunma tarihini korur", () => {
    const next = markAllRead(items, "NOW");
    expect(next.map((n) => n.read_at)).toEqual(["NOW", "2026-01-01T00:00:00Z"]);
  });

  it("toggleId yeni küme döndürür", () => {
    const base = new Set(["x"]);
    const on = toggleId(base, "y", true);
    expect([...on].sort()).toEqual(["x", "y"]);
    expect(base.has("y")).toBe(false);
    expect([...toggleId(on, "x", false)]).toEqual(["y"]);
  });
});
