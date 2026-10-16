import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { invoicePdf, qrPng, receiptJpeg } from "../__fixtures__/make";
import { UBL_SAMPLE } from "../ubl.test";
import { assembleExtraction } from "../assemble";
import { runLocalPipeline } from "./pipeline";
import { Gate, runSandboxed, SandboxBusyError, SandboxTimeoutError } from "./sandbox";

/**
 * Uçtan uca YEREL hat (dış servis yok): üretilmiş GİB karekodlu fiş fotoğrafı, metin katmanlı + gömülü karekodlu
 * e-Arşiv PDF'i, UBL-TR XML. Tesseract Türkçe modeli paketten (ağsız) yüklenir.
 */

const QR = JSON.stringify({
  vkntckn: "4810058590",
  avkntckn: "3130557669",
  senaryo: "EARSIVFATURA",
  tip: "SATIS",
  tarih: "2026-09-12",
  no: "GIB2026000000123",
  ettn: "04e26a62-7c00-46d0-878c-6f7c60834525",
  parabirimi: "TRY",
  malhizmettoplam: "1000.00",
  "kdvmatrah(20)": "1000.00",
  "hesaplanankdv(20)": "200.00",
  vergidahil: "1200.00",
  odenecek: "1200.00",
});

const FUEL = [
  "ÖZ ANADOLU PETROL ÜRÜNLERİ",
  "TİC. LTD. ŞTİ.",
  "ATATÜRK CAD. NO:12 ÇANKAYA/ANKARA",
  "ÇANKAYA V.D. 4810058590",
  "TARİH : 12.09.2026  SAAT : 14:32",
  "FİŞ NO : 0042",
  "KURŞUNSUZ 95       %20   *1.250,00",
  "TOPKDV                  *208,33",
  "TOPLAM                *1.250,00",
  "KREDİ KARTI           *1.250,00",
  "Z NO : 0123   EKÜ NO : 0001",
];

const TODAY = "2026-10-16";
const values = (fields: object) => Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, (v as { value: unknown }).value]));

