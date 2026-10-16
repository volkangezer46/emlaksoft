/**
 * Yalıtılmış iş parçacığı (worker_threads, `eval`) kaynağı: PDF ayrıştırma (pdf.js / unpdf) ve karekod çözme (jsQR).
 *
 * Neden ayrı iş parçacığı: kötü niyetli ya da bozuk bir PDF ana olay döngüsünü kilitleyemesin, bellek sınırı
 * (`resourceLimits`) aşılırsa yalnız bu iş parçacığı ölsün, süre aşımında `terminate()` ile kesilsin. Kod paketleyiciden
 * geçmez; modüller çalışma anında uygulama kökündeki node_modules'tan çözülür (Docker imajına `outputFileTracingIncludes`
 * ile girer). Ağ erişimi yok: pdf.js'e `isEvalSupported: false`, yazı tipi/CMap uzak yükleme kapalı.
 */
export const RECEIPT_WORKER_SOURCE = String.raw`
const { parentPort, workerData } = require("node:worker_threads");
const { createRequire } = require("node:module");
const req = createRequire(workerData.base);

function isGib(text) {
  return typeof text === "string" && /"?\s*vkntckn\s*"?\s*:/.test(text);
}

function toRgba(data, width, height, channels) {
  if (channels === 4) return new Uint8ClampedArray(data.buffer, data.byteOffset, width * height * 4);
  const out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0, j = 0; i < width * height; i++, j += 4) {
    if (channels === 1) { const v = data[i]; out[j] = v; out[j + 1] = v; out[j + 2] = v; }
    else { out[j] = data[i * 3]; out[j + 1] = data[i * 3 + 1]; out[j + 2] = data[i * 3 + 2]; }
    out[j + 3] = 255;
  }
  return out;
}

function scanQr(images) {
  const jsQR = req("jsqr");
  const found = [];
  for (const img of images) {
    const rgba = toRgba(new Uint8Array(img.data), img.width, img.height, img.channels || 4);
    const res = jsQR(rgba, img.width, img.height, { inversionAttempts: "attemptBoth" });
    if (res && res.data) {
      if (!found.includes(res.data)) found.push(res.data);
      if (isGib(res.data)) {
        const l = res.location;
        const xs = [l.topLeftCorner.x, l.topRightCorner.x, l.bottomLeftCorner.x, l.bottomRightCorner.x];
        const ys = [l.topLeftCorner.y, l.topRightCorner.y, l.bottomLeftCorner.y, l.bottomRightCorner.y];
        const box = { index: images.indexOf(img), minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
        return { found, gib: res.data, tried: images.indexOf(img) + 1, box };
      }
    }
  }
  return { found, gib: null, tried: images.length };
}

async function parsePdf(task) {
  const unpdf = req("unpdf");
  const pdf = await unpdf.getDocumentProxy(new Uint8Array(task.bytes), {
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    stopAtErrors: false,
    verbosity: 0,
  });
  const pages = Math.min(pdf.numPages, task.maxPages);
  const lines = [];
  let chars = 0;
  for (let p = 1; p <= pages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const items = [];
    for (const it of tc.items) {
      if (!it || typeof it.str !== "string" || !it.str.trim()) continue;
      const t = it.transform || [1, 0, 0, 1, 0, 0];
      items.push({ s: it.str, x: t[4], y: t[5], h: Math.max(1, Math.hypot(t[2], t[3]) || it.height || 8), w: it.width || 0 });
    }
    // Satır kurma: y'ye göre kümeler (yazı boyunun yarısı tolerans), her satır x'e göre sıralanır.
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    const rows = [];
    for (const it of items) {
      const row = rows.find((r) => Math.abs(r.y - it.y) <= Math.max(2, Math.min(r.h, it.h) * 0.5));
      if (row) { row.items.push(it); row.h = Math.max(row.h, it.h); }
      else rows.push({ y: it.y, h: it.h, items: [it] });
    }
    rows.sort((a, b) => b.y - a.y);
    for (const r of rows) {
      r.items.sort((a, b) => a.x - b.x);
      let s = "";
      let end = null;
      for (const it of r.items) {
        if (end !== null) s += it.x - end > r.h * 2.5 ? "   " : " ";
        s += it.s;
        end = it.x + it.w;
      }
      s = s.replace(/\s+$/, "");
      if (s) { lines.push(s); chars += s.length; }
      if (lines.length >= 600) break;
    }
    page.cleanup();
    if (lines.length >= 600) break;
  }

  // Gömülü görseller: karekod (e-Arşiv PDF'lerinde görsel olarak gömülür) ve metin katmanı yoksa OCR için en büyük görsel.
  const qrImages = [];
  let largest = null;
  for (let p = 1; p <= Math.min(pages, 2); p++) {
    let imgs = [];
    try { imgs = await unpdf.extractImages(pdf, p); } catch { imgs = []; }
    for (const im of imgs.slice(0, 40)) {
      const w = im.width, h = im.height;
      if (!w || !h || w * h > 25e6) continue;
      const ratio = w / h;
      if (ratio > 0.8 && ratio < 1.25 && w >= 40 && w <= 3000) qrImages.push({ data: im.data, width: w, height: h, channels: im.channels });
      if (!largest || w * h > largest.width * largest.height) largest = { data: im.data, width: w, height: h, channels: im.channels };
    }
  }
  const qr = qrImages.length ? scanQr(qrImages) : { found: [], gib: null, tried: 0 };
  const wantImage = chars < 40 && largest && largest.width * largest.height >= 300 * 300;
  const total = pdf.numPages || pages;
  try { if (typeof pdf.destroy === "function") await pdf.destroy(); else if (typeof pdf.cleanup === "function") await pdf.cleanup(); } catch {}
  return { lines, pages: total, qr, image: wantImage ? largest : null };
}

(async () => {
  try {
    const task = workerData.task;
    let result;
    if (task.kind === "pdf") result = await parsePdf(task);
    else if (task.kind === "qr") result = scanQr(task.images);
    else throw new Error("unknown task");
    const transfer = [];
    if (result && result.image && result.image.data && result.image.data.buffer) {
      const copy = new Uint8Array(result.image.data);
      result.image.data = copy;
      transfer.push(copy.buffer);
    }
    parentPort.postMessage({ ok: true, result }, transfer);
  } catch (e) {
    parentPort.postMessage({ ok: false, error: e && e.message ? String(e.message).slice(0, 200) : "error" });
  }
})();
`;
