import { describe, expect, it } from "vitest";
import { bandOf, MATCH_BANDS, rankCandidates, resolveBand, scoreMatch, type MatchProbe } from "./matching";
import { dhashFromGray9x8, hammingHex, photoHashSimilarity } from "./photo-hash";
import { INVENTORY_LIMITS, probeFromInventoryRow, rankUnregistered, type PropertyForMatch } from "./inventory-import";

const prop: MatchProbe = { address: "Caferağa Mahallesi Moda Caddesi Kadıköy", title: "Kadıköy 3+1 satılık daire", price: 4_250_000, sqm: 120, rooms: "3+1", advisorName: "Ayşe Yılmaz" };

describe("portal ağırlık profili (tasarım 2026-10)", () => {
  it("m² ve oda ağırlığı artar, başlık düşer; varsayılan profil (kopya taraması) değişmez", () => {
    const portal = scoreMatch(prop, prop, undefined, "portal");
    const def = scoreMatch(prop, prop);
    const max = (s: { signals: { key: string; max: number }[] }, k: string) => s.signals.find((x) => x.key === k)?.max;
    expect(max(portal, "sqm")).toBe(15);
    expect(max(portal, "rooms")).toBe(10);
    expect(max(portal, "title")).toBe(5);
    expect(max(def, "sqm")).toBe(10);
    expect(max(def, "rooms")).toBe(5);
  });
  it("fiyat ±%5 tamamen yakın sayılır (portal), varsayılanda ±%3", () => {
    const near = { ...prop, price: 4_250_000 * 1.045 };
    const p = scoreMatch(prop, near, undefined, "portal").signals.find((s) => s.key === "price");
    const d = scoreMatch(prop, near).signals.find((s) => s.key === "price");
    expect(p?.points).toBe(15);
    expect(d?.points ?? 0).toBeLessThan(15);
  });
  it("aynı ilan ≥85, farklı ilan <60", () => {
    const same = scoreMatch(prop, { ...prop, price: 4_300_000 }, undefined, "portal");
    expect(same.score).toBeGreaterThanOrEqual(MATCH_BANDS.suggested);
    const other = scoreMatch(prop, { address: "Bağdat Caddesi Maltepe", title: "Maltepe villa", price: 12_000_000, sqm: 300, rooms: "5+2" }, undefined, "portal");
    expect(other.score).toBeLessThan(MATCH_BANDS.unsure);
  });
});

describe("güven bantları", () => {
  it("≥85 önerilen, 60-84 emin değilim, <60 yok", () => {
    expect(bandOf(85)).toBe("suggested");
    expect(bandOf(84)).toBe("unsure");
    expect(bandOf(60)).toBe("unsure");
    expect(bandOf(59)).toBe("none");
  });
  it("aynı ilan birden çok portföye ≥85 verirse tek tık önerilmez (hangisi?)", () => {
    expect(resolveBand([{ score: 91 }, { score: 88 }])).toEqual({ band: "unsure", ambiguous: true });
    expect(resolveBand([{ score: 91 }, { score: 70 }])).toEqual({ band: "suggested", ambiguous: false });
    expect(resolveBand([])).toEqual({ band: "none", ambiguous: false });
  });
  it("aday eşiği 60: altındakiler listeye girmez", () => {
    expect(INVENTORY_LIMITS.candidateMinScore).toBe(MATCH_BANDS.unsure);
    const ranked = rankCandidates(prop, [{ id: "a", probe: { ...prop, price: 4_300_000 } }, { id: "b", probe: { address: "Başka", title: "Başka", price: 1, sqm: 10, rooms: "1+0" } }], 60, undefined, 5, "portal");
    expect(ranked.map((r) => r.candidate.id)).toEqual(["a"]);
  });
});

describe("fotoğraf karması", () => {
  const flat = new Array(72).fill(100) as number[];
  const ramp = Array.from({ length: 72 }, (_, i) => 255 - (i % 9) * 20);
  it("dHash 16 hane; düz görüntü sıfır, azalan rampa tüm bitler", () => {
    expect(dhashFromGray9x8(flat)).toBe("0000000000000000");
    expect(dhashFromGray9x8(ramp)).toBe("ffffffffffffffff");
    expect(dhashFromGray9x8([1, 2])).toBeNull();
  });
  it("Hamming uzaklığı ve benzerlik: ≤10 tam, ≥26 sıfır, geçersiz/boş ölçülemedi", () => {
    expect(hammingHex("0000000000000000", "ffffffffffffffff")).toBe(64);
    expect(hammingHex("0000000000000000", "000000000000000f")).toBe(4);
    expect(hammingHex("xyz", "0000000000000000")).toBeNull();
    expect(photoHashSimilarity(["0000000000000000"], ["000000000000000f"])).toBe(1);
    expect(photoHashSimilarity(["0000000000000000"], ["ffffffffffffffff"])).toBe(0);
    expect(photoHashSimilarity([], ["0000000000000000"])).toBeNull();
    expect(photoHashSimilarity(["bozuk"], ["0000000000000000"])).toBeNull();
  });
  it("iki tarafta da karma varsa skora girer; yoksa ölçülemedi (paydadan çıkar)", () => {
    const a = { ...prop, photoHashes: ["0000000000000000"] };
    const withPhoto = scoreMatch(a, { ...prop, photoHashes: ["000000000000000f"] }, undefined, "portal");
    expect(withPhoto.signals.some((s) => s.key === "photo" && s.points === 15)).toBe(true);
    const without = scoreMatch(prop, prop, undefined, "portal");
    expect(without.unmeasured).toContain("photo");
  });
});

describe("envanter satırı → aday", () => {
  const pool: PropertyForMatch[] = [
    { id: "p1", code: "P-1", title: "Kadıköy 3+1 satılık daire", address: "Caferağa Mahallesi Moda Caddesi Kadıköy", price: 4_250_000, sqm: 120, rooms: "3+1", block: null, lot: null, lat: null, lng: null, districtKey: null, advisorName: "Ayşe Yılmaz" },
  ];
  it("kart alanları (m², oda, konum) başlıktan çıkarılanın önüne geçer ve detay yazılır", () => {
    const probe = probeFromInventoryRow({ title: "Daire 2+1 90 m²", sqm: 120, rooms: "3+1", location: "Moda Kadıköy" });
    expect(probe).toMatchObject({ sqm: 120, rooms: "3+1", address: "Moda Kadıköy" });
    const out = rankUnregistered([{ externalId: "1234567", url: null, title: "Kadıköy 3+1 satılık daire", price: 4_300_000, advisorName: "Ayşe Yılmaz", status: "active", sqm: 120, rooms: "3+1", location: "Caferağa Mahallesi Moda Caddesi Kadıköy" }], pool);
    expect(out[0].candidates[0]?.property_id).toBe("p1");
    expect(out[0].detail).toMatchObject({ sqm: 120, rooms: "3+1", location: "Caferağa Mahallesi Moda Caddesi Kadıköy" });
  });
});
