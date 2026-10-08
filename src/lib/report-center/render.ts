/**
 * Raporu seçilen biçimde dosyaya çevirir (SUNUCU): toplama (`collectReport`) + üst bilgi + biçim yazıcısı.
 * Route handler'lar ve testler tek giriş noktası olarak burayı kullanır.
 */
import { now, trDayKey } from "@/lib/clock";
import { collectReport, type StopReason } from "./engine";
import { buildCsv } from "./format/csv";
import { buildPdf, type PdfLogo } from "./format/pdf";
import { buildXlsx } from "./format/xlsx";
import { summarizeFilters } from "./filters";
import { fillNames } from "./query-helpers";
import { formatDateTimeTr, safeFileSlug } from "./values";
import { REPORT_ROW_LIMITS, type Filters, type ReportContext, type ReportDef, type ReportFormat, type ReportMeta } from "./types";

export const CONTENT_TYPES: Record<ReportFormat, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
  csv: "text/csv; charset=utf-8",
};

export type RenderResult =
  | {
      ok: true;
      body: Uint8Array;
      contentType: string;
      filename: string;
      /** Dosyaya yazılan satır sayısı. */
      rowCount: number;
      /** Kaynaktaki toplam satır sayısı. */
      total: number;
      truncated: boolean;
      stopReason: StopReason;
    }
  | { ok: false; error: string };

export async function buildReportMeta(
  def: ReportDef,
  ctx: ReportContext,
  filters: Filters,
  extra: { rowCount: number; truncated: boolean; generatedBy?: string },
): Promise<ReportMeta> {
  const advisorIds = def.filters.filter((f) => f.kind === "advisor").map((f) => filters[f.key]).filter((v): v is string => !!v);
  if (advisorIds.length) await fillNames(ctx, "profiles", "full_name", advisorIds);
  return {
    title: def.title,
    officeName: ctx.officeName,
    filterSummary: [
      ...summarizeFilters(def, filters, ctx.names),
      // Ofis henüz gerçek kullanıma geçmediyse örnek (demo) kayıtlar rakamlara dahildir: dosyada açıkça yazılır.
      ...(ctx.scope === "tenant" && ctx.sample.label ? [{ label: "Veri", value: ctx.sample.label }] : []),
    ],
    generatedAt: formatDateTimeTr(new Date(now()).toISOString()),
    generatedBy: extra.generatedBy,
    rowCount: extra.rowCount,
    truncated: extra.truncated,
    personalData: def.personalData === true,
    platform: def.scope === "platform",
  };
}

export async function renderReport(opts: {
  format: ReportFormat;
  def: ReportDef;
  ctx: ReportContext;
  filters: Filters;
  generatedBy?: string;
  logo?: PdfLogo | null;
}): Promise<RenderResult> {
  const { format, def, ctx, filters } = opts;
  const collected = await collectReport(def, ctx, filters, { maxRows: REPORT_ROW_LIMITS[format] });
  if (!collected.ok) return collected;
  const { table, total, truncated, stopReason } = collected;
  const meta = await buildReportMeta(def, ctx, filters, { rowCount: table.rows.length, truncated, generatedBy: opts.generatedBy });
  const createdIso = new Date(now()).toISOString();

  let body: Uint8Array;
  if (format === "xlsx") body = buildXlsx(meta, table, createdIso);
  else if (format === "pdf") body = await buildPdf(meta, table, createdIso, opts.logo);
  else body = new TextEncoder().encode(buildCsv(meta, table));

  return {
    ok: true,
    body,
    contentType: CONTENT_TYPES[format],
    filename: `${safeFileSlug(def.title) || def.id}-${trDayKey()}.${format}`,
    rowCount: table.rows.length,
    total,
    truncated,
    stopReason,
  };
}
