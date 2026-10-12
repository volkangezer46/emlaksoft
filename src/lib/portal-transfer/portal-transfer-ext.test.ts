import { describe, expect, it } from "vitest";
import { computeMissingPortals, differenceCards } from "./gaps";
import { PHOTO_MAX_B64, PHOTO_TOTAL_B64_BUDGET, bytesToBase64, photoBudget, photoSummary, scaledSize } from "./photo-prep";
import { extractListingRef, parseListingInput } from "./listing-ref";
import {
  QUEUE_MAX,
  QUEUE_MAX_ATTEMPTS,
  QUEUE_TTL_MS,
  backoffMs,
  doneEntry,
  doneKey,
  dueEntries,
  enqueueEntry,
  failEntry,
  importKey,
  sanitizeDonePayload,
  sanitizeImportPayload,
  sanitizeTransferResponse,
} from "./ext-queue";
import { isTrustedTransferRequest } from "@/lib/listing-control/worker/extension-pairing";
import { parseBridgeMessage, BRIDGE_RESPONSE_SOURCE } from "@/lib/listing-control/worker/bridge";
import { completeOutcomeMessage } from "./complete";

describe("eksik portal ve fark kartları", () => {
  it("yalnız ofisin kullandığı portallar için, yayındaki portföyün o portalda canlı ilanı yoksa sayılır", () => {
    const gaps = computeMissingPortals(
      ["a", "b", "c"],
      [
        { propertyId: "a", portal: "Sahibinden" },
        { propertyId: "b", portal: "sahibinden" },
        { propertyId: "a", portal: "Hepsiemlak" },
        { propertyId: "a", portal: "Zingat" }, // desteklenmeyen portal sayılmaz
      ],
    );
    expect(gaps.map((g) => [g.portal, g.missing])).toEqual([
      ["hepsiemlak", ["b", "c"]],
      ["sahibinden", ["c"]],
    ]);
    expect(gaps.find((g) => g.portal === "sahibinden")!.used).toBe(2);
    expect(gaps.find((g) => g.portal === "emlakjet")).toBeUndefined(); // ofis Emlakjet kullanmıyor: kart yok
  });
  it("hiçbir portalda ilan yoksa ya da eksik yoksa kart yok", () => {
    expect(computeMissingPortals(["a"], [])).toEqual([]);
    expect(computeMissingPortals(["a"], [{ propertyId: "a", portal: "sahibinden" }])).toEqual([]);
  });
  it("fark kartları sıfırsa üretilmez; hedef KPI listesidir", () => {
    const href = (k: string) => `/app/ilan-kontrol/liste?kpi=${k}`;
    expect(differenceCards({ price_mismatch: 0, portal_missing: 0 }, href)).toEqual([]);
    const cards = differenceCards({ price_mismatch: 3, portal_missing: 1 }, href);
    expect(cards.map((c) => [c.key, c.count, c.href])).toEqual([
      ["price", 3, "/app/ilan-kontrol/liste?kpi=price_mismatch"],
      ["status", 1, "/app/ilan-kontrol/liste?kpi=portal_missing"],
    ]);
  });
});

describe("fotoğraf hazırlığı", () => {
  it("küçültme yalnız küçültür, oranı korur", () => {
    expect(scaledSize(4000, 3000)).toEqual({ width: 1600, height: 1200 });
    expect(scaledSize(800, 600)).toEqual({ width: 800, height: 600 });
    expect(scaledSize(0, 10)).toEqual({ width: 0, height: 0 });
  });
  it("bütçe: tek fotoğraf sınırı ve toplam sınır aşılınca alınmaz", () => {
    expect(photoBudget(0, 200_000)).toEqual({ take: true });
    expect(photoBudget(0, PHOTO_MAX_B64 + 1)).toEqual({ take: false, reason: "too_large" });
    expect(photoBudget(PHOTO_TOTAL_B64_BUDGET - 100, 200)).toEqual({ take: false, reason: "over_budget" });
    expect(photoBudget(0, 0).take).toBe(false);
  });
  it("base64 ve özet metni", () => {
    expect(bytesToBase64(new Uint8Array([104, 105]))).toBe("aGk=");
    expect(bytesToBase64(new Uint8Array(100_000)).length).toBeGreaterThan(100_000);
    expect(photoSummary(3, 3)).toBe("3 fotoğraf hazır.");
    expect(photoSummary(2, 5)).toMatch(/2\/5 fotoğraf hazır/);
    expect(photoSummary(0, 0)).toMatch(/yok/);
  });
});

