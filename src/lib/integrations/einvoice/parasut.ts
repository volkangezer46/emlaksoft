/**
 * Paraşüt adaptörü (API v4, https://apidocs.parasut.com/swagger.json). Taban: https://api.parasut.com/v4/{firma_no}.
 * Kimlik: OAuth2. İstemci kimliği/sırrı Paraşüt destekten alınır (destek@parasut.com); ofis kullanıcısı e-posta+parola ile
 * BİR KEZ yetkilendirir (password grant), yalnız `refresh_token` şifreli saklanır — parola ASLA saklanmaz.
 * Erişim jetonu 2 saat geçerlidir; süresi dolmadan yenilenir. Hız sınırı: 10 saniyede 10 istek.
 *
 * RESMİ ŞEMADAN DOĞRULANAN (2026-10-10):
 *  - POST /oauth/token (grant_type=password | refresh_token)         ; GET /v4/me
 *  - GET/POST /{firma}/contacts (filter[tax_number], name, tax_number, tax_office, address, city, district, contact_type, account_type)
 *  - POST /{firma}/sales_invoices (item_type=invoice, issue_date zorunlu; relationships.contact + details[]; detay: quantity, unit_price, vat_rate, description)
 *  - GET  /{firma}/sales_invoices/{id}?include=active_e_document (invoice_no, active_e_document -> e_invoices|e_archives)
 *  - GET  /{firma}/e_invoice_inboxes?filter[vkn]=  (e_invoice_address, name)  -> alıcı e-Fatura mükellefi mi
 *  - POST /{firma}/e_invoices {attributes:{scenario:basic, to}, relationships:{invoice}} -> 201 izlenebilir iş (trackable job)
 *  - POST /{firma}/e_archives {relationships:{sales_invoice}} -> 201 izlenebilir iş
 *  - GET  /{firma}/trackable_jobs/{id} -> status running|done|error, errors[]
 *  - GET  /{firma}/e_invoices/{id} status waiting|failed|successful ; e_archives/{id} status bounced|sent|printed|legalized
 *  - GET  /{firma}/e_invoices/{id}/pdf , e_archives/{id}/pdf -> {data.attributes.url, expires_at}
 *
 * DOĞRULANAMAYAN / DESTEKLENMEYEN (açık hata):
 *  - e-SMM: ön koşulları (hangi cari/fatura türü) belgede yok -> "desteklenmiyor".
 *  - İptal: `DELETE sales_invoices/{id}/cancel` resmileşmiş belge için davranışı belgelenmemiş -> "desteklenmiyor".
 *  - Fatura kaleminde ürün (product) ilişkisi olmadan kalem açıklaması: şemada ürün isteğe bağlı görünüyor; sandbox'ta doğrulanmalı.
 *  - Para birimi kodu Paraşüt'te "TRL" (belgede böyle); resmi belgede TRY'ye çevrilmesi Paraşüt tarafındadır.
 *  - Test ortamı: ayrı sandbox ana bilgisayarı belgelenmemiş; Paraşüt deneme hesabı canlı API'yi kullanır (mode yalnız "live").
 */
import { now } from "@/lib/clock";
import { providerCall } from "./http";
import {
  fail,
  ok,
  type AdapterCapabilities,
  type EInvoiceAdapter,
  type EInvoiceRef,
  type InvoiceDraft,
  type RemoteState,
  type Result,
} from "./types";
import { taxIdKind } from "./invoice-math";

const NAME = "Paraşüt";
const ORIGIN = "https://api.parasut.com";
const TOKEN_SKEW_MS = 5 * 60 * 1000;
const FALLBACK_TOKEN_TTL_MS = 100 * 60 * 1000;

export type ParasutCredentials = {
  clientId: string;
  clientSecret: string;
  companyId: string;
  refreshToken: string;
};

export type ParasutHooks = {
  /** Paraşüt yeni refresh_token döndürürse çağrılır (şifreli yeniden saklama). */
  onRefreshTokenRotated?: (refreshToken: string) => Promise<void>;
};

const CAPABILITIES: AdapterCapabilities = {
  eFatura: true,
  eArsiv: true,
  eSmm: false,
  sandbox: false,
  cancelDocTypes: [],
};

type TokenEntry = { accessToken: string; expiresAt: number };
const tokenCache = new Map<string, TokenEntry>();

export function clearParasutTokenCache(): void {
  tokenCache.clear();
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v : undefined;
}

