import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  RECEIPT_OCR_REQUEST_LIMIT_BYTES,
  fitsReceiptOcrRequest,
  parseReceiptDate,
  parseReceiptResponse,
  parseTrAmount,
  parseVatRate,
  parseVendor,
  safeObjectName,
  shouldRunReceiptOcr,
  suggestionFieldCount,
} from "./parse-receipt";

const read = (f: string) => readFileSync(resolve(process.cwd(), f), "utf8");

describe("parseTrAmount", () => {
  it("Türkçe ve İngilizce biçimleri okur", () => {
    expect(parseTrAmount("1.250,50")).toBe(1250.5);
    expect(parseTrAmount("1,250.50")).toBe(1250.5);
    expect(parseTrAmount("₺ 4.500")).toBe(4500);
    expect(parseTrAmount("12.345.678,9")).toBe(12345678.9);
    expect(parseTrAmount("99,9")).toBe(99.9);
    expect(parseTrAmount("1,250")).toBe(1250);
    expect(parseTrAmount("1250.5")).toBe(1250.5);
    expect(parseTrAmount(320.456)).toBe(320.46);
  });
  it("belirsiz, negatif ya da sıfır değeri reddeder", () => {
    expect(parseTrAmount(null)).toBeNull();
    expect(parseTrAmount("")).toBeNull();
    expect(parseTrAmount("-50")).toBeNull();
    expect(parseTrAmount("0")).toBeNull();
    expect(parseTrAmount("12,3456")).toBeNull();
    expect(parseTrAmount("abc")).toBeNull();
    expect(parseTrAmount(1e12)).toBeNull();
  });
});

describe("parseReceiptDate", () => {
  const today = "2026-10-13";
  it("gün.ay.yıl ve ISO biçimlerini okur", () => {
    expect(parseReceiptDate("12.05.2026", today)).toBe("2026-05-12");
    expect(parseReceiptDate("1/2/26", today)).toBe("2026-02-01");
    expect(parseReceiptDate("2026-10-01", today)).toBe("2026-10-01");
    expect(parseReceiptDate("13.10.2026 14:32", today)).toBe("2026-10-13");
  });
  it("geçersiz takvim günü ve uzak gelecek reddedilir", () => {
    expect(parseReceiptDate("31.02.2026", today)).toBeNull();
    expect(parseReceiptDate("20.12.2026", today)).toBeNull();
    expect(parseReceiptDate("15.10.2026", today)).toBe("2026-10-15");
    expect(parseReceiptDate("16.10.2026", today)).toBeNull();
    expect(parseReceiptDate("dün", today)).toBeNull();
  });
});

describe("parseVatRate / parseVendor", () => {
  it("yalnız %1, %10, %20 kabul edilir", () => {
    expect(parseVatRate("%20")).toBe(20);
    expect(parseVatRate(10)).toBe(10);
    expect(parseVatRate("0,01")).toBe(1);
    expect(parseVatRate(0.2)).toBe(20);
    expect(parseVatRate(18)).toBeNull();
    expect(parseVatRate("8")).toBeNull();
    expect(parseVatRate(null)).toBeNull();
  });
  it("satıcı adını temizler, maske yer tutucusunu reddeder", () => {
    expect(parseVendor("  ABC  Kırtasiye‎ Ltd. ")).toBe("ABC Kırtasiye Ltd.");
    expect(parseVendor("[TELEFON_1]")).toBeNull();
    expect(parseVendor("x")).toBeNull();
    expect(parseVendor("null")).toBeNull();
    expect(parseVendor("a".repeat(300))?.length).toBe(120);
  });
});

