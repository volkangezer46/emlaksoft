import { describe, expect, it } from "vitest";
import {
  AGING_BUCKETS,
  addDays,
  agingBucketOf,
  agingFromItems,
  balanceCaption,
  bucketDueRange,
  bucketShare,
  closingBalance,
  daysPastDue,
  dedupeOpenItems,
  kindHintFor,
  normalizeAging,
  normalizeStatementLine,
  parseSettleAmount,
  partyKindLabel,
  partyKindOf,
  recomputeRunning,
  remainingOf,
  safeHref,
  STATEMENT_DOC_LABEL,
  statementDocLabel,
  statementRpcArgs,
  statusAfter,
} from "./aging";
import { summarizeOwnerStatement } from "./owner-statement";

const TODAY = "2026-10-13";

describe("tarih yardımcıları", () => {
  it("addDays ay/yıl sınırını doğru geçer", () => {
    expect(addDays("2026-10-13", -13)).toBe("2026-09-30");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2024-03-01", -1)).toBe("2024-02-29");
  });
  it("daysPastDue: geçmiş pozitif, gelecek negatif", () => {
    expect(daysPastDue("2026-10-12", TODAY)).toBe(1);
    expect(daysPastDue("2026-10-13", TODAY)).toBe(0);
    expect(daysPastDue("2026-10-20", TODAY)).toBe(-7);
  });
});

describe("yaşlandırma kovası", () => {
  it("sınırlar: bugün/ileri vadesi gelmedi, 1–30, 31–60, 61–90, 91+", () => {
    expect(agingBucketOf("2026-10-13", TODAY)).toBe("vadesi_gelmedi");
    expect(agingBucketOf("2026-11-01", TODAY)).toBe("vadesi_gelmedi");
    expect(agingBucketOf(null, TODAY)).toBe("vadesi_gelmedi");
    expect(agingBucketOf(addDays(TODAY, -1), TODAY)).toBe("0-30");
    expect(agingBucketOf(addDays(TODAY, -30), TODAY)).toBe("0-30");
    expect(agingBucketOf(addDays(TODAY, -31), TODAY)).toBe("31-60");
    expect(agingBucketOf(addDays(TODAY, -60), TODAY)).toBe("31-60");
    expect(agingBucketOf(addDays(TODAY, -61), TODAY)).toBe("61-90");
    expect(agingBucketOf(addDays(TODAY, -90), TODAY)).toBe("61-90");
    expect(agingBucketOf(addDays(TODAY, -91), TODAY)).toBe("90+");
  });

  it("bucketDueRange agingBucketOf ile birebir aynı sınırları verir", () => {
    for (let back = -40; back <= 200; back++) {
      const due = addDays(TODAY, -back);
      const bucket = agingBucketOf(due, TODAY);
      const r = bucketDueRange(bucket, TODAY);
      expect(r.dueFrom === null || due >= r.dueFrom, `${due} ${bucket}`).toBe(true);
      expect(r.dueTo === null || due <= r.dueTo, `${due} ${bucket}`).toBe(true);
      // Başka hiçbir kovanın aralığına düşmez.
      for (const other of AGING_BUCKETS) {
        if (other === bucket) continue;
        const o = bucketDueRange(other, TODAY);
        const inside = (o.dueFrom === null || due >= o.dueFrom) && (o.dueTo === null || due <= o.dueTo);
        expect(inside, `${due} hem ${bucket} hem ${other}`).toBe(false);
      }
    }
    expect(bucketDueRange("vadesi_gelmedi", TODAY).includeNull).toBe(true);
  });

  it("normalizeAging 5 kovayı sabit sırayla doldurur, toplam = kova toplamı", () => {
    const s = normalizeAging([
      { bucket: "90+", cnt: 1, amount: "100.10" },
      { bucket: "0-30", cnt: 2, amount: 200.2 },
      { bucket: "bilinmeyen", cnt: 5, amount: 999 },
    ]);
    expect(s.rows.map((r) => r.bucket)).toEqual([...AGING_BUCKETS]);
    expect(s.total).toBe(300.3);
    expect(s.count).toBe(3);
    expect(s.overdue).toBe(300.3);
    expect(s.rows.reduce((a, r) => a + r.amount, 0)).toBeCloseTo(s.total, 10);
  });

  it("agingFromItems: kovaların toplamı açık kalemler toplamına eşit (kuruş hassas)", () => {
    const items = [
      { due_date: TODAY, amount_open: 0.1 },
      { due_date: addDays(TODAY, -5), amount_open: 0.2 },
      { due_date: addDays(TODAY, -45), amount_open: 1234.56 },
      { due_date: addDays(TODAY, -75), amount_open: "10" },
      { due_date: addDays(TODAY, -400), amount_open: 7 },
      { due_date: null, amount_open: 3 },
      { due_date: addDays(TODAY, -5), amount_open: 0 },
    ];
    const s = agingFromItems(items, TODAY);
    expect(s.total).toBe(1254.86);
    expect(s.count).toBe(6);
    expect(s.rows.find((r) => r.bucket === "vadesi_gelmedi")).toEqual({ bucket: "vadesi_gelmedi", cnt: 2, amount: 3.1 });
    expect(s.overdue).toBe(1251.76);
    expect(s.overdueCount).toBe(4);
  });

  it("bucketShare: boşta 0, doluda en az %2", () => {
    expect(bucketShare(0, 100)).toBe(0);
    expect(bucketShare(5, 0)).toBe(0);
    expect(bucketShare(1, 1000)).toBe(2);
    expect(bucketShare(50, 100)).toBe(50);
  });
});