describe("ilan numarası çıkarma", () => {
  it("adresten ve görünür metinden okur; okunamazsa null (tahmin yok)", () => {
    expect(extractListingRef({ url: "https://www.sahibinden.com/ilan/emlak-konut-satilik-kadikoy-moda-1234567890/detay", text: "" })).toMatchObject({ externalId: "1234567890", source: "url" });
    expect(extractListingRef({ url: "https://www.sahibinden.com/ilan-ver/basari", text: "Tebrikler! İlan No: 1098765432 yayında" })).toMatchObject({ externalId: "1098765432", source: "text", url: null });
    expect(extractListingRef({ url: "https://www.sahibinden.com/ilan-ver", text: "Form" })).toBeNull();
  });
  it("kullanıcı girdisi: yalnız numara ya da https bağlantı", () => {
    expect(parseListingInput(" #1234567890 ")).toMatchObject({ externalId: "1234567890" });
    expect(parseListingInput("https://www.emlakjet.com/ilan/satilik-daire-1234567/")).toMatchObject({ externalId: "1234567" });
    expect(parseListingInput("abc")).toBeNull();
    expect(parseListingInput("12345")).toBeNull();
    expect(parseListingInput("javascript:alert(1)")).toBeNull();
  });
});

describe("eklenti kuyruğu", () => {
  const done = (state: "filled" | "published" = "published") => ({
    sessionId: "6f0e4b0e-9d6b-4d34-8f0a-9d2c1f6a7a11",
    portal: "sahibinden",
    state,
    externalId: "1234567890",
    url: "https://www.sahibinden.com/ilan/x-1234567890/detay",
    report: { title: "planned", bad: "x", "Kötü Anahtar": "y" },
  });
  it("yük doğrulaması: geçersiz oturum/portal/durum reddedilir, rapor anahtarları süzülür, http reddedilir", () => {
    const ok = sanitizeDonePayload(done());
    expect(ok).toMatchObject({ portal: "sahibinden", state: "published", externalId: "1234567890" });
    expect(Object.keys(ok!.report)).toEqual(["title", "bad"]);
    expect(sanitizeDonePayload({ ...done(), sessionId: "x" })).toBeNull();
    expect(sanitizeDonePayload({ ...done(), portal: "zingat" })).toBeNull();
    expect(sanitizeDonePayload({ ...done(), state: "deleted" })).toBeNull();
    expect(sanitizeDonePayload({ ...done(), url: "http://x" })).toBeNull();
  });
  it("içe aktarma yükü: tekrar eden ilan no atılır, alanlar sınırlanır, boş liste null", () => {
    const p = sanitizeImportPayload({
      portal: "hepsiemlak",
      items: [
        { externalId: "111111", url: "https://www.hepsiemlak.com/a", title: "A", price: 5, sqm: 5, rooms: "3+1", status: "passive" },
        { externalId: "111111", url: null },
        { externalId: "", url: null },
        { externalId: "222222", url: "http://hepsi" },
      ],
    });
    expect(p!.items).toHaveLength(1);
    expect(p!.items[0]).toMatchObject({ externalId: "111111", price: 5, sqm: null, rooms: "3+1", status: "passive" });
    expect(sanitizeImportPayload({ portal: "zingat", items: [{ externalId: "1" }] })).toBeNull();
    expect(sanitizeImportPayload({ portal: "emlakjet", items: [] })).toBeNull();
    expect(importKey(p!)).toContain("hepsiemlak:111111");
  });
  it("aynı anahtar kuyruğu günceller (çift gönderim yok); üstel geri çekilme; 8 deneme ya da 24 saat sonra düşer; en çok 20", () => {
    const t0 = 1_000_000;
    const a = sanitizeDonePayload(done())!;
    let q = enqueueEntry([], doneKey(a), a, t0, "1");
    q = enqueueEntry(q, doneKey(a), { ...a, externalId: "999999" }, t0 + 5, "2");
    expect(q).toHaveLength(1);
    expect(q[0]!.payload.externalId).toBe("999999");
    expect(dueEntries(q, t0 + 10)).toHaveLength(1);
    q = failEntry(q, "2", t0 + 10);
    expect(dueEntries(q, t0 + 11)).toHaveLength(0);
    expect(dueEntries(q, t0 + 10 + backoffMs(1))).toHaveLength(1);
    expect(backoffMs(30)).toBe(2 * 3_600_000);
    for (let i = 0; i < QUEUE_MAX_ATTEMPTS; i += 1) q = failEntry(q, "2", t0 + 20);
    expect(dueEntries(q, t0 + 10 * 3_600_000)).toHaveLength(0);
    const fresh = enqueueEntry([], "k", a, t0, "3");
    expect(dueEntries(fresh, t0 + QUEUE_TTL_MS + 1)).toHaveLength(0);
    expect(doneEntry(fresh, "3")).toHaveLength(0);
    let many: ReturnType<typeof enqueueEntry<typeof a>> = [];
    for (let i = 0; i < 30; i += 1) many = enqueueEntry(many, `k${i}`, a, t0, `id${i}`);
    expect(many).toHaveLength(QUEUE_MAX);
  });
  it("sunucu paketi doğrulanır: geçersiz oturum / portal / alan yapısı reddedilir; fotoğraf kimlikleri süzülür", () => {
    const sid = "6f0e4b0e-9d6b-4d34-8f0a-9d2c1f6a7a11";
    const mid = "7f0e4b0e-9d6b-4d34-8f0a-9d2c1f6a7a22";
    const ok = sanitizeTransferResponse(
      { sessionId: sid, payload: { portal: "emlakjet", property: { id: "p", code: "ES-1", title: "T" }, fields: { title: "T" }, photos: [{ id: mid, fileName: "a.jpg", type: "image/jpeg" }, { id: "zzz" }] } },
      5,
    );
    expect(ok).toMatchObject({ sessionId: sid, portal: "emlakjet", propertyCode: "ES-1", photosDone: false });
    expect(ok!.photoIds).toHaveLength(1);
    expect(sanitizeTransferResponse({ sessionId: "x", payload: {} }, 5)).toBeNull();
    expect(sanitizeTransferResponse({ sessionId: sid, payload: { portal: "zingat", property: {}, fields: {} } }, 5)).toBeNull();
    expect(sanitizeTransferResponse({ sessionId: sid, payload: { portal: "emlakjet", property: {}, fields: {}, photos: [] } }, 5)!.photosDone).toBe(true);
  });
});

