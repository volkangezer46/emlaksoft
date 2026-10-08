import { describe, expect, it } from "vitest";
import {
  bumpUsage,
  isAdminHref,
  MAX_TOP_USED,
  MAX_USAGE_ENTRIES,
  MIN_USES_FOR_TOP,
  navStateId,
  parseAdminHrefs,
  parseUsage,
  topUsed,
  USAGE_HALVE_AT,
} from "./nav-memory";

describe("menü kullanım sayacı (saf)", () => {
  it("ziyareti sayar, girdiyi değiştirmez", () => {
    const a = bumpUsage({}, "/app/musteriler");
    const b = bumpUsage(a, "/app/musteriler");
    expect(a).toEqual({ "/app/musteriler": 1 });
    expect(b).toEqual({ "/app/musteriler": 2 });
  });

  it("eşiğin altındaki sayfa 'çok kullanılan' sayılmaz; ilk 4, azalan sıra, sabitlenen/hariç tutulan çıkar", () => {
    const usage = { "/app/a": MIN_USES_FOR_TOP - 1, "/app/b": 9, "/app/c": 7, "/app/d": 5, "/app/e": 4, "/app/f": 3, "/app/g": 8 };
    expect(topUsed(usage)).toEqual(["/app/b", "/app/g", "/app/c", "/app/d"]);
    expect(topUsed(usage)).toHaveLength(MAX_TOP_USED);
    expect(topUsed(usage, { exclude: ["/app/b"] })[0]).toBe("/app/g");
    expect(topUsed(usage, { allowed: new Set(["/app/c", "/app/e"]) })).toEqual(["/app/c", "/app/e"]);
  });

  it("eşitlikte sıra yol adına göre sabittir", () => {
    expect(topUsed({ "/app/z": 5, "/app/b": 5 })).toEqual(["/app/b", "/app/z"]);
  });

  it("sayaç eşiğe gelince yarıya iner, sıfırlananlar atılır; tablo sınırlıdır", () => {
    const next = bumpUsage({ "/app/a": USAGE_HALVE_AT - 1, "/app/b": 1 }, "/app/a");
    expect(next["/app/a"]).toBe(USAGE_HALVE_AT / 2);
    expect(next["/app/b"]).toBeUndefined();
    let u: Record<string, number> = {};
    for (let i = 0; i < MAX_USAGE_ENTRIES + 10; i++) u = { ...bumpUsage(u, `/app/s${i}`) };
    expect(Object.keys(u).length).toBeLessThanOrEqual(MAX_USAGE_ENTRIES);
  });

  it("bozuk/yabancı veriyi reddeder: yalnız güvenli /app yolu ve pozitif tam sayı", () => {
    const raw = JSON.stringify({ "/app/musteriler": 4, "//kotu.example": 9, "https://x.y": 3, "/admin": 5, "/app/a?b=1": 2, "/app/neg": -1, "/app/ondalik": 1.5, "/app/metin": "5" });
    expect(parseUsage(raw)).toEqual({ "/app/musteriler": 4 });
    expect(parseUsage("{bozuk")).toEqual({});
    expect(parseUsage(JSON.stringify([1, 2]))).toEqual({});
    expect(parseUsage(null)).toEqual({});
    expect(parseUsage(JSON.stringify({ "/admin/tenants": 3, "/app/x": 3 }), isAdminHref)).toEqual({ "/admin/tenants": 3 });
  });
});

describe("admin yolları ve menü durum kimliği", () => {
  it("admin belleği yalnız /admin yolunu kabul eder", () => {
    expect(parseAdminHrefs(JSON.stringify(["/admin/tenants", "/app/musteriler", "//x", "/admin/a?b=1"]), 6)).toEqual(["/admin/tenants"]);
  });

  it("durum kimliği depo kuralına uyar (küçük harf/rakam/tire, ≤32)", () => {
    for (const href of ["/app/musteriler", "/app/ayarlar/sozlesme-sablonlari", "/admin/billing", "/app", "/admin"]) {
      expect(navStateId("alt", href), href).toMatch(/^[a-z0-9-]{1,32}$/);
    }
    expect(navStateId("alt", "/app/musteriler")).toBe("alt-musteriler");
    expect(navStateId("alt", "/app/" + "a".repeat(60)).length).toBeLessThanOrEqual(32);
  });
});
