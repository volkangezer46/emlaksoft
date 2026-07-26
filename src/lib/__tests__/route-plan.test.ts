import { describe, expect, it } from "vitest";
import {
  buildRoutePlan,
  haversineKm,
  travelMinutes,
  DEFAULT_DURATION_MIN,
  type RoutePlanStop,
} from "@/lib/route-plan";

/** Sabit gün — testler duvar saatinden bağımsız (UTC ISO). */
const at = (hh: number, mm = 0) =>
  `2026-07-27T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00.000Z`;

const stop = (partial: Partial<RoutePlanStop> & { id: string; scheduledAt: string }): RoutePlanStop => ({
  durationMin: null,
  lat: null,
  lng: null,
  ...partial,
});

describe("haversineKm", () => {
  it("İstanbul–Ankara kuş uçuşu ~350 km", () => {
    const km = haversineKm(41.0082, 28.9784, 39.9334, 32.8597);
    expect(km).toBeGreaterThan(340);
    expect(km).toBeLessThan(365);
  });

  it("aynı nokta 0 km, travelMinutes 0 dk", () => {
    expect(haversineKm(41, 29, 41, 29)).toBe(0);
    expect(travelMinutes(0)).toBe(0);
  });
});

describe("travelMinutes", () => {
  it("40 km/s şehir içi varsayımıyla 10 km ≈ 15 dk (yukarı yuvarlar)", () => {
    expect(travelMinutes(10)).toBe(15);
    expect(travelMinutes(1)).toBe(2); // 1.5 dk → 2
  });
});

describe("buildRoutePlan", () => {
  it("saat sırası SABİT: girdi karışık gelse de duraklar saate göre dizilir, gezgin satıcı yapılmaz", () => {
    // C, A'ya B'den çok daha yakın olsa da sıra saat sırasıdır: A → B → C
    const plan = buildRoutePlan([
      stop({ id: "C", scheduledAt: at(14), lat: 41.001, lng: 29.001 }),
      stop({ id: "A", scheduledAt: at(9), lat: 41.0, lng: 29.0 }),
      stop({ id: "B", scheduledAt: at(11), lat: 41.2, lng: 29.3 }),
    ]);
    expect(plan.stops.map((s) => s.id)).toEqual(["A", "B", "C"]);
    expect(plan.legs[0]).toBeNull();
    expect(plan.legs[1]?.fromId).toBe("A");
    expect(plan.legs[2]?.fromId).toBe("B");
    expect(plan.totalKm).toBeCloseTo(
      (plan.legs[1]?.distanceKm ?? 0) + (plan.legs[2]?.distanceKm ?? 0),
      10,
    );
  });

  it("koordinatsız durak bacak zincirinde atlanır — polyline mantığıyla aynı", () => {
    const plan = buildRoutePlan([
      stop({ id: "A", scheduledAt: at(9), lat: 41.0, lng: 29.0 }),
      stop({ id: "B", scheduledAt: at(11) }), // ofis görüşmesi, koordinat yok
      stop({ id: "C", scheduledAt: at(13), lat: 41.1, lng: 29.1 }),
    ]);
    expect(plan.legs[1]).toBeNull(); // B koordinatsız → varış bacağı yok
    expect(plan.legs[2]?.fromId).toBe("A"); // C'nin bacağı önceki KOORDİNATLI durağa (A)
    expect(plan.totalKm).toBeCloseTo(plan.legs[2]?.distanceKm ?? 0, 10);
  });

  it("boşluk < tahmini yol süresi → sıkışık geçiş (süresiz randevu 60 dk varsayılır)", () => {
    // A 09:00 (süre girilmemiş → 60 dk, biter 10:00), B 10:05 → boşluk 5 dk.
    // Mesafe ~22 km → 40 km/s ile ~34 dk > 5 dk → tight.
    const plan = buildRoutePlan([
      stop({ id: "A", scheduledAt: at(9), lat: 41.0, lng: 29.0 }),
      stop({ id: "B", scheduledAt: at(10, 5), lat: 41.2, lng: 29.0 }),
    ]);
    const leg = plan.legs[1];
    expect(DEFAULT_DURATION_MIN).toBe(60);
    expect(leg?.gapMin).toBe(5);
    expect(leg?.travelMin).toBeGreaterThan(5);
    expect(leg?.tight).toBe(true);
    expect(plan.tightCount).toBe(1);
  });

  it("bol boşlukta uyarı yok; girilen duration_min varsayımı ezer", () => {
    // A 09:00 + 30 dk → 09:30 biter; B 11:00 → boşluk 90 dk, ~22 km ≈ 34 dk → rahat.
    const plan = buildRoutePlan([
      stop({ id: "A", scheduledAt: at(9), durationMin: 30, lat: 41.0, lng: 29.0 }),
      stop({ id: "B", scheduledAt: at(11), lat: 41.2, lng: 29.0 }),
    ]);
    const leg = plan.legs[1];
    expect(leg?.gapMin).toBe(90);
    expect(leg?.tight).toBe(false);
    expect(plan.tightCount).toBe(0);
  });

  it("örtüşen randevular negatif boşlukla sıkışık sayılır; boş girdi güvenli", () => {
    const overlapping = buildRoutePlan([
      stop({ id: "A", scheduledAt: at(9), durationMin: 120, lat: 41.0, lng: 29.0 }),
      stop({ id: "B", scheduledAt: at(10), lat: 41.01, lng: 29.01 }),
    ]);
    expect(overlapping.legs[1]?.gapMin).toBe(-60);
    expect(overlapping.legs[1]?.tight).toBe(true);

    const empty = buildRoutePlan([]);
    expect(empty.stops).toEqual([]);
    expect(empty.totalKm).toBe(0);
    expect(empty.tightCount).toBe(0);
  });
});