describe("parseReceiptResponse", () => {
  it("geçerli yanıt öneriye çevrilir; uydurma alan eklenmez", () => {
    const s = parseReceiptResponse('```json\n{"toplam":"1.180,00","tarih":"10.10.2026","kdv_orani":20,"satici":"Ofis Market"}\n```', "2026-10-13");
    expect(s).toEqual({ amount: 1180, date: "2026-10-10", vatRate: 20, vendor: "Ofis Market" });
    expect(suggestionFieldCount(s)).toBe(4);
  });
  it("null ya da bozuk yanıt boş öneri döner", () => {
    expect(parseReceiptResponse('{"toplam":null,"tarih":null,"kdv_orani":null,"satici":null}', "2026-10-13")).toEqual({});
    expect(parseReceiptResponse("not json", "2026-10-13")).toEqual({});
    expect(parseReceiptResponse("[1,2]", "2026-10-13")).toEqual({});
    expect(parseReceiptResponse(null, "2026-10-13")).toEqual({});
    expect(suggestionFieldCount({})).toBe(0);
  });
});

describe("shouldRunReceiptOcr (varsayılan kapalı)", () => {
  it("ayar kapalıyken hiçbir koşulda çalışmaz", () => {
    expect(shouldRunReceiptOcr({ enabled: false, fileType: "image/jpeg", quotaOpen: true })).toBe(false);
  });
  it("PDF ve kota dolu iken çalışmaz", () => {
    expect(shouldRunReceiptOcr({ enabled: true, fileType: "application/pdf", quotaOpen: true })).toBe(false);
    expect(shouldRunReceiptOcr({ enabled: true, fileType: "image/png", quotaOpen: false })).toBe(false);
    expect(shouldRunReceiptOcr({ enabled: true, fileType: "image/webp", quotaOpen: true })).toBe(true);
  });
});

describe("fitsReceiptOcrRequest (istek sınırı)", () => {
  it("küçük görsel sığar, ~8,9 MB üstü sığmaz; sınır openai-client ile aynı", () => {
    expect(fitsReceiptOcrRequest(2 * 1024 * 1024)).toBe(true);
    expect(fitsReceiptOcrRequest(8.5 * 1024 * 1024)).toBe(true);
    expect(fitsReceiptOcrRequest(9.5 * 1024 * 1024)).toBe(false);
    expect(fitsReceiptOcrRequest(10 * 1024 * 1024)).toBe(false);
    expect(fitsReceiptOcrRequest(0)).toBe(false);
    expect(read("src/lib/ai/openai-client.ts")).toMatch(/OPENAI_MAX_REQUEST_BYTES = 12 \* 1024 \* 1024;/);
    expect(RECEIPT_OCR_REQUEST_LIMIT_BYTES).toBe(12 * 1024 * 1024);
  });

  it("sınırı aşan görselde dış çağrı ve kota denetimi yapılmaz", () => {
    const ocr = read("src/lib/finance/receipt/engine/ai.ts");
    const sizeAt = ocr.indexOf('reason: "size"');
    expect(sizeAt).toBeGreaterThan(0);
    expect(ocr.indexOf("canAutoCallAi(")).toBeGreaterThan(sizeAt);
  });
});

describe("safeObjectName", () => {
  it("depolama yolu için güvenli ASCII ad üretir", () => {
    expect(safeObjectName("Fiş Ağustos (2).JPG", "jpg")).toBe("Fis-Agustos-2.jpg");
    expect(safeObjectName("../../etc/passwd", "pdf")).toBe("etc-passwd.pdf");
    expect(safeObjectName("İŞ ödemesi.pdf", "pdf")).toBe("IS-odemesi.pdf");
    expect(safeObjectName("", "png")).toBe("belge.png");
    expect(safeObjectName("a".repeat(200), "pdf")).toMatch(/^a{80}\.pdf$/);
    expect(safeObjectName("x y.pdf", "pdf")).toMatch(/^[A-Za-z0-9._-]{1,120}$/);
  });
});