describe("açık kalem durumu ve kısmi tahsilat", () => {
  it("statusAfter ve remainingOf", () => {
    expect(statusAfter(1000, 0)).toBe("open");
    expect(statusAfter(1000, 400)).toBe("partial");
    expect(statusAfter(1000, 1000)).toBe("paid");
    expect(statusAfter(0.3, 0.1 + 0.2)).toBe("paid");
    expect(remainingOf(1000, 400)).toBe(600);
    expect(remainingOf(100, 150)).toBe(0);
  });
  it("parseSettleAmount kalan tutarı aşamaz, TR biçimini okur", () => {
    expect(parseSettleAmount("400", 1000)).toEqual({ ok: true, value: 400 });
    expect(parseSettleAmount("1.000,50", 1000.5)).toEqual({ ok: true, value: 1000.5 });
    expect(parseSettleAmount("1000,51", 1000.5).ok).toBe(false);
    expect(parseSettleAmount("0", 10).ok).toBe(false);
    expect(parseSettleAmount("-5", 10).ok).toBe(false);
    expect(parseSettleAmount("abc", 10).ok).toBe(false);
  });
});

describe("ekstre", () => {
  it("kapanış bakiyesi = son yürüyen bakiye; yeniden hesap tutarlı", () => {
    const lines = [
      { d: "2026-09-01", doc_type: "receivable", ref_id: null, title: "Alacak", debit: "1000", credit: 0, running_balance: "1000", href: "/app/giderler?sekme=cari" },
      { d: "2026-09-10", doc_type: "entry", ref_id: null, title: "Tahsilat", debit: 0, credit: "400", running_balance: "600", href: "https://kotu.example" },
    ].map((r) => normalizeStatementLine(r));
    expect(closingBalance(lines)).toBe(600);
    expect(recomputeRunning(lines)).toEqual([1000, 600]);
    expect(lines[1].href).toBeNull();
    expect(closingBalance([])).toBe(0);
  });
  it("safeHref yalnız uygulama içi yolları geçirir", () => {
    expect(safeHref("/app/kiralama?x=1")).toBe("/app/kiralama?x=1");
    expect(safeHref("/app")).toBe("/app");
    expect(safeHref("//evil.com/app")).toBeNull();
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("/application")).toBeNull();
  });
  it("bakiye açıklaması", () => {
    expect(balanceCaption(10)).toBe("Cari bize borçlu");
    expect(balanceCaption(-0.004)).toBe("Hesap kapalı");
    expect(balanceCaption(-5)).toBe("Biz cariye borçluyuz");
  });
});

describe("cari türleri ve öneri", () => {
  it("tür doğrulama ve etiket", () => {
    expect(partyKindOf("malik")).toBe("malik");
    expect(partyKindOf("x")).toBeNull();
    expect(partyKindLabel("tedarikci")).toBe("Tedarikçi");
    expect(partyKindLabel(null)).toBe("Diğer");
  });
  it("kindHintFor kaynağa ve kategoriye göre öneri", () => {
    expect(kindHintFor({ sourceType: "rent" })).toBe("kiraci");
    expect(kindHintFor({ category: "mulk_sahibi_odeme" })).toBe("malik");
    expect(kindHintFor({ category: "komisyon", direction: "in" })).toBe("musteri");
    expect(kindHintFor({ category: "maas", direction: "out" })).toBe("danisman");
    expect(kindHintFor({ direction: "out", category: "ofis" })).toBe("tedarikci");
    expect(kindHintFor({})).toBeNull();
  });
});

describe("açık kalemlerde çift kayıt yok", () => {
  it("aynı anahtar tek satır; elle açılmış kalemin kapsadığı kaynak satırı düşer", () => {
    const rows = [
      { key: "rent:r1", source: "rent", source_id: "r1" },
      { key: "rent:r1", source: "rent", source_id: "r1" },
      { key: "commission:c1", source: "commission", source_id: "c1" },
      { key: "manual:m1", source: "manual", source_id: "m1", manual_source: { type: "commission", id: "c1" } },
      { key: "rent:r2", source: "rent", source_id: "r2" },
    ];
    expect(dedupeOpenItems(rows).map((r) => r.key)).toEqual(["rent:r1", "manual:m1", "rent:r2"]);
  });
});

