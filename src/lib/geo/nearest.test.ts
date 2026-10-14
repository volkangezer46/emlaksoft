import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./reader", () => ({
  getDistrict: vi.fn(),
  getNeighborhood: vi.fn(),
  getProvince: vi.fn(),
  getProvinces: vi.fn(),
}));

const { bbox, haversineKm, isValidPoint, pickNearest } = await import("./nearest");

describe("GPS → en yakın mahalle önerisi (saf parçalar)", () => {
  const kadikoy = { lat: 40.9903, lng: 29.0293 };

  it("haversine: Kadıköy–Beşiktaş ≈ 5 km", () => {
    const km = haversineKm(kadikoy, { lat: 41.0422, lng: 29.0083 });
    expect(km).toBeGreaterThan(5);
    expect(km).toBeLessThan(6.5);
  });

  it("en yakın aday eşik içinde seçilir; koordinatsız satır atlanır; eşik dışı yok", () => {
    const rows = [
      { id: "uzak", lat: 41.0422, lng: 29.0083 },
      { id: "yakin", lat: 40.991, lng: 29.03 },
      { id: "bos", lat: null, lng: null },
    ];
    expect(pickNearest(kadikoy, rows, 3)?.row.id).toBe("yakin");
    expect(pickNearest(kadikoy, rows.filter((r) => r.id !== "yakin"), 3)).toBeNull();
  });

  it("kutu ön süzgeci noktayı içerir; geçersiz koordinat reddedilir", () => {
    const b = bbox(kadikoy, 3);
    expect(b.minLat).toBeLessThan(kadikoy.lat);
    expect(b.maxLng).toBeGreaterThan(kadikoy.lng);
    expect(isValidPoint(40.99, 29.03)).toBe(true);
    expect(isValidPoint(120, 29)).toBe(false);
    expect(isValidPoint(Number.NaN, 29)).toBe(false);
  });
});
