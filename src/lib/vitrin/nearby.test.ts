import { describe, expect, it } from "vitest";
import { formatDistance, groupNearby, parseNearbyPlaces, validateNearbyInput, walkingMinutes } from "./nearby";

describe("çevrede neler var (PUB-8)", () => {
  it("kayıtlı değeri güvenle okur: bozuk öğe atılır, kategori + mesafe sırası", () => {
    const list = parseNearbyPlaces([
      { c: "market", n: "Migros", m: 300 },
      { c: "okul", n: "  Atatürk   İlkokulu ", m: 640 },
      { c: "okul", n: "Lise", m: 200 },
      { c: "kumarhane", n: "x", m: 10 },
      { c: "park", n: "", m: 10 },
      { c: "park", n: "<script>", m: 10 },
      "bozuk",
      null,
    ]);
    expect(list.map((p) => p.n)).toEqual(["Lise", "Atatürk İlkokulu", "Migros", "script"]);
    expect(parseNearbyPlaces({})).toEqual([]);
  });

  it("form doğrulama: boş satır atlanır, yarım satır açık hatayla reddedilir, km çevrilir", () => {
    expect(validateNearbyInput([{ c: "metro", n: "Kadıköy", m: "1,2 km" }, { c: "okul", n: "", m: "" }])).toEqual({
      ok: true,
      places: [{ c: "metro", n: "Kadıköy", m: 1200 }],
    });
    expect(validateNearbyInput([{ c: "metro", n: "", m: "100" }])).toEqual({ ok: false, error: "1. satır: yerin adını yazın." });
    expect(validateNearbyInput([{ c: "x", n: "A", m: "100" }])).toEqual({ ok: false, error: "1. satır: tür seçin." });
    const far = validateNearbyInput([{ c: "okul", n: "A", m: "90 km" }]);
    expect(far.ok).toBe(false);
    const many = Array.from({ length: 25 }, () => ({ c: "okul", n: "A", m: "100" }));
    expect(validateNearbyInput(many).ok).toBe(false);
  });

  it("mesafe ve yürüme metni", () => {
    expect(formatDistance(850)).toBe("850 m");
    expect(formatDistance(1200)).toBe("1,2 km");
    expect(formatDistance(12_000)).toBe("12 km");
    expect(walkingMinutes(640)).toBe(10);
    expect(walkingMinutes(3000)).toBeNull();
  });

  it("kategoriye göre gruplar", () => {
    const g = groupNearby([
      { c: "market", n: "A", m: 100 },
      { c: "okul", n: "B", m: 300 },
      { c: "market", n: "C", m: 50 },
    ]);
    expect(g.map((x) => [x.label, x.items.map((i) => i.n)])).toEqual([
      ["Okul", ["B"]],
      ["Market", ["C", "A"]],
    ]);
  });
});
