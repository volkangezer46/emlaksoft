/**
 * PDF yazıcı (SUNUCU; pdf-lib + fontkit, gömülü Geist yazı tipi — Türkçe karakterler tam). İstemci paketine GİRMEZ.
 *
 * Düzen: sütun sayısı/genişliğine göre yatay ya da dikey A4; birinci sayfada başlık bandı (ofis adı, filtre özeti,
 * oluşturma zamanı TR saati, satır sayısı, varsa logo); başlık satırı her sayfada tekrarlanır; zebra satırlar,
 * uzun metin hücre içinde en çok 3 satır sarılır; sayısal sütunlar sağa yaslıdır; varsa toplam satırı;
 * her sayfanın altında "Sayfa i / n".
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { computeTotals, displayValue } from "../values";
import type { CellValue, ReportMeta, ReportTable } from "../types";

const FONT_PATH = join(process.cwd(), "src/assets/fonts/Geist-Regular.ttf");
let fontBytesPromise: Promise<Buffer> | null = null;
function loadFontBytes(): Promise<Buffer> {
  fontBytesPromise ??= readFile(FONT_PATH).catch((e) => {
    fontBytesPromise = null;
    throw e;
  });
  return fontBytesPromise;
}

export type PdfLogo = { bytes: Uint8Array; kind: "png" | "jpg" };

const INK = rgb(0.1, 0.13, 0.18);
const MUTED = rgb(0.36, 0.4, 0.45);
const BRAND = rgb(0.122, 0.227, 0.373); // #1F3A5F
const LINE = rgb(0.85, 0.87, 0.9);
const ZEBRA = rgb(0.965, 0.972, 0.98);
const WARN = rgb(0.7, 0.33, 0.04);

const MARGIN = 28;
const A4 = { w: 595.28, h: 841.89 };
const MAX_LINES = 3;
const CELL_PAD_X = 4;
const CELL_PAD_Y = 3;

const DEFAULT_CHARS = { text: 22, date: 11, datetime: 15, money: 14, number: 9, percent: 8, bool: 7 } as const;

/** Yazı tipinde olmayan karakterleri güvenli karşılığa çevirir (₺ → TL); kontrol karakterlerini atar. */
export function pdfSafeText(text: string, has: (cp: number) => boolean): string {
  let out = "";
  for (const ch of text.replace(/\r?\n|\t/g, " ").replace(/₺/g, "TL")) {
    const cp = ch.codePointAt(0)!;
    if (cp < 32 || cp === 127) continue;
    out += has(cp) ? ch : "?";
  }
  return out;
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number, maxLines: number): string[] {
  if (!text) return [""];
  const lines: string[] = [];
  const words = text.split(" ");
  let cur = "";
  const pushLong = (word: string) => {
    // Tek sözcük sığmıyorsa karakter karakter böl.
    let chunk = "";
    for (const ch of word) {
      if (font.widthOfTextAtSize(chunk + ch, size) > maxWidth && chunk) {
        lines.push(chunk);
        chunk = ch;
      } else chunk += ch;
    }
    return chunk;
  };
  for (const w of words) {
    const trial = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(trial, size) <= maxWidth) {
      cur = trial;
      continue;
    }
    if (cur) lines.push(cur);
    cur = font.widthOfTextAtSize(w, size) <= maxWidth ? w : pushLong(w);
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    let last = kept[maxLines - 1]!;
    while (last.length > 1 && font.widthOfTextAtSize(last + "…", size) > maxWidth) last = last.slice(0, -1);
    kept[maxLines - 1] = last.replace(/\s+$/, "") + "…";
    return kept;
  }
  return lines;
}

function fitOneLine(text: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && font.widthOfTextAtSize(t + "…", size) > maxWidth) t = t.slice(0, -1);
  return t + "…";
}

