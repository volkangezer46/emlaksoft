import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { documentAmountOf, editBaseline, effectiveWithholdingRate, entryV2Patch, validateEntryEdit, type EntryEditForm } from "./entry-edit";
import { entryAmounts } from "./vat";

const base = { vatRate: null, vatAmount: null, vatIncluded: true, withholdingRate: null, withholdingAmount: null };
const form = (patch: Partial<EntryEditForm> = {}): EntryEditForm => ({
  amount: "20.000",
  date: "2026-10-10",
  category: "kira",
  title: "",
  counterparty: "",
  note: "",
  vatRate: null,
  vatIncluded: true,
  withholdingRate: 20,
  ...patch,
});

describe("Hareketi düzenle: belge tutarı nakitten geri kurulur (B101)", () => {
  it("stopajlı kayıt (kasa 16.000 + stopaj 4.000): belge 20.000, yalnız Kaydet nakdi DEĞİŞTİRMEZ", () => {
    const src = { ...base, amount: 16_000, withholdingRate: 20, withholdingAmount: 4_000 };
    const b = editBaseline(src);
    expect(b).toEqual({ document: 20_000, vatRate: null, vatIncluded: true, withholdingRate: 20, monetaryEditable: true });
    const checked = validateEntryEdit(form({ amount: String(b.document), withholdingRate: b.withholdingRate }), "2026-10-15", "Kira");
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    const patch = entryV2Patch(checked.value);
    expect(patch).toMatchObject({ amount: 20_000, vatIncluded: true, vatRate: null, withholdingRate: 20 });
    // RPC ile aynı hesap (finance_entry_amounts ↔ entryAmounts): nakit 16.000 kalır.
    expect(entryAmounts(patch.amount, patch.vatRate, patch.vatIncluded, patch.withholdingRate).cash).toBe(16_000);
  });

  it("stopaj tutarı var ama oranı yok (açık kalem kapanışı): oran tutardan çıkarılır, nakit aynı kalır", () => {
    const src = { ...base, amount: 8_000, withholdingAmount: 2_000 };
    expect(effectiveWithholdingRate(src)).toBe(20);
    const b = editBaseline(src);
    expect(b.monetaryEditable).toBe(true);
    expect(entryAmounts(b.document, b.vatRate, b.vatIncluded, b.withholdingRate).cash).toBe(8_000);
  });

  it("KDV hariç girilmiş kayıt: belge = net, vat_included=false geri gönderilir", () => {
    const src = { ...base, amount: 12_000, vatRate: 20, vatAmount: 2_000, vatIncluded: false };
    expect(documentAmountOf(src)).toBe(10_000);
    const b = editBaseline(src);
    expect(b).toMatchObject({ document: 10_000, vatIncluded: false, monetaryEditable: true });
    const checked = validateEntryEdit(form({ amount: "10.000", vatRate: 20, vatIncluded: false, withholdingRate: null }), "2026-10-15", "Kira");
    expect(checked.ok && entryV2Patch(checked.value)).toMatchObject({ amount: 10_000, vatIncluded: false, vatRate: 20 });
    expect(checked.ok && checked.value.cash).toBe(12_000);
  });

  it("KDV dahil, stopajsız kayıt: belge = nakit", () => {
    const src = { ...base, amount: 1_200, vatRate: 20, vatAmount: 200, vatIncluded: true };
    expect(editBaseline(src)).toMatchObject({ document: 1_200, vatIncluded: true, monetaryEditable: true });
  });

  it("geri kurulamayan eski kayıt: tutar alanları kilitlenir (nakit kendiliğinden değişmez)", () => {
    // Stopaj 333,33 ama nakit/oran ile birebir yeniden üretilemiyor (net üzerinden yuvarlama tutmuyor).
    const src = { ...base, amount: 1_000, vatRate: 20, vatAmount: 200, vatIncluded: true, withholdingRate: 17, withholdingAmount: 333.33 };
    expect(editBaseline(src).monetaryEditable).toBe(false);
  });
});

describe("Hareketi düzenle: istemci doğrulaması (sunucuya gitmeden)", () => {
  const today = "2026-10-15";
  it.each([
    [{ amount: "abc" }, "amount"],
    [{ amount: "-5" }, "amount"],
    [{ amount: "0" }, "amount"],
    [{ date: "2026-10-16" }, "date"],
    [{ date: "2026-02-31" }, "date"],
    [{ date: "1999-12-31" }, "date"],
    [{ category: "" }, "category"],
    [{ title: "x".repeat(161) }, "title"],
  ] as const)("%o → %s alanında hata", (patch, field) => {
    const r = validateEntryEdit(form(patch as Partial<EntryEditForm>), today, "Kira");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toBe(field);
  });

  it("boş açıklama kategori adına düşer; tarih boşsa bugün", () => {
    const r = validateEntryEdit(form({ title: "  ", date: "" }), today, "Kira");
    expect(r.ok && r.value).toMatchObject({ title: "Kira", date: today });
  });

  it("tek karede biter (50 ms bütçesinin çok altında)", () => {
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) validateEntryEdit(form({ amount: "abc" }), today, "Kira");
    expect((performance.now() - t0) / 1000).toBeLessThan(1);
  });
});

describe("EditDialog çağrı sözleşmesi", () => {
  const src = readFileSync(resolve(process.cwd(), "src/app/app/giderler/entry-actions.tsx"), "utf8");
  it("ofis defteri satırı updateEntryV2'yi belge tutarı + KDV dahil/hariç + oranlarla çağırır; kişisel yol hesap kimliğini sunucuda alır", () => {
    expect(src).toContain("updateEntryV2(entry.id, entryV2Patch(v))");
    expect(src).toContain("validateEntryEdit(form, today");
    // Eylem revalidatePath yapar: düzenleme sonrası ikinci tazeleme yok.
    const edit = src.slice(src.indexOf("function EditDialog("), src.indexOf("function VoidDialog("));
    expect(edit).not.toContain("router.refresh()");
    const action = readFileSync(resolve(process.cwd(), "src/app/actions/finance-accounts.ts"), "utf8");
    expect(action).toContain("accountId: scope.accountId");
  });
});