describe("köprü: aktarım iletisi", () => {
  const base = { fromSameWindow: true, eventOrigin: "https://emlaksoft.vercel.app", locationOrigin: "https://emlaksoft.vercel.app", allowedOrigins: ["https://emlaksoft.vercel.app"] };
  const data = { type: "transfer-request", nonce: "abcdef123456", code: "ABCDE-FGHJK" };
  it("yalnız aynı pencere + aynı köken + izinli köken + biçim", () => {
    expect(isTrustedTransferRequest({ ...base, data })).toBe(true);
    expect(isTrustedTransferRequest({ ...base, data: { ...data, code: "abcde fghjk" } })).toBe(true);
    expect(isTrustedTransferRequest({ ...base, fromSameWindow: false, data })).toBe(false);
    expect(isTrustedTransferRequest({ ...base, eventOrigin: "https://evil.example", data })).toBe(false);
    expect(isTrustedTransferRequest({ ...base, locationOrigin: "https://evil.example", eventOrigin: "https://evil.example", data })).toBe(false);
    expect(isTrustedTransferRequest({ ...base, data: { ...data, code: "kısa" } })).toBe(false);
    expect(isTrustedTransferRequest({ ...base, data: { ...data, nonce: "!" } })).toBe(false);
    expect(isTrustedTransferRequest({ ...base, data: { ...data, type: "connect-request" } })).toBe(false);
  });
  it("yanıt iletisi ayrıştırılır, sayılar sınırlanır", () => {
    expect(parseBridgeMessage({ source: BRIDGE_RESPONSE_SOURCE, type: "transfer-response", nonce: "n1", ok: true, photos: 3, total: 4, message: "x" })).toEqual({
      type: "transfer-response",
      nonce: "n1",
      ok: true,
      photos: 3,
      total: 4,
      message: "x",
    });
    expect(parseBridgeMessage({ source: BRIDGE_RESPONSE_SOURCE, type: "transfer-response", nonce: "n1", ok: 1, photos: -5, total: 99999 })).toMatchObject({ ok: false, photos: 0, total: 0 });
    expect(parseBridgeMessage({ source: "baska", type: "transfer-response", nonce: "n1" })).toBeNull();
  });
  it("tamamla sonuç iletileri Türkçe", () => {
    expect(completeOutcomeMessage("bound_to_other_property")).toMatch(/başka bir portföye bağlı/);
    expect(completeOutcomeMessage("expired")).toMatch(/süresi doldu/);
    expect(completeOutcomeMessage("yok")).toBe("İlan bağlanamadı.");
  });
});