export async function buildPdf(meta: ReportMeta, table: ReportTable, createdIso: string, logo?: PdfLogo | null): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(await loadFontBytes(), { subset: true });
  const charset = new Set<number>(font.getCharacterSet());
  const has = (cp: number) => charset.has(cp);
  const safe = (s: string) => pdfSafeText(s, has);

  doc.setTitle(meta.title);
  doc.setCreator("EmlakSoft");
  doc.setProducer("EmlakSoft Rapor Merkezi");
  doc.setCreationDate(new Date(createdIso));

  let logoImage: PDFImage | null = null;
  if (logo) {
    try {
      logoImage = logo.kind === "png" ? await doc.embedPng(logo.bytes) : await doc.embedJpg(logo.bytes);
    } catch {
      logoImage = null;
    }
  }

  // Yön: tercih edilen genişlik toplamı dikey kullanılabilir alana sığmıyorsa yatay.
  const prefChars = table.columns.map((c) => c.width ?? DEFAULT_CHARS[c.type]);
  const totalChars = prefChars.reduce((a, b) => a + b, 0);
  const portraitUsable = A4.w - MARGIN * 2;
  const landscape = totalChars * 4.4 > portraitUsable || table.columns.length > 7;
  const pageW = landscape ? A4.h : A4.w;
  const pageH = landscape ? A4.w : A4.h;
  const usableW = pageW - MARGIN * 2;

  // Yazı boyutu: çok sütunda küçülür (en az 6,5).
  const fontSize = Math.max(6.5, Math.min(8.5, (usableW / Math.max(totalChars, 1)) * 1.9));
  const lineH = fontSize * 1.28;

  // Sütun genişlikleri: tercih oranında ölçekle, alt sınır uygula.
  const minW = fontSize * 3.2;
  let colW = prefChars.map((c) => (c / totalChars) * usableW);
  colW = colW.map((w) => Math.max(minW, w));
  const sum = colW.reduce((a, b) => a + b, 0);
  colW = colW.map((w) => (w / sum) * usableW);
  const colX: number[] = [];
  colW.reduce((x, w, i) => {
    colX[i] = x;
    return x + w;
  }, MARGIN);

  const align = (type: string) => (type === "text" ? "left" : type === "bool" ? "center" : "right");

  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0;

  const drawBold = (p: PDFPage, text: string, x: number, yy: number, size: number, color = INK) => {
    p.drawText(text, { x, y: yy, size, font, color });
    p.drawText(text, { x: x + size * 0.035, y: yy, size, font, color });
  };

  const drawHeaderRow = (p: PDFPage, top: number): number => {
    const heads = table.columns.map((c, i) => wrapText(safe(c.label), font, fontSize, colW[i]! - CELL_PAD_X * 2, 2));
    const h = Math.max(...heads.map((l) => l.length)) * lineH + CELL_PAD_Y * 2;
    p.drawRectangle({ x: MARGIN, y: top - h, width: usableW, height: h, color: BRAND });
    heads.forEach((lines, i) => {
      const a = align(table.columns[i]!.type);
      lines.forEach((ln, li) => {
        const w = font.widthOfTextAtSize(ln, fontSize);
        const x = a === "right" ? colX[i]! + colW[i]! - CELL_PAD_X - w : a === "center" ? colX[i]! + (colW[i]! - w) / 2 : colX[i]! + CELL_PAD_X;
        drawBold(p, ln, x, top - CELL_PAD_Y - fontSize - li * lineH + 1.5, fontSize, rgb(1, 1, 1));
      });
    });
    return top - h;
  };

  const newPage = (first: boolean) => {
    page = doc.addPage([pageW, pageH]);
    pages.push(page);
    if (first) {
      const bandH = 58;
      page.drawRectangle({ x: 0, y: pageH - bandH, width: pageW, height: bandH, color: BRAND });
      let titleX = MARGIN;
      if (logoImage) {
        const maxH = 36;
        const sc = Math.min(maxH / logoImage.height, 120 / logoImage.width);
        const w = logoImage.width * sc;
        const h = logoImage.height * sc;
        page.drawRectangle({ x: MARGIN - 3, y: pageH - bandH + (bandH - h) / 2 - 3, width: w + 6, height: h + 6, color: rgb(1, 1, 1) });
        page.drawImage(logoImage, { x: MARGIN, y: pageH - bandH + (bandH - h) / 2, width: w, height: h });
        titleX = MARGIN + w + 14;
      }
      drawBold(page, fitOneLine(safe(meta.title), font, 16, pageW - titleX - MARGIN), titleX, pageH - 27, 16, rgb(1, 1, 1));
      page.drawText(
        fitOneLine(safe(`${meta.platform ? "EmlakSoft Platform" : meta.officeName}  |  ${meta.generatedAt} (TR saati)${meta.generatedBy ? `  |  ${meta.generatedBy}` : ""}`), font, 8.5, pageW - titleX - MARGIN),
        { x: titleX, y: pageH - 44, size: 8.5, font, color: rgb(0.86, 0.9, 0.96) },
      );
      y = pageH - bandH - 12;
      const infoLines: { text: string; color: typeof MUTED }[] = [];
      const filt = meta.filterSummary.length ? `Filtreler: ${meta.filterSummary.map((f) => `${f.label}: ${f.value}`).join("  ·  ")}` : "Filtreler: yok (tüm kayıtlar)";
      for (const l of wrapText(safe(filt), font, 8, usableW, 3)) infoLines.push({ text: l, color: MUTED });
      infoLines.push({ text: safe(`Satır sayısı: ${meta.rowCount}`), color: MUTED });
      if (meta.truncated) infoLines.push({ text: safe("UYARI: Güvenlik sınırı nedeniyle kayıtların yalnızca ilk bölümü gösteriliyor. Tamamı için filtreyi daraltın veya Excel/CSV seçin."), color: WARN });
      if (meta.personalData) infoLines.push({ text: safe("Bu belge kişisel veri içerir (KVKK). Yetkisiz kişilerle paylaşmayın."), color: WARN });
      for (const l of infoLines) {
        page.drawText(l.text, { x: MARGIN, y: y - 8, size: 8, font, color: l.color });
        y -= 11;
      }
      y -= 6;
    } else {
      page.drawText(fitOneLine(safe(meta.title), font, 8, usableW), { x: MARGIN, y: pageH - MARGIN - 6, size: 8, font, color: MUTED });
      y = pageH - MARGIN - 16;
    }
    y = drawHeaderRow(page, y);
  };

  newPage(true);
  const footerSpace = 30;
  const colTypes = table.columns.map((c) => c.type);

  const cellLines = (row: CellValue[]): string[][] =>
    row.map((v, i) => {
      const text = safe(displayValue(v, table.columns[i]!));
      if (colTypes[i] === "text") return wrapText(text, font, fontSize, colW[i]! - CELL_PAD_X * 2, MAX_LINES);
      return [fitOneLine(text, font, fontSize, colW[i]! - CELL_PAD_X * 2)];
    });

  const drawRow = (lines: string[][], zebra: boolean, bold = false) => {
    const h = Math.max(1, ...lines.map((l) => l.length)) * lineH + CELL_PAD_Y * 2;
    if (y - h < MARGIN + footerSpace) newPage(false);
    if (zebra) page.drawRectangle({ x: MARGIN, y: y - h, width: usableW, height: h, color: ZEBRA });
    lines.forEach((ls, i) => {
      const a = align(colTypes[i]!);
      ls.forEach((ln, li) => {
        const w = font.widthOfTextAtSize(ln, fontSize);
        const x = a === "right" ? colX[i]! + colW[i]! - CELL_PAD_X - w : a === "center" ? colX[i]! + (colW[i]! - w) / 2 : colX[i]! + CELL_PAD_X;
        const yy = y - CELL_PAD_Y - fontSize - li * lineH + 1.5;
        if (bold) drawBold(page, ln, x, yy, fontSize);
        else page.drawText(ln, { x, y: yy, size: fontSize, font, color: INK });
      });
    });
    page.drawLine({ start: { x: MARGIN, y: y - h }, end: { x: MARGIN + usableW, y: y - h }, thickness: 0.4, color: LINE });
    y -= h;
  };

  if (table.rows.length === 0) {
    page.drawText(safe("Seçilen filtrelerle eşleşen kayıt bulunamadı."), { x: MARGIN + CELL_PAD_X, y: y - 18, size: 9, font, color: MUTED });
  }
  table.rows.forEach((row, idx) => drawRow(cellLines(row), idx % 2 === 1));

  const totals = computeTotals(table.columns, table.rows);
  if (totals.some((t) => t !== null)) {
    const totalRow = totals.map((t, i) => (t !== null ? t : i === 0 ? "TOPLAM" : ""));
    const lines = totalRow.map((v, i) => [fitOneLine(safe(displayValue(v, i === 0 && typeof v === "string" ? { type: "text" } : table.columns[i]!)), font, fontSize, colW[i]! - CELL_PAD_X * 2)]);
    drawRow(lines, false, true);
  }

  // Alt bilgi: sayfa numaraları
  const n = pages.length;
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: MARGIN, y: MARGIN + 14 }, end: { x: pageW - MARGIN, y: MARGIN + 14 }, thickness: 0.4, color: LINE });
    p.drawText(fitOneLine(safe(`EmlakSoft  ·  ${meta.title}`), font, 7.5, usableW - 90), { x: MARGIN, y: MARGIN + 3, size: 7.5, font, color: MUTED });
    const label = `Sayfa ${i + 1} / ${n}`;
    p.drawText(label, { x: pageW - MARGIN - font.widthOfTextAtSize(label, 7.5), y: MARGIN + 3, size: 7.5, font, color: MUTED });
  });

  return doc.save();
}
