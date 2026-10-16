import { describe, expect, it } from "vitest";
import { parseUblInvoice, sniffXml } from "./ubl";

export const UBL_SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
  xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2">
  <ext:UBLExtensions><ext:UBLExtension><ext:ExtensionContent/></ext:UBLExtension></ext:UBLExtensions>
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>TR1.2</cbc:CustomizationID>
  <cbc:ProfileID>TICARIFATURA</cbc:ProfileID>
  <cbc:ID>ABC2026000000077</cbc:ID>
  <cbc:CopyIndicator>false</cbc:CopyIndicator>
  <cbc:UUID>3F2504E0-4F89-41D3-9A0C-0305E82C3301</cbc:UUID>
  <cbc:IssueDate>2026-09-30</cbc:IssueDate>
  <cbc:IssueTime>10:15:00</cbc:IssueTime>
  <cbc:InvoiceTypeCode>SATIS</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>TRY</cbc:DocumentCurrencyCode>
  <cac:AdditionalDocumentReference>
    <cbc:ID>xslt</cbc:ID>
    <cac:Attachment><cbc:EmbeddedDocumentBinaryObject mimeCode="application/xml" filename="a.xslt">PHhzbDpzdHlsZXNoZWV0Lz4=</cbc:EmbeddedDocumentBinaryObject></cac:Attachment>
  </cac:AdditionalDocumentReference>
  <cac:AccountingSupplierParty><cac:Party>
    <cac:PartyIdentification><cbc:ID schemeID="MERSISNO">0123456789012345</cbc:ID></cac:PartyIdentification>
    <cac:PartyIdentification><cbc:ID schemeID="VKN">2650179910</cbc:ID></cac:PartyIdentification>
    <cac:PartyName><cbc:Name>Örnek Kırtasiye &amp; Ofis Ürünleri Ltd. Şti.</cbc:Name></cac:PartyName>
    <cac:PartyTaxScheme><cac:TaxScheme><cbc:Name>Kozyatağı</cbc:Name></cac:TaxScheme></cac:PartyTaxScheme>
  </cac:Party></cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty><cac:Party>
    <cac:PartyIdentification><cbc:ID schemeID="VKN">3130557669</cbc:ID></cac:PartyIdentification>
    <cac:PartyName><cbc:Name>Demo Emlak Ltd. Şti.</cbc:Name></cac:PartyName>
  </cac:Party></cac:AccountingCustomerParty>
  <cac:PaymentMeans><cbc:PaymentMeansCode>42</cbc:PaymentMeansCode></cac:PaymentMeans>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="TRY">205.00</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="TRY">1000.00</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="TRY">200.00</cbc:TaxAmount>
      <cbc:Percent>20</cbc:Percent>
      <cac:TaxCategory><cac:TaxScheme><cbc:Name>KDV</cbc:Name><cbc:TaxTypeCode>0015</cbc:TaxTypeCode></cac:TaxScheme></cac:TaxCategory>
    </cac:TaxSubtotal>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="TRY">500.00</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="TRY">5.00</cbc:TaxAmount>
      <cbc:Percent>1</cbc:Percent>
      <cac:TaxCategory><cac:TaxScheme><cbc:Name>KDV</cbc:Name><cbc:TaxTypeCode>0015</cbc:TaxTypeCode></cac:TaxScheme></cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:WithholdingTaxTotal>
    <cbc:TaxAmount currencyID="TRY">100.00</cbc:TaxAmount>
  </cac:WithholdingTaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="TRY">1500.00</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="TRY">1500.00</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="TRY">1705.00</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="TRY">1605.00</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  <cac:InvoiceLine>
    <cbc:ID>1</cbc:ID>
    <cbc:InvoicedQuantity unitCode="C62">10</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="TRY">1000.00</cbc:LineExtensionAmount>
    <cac:TaxTotal><cac:TaxSubtotal><cbc:Percent>20</cbc:Percent></cac:TaxSubtotal></cac:TaxTotal>
    <cac:Item><cbc:Name>A4 Fotokopi Kağıdı</cbc:Name></cac:Item>
  </cac:InvoiceLine>
  <cac:InvoiceLine>
    <cbc:ID>2</cbc:ID>
    <cbc:InvoicedQuantity unitCode="C62">1</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="TRY">500.00</cbc:LineExtensionAmount>
    <cac:TaxTotal><cac:TaxSubtotal><cbc:Percent>1</cbc:Percent></cac:TaxSubtotal></cac:TaxTotal>
    <cac:Item><cbc:Name>Gazete aboneliği</cbc:Name></cac:Item>
  </cac:InvoiceLine>
