import { describe, expect, it } from "vitest";
import { resolvePeriod } from "./period";
import { AGING_BUCKETS, agingBucketOf, daysPastDue, summarizeAging } from "./aging";
import {
  creditNoteToLedger,
  matchesLedger,
  parseLedgerFilter,
  summarizeLedger,
  toLedgerInvoice,
  totalsOf,
  vatRatePercent,
  type RawInvoiceRow,
} from "./ledger";

const NOW = Date.parse("2026-10-15T09:00:00Z");
const DAY = 86_400_000;
const PERIOD = resolvePeriod({}, NOW);
const ALL = resolvePeriod({ donem: "tumu" }, NOW);

let n = 0;
function inv(over: Partial<RawInvoiceRow> = {}) {
  n += 1;
  return toLedgerInvoice({
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    tenant_id: "11111111-1111-4111-8111-111111111111",
    subscription_id: null,
    invoice_no: `ES-${n}`,
    status: "open",
    amount_try: "1000.00",
    tax_try: "200.00",
    total_try: "1200.00",
    currency: "TRY",
    due_at: null,
    paid_at: null,
    created_at: "2026-06-01T10:00:00Z",
    iyzico_payment_id: null,
    meta: { kind: "one_time", manual_invoice: { category: "kurulum" } },
    tenant: { id: "t", name: "Örnek Emlak" },
    ...over,
  });
}
const dueDaysAgo = (d: number) => new Date(NOW - d * DAY).toISOString();

describe("tahsilat yaşlandırması", () => {
  it("kova sınırları: 0-30 / 31-60 / 61-90 / 90+", () => {
    expect(agingBucketOf(0)).toBe("0-30");
    expect(agingBucketOf(30)).toBe("0-30");
    expect(agingBucketOf(31)).toBe("31-60");
    expect(agingBucketOf(60)).toBe("31-60");
    expect(agingBucketOf(61)).toBe("61-90");
    expect(agingBucketOf(90)).toBe("61-90");
    expect(agingBucketOf(91)).toBe("90+");
  });

  it("vadesi gelmemiş ve vadesiz fatura 0 gün sayılır", () => {
    expect(daysPastDue({ dueAt: new Date(NOW + 5 * DAY).toISOString() }, NOW)).toBe(0);
    expect(daysPastDue({ dueAt: null }, NOW)).toBe(0);
    expect(daysPastDue({ dueAt: dueDaysAgo(45) }, NOW)).toBe(45);
  });

  it("kova toplamları defterin Bekleyen + Gecikmiş toplamına eşittir; açık olmayanlar sayılmaz", () => {
    const rows = [
      inv({ due_at: new Date(NOW + 3 * DAY).toISOString(), total_try: "3000.00", amount_try: "2500.00", tax_try: "500.00" }),
      inv({ due_at: null }),
      inv({ due_at: dueDaysAgo(10) }),
      inv({ due_at: dueDaysAgo(40), total_try: "600.00", amount_try: "500.00", tax_try: "100.00" }),
      inv({ due_at: dueDaysAgo(75) }),
      inv({ due_at: dueDaysAgo(200), total_try: "99.99", amount_try: "83.33", tax_try: "16.66" }),
      inv({ status: "paid", paid_at: "2026-10-01T10:00:00Z", due_at: dueDaysAgo(120) }),
      inv({ status: "draft", due_at: dueDaysAgo(120) }),
      inv({ status: "void", due_at: dueDaysAgo(120) }),
    ];
    const aging = summarizeAging(rows, NOW);
    const ledger = summarizeLedger([], rows, PERIOD, NOW);

    expect(aging.total.gross).toBe(ledger.pending.gross + ledger.overdue.gross);
    expect(aging.total.count).toBe(ledger.pending.count + ledger.overdue.count);
    expect(aging.notDue).toEqual(ledger.pending);
    const sum = AGING_BUCKETS.reduce((a, b) => a + aging.buckets[b].gross, 0);
    expect(sum).toBe(aging.total.gross);

    expect(aging.buckets["0-30"]).toEqual({ count: 3, gross: 300000 + 120000 + 120000 });
    expect(aging.buckets["31-60"]).toEqual({ count: 1, gross: 60000 });
    expect(aging.buckets["61-90"]).toEqual({ count: 1, gross: 120000 });
    expect(aging.buckets["90+"]).toEqual({ count: 1, gross: 9999 });

    // Defter süzgeci (yas) kart ile aynı satırları verir.
    for (const b of AGING_BUCKETS) {
      const filter = parseLedgerFilter({ donem: "tumu", durum: "open", yas: b });
      const matched = rows.filter((r) => matchesLedger(r, filter, ALL, NOW));
      expect(totalsOf(matched).gross, b).toBe(aging.buckets[b].gross);
      expect(matched.length, b).toBe(aging.buckets[b].count);
    }
  });

  it("geçersiz yaş parametresi yok sayılır", () => {
    expect(parseLedgerFilter({ yas: "999" }).yas).toBeUndefined();
  });
});