describe("yerel okuma hattı", () => {
  it("fiş fotoğrafı: karekod (eğik, bulanık) + yerel OCR birleşir; karekod önceliklidir", async () => {
    const jpg = await receiptJpeg(FUEL, { qr: await qrPng(QR, 4), blur: 0.5, rotate: 2 });
    const r = await runLocalPipeline({ type: "image/jpeg", bytes: new Uint8Array(jpg) });
    expect(r.reports.find((l) => l.source === "karekod")?.status).toBe("done");
    expect(r.reports.find((l) => l.source === "ocr")?.status).toBe("done");
    const x = assembleExtraction({ layers: r.layers, reports: r.reports, todayIso: TODAY, nowIso: "", ai: "off" });
    expect(x.fields.total).toMatchObject({ value: 1200, source: "karekod" });
    expect(x.fields.ettn?.value).toBe("04e26a62-7c00-46d0-878c-6f7c60834525");
    // OCR katmanı karekodda olmayan unvanı tamamlar.
    expect(x.fields.sellerName?.source).toBe("ocr");
    expect(x.fields.sellerName?.value).toMatch(/ANADOLU PETROL/);
    // Fikstürde basılı toplam (1.250) karekoddan (1.200) farklı: karekod kazanır; OCR yeterince güvenliyse çelişki uyarısı çıkar.
    const ocrTotal = r.layers.find((l) => l.total?.source === "ocr")?.total;
    expect(ocrTotal?.value).toBe(1250);
    if ((ocrTotal?.confidence ?? 0) >= 0.6) expect(x.warnings.some((w) => w.code === "conflict" && w.field === "total")).toBe(true);
  }, 60_000);

  it("karekodsuz ÖKC fişi: yalnız OCR ile toplam, KDV, tarih, VKN", async () => {
    const jpg = await receiptJpeg(FUEL, { blur: 0.4, rotate: -1.5 });
    const r = await runLocalPipeline({ type: "image/jpeg", bytes: new Uint8Array(jpg) });
    const v = values(r.layers.find((l) => l.total?.source === "ocr") ?? {});
    expect(v.total).toBe(1250);
    expect(v.vatTotal).toBe(208.33);
    expect(v.date).toBe("2026-09-12");
    expect(v.sellerTaxId).toBe("4810058590");
    expect(r.textLines?.length).toBeGreaterThan(5);
  }, 60_000);

  it("büyük fotoğrafta küçük karekod kırpımlarla bulunur", async () => {
    const qr = await qrPng(QR, 3);
    const big = await sharp({ create: { width: 3000, height: 4000, channels: 3, background: "#ece7dc" } })
      .composite([{ input: qr, top: 3300, left: 2300 }])
      .jpeg({ quality: 80 })
      .toBuffer();
    const r = await runLocalPipeline({ type: "image/jpeg", bytes: new Uint8Array(big), budgetMs: 25_000 });
    expect(r.reports.find((l) => l.source === "karekod")?.status).toBe("done");
    expect(values(r.layers[0]!).total).toBe(1200);
  }, 60_000);

  it("e-Arşiv PDF: metin katmanı + gömülü karekod görseli (yalıtılmış iş parçacığında)", async () => {
    const pdf = await invoicePdf(
      [
        { text: "ORNEK BILISIM HIZMETLERI A.S.", x: 40, y: 800, size: 11 },
        { text: "Vergi Dairesi: KAVAKLIDERE  VKN: 4810058590", x: 40, y: 772 },
        { text: "e-ARSIV FATURA", x: 260, y: 740, size: 13 },
        { text: "SAYIN", x: 40, y: 700 },
        { text: "DEMO EMLAK GAYRIMENKUL LTD. STI.", x: 40, y: 688 },
        { text: "Fatura No:", x: 380, y: 700 },
        { text: "GIB2026000000123", x: 460, y: 700 },
        { text: "Fatura Tarihi:", x: 380, y: 688 },
        { text: "12-09-2026", x: 460, y: 688 },
        { text: "Mal Hizmet Toplam Tutari", x: 330, y: 540 },
        { text: "1.000,00 TL", x: 480, y: 540 },
        { text: "Hesaplanan KDV(%20)", x: 330, y: 528 },
        { text: "200,00 TL", x: 480, y: 528 },
        { text: "Odenecek Tutar", x: 330, y: 504 },
        { text: "1.200,00 TL", x: 480, y: 504 },
      ],
      await qrPng(QR, 4),
    );
    const r = await runLocalPipeline({ type: "application/pdf", bytes: new Uint8Array(pdf) });
    expect(r.reports.map((l) => `${l.source}:${l.status}`)).toEqual(["karekod:done", "pdf-text:done"]);
    const x = assembleExtraction({ layers: r.layers, reports: r.reports, todayIso: TODAY, nowIso: "", ai: "off" });
    expect(values(x.fields)).toMatchObject({ total: 1200, net: 1000, vatTotal: 200, date: "2026-09-12", documentNo: "GIB2026000000123", sellerName: "ORNEK BILISIM HIZMETLERI A.S.", sellerTaxId: "4810058590" });
    expect(x.fields.total!.confidence).toBeGreaterThanOrEqual(0.99);
    expect(x.warnings.filter((w) => w.code === "conflict")).toEqual([]);
  }, 60_000);

  it("bozuk PDF hattı düşürmez; XML kesin okunur", async () => {
    const broken = new TextEncoder().encode("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF");
    const bad = await runLocalPipeline({ type: "application/pdf", bytes: broken });
    expect(bad.layers).toEqual([]);
    expect(bad.reports[0]).toMatchObject({ source: "pdf-text", status: "failed" });
    const xml = await runLocalPipeline({ type: "application/xml", bytes: new TextEncoder().encode(UBL_SAMPLE) });
    expect(xml.reports).toMatchObject([{ source: "xml", status: "done" }]);
    expect(values(xml.layers[0]!).total).toBe(1605);
    expect(xml.textLines).toBeNull();
  }, 60_000);
});

describe("yalıtım", () => {
  it("süre aşımında iş parçacığı kesilir", async () => {
    const big = { data: new Uint8Array(4000 * 4000), width: 4000, height: 4000, channels: 1 as const };
    await expect(runSandboxed({ kind: "qr", images: [big, big, big] }, { timeoutMs: 50 })).rejects.toBeInstanceOf(SandboxTimeoutError);
  }, 30_000);

  it("kapı: eşzamanlılık ve kuyruk sınırı", async () => {
    const gate = new Gate(1, 1);
    let release!: () => void;
    const first = gate.run(() => new Promise<void>((r) => (release = r)));
    const second = gate.run(async () => "ikinci");
    await expect(gate.run(async () => "üçüncü")).rejects.toBeInstanceOf(SandboxBusyError);
    release();
    await first;
    await expect(second).resolves.toBe("ikinci");
  });
});
