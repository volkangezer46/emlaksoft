import { describe, expect, it } from "vitest";
import {
  DEFAULT_WATERMARK,
  computeWatermarkBox,
  sanitizeWatermarkSettings,
  type WatermarkPosition,
} from "@/lib/watermark";

/** 1000x1000 kare görsel, %20 ölçek, %0 boşluk → 200x200 kutu (matematik kolay okunsun). */
const square = { imgW: 1000, imgH: 1000, markW: 100, markH: 100, scale: 20, marginPct: 0 };

describe("computeWatermarkBox — beş konum", () => {
  const expected: Record<WatermarkPosition, { x: number; y: number }> = {
    "sol-ust": { x: 0, y: 0 },
    "sag-ust": { x: 800, y: 0 },
    "sol-alt": { x: 0, y: 800 },
    "sag-alt": { x: 800, y: 800 },
    orta: { x: 400, y: 400 },
  };

  for (const [position, pos] of Object.entries(expected)) {
    it(`${position} konumunda kutu doğru köşeye oturur`, () => {
      const box = computeWatermarkBox({ ...square, position: position as WatermarkPosition });
      expect(box).toEqual({ x: pos.x, y: pos.y, w: 200, h: 200 });
    });
  }
});

describe("computeWatermarkBox — ölçek sınırları", () => {
  it("ölçek alt sınıra (%5) ve üst sınıra (%40) kırpılır", () => {
    const tiny = computeWatermarkBox({ ...square, position: "sol-ust", scale: 1 });
    expect(tiny.w).toBe(50); // %5

    const huge = computeWatermarkBox({ ...square, position: "sol-ust", scale: 999 });
    expect(huge.w).toBe(400); // %40
  });

  it("geçersiz ölçek varsayılana düşer", () => {
    const box = computeWatermarkBox({ ...square, position: "sol-ust", scale: Number.NaN });
    expect(box.w).toBe((1000 * DEFAULT_WATERMARK.scale) / 100);
  });
});

describe("computeWatermarkBox — kenar boşluğu", () => {
  it("marginPct kısa kenardan hesaplanır ve kutuyu içeri çeker", () => {
    // 1000x1000, %5 boşluk = 50px
    const box = computeWatermarkBox({ ...square, position: "sag-alt", marginPct: 5 });
    expect(box).toEqual({ x: 750, y: 750, w: 200, h: 200 });
  });

  it("boşluk yüzünden sığmayan kutu orantılı küçültülür (taşma yok)", () => {
    // %40 ölçek + %20 boşluk: kullanılabilir alan 600px, istenen 400px → sığar;
    // ama 400x400 kutu dikey alanda 600px'e sığdığı için değişmez.
    const fits = computeWatermarkBox({ ...square, position: "sag-alt", scale: 40, marginPct: 20 });
    expect(fits.w).toBe(400);
    expect(fits.x).toBe(1000 - 200 - 400);

    // Çok uzun (dikey) filigran: en/boy 1:4 → 400 genişlik 1600 yükseklik isterdi,
    // kullanılabilir yükseklik 600 → 150x600'e küçültülür.
    const shrunk = computeWatermarkBox({
      ...square,
      markW: 100,
      markH: 400,
      position: "sag-alt",
      scale: 40,
      marginPct: 20,
    });
    expect(shrunk).toEqual({ x: 650, y: 200, w: 150, h: 600 });
  });

  it("orta konumda kenar boşluğu uygulanmaz, kutu tam ortalanır", () => {
    const box = computeWatermarkBox({ ...square, position: "orta", marginPct: 20 });
    expect(box).toEqual({ x: 400, y: 400, w: 200, h: 200 });
  });
});

