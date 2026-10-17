import { describe, expect, it, vi } from "vitest";
import { isSampleLocked, loadSampleLockState, sampleSeedDecision } from "./lock";
import { realUseConfirmMatches } from "./real-use";
import { demoStaticTarget, isDemoStaticPhotoUrl, mediaRowsFor } from "./demo-photo-pick";
import { findSahaRows } from "@/lib/demo-seed-invariants";

const NOW = Date.parse("2026-10-17T10:00:00Z");
const base = { realUseAt: null, overrideUntil: null, realRecords: 0, isDemoTenant: false };

describe("örnek veri kilidi (SAF karar = SQL sample_seed_guard)", () => {
  it("boş, geçiş yapmamış ofis serbest", () => {
    expect(sampleSeedDecision(base, NOW)).toEqual({ allowed: true, override: false });
  });
  it("gerçek kayıt varsa istisnasız kilit (süper admin izni dahil)", () => {
    expect(sampleSeedDecision({ ...base, realRecords: 1, overrideUntil: "2026-10-17T10:05:00Z" }, NOW)).toMatchObject({ allowed: false, code: "real_records" });
  });
  it("gerçek kullanıma geçmiş ofis kilitli; süper admin izni yalnız süresi içinde ve gerçek kayıt yokken", () => {
    const real = { ...base, realUseAt: "2026-10-01T00:00:00Z" };
    expect(sampleSeedDecision(real, NOW)).toMatchObject({ allowed: false, code: "real_use" });
    expect(sampleSeedDecision({ ...real, overrideUntil: "2026-10-17T10:05:00Z" }, NOW)).toEqual({ allowed: true, override: true });
    expect(sampleSeedDecision({ ...real, overrideUntil: "2026-10-17T09:55:00Z" }, NOW)).toMatchObject({ allowed: false });
    expect(isSampleLocked(real)).toBe(true);
    expect(isSampleLocked(base)).toBe(false);
  });
  it("genel demo ofisi kilit dışı", () => {
    expect(sampleSeedDecision({ ...base, realRecords: 50, realUseAt: "x", isDemoTenant: true }, NOW).allowed).toBe(true);
  });
  it("okuma hatasında güvenli taraf: kilitli", async () => {
    const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: null, error: { code: "x" } }), then: (r: (v: unknown) => void) => r({ count: null, error: { code: "x" } }) };
    const db = { rpc: vi.fn(async () => ({ data: null, error: { code: "PGRST202" } })), from: () => chain };
    expect(isSampleLocked(await loadSampleLockState(db as never, "t"))).toBe(true);
  });
});

describe("gerçek kullanıma geçiş ikinci onayı", () => {
  it("SİL (harf/boşluk önemsiz) ya da ofis adı", () => {
    expect(realUseConfirmMatches("SİL", "Ada Emlak")).toBe(true);
    expect(realUseConfirmMatches(" sil ", "Ada Emlak")).toBe(true);
    expect(realUseConfirmMatches("ada  emlak", "Ada Emlak")).toBe(true);
    expect(realUseConfirmMatches("SIL2", "Ada Emlak")).toBe(false);
    expect(realUseConfirmMatches("", "Ada Emlak")).toBe(false);
    expect(realUseConfirmMatches("a", "a")).toBe(false);
  });
});

describe("statik demo fotoğrafı güvenliği", () => {
  it("yalnız /img/demo kütüphane yolu kabul edilir", () => {
    expect(isDemoStaticPhotoUrl("/img/demo/kadikoy-moda-3p1-01-exterior-ab12cd34-960.webp")).toBe(true);
    for (const bad of ["https://evil.example/x.webp", "//evil/x.webp", "/img/demo/../secret.webp", "/img/demo/a.webp?x=1", "/img/hero/a.webp", "/img/demo/a.svg"]) {
      expect(isDemoStaticPhotoUrl(bad), bad).toBe(false);
    }
  });
  it("depo yolu olan satır statik sayılmaz (gerçek fotoğraf asla yönlendirilmez)", () => {
    expect(demoStaticTarget({ storage_path: "t/p/x.webp", external_url: "/img/demo/a/b.webp" })).toBeNull();
    expect(demoStaticTarget({ storage_path: null, external_url: "/img/demo/a/b.webp" })).toBe("/img/demo/a/b.webp");
    expect(demoStaticTarget(null)).toBeNull();
  });
  it("set satırları: dış cephe kapak, açıklama ≤ 80, oda etiketi sabit listeden", () => {
    const photo = (id: string, kind: "exterior" | "kitchen", cover: boolean) => ({
      id, kind, set: "s1", cover, alt: "Uzun bir açıklama ".repeat(8), focal: "50% 50%", color: "#000000", width: 2400, height: 1600, hash: "abcd1234",
      widths: [480, 960, 1600], webpWidths: [480, 960], lqip: "",
      credit: { provider: "Unsplash" as const, photographer: "y", profileUrl: "", pageUrl: "", license: "Unsplash License" as const, licenseUrl: "" },
    });
    const rows = mediaRowsFor([photo("k", "kitchen", false), photo("e", "exterior", true)]);
    expect(rows[0]).toMatchObject({ is_cover: true, room_tag: "cephe", width: 960, height: 640, external_url: "/img/demo/e-abcd1234-960.webp" });
    expect(rows[1]).toMatchObject({ is_cover: false, room_tag: "mutfak", sort_order: 1 });
    expect(rows.every((r) => r.caption.length <= 80 && isDemoStaticPhotoUrl(r.external_url))).toBe(true);
  });
});

describe("[SAHA] değişmezi", () => {
  it("[SAHA] önekli satırları bulur, diğerlerini geçer", () => {
    expect(
      findSahaRows([
        { id: "1", label: "[SAHA] Hızlı Müşteri 1" },
        { id: "2", label: "  [saha] B053 iniş" },
        { id: "3", label: "Selin Aksoy" },
        { id: "4", label: null },
        { id: "5", label: "Not: [SAHA] ortada" },
      ]),
    ).toEqual(["1", "2"]);
  });
});
