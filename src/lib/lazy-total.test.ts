import { describe, expect, it, vi } from "vitest";
import { resolveLazyTotal } from "./lazy-total";

describe("resolveLazyTotal", () => {
  it("tavandan az satırda COUNT çağırmaz; toplam kesindir", async () => {
    const count = vi.fn(async () => 999);
    expect(await resolveLazyTotal({ rows: 12, limit: 500, count })).toBe(12);
    expect(await resolveLazyTotal({ offset: 50, rows: 7, limit: 50, count })).toBe(57);
    expect(await resolveLazyTotal({ rows: 0, limit: 50, count })).toBe(0);
    expect(count).not.toHaveBeenCalled();
  });

  it("tavana dayanınca gerçek sayımı kullanır", async () => {
    const count = vi.fn(async () => 731);
    expect(await resolveLazyTotal({ rows: 500, limit: 500, count })).toBe(731);
    expect(count).toHaveBeenCalledOnce();
  });

  it("sayfa aşımında (boş sayfa, offset>0) gerçek sayımı kullanır", async () => {
    const count = vi.fn(async () => 40);
    expect(await resolveLazyTotal({ offset: 100, rows: 0, limit: 50, count })).toBe(40);
  });

  it("sayım yoksa null döner (sahte değer üretmez)", async () => {
    expect(await resolveLazyTotal({ rows: 50, limit: 50, count: async () => null })).toBeNull();
  });
});
