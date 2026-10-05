import { describe, expect, it } from "vitest";
import { ACCOUNTING_CSV_HEADERS, buildAccountingCsv, csvDate, csvHeaderLine, csvInvoiceLine, csvMoney, csvPercent, csvText } from "./csv";
import { toLedgerInvoice, type RawInvoiceRow } from "./ledger";

function inv(over: Partial<RawInvoiceRow> = {}) {
  return toLedgerInvoice(
    {
      id: "00000000-0000-4000-8000-000000000001",
      tenant_id: "11111111-1111-4111-8111-111111111111",
      subscription_id: null,
      invoice_no: "ES-2026-001",
      status: "paid",
      amount_try: "1000.00",
      tax_try: "200.00",
      total_try: "1200.00",
      currency: "TRY",
      due_at: null,
      paid_at: "2026-10-31T21:30:00Z", // TR: 1 Kasım 00:30
      created_at: "2026-10-30T10:00:00Z",
      iyzico_payment_id: "pay_1",
      meta: { plan: "office", refund: { amount_try: 300.5, at: "2026-11-02T10:00:00Z" } },
      tenant: { id: "t", name: "Örnek; \"Emlak\" Ltd.", tax_office: "Kadıköy", tax_number: "1234567890" },
      ...over,
    },
    { code: "YAZ25", discountKurus: 1000 },
  );
}

describe("muhasebe CSV", () => {
  it("BOM + noktalı virgül + CRLF + Türkçe başlıklar", () => {
    const head = csvHeaderLine();
    expect(head.startsWith("\uFEFF")).toBe(true);
    expect(head.endsWith("\r\n")).toBe(true);
    const cols = head.replace("\uFEFF", "").trim().split(";");
    expect(cols).toHaveLength(ACCOUNTING_CSV_HEADERS.length);
    expect(cols[0]).toBe('"Fatura No"');
    expect(head).toContain('"Vergi Dairesi"');
    expect(head).toContain('"KDV Oranı (%)"');
  });

  it("tutarlar virgüllü ondalık, binlik ayırıcısız; tarih gg.aa.yyyy (TR günü)", () => {
    expect(csvMoney(120000)).toBe("1200,00");
    expect(csvMoney(5)).toBe("0,05");
    expect(csvMoney(-1250)).toBe("-12,50");
    expect(csvPercent(18.5)).toBe("18,5");
    expect(csvDate("2026-10-31T21:30:00Z")).toBe("01.11.2026");
    expect(csvDate(null)).toBe("");
  });

  it("satır: ayırıcı içeren/tırnaklı ofis unvanı bozulmaz, sütun sayısı sabit", () => {
    const line = csvInvoiceLine(inv());
    expect(line).toContain('"Örnek; ""Emlak"" Ltd."');
    // Tırnaklı alanlar çıkarılınca kalan ayırıcılar sütun sayısını verir
    const stripped = line.replace(/"(?:[^"]|"")*"/g, "X").trim();
    expect(stripped.split(";")).toHaveLength(ACCOUNTING_CSV_HEADERS.length);
    expect(line).toContain(";1000,00;20;200,00;1200,00;");
    expect(line).toContain('"Ödendi"');
    expect(line).toContain('"Kart (iyzico)"');
    expect(line).toContain('"YAZ25"');
    // Son sütun "Hesap Kredisi ile Ödenen" (örnek faturada kredi yok = 0,00); iade tutarı bir önceki sütun
    expect(line.trim().endsWith(";300,50;0,00")).toBe(true);
    expect(line).toContain('"Kadıköy";"1234567890"');
  });

  it("formül enjeksiyonu: = + - @ TAB CR ile başlayan metin kaçırılır", () => {
    for (const bad of ["=1+1", "+90555", "-2+3", "@SUM(A1)", "\t=1", " =cmd", "\r=1"]) {
      const cell = csvText(bad);
      expect(cell.startsWith(`"'`)).toBe(true);
    }
    expect(csvText("Normal Ltd.")).toBe('"Normal Ltd."');
    expect(csvText(null)).toBe('""');
    // satır sonları tek satıra iner (CSV bozulmaz)
    expect(csvText("a\nb\r\nc")).toBe('"a b c"');
  });

  it("kötü niyetli ofis unvanı satıra formül olarak sızmaz", () => {
    const line = csvInvoiceLine(inv({ tenant: { name: '=HYPERLINK("http://x")', tax_office: "@x", tax_number: "+1" } }));
    expect(line).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(line).toContain(`"'@x"`);
    expect(line).toContain(`"'+1"`);
  });

  it("buildAccountingCsv başlık + satırlar", () => {
    const csv = buildAccountingCsv([inv(), inv()]);
    expect(csv.split("\r\n").filter(Boolean)).toHaveLength(3);
  });
});
