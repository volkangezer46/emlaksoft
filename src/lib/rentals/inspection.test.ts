import { describe, expect, it } from "vitest";
import {
  buildInspectionBody,
  countConditions,
  deductionLabel,
  defaultRooms,
  depositSummary,
  diffInspections,
  emptyMeters,
  kindFromSlug,
  meterUsage,
  newKey,
  normalizeKeys,
  normalizeMeters,
  normalizeRooms,
  roomsFromMoveIn,
} from "./inspection";

describe("tutanak normalizasyonu", () => {
  it("şablon odaları tekil, geçerli anahtarlı", () => {
    const rooms = defaultRooms();
    const keys = rooms.flatMap((r) => [r.key, ...r.items.map((i) => i.key)]);
    expect(new Set(keys).size).toBe(keys.length);
    expect(normalizeRooms(rooms)).toEqual(rooms);
  });

  it("geçersiz anahtar, yinelenen kalem, bilinmeyen durum ve uzun metin temizlenir", () => {
    const out = normalizeRooms([
      { key: "salon", name: "  Salon  ", items: [
        { key: "salon-1", label: "Duvar", condition: "damaged", note: "x".repeat(900) },
        { key: "salon-1", label: "Yineleme", condition: "good" },
        { key: "BAD KEY", label: "Kötü", condition: "good" },
        { key: "salon-2", label: "Zemin", condition: "harika" },
      ] },
      { key: "salon", name: "Yinelenen oda", items: [] },
      { key: "x", name: "", items: [] },
      "çöp",
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.name).toBe("Salon");
    expect(out[0]!.items.map((i) => [i.key, i.condition])).toEqual([["salon-1", "damaged"], ["salon-2", "good"]]);
    expect(out[0]!.items[0]!.note.length).toBe(500);
    expect(normalizeRooms("x")).toEqual([]);
  });

  it("sayaç ve anahtar alanları güvenli biçime iner", () => {
    const m = normalizeMeters({ electricity: { reading: "12.345,6 kWh", subscriber: "AB-12 34<script>" }, water: null, gas: "x" });
    expect(m.electricity).toEqual({ reading: "12.345,6", subscriber: "AB-1234script" });
    expect(m.water).toEqual({ reading: "", subscriber: "" });
    expect(normalizeKeys([{ label: "Kapı", count: 2 }, { label: "", count: 1 }, { label: "Fazla", count: 99 }, { label: "Kart", count: "1" }])).toEqual([
      { label: "Kapı", count: 2 },
      { label: "Kart", count: 1 },
    ]);
  });

  it("tür URL parçası", () => {
    expect(kindFromSlug("giris")).toBe("move_in");
    expect(kindFromSlug("cikis")).toBe("move_out");
    expect(kindFromSlug("x")).toBeNull();
  });

  it("yeni anahtar mevcutlarla çakışmaz", () => {
    expect(newKey("salon", new Set(["salon-1", "salon-2"]))).toBe("salon-3");
    expect(newKey("ÇOCUK ODASI", new Set())).toMatch(/^[a-z0-9]{1,12}-1$/);
    expect(newKey("", new Set())).toBe("k-1");
  });
});

describe("giriş ↔ çıkış farkı ve kesinti", () => {
  const moveIn = defaultRooms();
  moveIn[1]!.items[0]!.condition = "worn"; // salon duvar teslimde yıpranmış

  it("çıkış iskeleti giriş anahtarlarını korur, hepsi iyi başlar", () => {
    const out = roomsFromMoveIn(moveIn);
    expect(out.map((r) => r.key)).toEqual(moveIn.map((r) => r.key));
    expect(countConditions(out).good).toBe(countConditions(out).total);
  });

  it("yalnız kötüleşen kalem fark sayılır; giriş yoksa kusurlu her kalem", () => {
    const out = roomsFromMoveIn(moveIn);
    out[1]!.items[0]!.condition = "worn"; // aynı kaldı
    out[1]!.items[1]!.condition = "damaged"; // zemin kötüleşti
    out[1]!.items[1]!.note = "parke çizik";
    const diff = diffInspections(moveIn, out);
    expect(diff).toHaveLength(1);
    expect(diff[0]).toMatchObject({ itemKey: "salon-2", before: "good", after: "damaged", note: "parke çizik" });
    expect(deductionLabel(diff[0]!)).toBe("Salon · Zemin (hasarlı)");
    expect(diffInspections(null, out).map((d) => d.before)).toEqual([null, null]);
  });

  it("depozito özeti ve sayaç tüketimi", () => {
    expect(depositSummary(30000, [{ amount: 3500 }, { amount: 1500.5 }])).toEqual({ deposit: 30000, deducted: 5000.5, net: 24999.5, overLimit: false });
    expect(depositSummary(1000, [{ amount: 1500 }])).toMatchObject({ net: 0, overLimit: true });
    const a = emptyMeters();
    const b = emptyMeters();
    a.electricity.reading = "1.000,5";
    b.electricity.reading = "1250";
    a.water.reading = "50";
    b.water.reading = "40";
    expect(meterUsage(a, b)).toEqual({ electricity: 249.5, water: null, gas: null });
  });

  it("imza metni odaları, sayaçları, anahtarları ve çıkışta kesintileri içerir", () => {
    const rooms = roomsFromMoveIn(moveIn);
    rooms[2]!.items[0]!.condition = "missing";
    const body = buildInspectionBody({
      kind: "move_out",
      inspectedOn: "2026-10-15",
      propertyTitle: "Kadıköy 2+1",
      propertyAddress: null,
      landlordName: "Ayşe Malik",
      renterName: "Mehmet Kiracı",
      officeName: "Demo Emlak",
      rooms,
      meters: { ...emptyMeters(), gas: { reading: "345", subscriber: "99" } },
      keys: [{ label: "Daire kapısı", count: 2 }],
      notes: "Beyaz eşya teslim alındı.",
      photoCount: 3,
      deductions: [{ label: "Mutfak dolabı", amount: 2000 }],
      deposit: 30000,
    });
    expect(body).toContain("TAHLİYE");
    expect(body).toContain("15.10.2026");
    expect(body).toContain("Mutfak:");
    expect(body).toContain("Dolaplar: Eksik");
    expect(body).toContain("Doğalgaz: 345 m³ (abone no 99)");
    expect(body).toContain("Daire kapısı: 2 adet");
    expect(body).toContain("3 adet fotoğraf");
    expect(body).toContain("Mutfak dolabı");
    expect(body).toMatch(/İade edilecek: .*28\.000/);
    expect(body).not.toMatch(/\n\n\n/);
  });
});
