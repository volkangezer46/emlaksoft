import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { processSiteImage, VARIANT_WIDTHS } from "./variants";
import { VARIANT_FILE_RE } from "./types";

async function photo(width: number, height: number, opts: { exif?: boolean; orientation?: number } = {}) {
  let p = sharp({ create: { width, height, channels: 3, background: { r: 200, g: 120, b: 40 } } }).jpeg({ quality: 80 });
  if (opts.exif) p = p.withExif({ IFD0: { Copyright: "Gizli Kişi", Make: "KameraMarka" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "41/1 0/1 0/1" } });
  if (opts.orientation) p = p.withMetadata({ orientation: opts.orientation });
  return p.toBuffer();
}

describe("processSiteImage", () => {
  it("3 genişlik x 2 biçim üretir, w/h kaydeder, EXIF temizlenir", async () => {
    const input = await photo(2000, 1200, { exif: true });
    expect((await sharp(input).metadata()).exif).toBeDefined();
    const out = await processSiteImage(input, "jpeg", { tag: "abcdef01" });
    expect(out.w).toBe(2000);
    expect(out.h).toBe(1200);
    expect(out.variants).toHaveLength(6);
    for (const w of VARIANT_WIDTHS) {
      for (const f of ["avif", "webp"]) {
        const v = out.variants.find((x) => x.w === w && x.format === f);
        expect(v, `${w}/${f}`).toBeDefined();
        expect(v!.file).toBe(`${w}w-abcdef01.${f}`);
        expect(v!.file).toMatch(VARIANT_FILE_RE);
        expect(v!.h).toBe(Math.round((1200 * w) / 2000));
        expect(v!.bytes).toBe(v!.data.length);
        const meta = await sharp(v!.data).metadata();
        expect(meta.exif, `${v!.file} EXIF`).toBeUndefined();
        expect(meta.width).toBe(w);
      }
    }
    expect(out.bytes).toBe(out.variants.reduce((s, v) => s + v.bytes, 0));
    expect(out.lqip.length).toBeGreaterThan(0);
    expect(Buffer.byteLength(out.lqip)).toBeLessThanOrEqual(200);
  }, 60_000);

  it("EXIF yönü uygulanır (90° döndürülmüş fotoğrafta w/h yer değiştirir)", async () => {
    const input = await photo(800, 500, { orientation: 6 });
    const out = await processSiteImage(input, "jpeg");
    expect(out.w).toBe(500);
    expect(out.h).toBe(800);
    expect(out.variants.every((v) => v.w <= 500)).toBe(true);
  }, 60_000);

  it("küçük kaynak büyütülmez; bildirilen tür içerikle uyuşmazsa reddedilir; çok küçük görsel reddedilir", async () => {
    const small = await photo(600, 400);
    const out = await processSiteImage(small, "jpeg");
    expect([...new Set(out.variants.map((v) => v.w))]).toEqual([480, 600]);
    await expect(processSiteImage(small, "png")).rejects.toThrow(/uyuşmuyor/);
    await expect(processSiteImage(await photo(100, 100), "jpeg")).rejects.toThrow(/en az/);
  }, 60_000);
});