function rec(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function relId(relationships: unknown, name: string): { id?: string; type?: string } {
  const r = rec(relationships);
  const data = rec(rec(r?.[name])?.data);
  return { id: data?.id !== undefined ? String(data.id) : undefined, type: str(data?.type) };
}

type TokenResponse = { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown };

async function requestToken(form: Record<string, string>): Promise<Result<{ accessToken: string; refreshToken?: string; ttlMs: number }>> {
  const res = await providerCall(NAME, { method: "POST", url: `${ORIGIN}/oauth/token`, form });
  if (!res.ok) {
    // Yanlış parola/istemci: 400/401 -> kullanıcıya anlaşılır mesaj.
    if (res.error.code === "rejected" || res.error.code === "unauthorized") {
      return fail("unauthorized", "Paraşüt oturumu açılamadı. İstemci kimliği/sırrı, e-posta ve parolayı kontrol edin.", res.error.status);
    }
    return res;
  }
  const body = (rec(res.value.json) ?? {}) as TokenResponse;
  const accessToken = str(body.access_token);
  if (!accessToken) return fail("invalid_response", "Paraşüt erişim jetonu döndürmedi.");
  const expiresIn = typeof body.expires_in === "number" && body.expires_in > 0 ? body.expires_in * 1000 : FALLBACK_TOKEN_TTL_MS;
  return ok({ accessToken, refreshToken: str(body.refresh_token), ttlMs: expiresIn });
}

/** Bağlantı kurulumunda tek seferlik: e-posta+parola ile yetkilendir, yalnız refresh_token'ı döndür. */
export async function parasutAuthorizeWithPassword(input: {
  clientId: string;
  clientSecret: string;
  email: string;
  password: string;
}): Promise<Result<{ refreshToken: string }>> {
  const res = await requestToken({
    grant_type: "password",
    client_id: input.clientId,
    client_secret: input.clientSecret,
    username: input.email,
    password: input.password,
    redirect_uri: "urn:ietf:wg:oauth:2.0:oob",
  });
  if (!res.ok) return res;
  if (!res.value.refreshToken) return fail("invalid_response", "Paraşüt yenileme jetonu döndürmedi.");
  return ok({ refreshToken: res.value.refreshToken });
}

function qs(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

export function createParasutAdapter(creds: ParasutCredentials, hooks: ParasutHooks = {}): EInvoiceAdapter {
  const cacheKey = `${creds.companyId}:${creds.clientId}`;
  const root = `${ORIGIN}/v4/${encodeURIComponent(creds.companyId)}`;
  let refreshToken = creds.refreshToken;

  async function accessToken(): Promise<Result<string>> {
    const hit = tokenCache.get(cacheKey);
    if (hit && hit.expiresAt - TOKEN_SKEW_MS > now()) return ok(hit.accessToken);
    const res = await requestToken({
      grant_type: "refresh_token",
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      refresh_token: refreshToken,
    });
    if (!res.ok) return res;
    tokenCache.set(cacheKey, { accessToken: res.value.accessToken, expiresAt: now() + res.value.ttlMs });
    if (res.value.refreshToken && res.value.refreshToken !== refreshToken) {
      refreshToken = res.value.refreshToken;
      try {
        await hooks.onRefreshTokenRotated?.(refreshToken);
      } catch {
        // Saklama hatası bu isteği düşürmez; bir sonraki bağlantı testi yeniden dener.
      }
    }
    return ok(res.value.accessToken);
  }

  async function api(
    method: "GET" | "POST",
    path: string,
    opts: { json?: unknown; allowStatuses?: readonly number[]; global?: boolean } = {},
  ) {
    const token = await accessToken();
    if (!token.ok) return token;
    return providerCall(NAME, {
      method,
      url: `${opts.global ? `${ORIGIN}/v4` : root}${path}`,
      headers: { Authorization: `Bearer ${token.value}` },
      ...(opts.json !== undefined ? { json: opts.json, headers: { Authorization: `Bearer ${token.value}`, "Content-Type": "application/vnd.api+json" } } : {}),
      allowStatuses: opts.allowStatuses,
    });
  }

  async function findOrCreateContact(buyer: InvoiceDraft["buyer"]): Promise<Result<string>> {
    const found = await api("GET", `/contacts?${qs({ "filter[tax_number]": buyer.taxId, "page[size]": "1" })}`);
    if (!found.ok) return found;
    const list = rec(found.value.json)?.data;
    const first = Array.isArray(list) ? rec(list[0]) : null;
    if (first?.id !== undefined) return ok(String(first.id));
    const created = await api("POST", "/contacts", {
      json: {
        data: {
          type: "contacts",
          attributes: {
            name: buyer.name,
            account_type: "customer",
            contact_type: taxIdKind(buyer.taxId) === "vkn" ? "company" : "person",
            tax_number: buyer.taxId,
            tax_office: buyer.taxOffice ?? undefined,
            address: buyer.address ?? undefined,
            city: buyer.city ?? undefined,
            district: buyer.district ?? undefined,
          },
        },
      },
    });
    if (!created.ok) return created;
    const id = rec(rec(created.value.json)?.data)?.id;
    return id !== undefined ? ok(String(id)) : fail("invalid_response", "Paraşüt cari kaydı oluşturmadı.");
  }

  async function activeDocument(salesInvoiceId: string): Promise<
    Result<{ number?: string; docType?: "e_invoices" | "e_archives"; docId?: string; state?: RemoteState; reason?: string }>
  > {
    const res = await api("GET", `/sales_invoices/${encodeURIComponent(salesInvoiceId)}?include=active_e_document`);
    if (!res.ok) return res;
    const body = rec(res.value.json);
    const data = rec(body?.data);
    const number = str(rec(data?.attributes)?.invoice_no);
    const doc = relId(data?.relationships, "active_e_document");
    if (!doc.id) return ok({ number });
    const type = doc.type === "e_archives" ? "e_archives" : doc.type === "e_invoices" ? "e_invoices" : undefined;
    const included = Array.isArray(body?.included) ? body.included.map(rec) : [];
    const edoc = included.find((i) => i && String(i.id) === doc.id && i.type === doc.type);
    const status = str(rec(edoc?.attributes)?.status);
    let state: RemoteState = "waiting";
    if (type === "e_invoices") {
      if (status === "successful") state = "succeeded";
      else if (status === "failed") state = "failed";
    } else if (type === "e_archives") {
      if (status === "bounced") state = "failed";
      else if (status === "sent" || status === "printed" || status === "legalized") state = "succeeded";
    }
    const reason = state === "failed" ? str(rec(edoc?.attributes)?.response_note) ?? str(rec(edoc?.attributes)?.note) : undefined;
    return ok({ number, docType: type, docId: doc.id, state, reason });
  }

  const adapter: EInvoiceAdapter = {
    id: "parasut",
    capabilities: CAPABILITIES,

    async testConnection() {
      // /v4/me firma gerektirmez (oturumun geçerliliğini doğrular).
      const me = await api("GET", "/me", { global: true });
      if (!me.ok) return me;
      // Firma erişimi: tek kayıtlık cari sorgusu.
      const probe = await api("GET", `/contacts?${qs({ "page[size]": "1" })}`);
      if (!probe.ok) {
        if (probe.error.code === "not_found" || probe.error.code === "unauthorized") {
          return fail("unauthorized", "Bu Paraşüt hesabının girilen firma numarasına erişimi yok.", probe.error.status);
        }
        return probe;
      }
      const name = str(rec(rec(rec(me.value.json)?.data)?.attributes)?.name);
      return ok({ company: `Paraşüt firma no ${creds.companyId}${name ? ` (${name})` : ""}` });
    },

    async lookupTaxpayer(taxId) {
      const res = await api("GET", `/e_invoice_inboxes?${qs({ "filter[vkn]": taxId, "page[size]": "1" })}`);
      if (!res.ok) return res;
      const list = rec(res.value.json)?.data;
      const first = Array.isArray(list) ? rec(list[0]) : null;
      const address = str(rec(first?.attributes)?.e_invoice_address);
      return ok({ isEInvoiceUser: Boolean(first), alias: address });
    },

    async createDraft(draft) {
      if (draft.docType === "e-smm") {
        return fail("not_supported", "Paraşüt bağlantısında e-Serbest Meslek Makbuzu desteklenmiyor (ön koşulları belgelenmemiş).");
      }
      if (draft.docType === "e-fatura" && !draft.alias) {
        return fail("invalid_input", "Alıcının e-Fatura posta kutusu bulunamadı. Önce alıcıyı sorgulayın ya da e-Arşiv seçin.");
      }
      const contactId = await findOrCreateContact(draft.buyer);
      if (!contactId.ok) return contactId;
      const res = await api("POST", "/sales_invoices", {
        json: {
          data: {
            type: "sales_invoices",
            attributes: {
              item_type: "invoice",
              issue_date: draft.issueDate,
              due_date: draft.issueDate,
              currency: "TRL",
              description: draft.note?.trim() || undefined,
            },
            relationships: {
              contact: { data: { id: contactId.value, type: "contacts" } },
              details: {
                data: draft.lines.map((line) => ({
                  type: "sales_invoice_details",
                  attributes: {
                    quantity: line.quantity,
                    unit_price: line.unitPrice,
                    vat_rate: line.vatRate,
                    description: line.description,
                  },
                })),
              },
            },
          },
        },
      });
      if (!res.ok) return res;
      const data = rec(rec(res.value.json)?.data);
      if (data?.id === undefined) return fail("invalid_response", "Paraşüt fatura taslağı oluşturmadı.");
      return ok({
        ref: { externalId: String(data.id), docType: draft.docType, alias: draft.alias ?? null, issued: false },
        number: str(rec(data.attributes)?.invoice_no),
      });
    },

    async issue(ref) {
      if (ref.docType === "e-smm") return fail("not_supported", "Paraşüt bağlantısında e-Serbest Meslek Makbuzu desteklenmiyor.");
      const sid = { id: ref.externalId, type: "sales_invoices" };
      const res =
        ref.docType === "e-fatura"
          ? await (async () => {
              if (!ref.alias) return fail("invalid_input", "Alıcının e-Fatura posta kutusu eksik.");
              return api("POST", "/e_invoices", {
                json: {
                  data: {
                    type: "e_invoices",
                    attributes: { scenario: "basic", to: ref.alias },
                    relationships: { invoice: { data: sid } },
                  },
                },
              });
            })()
          : await api("POST", "/e_archives", {
              json: { data: { type: "e_archives", attributes: {}, relationships: { sales_invoice: { data: sid } } } },
            });
      if (!res.ok) return res;
      const jobId = rec(rec(res.value.json)?.data)?.id;
      return ok({ ref: { ...ref, issued: true, jobId: jobId !== undefined ? String(jobId) : null } });
    },

    async getStatus(ref) {
      if (!ref.issued) return ok({ state: "draft" as RemoteState, ref });
      let next: EInvoiceRef = { ...ref };
      if (ref.jobId && !ref.eDocId) {
        const job = await api("GET", `/trackable_jobs/${encodeURIComponent(ref.jobId)}`);
        if (!job.ok) return job;
        const attrs = rec(rec(rec(job.value.json)?.data)?.attributes);
        const status = str(attrs?.status);
        if (status === "error") {
          const errors = Array.isArray(attrs?.errors) ? attrs.errors.filter((e): e is string => typeof e === "string") : [];
          return ok({ state: "failed" as RemoteState, reason: errors.join("; ").slice(0, 300) || "Paraşüt belgeyi oluşturamadı.", ref: next });
        }
        if (status !== "done") return ok({ state: "waiting" as RemoteState, ref: next });
      }
      const doc = await activeDocument(ref.externalId);
      if (!doc.ok) return doc;
      if (doc.value.docId) {
        next = { ...next, eDocId: doc.value.docId, eDocType: doc.value.docType ?? null };
      }
      return ok({
        state: doc.value.state ?? "waiting",
        number: doc.value.number,
        reason: doc.value.reason,
        ref: next,
      });
    },

    async getPdf(ref) {
      if (!ref.issued) return fail("not_supported", "Paraşüt'te PDF belge resmileştikten sonra alınır.");
      let docId = ref.eDocId;
      let docType = ref.eDocType;
      if (!docId || !docType) {
        const doc = await activeDocument(ref.externalId);
        if (!doc.ok) return doc;
        docId = doc.value.docId;
        docType = doc.value.docType;
      }
      if (!docId || (docType !== "e_invoices" && docType !== "e_archives")) {
        return fail("not_found", "Belge henüz Paraşüt'te oluşmadı. Biraz sonra tekrar deneyin.");
      }
      const res = await api("GET", `/${docType}/${encodeURIComponent(docId)}/pdf`);
      if (!res.ok) return res;
      const url = str(rec(rec(rec(res.value.json)?.data)?.attributes)?.url);
      if (!url || !/^https:\/\//i.test(url)) return fail("not_found", "PDF bağlantısı henüz hazır değil.");
      // PDF adresi imzalı, süreli ve sağlayıcıya aittir; sunucu indirmez, yalnız tarayıcıya yönlendirilir.
      return ok({ url });
    },
  };
  return adapter;
}

