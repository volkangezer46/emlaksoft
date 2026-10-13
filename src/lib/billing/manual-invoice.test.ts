import { describe, expect, it } from "vitest";
import { DEFAULT_BILLING_VAT_RATE, DEFAULT_VAT_SCHEDULE, formatVatSchedule, parseVatSchedule, vatRateAt } from "./plans";
import { buildInvoiceEmail, buildManualLines, canIssueManual, computeLine, isManualInvoice, manualDueIso, sumLines, synthesizeLine } from "./manual-invoice";
import { classifyInvoiceKind } from "@/lib/accounting/ledger";
import { getSettingDef } from "@/lib/settings/registry";
import { prepareWrite } from "@/lib/settings/prepare";

describe("KDV oranı ayar defteri (geçerlilik tarihli)", () => {
  it("biçimi çözer, sıralar; bozuk kayıt null", () => {
    expect(parseVatSchedule(DEFAULT_VAT_SCHEDULE)).toEqual([{ from: "2000-01-01", rate: 0.2 }]);
    expect(parseVatSchedule("2027-01-01=18; 2000-01-01=20")).toEqual([
      { from: "2000-01-01", rate: 0.2 },
      { from: "2027-01-01", rate: 0.18 },
    ]);
    expect(parseVatSchedule("2026-07-01=10,5")).toEqual([{ from: "2026-07-01", rate: 0.105 }]);
    for (const bad of ["", "20", "2026-13-01=20", "2026-02-30=20", "2026-01-01=100", "2026-01-01=20;2026-01-01=18", "x=1"]) {
      expect(parseVatSchedule(bad), bad).toBeNull();
    }
    expect(formatVatSchedule(parseVatSchedule("2027-01-01=18;2000-01-01=20")!)).toBe("2000-01-01=20; 2027-01-01=18");
  });

  it("verilen günde geçerli EN SON kayıt; hiçbiri geçerli değilse kod varsayılanı", () => {
    const s = parseVatSchedule("2000-01-01=20; 2027-01-01=18")!;
    expect(vatRateAt(s, "2026-12-31")).toBe(0.2);
    expect(vatRateAt(s, "2027-01-01")).toBe(0.18);
    expect(vatRateAt(parseVatSchedule("2030-01-01=1")!, "2026-10-13")).toBe(DEFAULT_BILLING_VAT_RATE);
    expect(vatRateAt(null, "2026-10-13")).toBe(DEFAULT_BILLING_VAT_RATE);
  });

  it("ayar kaydı: bozuk metin yazımda reddedilir, okumada varsayılana düşer", () => {
    const def = getSettingDef("billing.vat_rate")!;
    expect(def).toBeTruthy();
    expect(def.codec.parse("bozuk")).toBe(DEFAULT_VAT_SCHEDULE);
    expect(def.codec.parse("2000-01-01=20; 2027-01-01=18")).toBe("2000-01-01=20; 2027-01-01=18");
    expect(def.schema.safeParse("2026-01-01=200").success).toBe(false);
    expect(def.schema.safeParse("2000-01-01=20; 2027-01-01=18").success).toBe(true);
    expect(prepareWrite({ key: "billing.vat_rate", value: "abc", reason: "deneme gerekçesi" }).ok).toBe(false);
    expect(getSettingDef("billing.manual_invoice_due_days")?.default).toBe(14);
  });
});

