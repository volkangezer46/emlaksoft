import { afterEach, describe, expect, it } from "vitest";
import { buildNilveraAmounts, createNilveraAdapter } from "./nilvera";
import { installFakeFetch, restoreFetch, SAMPLE_DRAFT } from "./test-support";

afterEach(() => restoreFetch());

const COMPANY = { Name: "Demo Emlak Ltd.", TaxNumber: "9876543210", TaxOffice: "Beşiktaş", Address: "Barbaros Bul. 5", City: "İstanbul", District: "Beşiktaş" };
const KEY = "NILVERA-TEST-KEY-1234567890";

describe("nilvera adapter", () => {
  it("bağlantı testi Bearer anahtarıyla /general/Company çağırır; sandbox ayrı ana bilgisayardır", async () => {
    const calls = installFakeFetch((c) => (c.url.endsWith("/general/Company") ? { json: COMPANY } : undefined));
    const adapter = createNilveraAdapter({ apiKey: KEY }, "sandbox");
    const res = await adapter.testConnection();
    expect(res).toEqual({ ok: true, value: { company: "Demo Emlak Ltd." } });
    expect(calls[0]!.url).toBe("https://apitest.nilvera.com/general/Company");
    expect(calls[0]!.headers.Authorization).toBe(`Bearer ${KEY}`);
    const live = createNilveraAdapter({ apiKey: KEY }, "live");
    await live.testConnection();
    expect(calls[1]!.url).toBe("https://api.nilvera.com/general/Company");
  });

  it("401 anahtar reddini anlaşılır Türkçe hataya çevirir ve anahtarı sızdırmaz", async () => {
    installFakeFetch(() => ({ status: 401, json: { Message: `Bearer ${KEY} geçersiz` } }));
    const res = await createNilveraAdapter({ apiKey: KEY }, "live").testConnection();
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("unauthorized");
      expect(res.error.message).not.toContain(KEY);
    }
  });

  it("mükellef sorgusu: boş liste e-Arşiv, dolu liste e-Fatura + posta kutusu; 404 = mükellef değil", async () => {
    installFakeFetch((c) => {
      if (c.url.includes("/Check/TaxNumber/1111111111")) return { json: [{ TaxNumber: "1111111111", Name: "urn:mail:defaultpk@x.com", Type: "PK" }] };
      if (c.url.includes("/Check/TaxNumber/2222222222")) return { json: [] };
      return { status: 404 };
    });
    const a = createNilveraAdapter({ apiKey: KEY }, "live");
    expect(await a.lookupTaxpayer("1111111111")).toEqual({ ok: true, value: { isEInvoiceUser: true, alias: "urn:mail:defaultpk@x.com" } });
    expect(await a.lookupTaxpayer("2222222222")).toEqual({ ok: true, value: { isEInvoiceUser: false } });
    expect(await a.lookupTaxpayer("3333333333")).toEqual({ ok: true, value: { isEInvoiceUser: false } });
  });

  it("e-Arşiv akışı: taslak -> ConfirmAndSend -> durum -> iptal", async () => {
    const calls = installFakeFetch((c) => {
      if (c.url.endsWith("/general/Company")) return { json: COMPANY };
      if (c.url.endsWith("/earchive/Draft/Create")) return { json: { UUID: SAMPLE_DRAFT.uuid, InvoiceNumber: "TASLAK-1" } };
      if (c.url.endsWith("/earchive/Draft/ConfirmAndSend")) return { json: "ok" };
      if (c.url.endsWith(`/earchive/Invoices/${SAMPLE_DRAFT.uuid}/Status`)) return { json: { StatusCode: "succeed", ReportStatus: "Reported", CancelStatus: false } };
      if (c.url.endsWith(`/earchive/Invoices/${SAMPLE_DRAFT.uuid}/Cancel`)) return { json: ["ok"] };
      return undefined;
    });
    const a = createNilveraAdapter({ apiKey: KEY }, "sandbox");
    const created = await a.createDraft({ ...SAMPLE_DRAFT, docType: "e-arsiv" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const createCall = calls.find((c) => c.url.endsWith("/earchive/Draft/Create"))!;
    const body = JSON.parse(createCall.body!) as { ArchiveInvoice: { InvoiceInfo: Record<string, unknown>; InvoiceLines: Array<Record<string, unknown>>; CompanyInfo: Record<string, unknown> } };
    expect(body.ArchiveInvoice.InvoiceInfo).toMatchObject({ UUID: SAMPLE_DRAFT.uuid, LineExtensionAmount: 100000, KdvTotal: 20000, PayableAmount: 120000, GeneralKDV20Total: 20000, InvoiceType: "SATIS" });
    expect(body.ArchiveInvoice.InvoiceLines[0]).toMatchObject({ Price: 100000, KDVPercent: 20, KDVTotal: 20000 });
    expect(body.ArchiveInvoice.CompanyInfo).toMatchObject({ TaxNumber: "9876543210", Name: "Demo Emlak Ltd." });
    expect(created.value.number).toBe("TASLAK-1");

    const issued = await a.issue(created.value.ref);
    expect(issued.ok).toBe(true);
    const confirm = calls.find((c) => c.url.endsWith("/earchive/Draft/ConfirmAndSend"))!;
    expect(JSON.parse(confirm.body!)).toEqual([SAMPLE_DRAFT.uuid]);
    if (!issued.ok) return;
    expect(issued.value.ref.issued).toBe(true);

    const st = await a.getStatus(issued.value.ref);
    expect(st).toMatchObject({ ok: true, value: { state: "succeeded" } });
    expect((await a.cancel!(issued.value.ref, "hatalı"))).toEqual({ ok: true, value: undefined });
  });

  it("e-Fatura: posta kutusu olmadan taslak reddedilir; varsa ConfirmAndSend Alias+UUID gönderir; durum eşlemesi", async () => {
    const calls = installFakeFetch((c) => {
      if (c.url.endsWith("/general/Company")) return { json: COMPANY };
      if (c.url.endsWith("/einvoice/Draft/Create")) return { json: { UUID: SAMPLE_DRAFT.uuid, InvoiceNumber: "X1" } };
      if (c.url.endsWith("/einvoice/Draft/ConfirmAndSend")) return { json: [SAMPLE_DRAFT.uuid] };
      if (c.url.endsWith(`/einvoice/Sale/${SAMPLE_DRAFT.uuid}/Status`)) return { json: { InvoiceStatus: { Code: "error", Description: "Hatalı VKN" } } };
      return undefined;
    });
    const a = createNilveraAdapter({ apiKey: KEY }, "live");
    const noAlias = await a.createDraft({ ...SAMPLE_DRAFT, docType: "e-fatura" });
    expect(noAlias.ok).toBe(false);
    const created = await a.createDraft({ ...SAMPLE_DRAFT, docType: "e-fatura", alias: "urn:mail:pk@x.com" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const issued = await a.issue(created.value.ref);
    expect(issued.ok).toBe(true);
    const confirm = calls.find((c) => c.url.endsWith("/einvoice/Draft/ConfirmAndSend"))!;
    expect(JSON.parse(confirm.body!)).toEqual([{ Alias: "urn:mail:pk@x.com", UUID: SAMPLE_DRAFT.uuid }]);
    if (!issued.ok) return;
    const st = await a.getStatus(issued.value.ref);
    expect(st).toMatchObject({ ok: true, value: { state: "failed", reason: "Hatalı VKN" } });
    // e-Fatura iptali API'de yok -> açık "desteklenmiyor"
    const c = await a.cancel!(issued.value.ref, "x");
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.error.code).toBe("not_supported");
  });

  it("desteklenmeyen KDV oranı ve e-SMM açık hata verir (ağ çağrısı yapılmadan)", async () => {
    const calls = installFakeFetch(() => ({ json: COMPANY }));
    const a = createNilveraAdapter({ apiKey: KEY }, "live");
    const smm = await a.createDraft({ ...SAMPLE_DRAFT, docType: "e-smm" });
    expect(smm).toMatchObject({ ok: false, error: { code: "not_supported" } });
    const zero = await a.createDraft({ ...SAMPLE_DRAFT, docType: "e-arsiv", lines: [{ description: "x", quantity: 1, unitPrice: 10, vatRate: 0 }] });
    expect(zero).toMatchObject({ ok: false, error: { code: "not_supported" } });
    expect(calls).toHaveLength(0);
    expect(buildNilveraAmounts({ ...SAMPLE_DRAFT, docType: "e-arsiv", lines: [{ description: "x", quantity: 2, unitPrice: 50, vatRate: 10 }] })).toMatchObject({
      ok: true,
      value: { totals: { LineExtensionAmount: 100, GeneralKDV10Total: 10, KdvTotal: 10, PayableAmount: 110, GeneralKDV20Total: 0 } },
    });
  });

  it("PDF: ikili PDF ve JSON içinde base64 kabul edilir; PDF olmayan yanıt reddedilir", async () => {
    const pdf = new TextEncoder().encode("%PDF-1.4 test");
    const b64 = Buffer.from(pdf).toString("base64");
    installFakeFetch((c) => {
      if (c.url.includes("/Draft/")) return { json: b64 };
      if (c.url.includes("/Invoices/")) return { bytes: pdf };
      return { text: "html degil pdf degil", headers: { "content-type": "text/plain" } };
    });
    const a = createNilveraAdapter({ apiKey: KEY }, "live");
    const draftPdf = await a.getPdf({ externalId: SAMPLE_DRAFT.uuid, docType: "e-arsiv", issued: false });
    expect(draftPdf.ok && draftPdf.value.bytes?.byteLength).toBe(pdf.byteLength);
    const issuedPdf = await a.getPdf({ externalId: SAMPLE_DRAFT.uuid, docType: "e-arsiv", issued: true });
    expect(issuedPdf.ok).toBe(true);
    const bad = await a.getPdf({ externalId: SAMPLE_DRAFT.uuid, docType: "e-fatura", issued: true });
    expect(bad).toMatchObject({ ok: false, error: { code: "invalid_response" } });
  });

  it("kullanıcı yönlendirilmiş/izinsiz ana bilgisayara çağrı yapılmaz (yalnız sabit izin listesi)", async () => {
    const calls = installFakeFetch(() => ({ json: COMPANY }));
    await createNilveraAdapter({ apiKey: KEY }, "live").testConnection();
    for (const c of calls) expect(["api.nilvera.com", "apitest.nilvera.com"]).toContain(new URL(c.url).hostname);
  });
});
