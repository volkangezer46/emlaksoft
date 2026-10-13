import { describe, expect, it } from "vitest";
import { checkAlt, checkInputSize, checkQuota, heroBudget, isLargeOutput, SITE_MEDIA_LIMITS } from "./quota";
import { computeUsage, usageLabel, usageOf } from "./usage";

const MB = 1024 * 1024;

describe("kota ve sınırlar", () => {
  it("dosya başına 8 MB, toplam 1 GB; değiştirmede eski çıktı düşülür", () => {
    expect(checkInputSize(8 * MB)).toBeNull();
    expect(checkInputSize(8 * MB + 1)).toMatch(/en fazla/);
    expect(checkInputSize(0)).toMatch(/boş/);
    expect(checkQuota({ usedBytes: 1024 * MB - 10, incomingBytes: 10 })).toBeNull();
    expect(checkQuota({ usedBytes: 1024 * MB - 10, incomingBytes: 11 })).toMatch(/kotası doldu/);
    expect(checkQuota({ usedBytes: 1024 * MB, incomingBytes: 5 * MB, replacingBytes: 5 * MB })).toBeNull();
  });

  it("ilk ekran bütçesi 960w AVIF; büyük dosya > 200 KB", () => {
    const v = (w: number, format: string, kb: number) => ({ w, format, bytes: kb * 1024 });
    expect(heroBudget([v(480, "avif", 30), v(960, "avif", 110), v(1600, "avif", 300), v(960, "webp", 500)])).toEqual({ bytes: 110 * 1024, over: false });
    expect(heroBudget([v(960, "avif", 121)]).over).toBe(true);
    expect(heroBudget([v(600, "avif", 50)]).bytes).toBe(50 * 1024);
    expect(isLargeOutput([v(1600, "webp", 201)])).toBe(true);
    expect(isLargeOutput([v(1600, "webp", 200)])).toBe(false);
    expect(SITE_MEDIA_LIMITS.heroBudgetBytes).toBe(120 * 1024);
  });

  it("alt metin zorunlu, 1-140, işaretleme yok", () => {
    expect(checkAlt("  ").ok).toBe(false);
    expect(checkAlt("a".repeat(141)).ok).toBe(false);
    expect(checkAlt("<b>x</b>").ok).toBe(false);
    expect(checkAlt("  Ofiste   danışman ")).toEqual({ ok: true, alt: "Ofiste danışman" });
  });
});

describe("kullanım (used_by) yapılandırmadan hesaplanır", () => {
  const A = "11111111-1111-4111-8111-111111111111";
  const B = "22222222-2222-4222-8222-222222222222";
  it("yayın ve taslak ayrı etiketlenir; görselsiz yapılandırma boş", () => {
    const u = computeUsage({ live: { hero: { image: { mediaId: A } } }, draft: { hero: { image: { mediaId: B } } } });
    expect(u.get(A)).toEqual(["sitecontent.live:hero.image"]);
    expect(u.get(B)).toEqual(["sitecontent.draft:hero.image"]);
    expect(usageOf({ live: null, draft: { hero: {} } }, A)).toEqual([]);
    expect(usageOf({ live: { hero: { image: { mediaId: A } } }, draft: { hero: { image: { mediaId: A } } } }, A)).toEqual(["sitecontent.draft:hero.image", "sitecontent.live:hero.image"]);
    expect(usageLabel("sitecontent.live:hero.image")).toBe("Ana sayfa görseli (yayında)");
  });
});