describe("malik carisi özeti (yalnız gösterim)", () => {
  it("ödenecek = kira − ücret − masraf − stopaj − ödenen", () => {
    const s = summarizeOwnerStatement(
      [
        { rentalId: "r1", propertyId: "p1", propertyLabel: "A", collected: 20000, fee: 1600, charges: 500.5, paidOut: 10000 },
        { rentalId: "r2", propertyId: "p2", propertyLabel: "B", collected: 10000, fee: 800, charges: 0, paidOut: 0 },
      ],
      2000.1,
    );
    expect(s.totals.collected).toBe(30000);
    expect(s.totals.fee).toBe(2400);
    expect(s.totals.charges).toBe(500.5);
    // Stopaj yalnız bilgi: hak edişten ve ödenecekten düşülmez (finance_open_items_v.owner_payout ile aynı formül).
    expect(s.totals.withholding).toBe(2000.1);
    expect(s.totals.entitlement).toBe(27099.5);
    expect(s.totals.payable).toBe(17099.5);
    expect(s.totals.overpaid).toBe(0);
    expect(s.rentals[0].balance).toBe(7899.5);
    // Ödenecek = görünümün owner_payout satırları toplamı (bakiyesi > 0 olan kiralar).
    expect(s.totals.payable).toBe(s.rentals.filter((r) => r.balance > 0).reduce((a, r) => a + r.balance, 0));
  });
  it("kira bazında: bir kiradaki fazla ödeme diğerinin ödenecek tutarını azaltmaz (görünümle aynı)", () => {
    const s = summarizeOwnerStatement(
      [
        { rentalId: "r1", propertyId: "p1", propertyLabel: "A", collected: 1000, fee: 0, charges: 0, paidOut: 0 },
        { rentalId: "r2", propertyId: "p2", propertyLabel: "B", collected: 1000, fee: 0, charges: 0, paidOut: 1300 },
      ],
      0,
    );
    expect(s.totals.payable).toBe(1000);
    expect(s.totals.overpaid).toBe(300);
  });
  it("fazla ödemede ödenecek 0, fazla ayrı gösterilir", () => {
    const s = summarizeOwnerStatement([{ rentalId: "r", propertyId: "p", propertyLabel: "", collected: 1000, fee: 0, charges: 0, paidOut: 1500 }], 0);
    expect(s.totals.payable).toBe(0);
    expect(s.totals.overpaid).toBe(500);
  });
});

describe("ekstre sözleşmesi (FN1 finance_party_statement)", () => {
  it("doc_type etiketleri RPC değerleriyle birebir", () => {
    expect(Object.keys(STATEMENT_DOC_LABEL).sort()).toEqual(["alacak", "borc", "devir", "odeme", "pesin_odeme", "pesin_tahsilat", "tahsilat"]);
    expect(statementDocLabel("alacak")).toBe("Alacak");
    expect(statementDocLabel("borc")).toBe("Borç");
    expect(statementDocLabel("tahsilat")).toBe("Tahsilat");
    expect(statementDocLabel("odeme")).toBe("Ödeme");
    expect(statementDocLabel("pesin_tahsilat")).toBe("Peşin tahsilat");
    expect(statementDocLabel("pesin_odeme")).toBe("Peşin ödeme");
    expect(statementDocLabel("devir")).toBe("Devir");
    expect(statementDocLabel("bilinmeyen")).toBe("Kayıt");
  });
  it("süzgeçsiz ekstre sınırsız okunur (devir yok, ileri tarih dahil → kapanış = liste bakiyesi)", () => {
    expect(statementRpcArgs("p", "", "")).toEqual({ p_party_id: "p", p_from: null, p_to: null });
    expect(statementRpcArgs("p", null, undefined)).toEqual({ p_party_id: "p", p_from: null, p_to: null });
    expect(statementRpcArgs("p", "2026-01-01", "")).toEqual({ p_party_id: "p", p_from: "2026-01-01", p_to: null });
    expect(statementRpcArgs("p", "", "2026-02-01")).toEqual({ p_party_id: "p", p_from: null, p_to: "2026-02-01" });
  });
  it("liste bakiyesi (açık alacak − açık borç) = süzgeçsiz ekstrenin kapanışı", () => {
    // Fixture: 1000 alacak, 400 kısmi tahsilat (bağlı), 250 borç, bağsız peşin hareket (borç=alacak, nötr).
    const lines = [
      { d: "2026-09-01", doc_type: "alacak", ref_id: "a", title: "Hizmet", debit: 1000, credit: 0, running_balance: 1000, href: null },
      { d: "2026-09-05", doc_type: "tahsilat", ref_id: "t", title: "Tahsilat", debit: 0, credit: 400, running_balance: 600, href: null },
      { d: "2026-09-10", doc_type: "pesin_odeme", ref_id: "x", title: "Peşin", debit: 75, credit: 75, running_balance: 600, href: null },
      { d: "2026-12-01", doc_type: "borc", ref_id: "b", title: "İleri tarihli borç", debit: 0, credit: 250, running_balance: 350, href: null },
    ].map(normalizeStatementLine);
    const recvOpen = 1000 - 400;
    const payOpen = 250;
    expect(closingBalance(lines)).toBe(recvOpen - payOpen);
    expect(recomputeRunning(lines).at(-1)).toBe(recvOpen - payOpen);
  });
});
