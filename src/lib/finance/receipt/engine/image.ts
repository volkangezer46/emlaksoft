import "server-only";
import sharp from "sharp";
import { runSandboxed } from "./sandbox";

/**
 * Görsel ön işleme (sharp) + karekod tarama. EXIF yönü düzeltilir; gri ton + normalize; birden çok ölçek, eşikleme ve
 * örtüşen dörtte bir kırpımlar denenir (fotoğrafta küçük kalan karekod için). İlk GİB karekodunda durulur.
 */

const PIXEL_LIMIT = 50_000_000;

type Raw = { data: Uint8Array; width: number; height: number; channels: 1; crop?: Crop };
type Crop = { left: number; top: number; width: number; height: number };

async function variant(input: Uint8Array, opts: { max: number; threshold?: number; sharpen?: boolean; crop?: { left: number; top: number; width: number; height: number } }): Promise<Raw | null> {
  try {
    let img = sharp(input, { limitInputPixels: PIXEL_LIMIT, failOn: "none" });
    if (opts.crop) img = img.extract(opts.crop);
    img = img.resize({ width: opts.max, height: opts.max, fit: "inside", withoutEnlargement: false }).grayscale().normalize();
    if (opts.sharpen) img = img.sharpen();
    if (opts.threshold) img = img.threshold(opts.threshold);
    const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
    return { data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), width: info.width, height: info.height, channels: 1, crop: opts.crop };
  } catch {
    return null;
  }
}

/** Karekod kutusu: yönü düzeltilmiş görselin oranı (0..1) cinsinden; OCR öncesi maskelemek için. */
export type QrBox = { x: number; y: number; w: number; h: number };
export type QrScan = { gib: string | null; found: string[]; tried: number; box?: QrBox };
type WorkerScan = { gib: string | null; found: string[]; tried: number; box?: { index: number; minX: number; minY: number; maxX: number; maxY: number } };

/** İş parçacığının varyant koordinatındaki kutusunu taban görsel oranına çevirir. */
function toBox(scan: WorkerScan, images: Raw[], W: number, H: number): QrBox | undefined {
  const b = scan.box;
  const img = b ? images[b.index] : undefined;
  if (!b || !img) return undefined;
  const srcW = img.crop?.width ?? W;
  const srcH = img.crop?.height ?? H;
  const sx = srcW / img.width;
  const sy = srcH / img.height;
  const x0 = (img.crop?.left ?? 0) + b.minX * sx;
  const y0 = (img.crop?.top ?? 0) + b.minY * sy;
  return { x: x0 / W, y: y0 / H, w: ((b.maxX - b.minX) * sx) / W, h: ((b.maxY - b.minY) * sy) / H };
}