describe("alacak dekontu defter satırı", () => {
  const note = creditNoteToLedger({
    id: "cn-1",
    invoice_id: "inv-1",
    tenant_id: "11111111-1111-4111-8111-111111111111",
    credit_no: "ADK-2026-000007",
    amount_try: "600.00",
    net_try: "500.00",
    tax_try: "100.00",
    issued_at: "2026-10-12T08:00:00Z",
    invoice: { invoice_no: "ES-MAN-ABC-1", currency: "TRY", subscription_id: null, iyzico_payment_id: null, meta: { kind: "one_time", manual_invoice: {}, manual_payment: { method: "kart_pos" } } },
    tenant: { name: "Örnek Emlak", tax_office: "Kadıköy", tax_number: "1" },
  });

  it("tutarlar eksi, tür/yöntem bağlı faturadan, durum credit_note", () => {
    expect(note.grossKurus).toBe(-60000);
    expect(note.netKurus).toBe(-50000);
    expect(note.taxKurus).toBe(-10000);
    expect(note.status).toBe("credit_note");
    expect(note.kind).toBe("one_time");
    expect(note.method).toBe("kart_pos");
    expect(note.creditNoteOf).toBe("inv-1");
    expect(note.refInvoiceNo).toBe("ES-MAN-ABC-1");
    expect(vatRatePercent(note)).toBe(20);
  });

  it("defterde dönem içinde eksi satırdır ve toplamı düşürür; özet kartlarını (tahsilat/iade) değiştirmez", () => {
    const paid = inv({ status: "paid", paid_at: "2026-10-05T10:00:00Z", due_at: null, meta: { kind: "one_time", manual_invoice: {}, refund: { amount_try: 600, at: "2026-10-12T08:00:00Z" } } });
    const all = parseLedgerFilter({});
    const rows = [paid, note].filter((r) => matchesLedger(r, all, PERIOD, NOW));
    expect(rows).toHaveLength(2);
    expect(totalsOf(rows).gross).toBe(120000 - 60000);

    const onlyNotes = [paid, note].filter((r) => matchesLedger(r, parseLedgerFilter({ durum: "dekont" }), PERIOD, NOW));
    expect(onlyNotes).toEqual([note]);
    // Fatura numarasıyla arama dekontu da bulur.
    expect(matchesLedger(note, parseLedgerFilter({ q: "es-man-abc" }), PERIOD, NOW)).toBe(true);

    const withNote = summarizeLedger([paid, note], [], PERIOD, NOW);
    const withoutNote = summarizeLedger([paid], [], PERIOD, NOW);
    expect(withNote).toEqual(withoutNote);
    expect(withNote.refunds.gross).toBe(60000);
    expect(withNote.byKind.one_time.gross).toBe(120000);
  });
});
