/**
 * Nilvera adaptörü (https://developer.nilvera.com ; OpenAPI: /{servis}/swagger/v1/swagger.json).
 * Kimlik: `Authorization: Bearer <API anahtarı>`. Canlı: api.nilvera.com, test: apitest.nilvera.com.
 *
 * RESMİ ŞEMADAN DOĞRULANAN (2026-10-10, OpenAPI):
 *  - GET  /general/Company                                  -> Name, TaxNumber, TaxOffice, Address, District, City, ... (bağlantı testi + satıcı bilgisi)
 *  - GET  /general/GlobalCompany/Check/TaxNumber/{vkn}?globalUserType=Invoice -> [{TaxNumber, Title, Name, Type, DocumentType, ...}]
 *  - POST /einvoice/Draft/Create   {EInvoice:{InvoiceInfo,CompanyInfo,CustomerInfo,InvoiceLines,Notes}, CustomerAlias} -> {UUID, InvoiceNumber}
 *  - POST /earchive/Draft/Create   {ArchiveInvoice:{InvoiceInfo,CompanyInfo,CustomerInfo,InvoiceLines,Notes}}          -> {UUID, InvoiceNumber}
 *  - POST /einvoice/Draft/ConfirmAndSend [{Alias, UUID}]    ; POST /earchive/Draft/ConfirmAndSend [uuid]
 *  - GET  /einvoice/Sale/{UUID}/Status -> InvoiceStatus.Code unknown|waiting|succeed|error
 *  - GET  /earchive/Invoices/{UUID}/Status -> StatusCode unknown|waiting|succeed|error, CancelStatus
 *  - GET  .../Draft/{UUID}/pdf, /einvoice/Sale/{UUID}/pdf, /earchive/Invoices/{UUID}/pdf
 *  - PUT  /earchive/Invoices/{UUID}/Cancel
 *
 * DOĞRULANAMAYAN / DESTEKLENMEYEN (adaptörde açık hata döner, tahmin edilmez):
 *  - e-SMM: Nilvera'da ayrı servis (evoucher) var; satır alanları (GrossWage/Price/GV stopajı) anlam olarak belgede
 *    açıklanmıyor -> "desteklenmiyor".
 *  - e-Fatura iptali: iptal ucu yok (alıcı yanıtı/iade ayrı akış) -> "desteklenmiyor". Yalnız e-Arşiv iptali vardır.
 *  - KDV oranları: şemada yalnız %1/8/10/18/20 toplam alanları vardır; %0 ve diğer oranlar muafiyet kodu ister -> reddedilir.
 *  - Alıcı posta kutusu (alias) alanı: Check/TaxNumber yanıtında `Name` olarak varsayılır (PK tipi tercih edilir); sandbox'ta doğrulanmalı.
 *  - Resmi fatura numarası: Create yanıtındaki InvoiceNumber kullanılır; gönderim sonrası değişirse bir sonraki durum sorgusu güncellemez.
 */
import { providerCall, providerPdf } from "./http";
import { computeTotals, lineAmounts, round2 } from "./invoice-math";
import {
  fail,
  ok,
  type AdapterCapabilities,
  type EInvoiceAdapter,
  type EInvoiceMode,
  type EInvoiceRef,
  type InvoiceDraft,
  type RemoteState,
  type Result,
} from "./types";

const NAME = "Nilvera";
const BASES: Record<EInvoiceMode, string> = {
  live: "https://api.nilvera.com",
  sandbox: "https://apitest.nilvera.com",
};
/** Şemada GeneralKDV{N}Total alanı bulunan oranlar. */
const SUPPORTED_VAT = [1, 8, 10, 18, 20] as const;

export type NilveraCredentials = { apiKey: string };

const CAPABILITIES: AdapterCapabilities = {
  eFatura: true,
  eArsiv: true,
  eSmm: false,
  sandbox: true,
  cancelDocTypes: ["e-arsiv"],
};

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v : undefined;
}

