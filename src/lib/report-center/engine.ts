/**
 * Rapor motoru: tanımdan satırları okur (önizleme ve tam toplama). SUNUCU kodudur; biçim yazıcılarına bağlı değildir.
 *
 * Okuma `fetchAllRows` ile aynı sözleşmeyi izler (1000'lik deterministik `range` sayfaları, RLS'li oturum istemcisi),
 * fakat satırları bellekte biriktirmez: her sayfa hemen hücrelere çevrilir; satır tavanı ve süre tavanı aşılırsa
 * toplama DURUR, `truncated` işaretlenir ve dosya/arayüz bunu açıkça bildirir (sessiz kesme yok).
 */
import { now } from "@/lib/clock";
import { formatValue, type CustomFieldDef, type CustomFieldValueRow } from "@/lib/custom-fields/core";
import { loadCustomFieldDefs, loadCustomFieldValues } from "@/lib/custom-fields/load";
import { actionErrorMessage } from "@/lib/action-errors";
import { REPORT_MAX_MS, REPORT_PREVIEW_ROWS, type CellValue, type Filters, type ReportContext, type ReportDef, type ReportTable, type Row } from "./types";

const PAGE_SIZE = 1000;

export type StopReason = "rows" | "time" | null;

export type CollectResult =
  | { ok: true; table: ReportTable; total: number; truncated: boolean; stopReason: StopReason }
  | { ok: false; error: string };

export function tableShell(def: ReportDef, custom: readonly CustomFieldDef[] = []): ReportTable["columns"] {
  return [
    ...def.columns.map((c) => ({ key: c.key, label: c.label, type: c.type, width: c.width, decimals: c.decimals, total: c.total })),
    ...custom.map((d) => ({ key: `ozel_${d.id}`, label: `Özel: ${d.label}`, type: "text" as const, width: 20, decimals: undefined, total: undefined })),
  ];
}

function cellsOf(def: ReportDef, row: Row, ctx: ReportContext): CellValue[] {
  return def.columns.map((c) => {
    try {
      return c.get(row, ctx);
    } catch {
      return "";
    }
  });
}

const FAIL = "Rapor hazırlanamadı. Lütfen filtreleri kontrol edip tekrar deneyin.";

type PageResult = { data: unknown[] | null; error: { message: string; code?: string } | null; count?: number | null };

/**
 * Raporu toplar. `maxRows`: ulaşılırsa durur (truncated). Önizleme için `maxRows = REPORT_PREVIEW_ROWS` verilir;
 * `total` yine tam satır sayısıdır (PostgREST `count: exact`; hesaplanan raporlarda satır sayısı).
 */
export async function collectReport(
  def: ReportDef,
  ctx: ReportContext,
  filters: Filters,
  opts: { maxRows: number; maxMs?: number },
): Promise<CollectResult> {
  const startedAt = now();
  const maxMs = opts.maxMs ?? REPORT_MAX_MS;
  const rows: CellValue[][] = [];
  const src = def.source;
  // Özel alanlar: tanımlar bir kez, değerler sayfa başına (RLS'li istemci + kiracı filtresi). Okuma hatası raporu bozmaz.
  const customDefs: CustomFieldDef[] =
    def.customFields && ctx.tenantId ? await loadCustomFieldDefs(ctx.supabase, ctx.tenantId, def.customFields).then((r) => r.defs).catch(() => []) : [];
  const customCells = async (page: Row[]): Promise<CellValue[][]> => {
    if (customDefs.length === 0) return page.map(() => []);
    const values = await loadCustomFieldValues(ctx.supabase, ctx.tenantId!, def.customFields!, page.map((r) => String(r.id ?? ""))).catch(
      () => new Map<string, Map<string, CustomFieldValueRow>>(),
    );
    return page.map((r) => {
      const rowValues = values.get(String(r.id ?? ""));
      return customDefs.map((d) => formatValue(d, rowValues?.get(d.id)));
    });
  };

  try {
    if (src.kind === "compute") {
      const all = await src.run(ctx, filters);
      const take = all.slice(0, opts.maxRows);
      for (const r of take) rows.push(cellsOf(def, r, ctx));
      return { ok: true, table: { columns: tableShell(def), rows }, total: all.length, truncated: all.length > take.length, stopReason: all.length > take.length ? "rows" : null };
    }

    let total: number | null = null;
    let offset = 0;
    let stopReason: StopReason = null;
    for (;;) {
      const want = Math.min(PAGE_SIZE, opts.maxRows - rows.length);
      if (want <= 0) {
        stopReason = "rows";
        break;
      }
      // Her sayfa için TAZE sorgu (paylaşılan builder durumu sızmasın).
      const res = (await src.build(ctx, filters).range(offset, offset + want - 1)) as PageResult;
      if (res.error) {
        console.error("report.page", def.id, res.error.message);
        return { ok: false, error: actionErrorMessage(res.error, FAIL) };
      }
      if (total === null && typeof res.count === "number") total = res.count;
      const page = (res.data ?? []) as Row[];
      if (src.enrich && page.length) await src.enrich(page, ctx);
      const extra = await customCells(page);
      page.forEach((r, i) => rows.push([...cellsOf(def, r, ctx), ...extra[i]!]));
      offset += page.length;
      if (page.length < want) break;
      if (rows.length >= opts.maxRows) {
        // Daha fazla kayıt var mı? Sayım biliniyorsa ona bak; bilinmiyorsa kesilmiş say.
        stopReason = total === null || total > rows.length ? "rows" : null;
        break;
      }
      if (now() - startedAt > maxMs) {
        stopReason = "time";
        break;
      }
    }
    const grand = total ?? rows.length;
    return { ok: true, table: { columns: tableShell(def, customDefs), rows }, total: grand, truncated: stopReason !== null && (total === null || grand > rows.length), stopReason };
  } catch (e) {
    console.error("report.collect", def.id, e);
    return { ok: false, error: actionErrorMessage(e, FAIL) };
  }
}

/** İlk satırlar + tam satır sayısı (arayüz önizlemesi). */
export function previewReport(def: ReportDef, ctx: ReportContext, filters: Filters) {
  return collectReport(def, ctx, filters, { maxRows: REPORT_PREVIEW_ROWS });
}