/** Görselde GİB karekodu arar (iki tur: hızlı, sonra ağır). */
export async function scanImageForQr(bytes: Uint8Array, timeoutMs: number): Promise<QrScan> {
  // Tek sefer: EXIF yönü düzeltilmiş, gri, uzun kenarı ≤ 3000 px kayıpsız taban; tüm denemeler bundan türetilir.
  const { data: baseBuf, info } = await sharp(bytes, { limitInputPixels: PIXEL_LIMIT, failOn: "none" })
    .rotate()
    .resize({ width: 3000, height: 3000, fit: "inside", withoutEnlargement: true })
    .grayscale()
    .png({ compressionLevel: 1 })
    .toBuffer({ resolveWithObject: true });
  const base = new Uint8Array(baseBuf.buffer, baseBuf.byteOffset, baseBuf.byteLength);
  const W = info.width;
  const H = info.height;
  const started = Date.now();
  const left = () => Math.max(500, timeoutMs - (Date.now() - started));

  const fast = (await Promise.all([variant(base, { max: 1000 }), variant(base, { max: 1800, sharpen: true })])).filter((v): v is Raw => !!v);
  const r1 = await runSandboxed<WorkerScan>({ kind: "qr", images: fast }, { timeoutMs: left(), maxOldMb: 256 });
  if (r1.gib) return { gib: r1.gib, found: r1.found, tried: r1.tried, box: toBox(r1, fast, W, H) };

  const heavy: Promise<Raw | null>[] = [variant(base, { max: 1400, threshold: 128 }), variant(base, { max: 2400, threshold: 150 })];
  if (W >= 600 && H >= 600) {
    const cw = Math.round(W * 0.6);
    const ch = Math.round(H * 0.6);
    for (const [lx, ty] of [
      [W - cw, 0],
      [0, 0],
      [W - cw, H - ch],
      [0, H - ch],
      [Math.round((W - cw) / 2), Math.round((H - ch) / 2)],
    ] as const) {
      heavy.push(variant(base, { max: 1400, sharpen: true, crop: { left: lx, top: ty, width: cw, height: ch } }));
    }
  }
  const images = (await Promise.all(heavy)).filter((v): v is Raw => !!v);
  const r2 = await runSandboxed<WorkerScan>({ kind: "qr", images }, { timeoutMs: left(), maxOldMb: 256 });
  return { gib: r2.gib, found: [...new Set([...r1.found, ...r2.found])], tried: r1.tried + r2.tried, box: r2.gib ? toBox(r2, images, W, H) : undefined };
}

/**
 * OCR girişi: EXIF yönü, gri ton, uzun kenar 1600-2400 px, normalize, hafif keskinleştirme → PNG. Karekod kutusu verilirse
 * beyazla örtülür (Tesseract sayfa çözümlemesi karekodu görsel blok sayıp çevresindeki satırları atabiliyor).
 */
export async function prepareForOcr(bytes: Uint8Array, mask?: QrBox): Promise<{ png: Buffer; tall: boolean }> {
  const base = sharp(bytes, { limitInputPixels: PIXEL_LIMIT, failOn: "none" }).rotate();
  const meta = await base.metadata();
  const swap = (meta.orientation ?? 1) >= 5;
  const w = (swap ? meta.height : meta.width) ?? 1000;
  const h = (swap ? meta.width : meta.height) ?? 1000;
  const long = Math.max(w, h);
  const target = long < 1600 ? 1600 : Math.min(long, 2400);
  const { data, info } = await base
    .resize({ width: target, height: target, fit: "inside", withoutEnlargement: false, kernel: "lanczos3" })
    .grayscale()
    .normalize()
    .sharpen({ sigma: 0.8 })
    .png({ compressionLevel: 1 })
    .toBuffer({ resolveWithObject: true });
  let png: Buffer = data;
  if (mask && mask.w > 0 && mask.h > 0) {
    const pad = 0.12;
    const left = Math.max(0, Math.floor((mask.x - mask.w * pad) * info.width));
    const top = Math.max(0, Math.floor((mask.y - mask.h * pad) * info.height));
    const width = Math.min(info.width - left, Math.ceil(mask.w * (1 + 2 * pad) * info.width));
    const height = Math.min(info.height - top, Math.ceil(mask.h * (1 + 2 * pad) * info.height));
    if (width > 0 && height > 0) {
      const white = await sharp({ create: { width, height, channels: 3, background: "#ffffff" } }).png().toBuffer();
      png = await sharp(data).composite([{ input: white, left, top }]).png({ compressionLevel: 3 }).toBuffer();
    }
  }
  return { png, tall: h > w * 1.3 };
}

/** PDF'ten çıkan ham görseli (1/3/4 kanal) PNG'ye çevirir. */
export async function rawToPng(img: { data: Uint8Array; width: number; height: number; channels: 1 | 3 | 4 }): Promise<Uint8Array> {
  const buf = await sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength), { raw: { width: img.width, height: img.height, channels: img.channels } })
    .png({ compressionLevel: 3 })
    .toBuffer();
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}