describe("elle fatura kalemleri", () => {
  it("'Kurulum ücreti 2.500 TL + KDV' = 2.500 net, 500 KDV, 3.000 toplam", () => {
    const r = buildManualLines([{ description: "Kurulum ücreti", quantity: "1", unitNet: "2.500" }], 0.2);
    expect("lines" in r).toBe(true);
    if (!("lines" in r)) return;
    expect(r.lines).toEqual([{ position: 1, description: "Kurulum ücreti", quantity: 1, unitNetTry: 2500, vatRate: 0.2, netTry: 2500, taxTry: 500, totalTry: 3000 }]);
    expect(sumLines(r.lines)).toEqual({ amountTry: 2500, taxTry: 500, totalTry: 3000 });
  });

  it("KDV oranı değişince YENİ kalemler yeni oranla hesaplanır; kaydedilmiş satır oranını taşır (eskisi değişmez)", () => {
    const schedule = parseVatSchedule("2000-01-01=20; 2027-01-01=18")!;
    const before = buildManualLines([{ description: "Eğitim", quantity: "2", unitNet: "1000" }], vatRateAt(schedule, "2026-12-30"));
    const after = buildManualLines([{ description: "Eğitim", quantity: "2", unitNet: "1000" }], vatRateAt(schedule, "2027-01-02"));
    if (!("lines" in before) || !("lines" in after)) throw new Error("beklenmedik hata");
    expect(sumLines(before.lines)).toEqual({ amountTry: 2000, taxTry: 400, totalTry: 2400 });
    expect(sumLines(after.lines)).toEqual({ amountTry: 2000, taxTry: 360, totalTry: 2360 });
    expect(before.lines[0].vatRate).toBe(0.2);
  });

  it("satır kuruşa yuvarlanır ve toplam = net + KDV", () => {
    const l = computeLine(1, "x", 3, 33.33, 0.2);
    expect(l.netTry).toBe(99.99);
    expect(l.taxTry).toBe(20);
    expect(l.totalTry).toBe(119.99);
  });

  it("boş satırlar atlanır; geçersiz miktar/fiyat/açıklama reddedilir", () => {
    expect(buildManualLines([{ description: "", quantity: "", unitNet: "" }], 0.2)).toEqual({ error: "En az bir kalem girin." });
    expect(buildManualLines([{ description: "Kurulum", quantity: "0", unitNet: "10" }], 0.2)).toHaveProperty("error");
    expect(buildManualLines([{ description: "Kurulum", quantity: "1", unitNet: "-5" }], 0.2)).toHaveProperty("error");
    expect(buildManualLines([{ description: "K", quantity: "1", unitNet: "5" }], 0.2)).toHaveProperty("error");
    expect(buildManualLines([{ description: "Kurulum", quantity: "1", unitNet: "5" }], 1)).toEqual({ error: "KDV oranı geçersiz." });
  });

  it("elle fatura türü muhasebede 'Tek seferlik' sayılır, abonelik (plan) sayılmaz", () => {
    const meta = { kind: "one_time", manual_invoice: { category: "kurulum" } };
    expect(classifyInvoiceKind(meta, null)).toBe("one_time");
    expect(isManualInvoice(meta)).toBe(true);
    expect(isManualInvoice({ plan: "office" })).toBe(false);
  });

  it("yalnız ödeme oturumu olmayan elle TASLAK kesilebilir", () => {
    const meta = { kind: "one_time", manual_invoice: {} };
    expect(canIssueManual({ status: "draft", checkout_status: null, meta })).toBe(true);
    expect(canIssueManual({ status: "open", checkout_status: null, meta })).toBe(false);
    expect(canIssueManual({ status: "draft", checkout_status: "pending_checkout", meta })).toBe(false);
    expect(canIssueManual({ status: "draft", checkout_status: null, meta: { plan: "office" } })).toBe(false);
  });

  it("vade: kesim + gün (0..120 arası sınırlı)", () => {
    const at = Date.parse("2026-10-13T09:00:00Z");
    expect(manualDueIso(at, 14)).toBe("2026-10-27T09:00:00.000Z");
    expect(manualDueIso(at, 0)).toBe("2026-10-13T09:00:00.000Z");
    expect(manualDueIso(at, 999)).toBe(new Date(at + 120 * 86_400_000).toISOString());
  });

  it("satırı olmayan fatura tek satır olarak gösterilir (tutarlar faturadan)", () => {
    expect(synthesizeLine({ amount_try: "1000.00", tax_try: "200.00", total_try: "1200.00", meta: { plan: "office" } })).toEqual({
      position: 1,
      description: "Abonelik: office",
      quantity: 1,
      unitNetTry: 1000,
      vatRate: 0.2,
      netTry: 1000,
      taxTry: 200,
      totalTry: 1200,
    });
  });

  it("e-posta gövdesi kalemleri ve toplamı içerir", () => {
    const mail = buildInvoiceEmail({
      invoiceNo: "ES-MAN-1",
      tenantName: "Örnek Emlak",
      lines: [computeLine(1, "Kurulum ücreti", 1, 2500, 0.2)],
      amountTry: 2500,
      taxTry: 500,
      totalTry: 3000,
      dueLabel: "27 Ekim 2026",
      statusLabel: "Açık",
    });
    expect(mail.subject).toBe("EmlakSoft fatura ES-MAN-1");
    expect(mail.text).toContain("Kurulum ücreti");
    expect(mail.text).toMatch(/Genel toplam: .*3\.000,00/);
    expect(mail.text).toContain("27 Ekim 2026");
  });
});
