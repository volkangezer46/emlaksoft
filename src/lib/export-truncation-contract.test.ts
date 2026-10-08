import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { collectReport } from "./report-center/engine";
import { buildCsv } from "./report-center/format/csv";
import { REPORT_PREVIEW_ROWS, REPORT_ROW_LIMITS, type ReportDef } from "./report-center/types";
import { testCtx } from "./report-center/test-support";

/**
 * Dışa aktarma sınırı ve denetim izi sözleşmesi (rapor merkezi): sınıra takılma ASLA sessiz değildir —
 * motor `truncated` işaretler, dosya uyarı satırı taşır, arayüz kullanıcıya söyler ve her indirme denetim kaydına yazılır.
 */
const read = (p: string) => readFileSync(p, "utf8");

/** `range(from,to)` destekleyen sahte sayfalı sorgu. */
function pagedQuery(total: number, opts: { failAt?: number } = {}) {
  const calls: [number, number][] = [];
  const build = () => ({
    range: (from: number, to: number) => {
      calls.push([from, to]);
      if (opts.failAt !== undefined && from >= opts.failAt) {
        return Promise.resolve({ data: null, error: { message: 'relation "x" does not exist', code: "42P01" }, count: null });
      }
      const n = Math.max(0, Math.min(to + 1, total) - from);
      return Promise.resolve({ data: Array.from({ length: n }, (_, i) => ({ id: from + i })), error: null, count: total });
    },
  });
  return { build, calls };
}

function defOf(source: ReportDef["source"]): ReportDef {
  return {
    id: "deneme",
    title: "Deneme",
    description: "Sınır sözleşmesi için sahte rapor tanımı.",
    category: "musteri",
    scope: "tenant",
    module: "customers",
    filters: [],
    columns: [{ key: "id", label: "Sıra", type: "number", get: (r) => r.id }],
    source,
  };
}

describe("satır tavanı", () => {
  it("tavan aşılırsa durur, kesildi işaretler ve toplam sayıyı korur", async () => {
    const q = pagedQuery(2500);
    const { ctx } = testCtx();
    const res = await collectReport(defOf({ kind: "query", build: q.build as never }), ctx, {}, { maxRows: 2000 });
    expect(res).toMatchObject({ ok: true, total: 2500, truncated: true, stopReason: "rows" });
    if (res.ok) expect(res.table.rows).toHaveLength(2000);
    expect(q.calls).toEqual([[0, 999], [1000, 1999]]);
  });

  it("tavanın altında tüm sayfaları okur ve kesmez", async () => {
    const q = pagedQuery(1500);
    const { ctx } = testCtx();
    const res = await collectReport(defOf({ kind: "query", build: q.build as never }), ctx, {}, { maxRows: 2000 });
    expect(res).toMatchObject({ ok: true, total: 1500, truncated: false, stopReason: null });
    if (res.ok) expect(res.table.rows).toHaveLength(1500);
  });

  it("tam tavan kadar kayıt kesilmiş sayılmaz", async () => {
    const q = pagedQuery(1000);
    const { ctx } = testCtx();
    const res = await collectReport(defOf({ kind: "query", build: q.build as never }), ctx, {}, { maxRows: 1000 });
    expect(res).toMatchObject({ ok: true, total: 1000, truncated: false });
  });

  it("süre tavanı: kalan sayfa varken süre dolarsa kesildi işaretlenir", async () => {
    const q = pagedQuery(5000);
    const { ctx } = testCtx();
    const res = await collectReport(defOf({ kind: "query", build: q.build as never }), ctx, {}, { maxRows: 5000, maxMs: -1 });
    expect(res).toMatchObject({ ok: true, truncated: true, stopReason: "time", total: 5000 });
    if (res.ok) expect(res.table.rows.length).toBeLessThan(5000);
  });

  it("önizleme yalnız ilk satırları okur ama toplam sayıyı verir", async () => {
    const q = pagedQuery(12_345);
    const { ctx } = testCtx();
    const res = await collectReport(defOf({ kind: "query", build: q.build as never }), ctx, {}, { maxRows: REPORT_PREVIEW_ROWS });
    expect(res).toMatchObject({ ok: true, total: 12_345 });
    if (res.ok) expect(res.table.rows).toHaveLength(REPORT_PREVIEW_ROWS);
    expect(q.calls).toEqual([[0, REPORT_PREVIEW_ROWS - 1]]);
  });

  it("sayfa hatası ham veritabanı metni sızdırmadan Türkçe hata döner", async () => {
    const q = pagedQuery(3000, { failAt: 1000 });
    const { ctx } = testCtx();
    const res = await collectReport(defOf({ kind: "query", build: q.build as never }), ctx, {}, { maxRows: 3000 });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).not.toMatch(/relation|42P01/);
      expect(res.error.length).toBeGreaterThan(10);
    }
  });

  it("hesaplanan rapor tavanı da uygulanır", async () => {
    const { ctx } = testCtx();
    const rows = Array.from({ length: 30 }, (_, i) => ({ id: i }));
    const res = await collectReport(defOf({ kind: "compute", run: async () => rows }), ctx, {}, { maxRows: 10 });
    expect(res).toMatchObject({ ok: true, total: 30, truncated: true });
    if (res.ok) expect(res.table.rows).toHaveLength(10);
  });
});

describe("uyarı ve denetim izi", () => {
  it("kesilen CSV dosyasının sonunda açık uyarı satırı vardır", () => {
    const csv = buildCsv({ truncated: true }, { columns: [{ key: "a", label: "A", type: "text" }], rows: [["x"]] });
    expect(csv).toContain("UYARI: Güvenlik sınırı nedeniyle");
    expect(buildCsv({ truncated: false }, { columns: [{ key: "a", label: "A", type: "text" }], rows: [["x"]] })).not.toContain("UYARI");
  });

  it("tavanlar tek sabitte; PDF tavanı en düşük (dosya boyutu)", () => {
    expect(REPORT_ROW_LIMITS).toEqual({ xlsx: 100_000, pdf: 3_000, csv: 200_000 });
    expect(read("src/lib/report-center/engine.ts")).toContain("opts.maxRows");
  });

  it("her indirme kişisel veri içermeyen denetim kaydı yazar (sayı, kesilme, durma nedeni, filtre anahtarları)", () => {
    const s = read("src/lib/report-center/download.ts");
    expect(s).toContain('REPORT_EXPORT_ACTION = "export.report"');
    expect(s).toContain("rows: result.rowCount");
    expect(s).toContain("truncated: result.truncated");
    expect(s).toContain("stopReason: result.stopReason");
    // serbest metin filtreleri (ad / telefon olabilir) kayda girmez
    expect(s).toContain('f.kind === "text" ? "(metin)" : v');
    // platform tarafı
    expect(s).toContain("logPlatformActivity(");
    expect(s).toContain("X-Report-Truncated");
    // denetim eylemi "export." ile başlar → ofis kontrol uyarı kuralları (toplu indirme) çalışmaya devam eder
    expect("export.report".startsWith("export.")).toBe(true);
  });

  it("arayüz kesilmeyi kullanıcıya gösterir", () => {
    const b = read("src/components/report-center/download-buttons.tsx");
    expect(b).toContain("x-report-truncated");
    expect(b).toContain("sınırlandı");
  });

  it("denetim kaydı etiketi tanımlı", () => {
    expect(read("src/lib/audit-labels.ts")).toContain('"export.report"');
  });
});
