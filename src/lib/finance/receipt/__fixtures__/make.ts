/**
 * Test fikstürü üreticileri (YALNIZ testler): GİB karekodu görseli (qrcode → sharp), fiş fotoğrafı benzeri JPEG (SVG metin +
 * döndürme + bulanıklık + gürültülü zemin), metin katmanlı ve karekod görselli PDF (pdf-lib).
 */
import QRCode from "qrcode";
import sharp, { type OverlayOptions } from "sharp";
import { PDFDocument, StandardFonts } from "pdf-lib";

export async function qrPng(text: string, scale = 6): Promise<Buffer> {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const n = qr.modules.size;
  const quiet = 4;
  const size = (n + quiet * 2) * scale;
  const raw = Buffer.alloc(size * size, 255);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++)
      if (qr.modules.get(y, x))
        for (let dy = 0; dy < scale; dy++)
          for (let dx = 0; dx < scale; dx++) raw[((y + quiet) * scale + dy) * size + (x + quiet) * scale + dx] = 0;
  return sharp(raw, { raw: { width: size, height: size, channels: 1 } }).png().toBuffer();
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function receiptJpeg(lines: string[], opts: { qr?: Buffer; rotate?: number; blur?: number; width?: number } = {}): Promise<Buffer> {
  const width = opts.width ?? 640;
  const lh = 38;
  const qrSize = opts.qr ? 260 : 0;
  const height = lines.length * lh + 60 + qrSize + 20;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#f3efe6"/>${lines
    .map((l, i) => `<text x="24" y="${48 + i * lh}" font-family="DejaVu Sans Mono" font-size="23" fill="#1d1d1d">${esc(l)}</text>`)
    .join("")}</svg>`;
  const layers: OverlayOptions[] = [];
  if (opts.qr) layers.push({ input: await sharp(opts.qr).resize(qrSize, qrSize, { kernel: "nearest" }).toBuffer(), top: lines.length * lh + 50, left: Math.round((width - qrSize) / 2) });
  let img = sharp(Buffer.from(svg)).composite(layers);
  const flat = await img.png().toBuffer();
  img = sharp(flat).rotate(opts.rotate ?? 1.5, { background: "#d9d4c8" });
  if (opts.blur) img = img.blur(opts.blur);
  return img.jpeg({ quality: 72 }).toBuffer();
}

/** pdf-lib standart yazı tipi WinAnsi dışını basamaz: Türkçe harfler ASCII'ye indirilir (gerçek PDF'lerde gömülü yazı tipi olur). */
const ascii = (s: string) => s.replace(/İ/g, "I").replace(/ı/g, "i").replace(/Ş/g, "S").replace(/ş/g, "s").replace(/Ğ/g, "G").replace(/ğ/g, "g");

export async function invoicePdf(rows: { text: string; x: number; y: number; size?: number }[], qr?: Buffer): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const r of rows) page.drawText(ascii(r.text), { x: r.x, y: r.y, size: r.size ?? 9, font });
  if (qr) {
    const img = await doc.embedPng(qr);
    page.drawImage(img, { x: 470, y: 720, width: 100, height: 100 });
  }
  return Buffer.from(await doc.save());
}