</Invoice>`;

describe("UBL-TR XML", () => {
  it("tüm tutarları, oran bazında KDV'yi, tevkifatı ve tarafları kesin okur", () => {
    const r = parseUblInvoice(UBL_SAMPLE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const f = r.fields;
    expect(f.docType?.value).toBe("e_fatura");
    expect(f.documentNo?.value).toBe("ABC2026000000077");
    expect(f.ettn?.value).toBe("3f2504e0-4f89-41d3-9a0c-0305e82c3301");
    expect(f.date?.value).toBe("2026-09-30");
    expect(f.time?.value).toBe("10:15");
    expect(f.currency?.value).toBe("TRY");
    expect(f.total?.value).toBe(1605);
    expect(f.grossTotal?.value).toBe(1705);
    expect(f.net?.value).toBe(1500);
    expect(f.vatTotal?.value).toBe(205);
    expect(f.vatWithholding?.value).toBe(100);
    expect(f.vatLines?.value).toEqual([
      { rate: 20, base: 1000, amount: 200 },
      { rate: 1, base: 500, amount: 5 },
    ]);
    expect(f.sellerName?.value).toBe("Örnek Kırtasiye & Ofis Ürünleri Ltd. Şti.");
    expect(f.sellerTaxId?.value).toBe("2650179910");
    expect(f.sellerTaxOffice?.value).toBe("Kozyatağı");
    expect(f.buyerTaxId?.value).toBe("3130557669");
    expect(f.paymentMethod?.value).toBe("havale");
    expect(f.items?.value.map((i) => i.name)).toEqual(["A4 Fotokopi Kağıdı", "Gazete aboneliği"]);
    expect(f.total!.source).toBe("xml");
  });

  it("entegratör zarfı içindeki faturayı bulur; e-Arşiv profili", () => {
    const wrapped = `<?xml version="1.0"?><sh:StandardBusinessDocument xmlns:sh="x"><ef:Package xmlns:ef="y"><Elements><ElementList>${UBL_SAMPLE.replace(/^<\?xml[^>]*>/, "").replace("TICARIFATURA", "EARSIVFATURA")}</ElementList></Elements></ef:Package></sh:StandardBusinessDocument>`;
    const r = parseUblInvoice(wrapped);
    expect(r.ok && r.fields.docType?.value).toBe("e_arsiv");
    expect(r.ok && r.fields.total?.value).toBe(1605);
  });

  it("DOCTYPE/ENTITY (XXE) ve fatura olmayan XML reddedilir", () => {
    expect(parseUblInvoice(`<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "b">]><Invoice/>`)).toEqual({ ok: false, reason: "unsafe" });
    expect(parseUblInvoice(`<?xml version="1.0"?><Order><ID>1</ID></Order>`)).toEqual({ ok: false, reason: "not_invoice" });
    expect(parseUblInvoice("PDF-1.7")).toEqual({ ok: false, reason: "not_xml" });
  });

  it("içerik imzası", () => {
    const enc = new TextEncoder();
    expect(sniffXml(enc.encode("﻿  <?xml version='1.0'?><Invoice/>"))).toBe(true);
    expect(sniffXml(enc.encode("<cbc:Invoice xmlns:cbc='x'/>"))).toBe(true);
    expect(sniffXml(enc.encode("%PDF-1.7"))).toBe(false);
    expect(sniffXml(enc.encode("<html><script>alert(1)</script></html>"))).toBe(false);
  });
});
