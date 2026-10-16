/**
 * UBL-TR (e-Fatura / e-Arşiv XML) çözümleyici (SAF, kesin). Ad alanı önekleri atılır; entegratör zarfı
 * (StandardBusinessDocument > Package > ElementList > Invoice) içindeki fatura da bulunur.
 *
 * Güvenlik: DOCTYPE / ENTITY bildirimi içeren belge hiç ayrıştırılmaz (XXE, "milyar kahkaha"); boyut ve iç içelik sınırlı;
 * gömülü XSLT/PDF (EmbeddedDocumentBinaryObject) okunmaz.
 */
import { XMLParser } from "fast-xml-parser";
import { classifyTaxId } from "./tax-id";
import { parseMachineAmount, round2 } from "./numbers";
import type { LayerFields, LineItem, PaymentMethod, ReceiptDocType, VatLine } from "./types";

export const UBL_MAX_BYTES = 5 * 1024 * 1024;
const CONF = 0.99;

type Node = Record<string, unknown>;

/** Bayt içeriği XML mi (BOM/boşluk sonrası "<?xml" ya da "<" + Invoice)? Sihirli bayt denetimi. */
export function sniffXml(bytes: Uint8Array): boolean {
  const head = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, 2048)).replace(/^﻿/, "").trimStart();
  if (!head.startsWith("<")) return false;
  return /^<\?xml[\s?]/.test(head) || /^<([A-Za-z_][\w.-]*:)?(Invoice|StandardBusinessDocument|CreditNote)\b/.test(head);
}

function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function text(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string" || typeof v === "number") return String(v).trim();
  if (typeof v === "object" && "#text" in (v as Node)) return text((v as Node)["#text"]);
  return null;
}

function attr(v: unknown, name: string): string | null {
  if (v && typeof v === "object") {
    const a = (v as Node)[`@_${name}`];
    return typeof a === "string" ? a : null;
  }
  return null;
}

function child(n: unknown, ...path: string[]): unknown {
  let cur: unknown = n;
  for (const p of path) {
    if (cur == null || typeof cur !== "object") return undefined;
    const next = (cur as Node)[p];
    cur = Array.isArray(next) ? next[0] : next;
  }
  return cur;
}

