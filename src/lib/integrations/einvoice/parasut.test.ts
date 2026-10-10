import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearParasutTokenCache, createParasutAdapter, parasutAuthorizeWithPassword } from "./parasut";
import { installFakeFetch, restoreFetch, SAMPLE_DRAFT, type RecordedCall } from "./test-support";

const CREDS = { clientId: "cid", clientSecret: "csecret", companyId: "777", refreshToken: "rt-1" };

beforeEach(() => clearParasutTokenCache());
afterEach(() => restoreFetch());

function tokenReply(c: RecordedCall) {
  if (c.url === "https://api.parasut.com/oauth/token") return { json: { access_token: "AT", refresh_token: "rt-2", expires_in: 7200 } };
  return undefined;
}

describe("parasut adapter", () => {
  it("parola ile yetkilendirme yalnız refresh_token döndürür (parola/jeton dönmez)", async () => {
    const calls = installFakeFetch(tokenReply);
    const res = await parasutAuthorizeWithPassword({ clientId: "c", clientSecret: "s", email: "a@b.com", password: "pw!" });
    expect(res).toEqual({ ok: true, value: { refreshToken: "rt-2" } });
    expect(calls[0]!.body).toContain("grant_type=password");
    expect(calls[0]!.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
  });

  it("yanlış parola anlaşılır hatadır", async () => {
    installFakeFetch(() => ({ status: 401, json: { error: "invalid_grant" } }));
    const res = await parasutAuthorizeWithPassword({ clientId: "c", clientSecret: "s", email: "a@b.com", password: "yanlis" });
    expect(res).toMatchObject({ ok: false, error: { code: "unauthorized" } });
  });

  it("erişim jetonu önbelleğe alınır, yenileme jetonu değişirse kancayla bildirilir", async () => {
    const rotated: string[] = [];
    const calls = installFakeFetch((c) => {
      const t = tokenReply(c);
      if (t) return t;
      if (c.url.endsWith("/v4/me")) return { json: { data: { attributes: { name: "Ayşe" } } } };
      if (c.url.includes("/v4/777/contacts")) return { json: { data: [] } };
      return undefined;
    });
    const a = createParasutAdapter(CREDS, { onRefreshTokenRotated: async (t) => void rotated.push(t) });
    const first = await a.testConnection();
    expect(first).toEqual({ ok: true, value: { company: "Paraşüt firma no 777 (Ayşe)" } });
    await a.testConnection();
    expect(calls.filter((c) => c.url.endsWith("/oauth/token"))).toHaveLength(1);
    expect(rotated).toEqual(["rt-2"]);
    expect(calls.find((c) => c.url.endsWith("/v4/me"))!.headers.Authorization).toBe("Bearer AT");
  });

  it("e-Arşiv: cari yoksa oluşturur, fatura kalemleriyle satış faturası açar, e-arşiv işi başlatır, durumu çözer", async () => {
    const calls = installFakeFetch((c) => {
      const t = tokenReply(c);
      if (t) return t;
      if (c.url.includes("/contacts?") && c.method === "GET") return { json: { data: [] } };
      if (c.url.endsWith("/v4/777/contacts") && c.method === "POST") return { status: 201, json: { data: { id: "c1", type: "contacts" } } };
      if (c.url.endsWith("/v4/777/sales_invoices") && c.method === "POST") return { status: 201, json: { data: { id: "si1", attributes: { invoice_no: null } } } };
      if (c.url.endsWith("/v4/777/e_archives") && c.method === "POST") return { status: 201, json: { data: { id: "job9", type: "trackable_jobs" } } };
      if (c.url.includes("/trackable_jobs/job9")) return { json: { data: { attributes: { status: "done" } } } };
      if (c.url.includes("/sales_invoices/si1?include=active_e_document"))
        return {
          json: {
            data: { id: "si1", attributes: { invoice_no: "EAR2026000001" }, relationships: { active_e_document: { data: { id: "ea1", type: "e_archives" } } } },
            included: [{ id: "ea1", type: "e_archives", attributes: { status: "sent" } }],
          },
        };
      return undefined;
    });
    const a = createParasutAdapter(CREDS);
    const created = await a.createDraft({ ...SAMPLE_DRAFT, docType: "e-arsiv" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const contactPost = calls.find((c) => c.url.endsWith("/contacts") && c.method === "POST")!;
    expect(JSON.parse(contactPost.body!).data.attributes).toMatchObject({ name: "Örnek Yapı A.Ş.", tax_number: "1234567890", contact_type: "company", account_type: "customer" });
    const invPost = JSON.parse(calls.find((c) => c.url.endsWith("/sales_invoices") && c.method === "POST")!.body!);
    expect(invPost.data.attributes).toMatchObject({ item_type: "invoice", issue_date: "2026-10-10" });
    expect(invPost.data.relationships.contact.data).toEqual({ id: "c1", type: "contacts" });
    expect(invPost.data.relationships.details.data[0].attributes).toMatchObject({ quantity: 1, unit_price: 100000, vat_rate: 20 });

    const issued = await a.issue(created.value.ref);
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;
    const archPost = JSON.parse(calls.find((c) => c.url.endsWith("/e_archives") && c.method === "POST")!.body!);
    expect(archPost.data.relationships.sales_invoice.data).toEqual({ id: "si1", type: "sales_invoices" });
    expect(issued.value.ref.jobId).toBe("job9");

    const st = await a.getStatus(issued.value.ref);
    expect(st).toMatchObject({ ok: true, value: { state: "succeeded", number: "EAR2026000001", ref: { eDocId: "ea1", eDocType: "e_archives" } } });
  });

  it("e-Fatura: posta kutusu sorgusu, scenario/to gönderimi; iş hatası 'failed' olur", async () => {
    const calls = installFakeFetch((c) => {
      const t = tokenReply(c);
      if (t) return t;
      if (c.url.includes("/e_invoice_inboxes?")) return { json: { data: [{ id: "1", attributes: { vkn: "1234567890", e_invoice_address: "urn:mail:pk@x.com" } }] } };
      if (c.url.endsWith("/e_invoices") && c.method === "POST") return { status: 201, json: { data: { id: "job1" } } };
      if (c.url.includes("/trackable_jobs/job1")) return { json: { data: { attributes: { status: "error", errors: ["VKN geçersiz"] } } } };
      return undefined;
    });
    const a = createParasutAdapter(CREDS);
    expect(await a.lookupTaxpayer("1234567890")).toEqual({ ok: true, value: { isEInvoiceUser: true, alias: "urn:mail:pk@x.com" } });
    const issued = await a.issue({ externalId: "si1", docType: "e-fatura", alias: "urn:mail:pk@x.com", issued: false });
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;
    const body = JSON.parse(calls.find((c) => c.url.endsWith("/e_invoices") && c.method === "POST")!.body!);
    expect(body.data.attributes).toEqual({ scenario: "basic", to: "urn:mail:pk@x.com" });
    expect(body.data.relationships.invoice.data).toEqual({ id: "si1", type: "sales_invoices" });
    const st = await a.getStatus(issued.value.ref);
    expect(st).toMatchObject({ ok: true, value: { state: "failed", reason: "VKN geçersiz" } });
  });

  it("PDF sağlayıcının imzalı adresini döndürür; e-SMM ve iptal açıkça desteklenmez", async () => {
    installFakeFetch((c) => {
      const t = tokenReply(c);
      if (t) return t;
      if (c.url.endsWith("/e_archives/ea1/pdf")) return { json: { data: { attributes: { url: "https://files.example.com/x.pdf", expires_at: "2026-10-11T00:00:00Z" } } } };
      return undefined;
    });
    const a = createParasutAdapter(CREDS);
    const pdf = await a.getPdf({ externalId: "si1", docType: "e-arsiv", issued: true, eDocId: "ea1", eDocType: "e_archives" });
    expect(pdf).toEqual({ ok: true, value: { url: "https://files.example.com/x.pdf" } });
    expect(await a.createDraft({ ...SAMPLE_DRAFT, docType: "e-smm" })).toMatchObject({ ok: false, error: { code: "not_supported" } });
    expect(a.cancel).toBeUndefined();
    expect(a.capabilities.cancelDocTypes).toEqual([]);
  });
});
