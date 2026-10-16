import "server-only";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { Gate, moduleBase, SandboxBusyError, SandboxTimeoutError } from "./sandbox";

/**
 * Yerel görsel OCR (Tesseract.js 7, Türkçe "best_int" LSTM modeli). DIŞ SERVİS YOK:
 *  - Model dosyası pakette gelir (`@tesseract.js-data/tur`, imaja `outputFileTracingIncludes` ile girer); çalışma anında
 *    ağdan indirme yapılmaz (`langPath` yerel dizin, `cacheMethod: "none"`).
 *  - Tesseract kendi worker_threads iş parçacığında çalışır; bu modül tek seferde YALNIZ BİR tanıma yapar (kapı 1, kuyruk 2),
 *    süre sınırında iş parçacığı sonlandırılır. Ölçüm (8 çekirdek): ilk yükleme ~0,3 sn, 2000 px fiş ~1-3 sn, ~140 MB RSS.
 *  - Her istekte yeni iş parçacığı açılıp kapatılır: boşta bellek tutulmaz.
 */

const ocrGate = new Gate(1, 2);

type TesseractModule = {
  createWorker: (
    langs: string,
    oem: number,
    options: Record<string, unknown>,
  ) => Promise<{
    setParameters: (p: Record<string, string>) => Promise<unknown>;
    recognize: (image: Buffer) => Promise<{ data: { text: string; confidence: number } }>;
    terminate: () => Promise<unknown>;
  }>;
};

function loadTesseract(): { mod: TesseractModule; langPath: string } | null {
  try {
    const req = createRequire(moduleBase());
    const langPath = path.join(path.dirname(req.resolve("@tesseract.js-data/tur/package.json")), "4.0.0_best_int");
    if (!existsSync(path.join(langPath, "tur.traineddata.gz"))) return null;
    return { mod: req("tesseract.js") as TesseractModule, langPath };
  } catch {
    return null;
  }
}

export type OcrOutcome = { status: "done"; lines: string[]; quality: number; ms: number } | { status: "skipped"; reason: "unavailable" | "busy" } | { status: "failed"; reason: "timeout" | "error" };

/** `psm`: 3 otomatik sayfa düzeni (A4), 4 değişken boyutlu tek sütun (fiş), 6 tek düzgün blok (yedek tur). */
export async function ocrImage(png: Buffer, opts: { timeoutMs: number; psm: 3 | 4 | 6 }): Promise<OcrOutcome> {
  const lib = loadTesseract();
  if (!lib) return { status: "skipped", reason: "unavailable" };
  try {
    return await ocrGate.run(async () => {
      const started = Date.now();
      const worker = await lib.mod.createWorker("tur", 1, { langPath: lib.langPath, cacheMethod: "none", gzip: true, logger: () => undefined, errorHandler: () => undefined });
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await worker.setParameters({ tessedit_pageseg_mode: String(opts.psm), preserve_interword_spaces: "1" });
        const result = await Promise.race([
          worker.recognize(png),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new SandboxTimeoutError()), opts.timeoutMs);
          }),
        ]);
        const lines = result.data.text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 400);
        return { status: "done" as const, lines, quality: Math.max(0, Math.min(1, (result.data.confidence ?? 0) / 100)), ms: Date.now() - started };
      } finally {
        if (timer) clearTimeout(timer);
        await worker.terminate().catch(() => undefined);
      }
    });
  } catch (e) {
    if (e instanceof SandboxBusyError) return { status: "skipped", reason: "busy" };
    if (e instanceof SandboxTimeoutError) return { status: "failed", reason: "timeout" };
    return { status: "failed", reason: "error" };
  }
}