function findInvoice(n: unknown, depth = 0): Node | null {
  if (!n || typeof n !== "object" || depth > 8) return null;
  for (const [k, v] of Object.entries(n as Node)) {
    if (k === "Invoice" || k === "CreditNote") {
      const first = Array.isArray(v) ? v[0] : v;
      if (first && typeof first === "object") return first as Node;
    }
  }
  for (const v of Object.values(n as Node)) {
    for (const item of asArray(v)) {
      const found = findInvoice(item, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function partyInfo(party: unknown): { name: string | null; taxId: string | null; taxOffice: string | null } {
  let taxId: string | null = null;
  for (const pid of asArray((party as Node | undefined)?.PartyIdentification)) {
    const idNode = child(pid, "ID");
    const scheme = (attr(idNode, "schemeID") ?? "").toUpperCase();
    if (scheme === "VKN" || scheme === "TCKN") {
      taxId = text(idNode);
      break;
    }
  }
  let name = text(child(party, "PartyName", "Name"));
  if (!name) {
    const first = text(child(party, "Person", "FirstName"));
    const family = text(child(party, "Person", "FamilyName"));
    name = [first, family].filter(Boolean).join(" ") || null;
  }
  const taxOffice = text(child(party, "PartyTaxScheme", "TaxScheme", "Name"));
  return { name, taxId, taxOffice };
}

const PAYMENT_CODES: Record<string, PaymentMethod> = { "10": "nakit", "1": "diger", "42": "havale", "31": "havale", "30": "havale", "48": "kart", "54": "kart", "55": "kart" };

export type UblParseResult = { ok: true; fields: LayerFields } | { ok: false; reason: "not_xml" | "unsafe" | "too_large" | "not_invoice" | "parse_error" };

export function parseUblInvoice(xml: string): UblParseResult {
  if (xml.length > UBL_MAX_BYTES) return { ok: false, reason: "too_large" };
  const body = xml.replace(/^﻿/, "");
  if (!body.trimStart().startsWith("<")) return { ok: false, reason: "not_xml" };
  if (/<!DOCTYPE|<!ENTITY/i.test(body)) return { ok: false, reason: "unsafe" };
  let doc: unknown;
  try {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      removeNSPrefix: true,
      parseTagValue: false,
      parseAttributeValue: false,
      trimValues: true,
      processEntities: true,
      htmlEntities: false,
      maxNestedTags: 64,
      // Büyük gömülü ekleri belleğe ağaç olarak almayalım: değerleri yine string kalır, okunmaz.
    });
    doc = parser.parse(body);
  } catch {
    return { ok: false, reason: "parse_error" };
  }
  const inv = findInvoice(doc);
  if (!inv) return { ok: false, reason: "not_invoice" };

  const src = "xml" as const;
  const f: LayerFields = {};
  const profile = (text(child(inv, "ProfileID")) ?? "").toUpperCase();
  const docType: ReceiptDocType = /EARSIV/.test(profile) ? "e_arsiv" : profile ? "e_fatura" : "fatura";
  f.docType = { value: docType, confidence: 0.98, source: src };

  const id = text(child(inv, "ID"));
  if (id && id.length <= 40) f.documentNo = { value: id.toUpperCase(), confidence: CONF, source: src };
  const uuid = (text(child(inv, "UUID")) ?? "").toLowerCase();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(uuid)) f.ettn = { value: uuid, confidence: CONF, source: src };
  const issue = text(child(inv, "IssueDate"));
  if (issue && /^\d{4}-\d{2}-\d{2}$/.test(issue)) f.date = { value: issue, confidence: CONF, source: src };
  const time = text(child(inv, "IssueTime"));
  if (time && /^\d{2}:\d{2}/.test(time)) f.time = { value: time.slice(0, 5), confidence: CONF, source: src };
  const cur = (text(child(inv, "DocumentCurrencyCode")) ?? "").toUpperCase();
  if (/^[A-Z]{3}$/.test(cur)) f.currency = { value: cur === "TL" ? "TRY" : cur, confidence: CONF, source: src };

  const seller = partyInfo(child(inv, "AccountingSupplierParty", "Party"));
  if (seller.name) f.sellerName = { value: seller.name.slice(0, 120), confidence: 0.98, source: src };
  const sTax = classifyTaxId(seller.taxId);
  if (sTax) f.sellerTaxId = { value: sTax.value, confidence: sTax.valid ? CONF : 0.6, source: src };
  if (seller.taxOffice) f.sellerTaxOffice = { value: seller.taxOffice.slice(0, 80), confidence: 0.95, source: src };
  const buyer = partyInfo(child(inv, "AccountingCustomerParty", "Party"));
  if (buyer.name) f.buyerName = { value: buyer.name.slice(0, 120), confidence: 0.98, source: src };
  const bTax = classifyTaxId(buyer.taxId);
  if (bTax) f.buyerTaxId = { value: bTax.value, confidence: bTax.valid ? CONF : 0.6, source: src };

  // Vergiler: KDV (0015) oran bazında; GV stopajı (0003) ve diğer kesintiler ayrı.
  const byRate = new Map<number, VatLine>();
  let stopaj = 0;
  for (const tt of asArray(inv.TaxTotal as Node | Node[] | undefined)) {
    for (const sub of asArray((tt as Node).TaxSubtotal as Node | Node[] | undefined)) {
      const code = text(child(sub, "TaxCategory", "TaxScheme", "TaxTypeCode")) ?? "0015";
      const amount = parseMachineAmount(text(child(sub, "TaxAmount")));
      const base = parseMachineAmount(text(child(sub, "TaxableAmount")));
      const pct = parseMachineAmount(text(child(sub, "Percent")));
      if (code === "0015") {
        const rate = pct ?? 0;
        const line = byRate.get(rate) ?? { rate, base: 0, amount: 0 };
        line.base = round2((line.base ?? 0) + (base ?? 0));
        line.amount = round2((line.amount ?? 0) + (amount ?? 0));
        byRate.set(rate, line);
      } else if (code === "0003" || code === "0011") {
        stopaj += amount ?? 0;
      }
    }
  }
  const lines = [...byRate.values()].sort((a, b) => b.rate - a.rate);
  if (lines.length) {
    f.vatLines = { value: lines, confidence: CONF, source: src };
    f.vatTotal = { value: round2(lines.reduce((s, l) => s + (l.amount ?? 0), 0)), confidence: CONF, source: src };
  }
  if (stopaj > 0) f.incomeTaxWithholding = { value: round2(stopaj), confidence: CONF, source: src };
  let withheld = 0;
  for (const wt of asArray(inv.WithholdingTaxTotal as Node | Node[] | undefined)) withheld += parseMachineAmount(text(child(wt, "TaxAmount"))) ?? 0;
  if (withheld > 0) f.vatWithholding = { value: round2(withheld), confidence: CONF, source: src };

  const lmt = child(inv, "LegalMonetaryTotal");
  const taxExclusive = parseMachineAmount(text(child(lmt, "TaxExclusiveAmount")));
  const lineExt = parseMachineAmount(text(child(lmt, "LineExtensionAmount")));
  const net = taxExclusive ?? lineExt;
  if (net != null) f.net = { value: net, confidence: CONF, source: src };
  const gross = parseMachineAmount(text(child(lmt, "TaxInclusiveAmount")));
  if (gross != null) f.grossTotal = { value: gross, confidence: CONF, source: src };
  const payable = parseMachineAmount(text(child(lmt, "PayableAmount")));
  if (payable != null || gross != null) f.total = { value: (payable ?? gross)!, confidence: CONF, source: src };

  const pm = text(child(inv, "PaymentMeans", "PaymentMeansCode"));
  if (pm && PAYMENT_CODES[pm]) f.paymentMethod = { value: PAYMENT_CODES[pm], confidence: 0.9, source: src };

  const items: LineItem[] = [];
  for (const line of asArray(inv.InvoiceLine as Node | Node[] | undefined).slice(0, 20)) {
    const name = text(child(line, "Item", "Name"));
    if (!name) continue;
    const pct = parseMachineAmount(text(child(line, "TaxTotal", "TaxSubtotal", "Percent")));
    items.push({
      name: name.slice(0, 80),
      quantity: parseMachineAmount(text(child(line, "InvoicedQuantity"))),
      total: parseMachineAmount(text(child(line, "LineExtensionAmount"))),
      vatRate: pct,
    });
  }
  if (items.length) f.items = { value: items, confidence: 0.97, source: src };
  return { ok: true, fields: f };
}