describe("fiş okuma ve belge ucu sözleşmesi (KVKK m.9, service_role yok)", () => {
  const ai = read("src/lib/finance/receipt/engine/ai.ts");
  const service = read("src/lib/finance/receipt/engine/service.ts");
  const route = read("src/app/api/app/finans/belge/route.ts");
  const aiRoute = read("src/app/api/app/finans/belge/oku/route.ts");

  it("yapay zekâ yalnız openai-client üzerinden; doğrudan api.openai.com / fetch yok", () => {
    expect(ai).toMatch(/from "@\/lib\/ai\/openai-client"/);
    expect(ai).toMatch(/openAiChat\(/);
    for (const src of [ai, service, route, aiRoute]) {
      expect(src).not.toContain("api.openai.com");
      expect(src).not.toMatch(/\bfetch\s*\(/);
      expect(src).not.toMatch(/\bfetchExternal\s*\(/);
    }
    // Denetim (kiracı) bağlamı zorunlu: kredi ölçümü + activity log.
    expect(ai).toMatch(/audit: \{ tenantId: input\.tenantId/);
  });

  it("anahtar yoksa ve kota kapalıysa dış çağrıdan ÖNCE döner", () => {
    const keyAt = ai.indexOf('if (!apiKey) return { status: "unavailable", reason: "no_key" }');
    const quotaAt = ai.indexOf("canAutoCallAi(");
    const callAt = ai.indexOf("await openAiChat(");
    expect(keyAt).toBeGreaterThan(0);
    expect(quotaAt).toBeGreaterThan(keyAt);
    expect(callAt).toBeGreaterThan(quotaAt);
  });

  it("yükleme ucu okumayı yalnız ana anahtar açıkken yapar, yapay zekâyı HİÇ çağırmaz; sonuç yalnız öneri", () => {
    expect(route).toMatch(/const settings = await readReceiptSettings\(/);
    expect(route).toMatch(/if \(settings\.enabled\) \{\s*try \{\s*extraction = await extractOnUpload\(/);
    expect(route).not.toMatch(/readWithAi|extractWithAi/);
    expect(service).toMatch(/Yapay zekâ burada ÇAĞRILMAZ/);
    for (const src of [route, aiRoute, service]) {
      expect(src).not.toMatch(/finance_record_entry/);
      expect(src).not.toMatch(/createAdminClient|supabase\/admin/);
    }
  });

  it("yapay zekâ ucu ayrı onay (ocr_ai_enabled) + anahtar olmadan dış çağrı yapmaz", () => {
    const gateAt = aiRoute.indexOf("if (!settings.aiEnabled || !settings.aiConfigured");
    const callAt = aiRoute.indexOf("await extractWithAi(");
    expect(gateAt).toBeGreaterThan(0);
    expect(callAt).toBeGreaterThan(gateAt);
    expect(aiRoute).toMatch(/requirePermission\("expenses", "create"\)/);
    expect(aiRoute).toMatch(/isSameOriginBridgeRequest\(request\)/);
    expect(service).toMatch(/aiEnabled: d\?\.ocr_enabled === true && d\?\.ocr_ai_enabled === true/);
  });

  it("uç tür, boyut ve kiracı yolunu doğrular; XML betik çalıştıramayan türle saklanır", () => {
    expect(route).toMatch(/verifyDocumentFile\(/);
    expect(route).toMatch(/Dosya en çok 10 MB olabilir\./);
    expect(route).toMatch(/Yalnız JPEG, PNG, WEBP görsel, PDF ya da e-Fatura XML yüklenebilir\./);
    expect(route).toMatch(/<!DOCTYPE\|<!ENTITY/);
    expect(route).toMatch(/contentType: type === "application\/xml" \? "text\/plain" : type/);
    expect(route).toMatch(/`\$\{gate\.tenantId\}\/ledger\/\$\{randomUUID\(\)\}-/);
    expect(route).toMatch(/requirePermission\("expenses", "create"\)/);
    expect(route).toMatch(/isSameOriginBridgeRequest\(request\)/);
  });

  it("ham belge metni saklanmaz ve loglanmaz (yalnız alanlar)", () => {
    const pipeline = read("src/lib/finance/receipt/engine/pipeline.ts");
    expect(service).toMatch(/p_extraction: compact/);
    for (const src of [service, pipeline, route, aiRoute]) expect(src).not.toMatch(/(console|log)\.(log|info|error|warn)\([^)]*(textLines|lines|bytes)/);
  });
});
