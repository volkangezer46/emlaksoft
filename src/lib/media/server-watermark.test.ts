import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { DEFAULT_WATERMARK } from "@/lib/watermark";
import { buildWatermarkMark, prepareLogo, resolveMarkMode, stampImage } from "./server-watermark";

async function solidJpeg(w: number, h: number) {
  return sharp({ create: { width: w, height: h, channels: 3, background: { r: 20, g: 40, b: 60 } } }).jpeg().toBuffer();
}

async function whiteMark() {
  return sharp({ create: { width: 200, height: 80, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } }).png().toBuffer();
}

describe("resolveMarkMode (istemci effectiveWatermarkMode ile aynı kural)", () => {
  it("eldeki kaynağa düşer", () => {
    expect(resolveMarkMode("logo", false, true)).toBe("text");
    expect(resolveMarkMode("text", true, false)).toBe("logo");
    expect(resolveMarkMode("both", true, true)).toBe("both");
    expect(resolveMarkMode("both", false, false)).toBeNull();
  });
});

describe("stampImage", () => {
  const settings = { ...DEFAULT_WATERMARK, enabled: true, position: "sag-alt" as const, opacity: 100, scale: 20 };

  it("sağ alt köşeye basar, sol üst değişmez; ölçü korunur", async () => {
    const src = await solidJpeg(800, 600);
    const out = await stampImage(src, "image/jpeg", await whiteMark(), settings);
    expect(out).not.toBeNull();
    const { data, info } = await sharp(out!).raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([800, 600]);
    const px = (x: number, y: number) => data[(y * info.width + x) * info.channels];
    expect(px(5, 5)).toBeLessThan(60);
    // Kutu: genişlik %20 = 160, kenar boşluğu kısa kenarın %3'ü = 18 → sağ alt bölge beyaz.
    expect(px(800 - 18 - 80, 600 - 18 - 30)).toBeGreaterThan(200);
  });

  it("GIF ve bozuk dosya: null (orijinal korunur)", async () => {
    expect(await stampImage(new Uint8Array([1, 2, 3]), "image/gif", await whiteMark(), settings)).toBeNull();
    expect(await stampImage(new Uint8Array([1, 2, 3]), "image/jpeg", await whiteMark(), settings)).toBeNull();
  });
});

describe("buildWatermarkMark", () => {
  it("metin filigranı saydam PNG üretir; kaynak yoksa null", async () => {
    const mark = await buildWatermarkMark({ ...DEFAULT_WATERMARK, enabled: true, mode: "text" }, { text: "Örnek Gayrimenkul" });
    expect(mark).not.toBeNull();
    const meta = await sharp(mark!).metadata();
    expect(meta.format).toBe("png");
    expect(meta.hasAlpha).toBe(true);
    expect(await buildWatermarkMark({ ...DEFAULT_WATERMARK, mode: "text" }, { text: "" })).toBeNull();
  }, 20_000);

  it("logo hazırlanır, bozuk logo null", async () => {
    expect(await prepareLogo(Buffer.from("not an image"))).toBeNull();
    const logo = await prepareLogo(await whiteMark());
    expect(logo?.width).toBe(200);
  });
});