function rec(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

type NilveraCompany = {
  TaxNumber?: string;
  Name?: string;
  TaxOffice?: string;
  Address?: string;
  District?: string;
  City?: string;
  Country?: string;
  PostalCode?: string;
  PhoneNumber?: string;
  Email?: string;
};

function partyFromBuyer(buyer: InvoiceDraft["buyer"]) {
  return {
    TaxNumber: buyer.taxId,
    Name: buyer.name,
    TaxOffice: buyer.taxOffice ?? undefined,
    Address: buyer.address ?? undefined,
    District: buyer.district ?? undefined,
    City: buyer.city ?? undefined,
    Country: "Türkiye",
  };
}

function partyFromCompany(c: NilveraCompany) {
  return {
    TaxNumber: c.TaxNumber,
    Name: c.Name,
    TaxOffice: c.TaxOffice,
    Address: c.Address,
    District: c.District,
    City: c.City,
    Country: c.Country ?? "Türkiye",
    PostalCode: c.PostalCode,
    Phone: c.PhoneNumber,
    Mail: c.Email,
  };
}

/** Saf: taslaktan Nilvera satır + toplam alanları. Desteklenmeyen KDV oranı -> hata mesajı. */
export function buildNilveraAmounts(draft: InvoiceDraft): Result<{
  invoiceLines: Array<Record<string, unknown>>;
  totals: Record<string, number>;
}> {
  for (const line of draft.lines) {
    if (!(SUPPORTED_VAT as readonly number[]).includes(line.vatRate)) {
      return fail(
        "not_supported",
        `Nilvera için %${line.vatRate} KDV oranı bu bağlantıda desteklenmiyor (desteklenen: %${SUPPORTED_VAT.join(", %")}).`,
      );
    }
  }
  const t = computeTotals(draft.lines);
  const invoiceLines = draft.lines.map((line, i) => {
    const a = lineAmounts(line);
    return {
      Index: String(i + 1),
      Name: line.description,
      Quantity: line.quantity,
      UnitType: "C62",
      Price: line.unitPrice,
      AllowanceTotal: 0,
      KDVPercent: line.vatRate,
      KDVTotal: a.vat,
      Taxes: [{ TaxCode: "0015", Total: a.vat, Percent: line.vatRate }],
    };
  });
  const totals: Record<string, number> = {
    LineExtensionAmount: t.net,
    GeneralAllowanceTotal: 0,
    KdvTotal: t.vat,
    PayableAmount: t.gross,
    GeneralKDV1Total: 0,
    GeneralKDV8Total: 0,
    GeneralKDV10Total: 0,
    GeneralKDV18Total: 0,
    GeneralKDV20Total: 0,
  };
  for (const rate of SUPPORTED_VAT) totals[`GeneralKDV${rate}Total`] = round2(t.vatByRate[rate] ?? 0);
  return ok({ invoiceLines, totals });
}

export function createNilveraAdapter(creds: NilveraCredentials, mode: EInvoiceMode): EInvoiceAdapter {
  const base = BASES[mode];
  const headers = { Authorization: `Bearer ${creds.apiKey}` };

  async function company(): Promise<Result<NilveraCompany>> {
    const res = await providerCall(NAME, { method: "GET", url: `${base}/general/Company`, headers });
    if (!res.ok) return res;
    const obj = rec(res.value.json);
    if (!obj) return fail("invalid_response", "Nilvera firma bilgisini beklenen biçimde döndürmedi.");
    return ok(obj as NilveraCompany);
  }

  function svc(docType: EInvoiceRef["docType"]): "einvoice" | "earchive" {
    return docType === "e-fatura" ? "einvoice" : "earchive";
  }

  const adapter: EInvoiceAdapter = {
    id: "nilvera",
    capabilities: CAPABILITIES,

    async testConnection() {
      const c = await company();
      if (!c.ok) return c;
      return ok({ company: str(c.value.Name) ?? "Nilvera hesabı" });
    },

    async lookupTaxpayer(taxId) {
      const res = await providerCall(NAME, {
        method: "GET",
        url: `${base}/general/GlobalCompany/Check/TaxNumber/${encodeURIComponent(taxId)}?globalUserType=Invoice`,
        headers,
        allowStatuses: [404],
      });
      if (!res.ok) return res;
      if (res.value.status === 404) return ok({ isEInvoiceUser: false });
      const list = Array.isArray(res.value.json) ? res.value.json : [];
      if (list.length === 0) return ok({ isEInvoiceUser: false });
      const items = list.map(rec).filter((r): r is Record<string, unknown> => r !== null);
      const pk = items.find((r) => String(r.Type ?? "").toUpperCase() === "PK") ?? items[0];
      return ok({ isEInvoiceUser: true, alias: pk ? str(pk.Name) : undefined });
    },

    async createDraft(draft) {
      if (draft.docType === "e-smm") {
        return fail("not_supported", "Nilvera bağlantısında e-Serbest Meslek Makbuzu henüz desteklenmiyor. Paraşüt bağlantısı ya da e-Arşiv kullanın.");
      }
      const amounts = buildNilveraAmounts(draft);
      if (!amounts.ok) return amounts;
      const co = await company();
      if (!co.ok) return co;
      const issue = `${draft.issueDate}T00:00:00`;
      const notes = draft.note?.trim() ? [draft.note.trim()] : [];

      if (draft.docType === "e-fatura") {
        if (!draft.alias) return fail("invalid_input", "Alıcının e-Fatura posta kutusu bulunamadı. Önce alıcıyı sorgulayın ya da e-Arşiv seçin.");
        const res = await providerCall(NAME, {
          method: "POST",
          url: `${base}/einvoice/Draft/Create`,
          headers,
          allowStatuses: [409],
          json: {
            EInvoice: {
              InvoiceInfo: {
                UUID: draft.uuid,
                InvoiceType: "SATIS",
                InvoiceProfile: "TEMELFATURA",
                IssueDate: issue,
                CurrencyCode: "TRY",
                ...amounts.value.totals,
              },
              CompanyInfo: partyFromCompany(co.value),
              CustomerInfo: partyFromBuyer(draft.buyer),
              InvoiceLines: amounts.value.invoiceLines,
              Notes: notes,
            },
            CustomerAlias: draft.alias,
          },
        });
        if (!res.ok) return res;
        // 409: aynı UUID daha önce oluşturulmuş (yeniden deneme) -> aynı belge kabul edilir.
        const obj = rec(res.value.json);
        return ok({
          ref: { externalId: str(obj?.UUID) ?? draft.uuid, docType: "e-fatura" as const, alias: draft.alias, issued: false },
          number: str(obj?.InvoiceNumber),
        });
      }

      const res = await providerCall(NAME, {
        method: "POST",
        url: `${base}/earchive/Draft/Create`,
        headers,
        allowStatuses: [409],
        json: {
          ArchiveInvoice: {
            InvoiceInfo: {
              UUID: draft.uuid,
              InvoiceType: "SATIS",
              IssueDate: issue,
              CurrencyCode: "TRY",
              SendType: "ELEKTRONIK",
              SalesPlatform: "NORMAL",
              ISDespatch: false,
              ...amounts.value.totals,
            },
            CompanyInfo: partyFromCompany(co.value),
            CustomerInfo: partyFromBuyer(draft.buyer),
            InvoiceLines: amounts.value.invoiceLines,
            Notes: notes,
          },
        },
      });
      if (!res.ok) return res;
      const obj = rec(res.value.json);
      return ok({
        ref: { externalId: str(obj?.UUID) ?? draft.uuid, docType: "e-arsiv" as const, issued: false },
        number: str(obj?.InvoiceNumber),
      });
    },

    async issue(ref) {
      if (ref.docType === "e-smm") return fail("not_supported", "Nilvera bağlantısında e-Serbest Meslek Makbuzu desteklenmiyor.");
      if (ref.docType === "e-fatura") {
        if (!ref.alias) return fail("invalid_input", "Alıcının e-Fatura posta kutusu eksik.");
        const res = await providerCall(NAME, {
          method: "POST",
          url: `${base}/einvoice/Draft/ConfirmAndSend`,
          headers,
          json: [{ Alias: ref.alias, UUID: ref.externalId }],
        });
        if (!res.ok) return res;
      } else {
        const res = await providerCall(NAME, {
          method: "POST",
          url: `${base}/earchive/Draft/ConfirmAndSend`,
          headers,
          json: [ref.externalId],
        });
        if (!res.ok) return res;
      }
      return ok({ ref: { ...ref, issued: true } });
    },

    async getStatus(ref) {
      if (ref.docType === "e-smm") return fail("not_supported", "Nilvera bağlantısında e-Serbest Meslek Makbuzu desteklenmiyor.");
      const id = encodeURIComponent(ref.externalId);
      const url =
        ref.docType === "e-fatura"
          ? `${base}/einvoice/Sale/${id}/Status`
          : `${base}/earchive/Invoices/${id}/Status`;
      const res = await providerCall(NAME, { method: "GET", url, headers, allowStatuses: [404] });
      if (!res.ok) return res;
      if (res.value.status === 404) {
        return ok({ state: ref.issued ? ("waiting" as RemoteState) : ("draft" as RemoteState), ref });
      }
      const obj = rec(res.value.json);
      if (!obj) return fail("invalid_response", "Nilvera durum bilgisini beklenen biçimde döndürmedi.");
      let code: string | undefined;
      let reason: string | undefined;
      let cancelled = false;
      if (ref.docType === "e-fatura") {
        const st = rec(obj.InvoiceStatus);
        code = str(st?.Code);
        reason = str(st?.DetailDescription) ?? str(st?.Description);
      } else {
        code = str(obj.StatusCode);
        reason = str(obj.StatusDetail);
        cancelled = obj.CancelStatus === true;
      }
      let state: RemoteState = "waiting";
      if (cancelled) state = "cancelled";
      else if (code === "succeed") state = "succeeded";
      else if (code === "error") state = "failed";
      return ok({ state, reason: state === "failed" ? reason : undefined, ref });
    },

    async getPdf(ref) {
      if (ref.docType === "e-smm") return fail("not_supported", "Nilvera bağlantısında e-Serbest Meslek Makbuzu desteklenmiyor.");
      const id = encodeURIComponent(ref.externalId);
      const service = svc(ref.docType);
      const path = ref.issued
        ? ref.docType === "e-fatura"
          ? `${service}/Sale/${id}/pdf`
          : `${service}/Invoices/${id}/pdf`
        : `${service}/Draft/${id}/pdf`;
      const res = await providerPdf(NAME, { method: "GET", url: `${base}/${path}`, headers });
      if (!res.ok) return res;
      return ok({ bytes: res.value });
    },

    async cancel(ref) {
      if (ref.docType !== "e-arsiv") {
        return fail("not_supported", "Nilvera üzerinden yalnız e-Arşiv faturası iptal edilebilir; e-Fatura için iptal ucu sunulmuyor.");
      }
      const res = await providerCall(NAME, {
        method: "PUT",
        url: `${base}/earchive/Invoices/${encodeURIComponent(ref.externalId)}/Cancel`,
        headers,
      });
      if (!res.ok) return res;
      return ok(undefined);
    },
  };
  return adapter;
}
