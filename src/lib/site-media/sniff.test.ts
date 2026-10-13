import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { sniffSiteMedia } from "./sniff";

const enc = (s: string) => new TextEncoder().encode(s);
const cat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

async function img(format: "png" | "jpeg" | "webp" | "avif") {
  const base = sharp({ create: { width: 32, height: 24, channels: 3, background: { r: 30, g: 90, b: 200 } } });
  return new Uint8Array(await base.toFormat(format).toBuffer());
}

describe("sniffSiteMedia: tür yalnız bayt imzasından", () => {
  it("PNG, JPEG, WebP ve AVIF kabul edilir", async () => {
    for (const f of ["png", "jpeg", "webp", "avif"] as const) {
      const r = sniffSiteMedia(await img(f));
      expect(r.ok, f).toBe(true);
      if (r.ok) expect(r.type).toBe(f);
    }
  });

  it("SVG reddedilir (XML başlıklı ya da başlıksız)", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
    expect(sniffSiteMedia(enc(svg))).toMatchObject({ ok: false, error: expect.stringContaining("SVG") });
    expect(sniffSiteMedia(enc(`<?xml version="1.0"?>\n${svg}`))).toMatchObject({ ok: false });
  });

  it("PNG adıyla gelen HTML reddedilir (uzantı yalan söylese de içerik esas)", () => {
    // Dosya adı/uzantı API'ye hiç girmez: yalnız bayt.
    const r = sniffSiteMedia(enc("<!doctype html><html><body><script>fetch('/x')</script></body></html>"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/görsel değil|HTML/);
  });

  it("çok dilli dosya: geçerli PNG/JPEG imzası + gövdede HTML/betik reddedilir", async () => {
    const png = await img("png");
    expect(sniffSiteMedia(cat(png, enc("<script>alert(document.cookie)</script>"))).ok).toBe(false);
    const jpeg = await img("jpeg");
    expect(sniffSiteMedia(cat(jpeg.subarray(0, 20), enc("<HTML><BODY onload=x>"), jpeg.subarray(20))).ok).toBe(false);
    // GIFAR/JAR tipi: sonda ZIP merkez dizini.
    const zipEnd = new Uint8Array([0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(sniffSiteMedia(cat(png, zipEnd))).toMatchObject({ ok: false, error: expect.stringContaining("ZIP") });
  });

  it("GIF, video (ftyp mp4), HEIC ve rastgele ikili reddedilir", () => {
    expect(sniffSiteMedia(enc("GIF89a\x01\x00\x01\x00")).ok).toBe(false);
    const ftyp = (brand: string) => cat(new Uint8Array([0, 0, 0, 24]), enc(`ftyp${brand}\0\0\0\0${brand}mif1`), new Uint8Array(64));
    expect(sniffSiteMedia(ftyp("isom")).ok).toBe(false);
    expect(sniffSiteMedia(ftyp("heic")).ok).toBe(false);
    expect(sniffSiteMedia(ftyp("avis")).ok).toBe(false);
    expect(sniffSiteMedia(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).ok).toBe(false);
    expect(sniffSiteMedia(new Uint8Array()).ok).toBe(false);
  });
});