describe("computeWatermarkBox — kare / dikey / yatay görseller", () => {
  it("yatay görselde genişlik referans alınır, en-boy oranı korunur", () => {
    // 1600x900, logo 200x50 (4:1), %25 ölçek → 400x100
    const box = computeWatermarkBox({
      imgW: 1600,
      imgH: 900,
      markW: 200,
      markH: 50,
      position: "sag-alt",
      scale: 25,
      marginPct: 0,
    });
    expect(box).toEqual({ x: 1200, y: 800, w: 400, h: 100 });
  });

  it("dikey görselde kutu asla alt kenardan taşmaz", () => {
    // 900x1600, logo 1:2, %40 ölçek → 360x720, boşluk %0
    const box = computeWatermarkBox({
      imgW: 900,
      imgH: 1600,
      markW: 100,
      markH: 200,
      position: "sol-alt",
      scale: 40,
      marginPct: 0,
    });
    expect(box).toEqual({ x: 0, y: 880, w: 360, h: 720 });
    expect(box.y + box.h).toBeLessThanOrEqual(1600);
  });

  it("karede kutu her zaman kare kalır", () => {
    const box = computeWatermarkBox({ ...square, position: "sag-ust", scale: 30 });
    expect(box.w).toBe(box.h);
  });
});

describe("computeWatermarkBox — bozuk girdi", () => {
  it("sıfır/negatif görsel ölçüsünde boş kutu döner", () => {
    expect(computeWatermarkBox({ ...square, imgW: 0, position: "orta" })).toEqual({ x: 0, y: 0, w: 0, h: 0 });
    expect(computeWatermarkBox({ ...square, imgH: -5, position: "orta" })).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });

  it("filigran ölçüsü 0/NaN ise kare varsayılır (bölme hatası yok)", () => {
    const box = computeWatermarkBox({ ...square, markW: 0, markH: Number.NaN, position: "sol-ust" });
    expect(box).toEqual({ x: 0, y: 0, w: 200, h: 200 });
  });

  it("bilinmeyen konum sağ-alt gibi davranır", () => {
    const box = computeWatermarkBox({ ...square, position: "zurna" as WatermarkPosition });
    expect(box).toEqual({ x: 800, y: 800, w: 200, h: 200 });
  });
});

describe("sanitizeWatermarkSettings", () => {
  it("null/undefined/ilkel girdide varsayılan seti döner", () => {
    expect(sanitizeWatermarkSettings(null)).toEqual(DEFAULT_WATERMARK);
    expect(sanitizeWatermarkSettings(undefined)).toEqual(DEFAULT_WATERMARK);
    expect(sanitizeWatermarkSettings("bozuk")).toEqual(DEFAULT_WATERMARK);
    expect(sanitizeWatermarkSettings(42)).toEqual(DEFAULT_WATERMARK);
  });

  it("bilinmeyen mod ve konum varsayılana düşer", () => {
    const s = sanitizeWatermarkSettings({ mode: "hologram", position: "sag-orta" });
    expect(s.mode).toBe(DEFAULT_WATERMARK.mode);
    expect(s.position).toBe(DEFAULT_WATERMARK.position);
  });

  it("aralık dışı sayılar sınıra çekilir", () => {
    const s = sanitizeWatermarkSettings({ opacity: 480, scale: -12, marginPct: 999 });
    expect(s.opacity).toBe(100);
    expect(s.scale).toBe(5);
    expect(s.marginPct).toBe(20);
  });

  it("string sayılar ve virgüllü ondalık kabul edilir", () => {
    const s = sanitizeWatermarkSettings({ opacity: "72", scale: "12,5", marginPct: "4" });
    expect(s.opacity).toBe(72);
    expect(s.scale).toBe(12.5);
    expect(s.marginPct).toBe(4);
  });

  it("enabled string formlardan da doğru okunur", () => {
    expect(sanitizeWatermarkSettings({ enabled: "on" }).enabled).toBe(true);
    expect(sanitizeWatermarkSettings({ enabled: "true" }).enabled).toBe(true);
    expect(sanitizeWatermarkSettings({ enabled: "false" }).enabled).toBe(false);
    expect(sanitizeWatermarkSettings({ enabled: true }).enabled).toBe(true);
  });

  it("metin kırpılır ve 80 karakterle sınırlanır", () => {
    const s = sanitizeWatermarkSettings({ text: `  ${"A".repeat(120)}  ` });
    expect(s.text).toHaveLength(80);
    expect(sanitizeWatermarkSettings({ text: 123 }).text).toBe("");
  });

  it("geçerli tam set aynen korunur", () => {
    const input = {
      enabled: true,
      mode: "logo",
      position: "orta",
      opacity: 40,
      scale: 22,
      text: "Demo Emlak",
      marginPct: 6,
    };
    expect(sanitizeWatermarkSettings(input)).toEqual(input);
  });
});
