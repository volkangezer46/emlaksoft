import "server-only";
import { parseGibQr } from "../karekod";
import { parseUblInvoice } from "../ubl";
import { parseReceiptText } from "../text-parser";
import type { LayerFields, LayerReport } from "../types";
import { prepareForOcr, rawToPng, scanImageForQr, type QrBox } from "./image";
import { ocrImage } from "./ocr";
import { runSandboxed, SandboxBusyError, SandboxTimeoutError } from "./sandbox";

/**
 * YEREL okuma hattı (dış servis YOK; dosya sunucudan çıkmaz). Sıra: XML → PDF (metin katmanı + gömülü karekod görseli
 * + metinsiz taranmış sayfa için OCR) → görsel (karekod taraması, ardından OCR). Toplam süre bütçesi aşılırsa kalan
 * katmanlar "skipped: time" olur; o ana kadarki sonuç döner.
 *
 * Dönen `textLines` YALNIZ bellekte kalır (yapay zekâ katmanına metin vermek için); saklanmaz, loglanmaz (KVKK).
 */

export type LocalResult = { layers: LayerFields[]; reports: LayerReport[]; textLines: string[] | null };

const PDF_TIMEOUT_MS = 12_000;
const QR_TIMEOUT_MS = 6_000;
const OCR_TIMEOUT_MS = 20_000;

type PdfResult = {
  lines: string[];
  pages: number;
  qr: { gib: string | null; found: string[]; tried: number };
  image: { data: Uint8Array; width: number; height: number; channels: 1 | 3 | 4 } | null;
};

function reasonOf(e: unknown): string {
  if (e instanceof SandboxBusyError) return "busy";
  if (e instanceof SandboxTimeoutError) return "timeout";
  return "error";
}

const nonEmpty = (f: LayerFields) => Object.keys(f).length > 0;

export async function runLocalPipeline(input: { type: string; bytes: Uint8Array; budgetMs?: number }): Promise<LocalResult> {
  const started = Date.now();
  const budget = input.budgetMs ?? 28_000;
  const left = () => budget - (Date.now() - started);
  const layers: LayerFields[] = [];
  const reports: LayerReport[] = [];
  let textLines: string[] | null = null;

  const runOcr = async (png: Buffer, tall: boolean) => {
    if (left() < 2_000) {
      reports.push({ source: "ocr", status: "skipped", reason: "time" });
      return;
    }
    const t0 = Date.now();
    const r = await ocrImage(png, { timeoutMs: Math.min(OCR_TIMEOUT_MS, left()), psm: tall ? 4 : 3 });
    if (r.status === "done") {
      let lines = r.lines;
      let f = parseReceiptText({ lines, source: "ocr", quality: r.quality });
      // Sayfa çözümlemesi satır atmışsa (toplam yok) tek blok kipinde (PSM 6) ikinci tur; daha çok alan veren seçilir.
      if (!f.total && left() > 4_000) {
        const r2 = await ocrImage(png, { timeoutMs: Math.min(OCR_TIMEOUT_MS, left()), psm: 6 });
        if (r2.status === "done") {
          const f2 = parseReceiptText({ lines: r2.lines, source: "ocr", quality: r2.quality });
          if (Object.keys(f2).length > Object.keys(f).length || (f2.total && !f.total)) {
            f = f2;
            lines = r2.lines;
          }
        }
      }
      textLines = textLines ?? lines;
      layers.push(f);
      reports.push({ source: "ocr", status: nonEmpty(f) ? "done" : "empty", ms: Date.now() - t0 });
    } else reports.push({ source: "ocr", status: r.status === "skipped" ? "skipped" : "failed", reason: r.reason, ms: Date.now() - t0 });
  };

  if (input.type === "application/xml") {
    const t0 = Date.now();
    const xml = new TextDecoder("utf-8", { fatal: false }).decode(input.bytes);
    const r = parseUblInvoice(xml);
    if (r.ok) {
      layers.push(r.fields);
      reports.push({ source: "xml", status: nonEmpty(r.fields) ? "done" : "empty", ms: Date.now() - t0 });
    } else reports.push({ source: "xml", status: "failed", reason: r.reason, ms: Date.now() - t0 });
    return { layers, reports, textLines: null };
  }

  if (input.type === "application/pdf") {
    const t0 = Date.now();
    let pdf: PdfResult | null = null;
    try {
      pdf = await runSandboxed<PdfResult>({ kind: "pdf", bytes: input.bytes, maxPages: 3 }, { timeoutMs: Math.min(PDF_TIMEOUT_MS, left()), maxOldMb: 384 });
    } catch (e) {
      reports.push({ source: "pdf-text", status: "failed", reason: reasonOf(e), ms: Date.now() - t0 });
    }
    if (pdf) {
      const qr = pdf.qr.gib ? parseGibQr(pdf.qr.gib) : null;
      if (qr) {
        layers.push(qr);
        reports.push({ source: "karekod", status: "done", ms: Date.now() - t0 });
      } else reports.push({ source: "karekod", status: pdf.qr.tried ? "empty" : "skipped", reason: pdf.qr.tried ? undefined : "no_image" });
      if (pdf.lines.join("").length >= 40) {
        const f = parseReceiptText({ lines: pdf.lines, source: "pdf-text" });
        textLines = pdf.lines;
        layers.push(f);
        reports.push({ source: "pdf-text", status: nonEmpty(f) ? "done" : "empty", ms: Date.now() - t0 });
      } else {
        reports.push({ source: "pdf-text", status: "empty", reason: "no_text_layer", ms: Date.now() - t0 });
        if (pdf.image) {
          let pdfMask: QrBox | undefined;
          try {
            const png = await rawToPng(pdf.image);
            if (!qr) {
              const scan = await scanImageForQr(png, Math.min(QR_TIMEOUT_MS, left())).catch(() => null);
              const fromScan = scan?.gib ? parseGibQr(scan.gib) : null;
              if (fromScan) {
                layers.push(fromScan);
                reports.push({ source: "karekod", status: "done" });
              }
              pdfMask = scan?.box;
            }
            const prepared = await prepareForOcr(png, pdfMask);
            await runOcr(prepared.png, prepared.tall);
          } catch {
            reports.push({ source: "ocr", status: "failed", reason: "error" });
          }
        }
      }
    }
    return { layers, reports, textLines };
  }

  // Görsel
  const tq = Date.now();
  let mask: QrBox | undefined;
  try {
    const scan = await scanImageForQr(input.bytes, Math.min(QR_TIMEOUT_MS, left()));
    const qr = scan.gib ? parseGibQr(scan.gib) : null;
    if (qr) layers.push(qr);
    mask = scan.box;
    reports.push({ source: "karekod", status: qr ? "done" : "empty", ms: Date.now() - tq });
  } catch (e) {
    reports.push({ source: "karekod", status: "failed", reason: reasonOf(e), ms: Date.now() - tq });
  }
  try {
    const prepared = await prepareForOcr(input.bytes, mask);
    await runOcr(prepared.png, prepared.tall);
  } catch {
    reports.push({ source: "ocr", status: "failed", reason: "error" });
  }
  return { layers, reports, textLines };
}
