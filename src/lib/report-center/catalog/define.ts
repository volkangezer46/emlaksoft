/**
 * Katalog yardımcıları: tür güvenli tanım kurucu + sık kullanılan filtre alanları.
 * Her rapor kendi sorgusunda kiracı sınırını (`.eq("tenant_id", ctx.tenantId!)`) ve aktör kapsamını
 * (`applyActorScope`) uygular — bkz. `report-scope-contract.test.ts`.
 */
import type { FilterField, ReportContext, ReportDef, Row, SelectOption } from "../types";

export function defineReport<R = Row>(def: ReportDef<R>): ReportDef {
  return def as unknown as ReportDef;
}

export const ADVISOR_FILTER: FilterField = { kind: "advisor", key: "advisor", label: "Danışman" };
export const SEARCH_FILTER = (label = "Arama", placeholder?: string): FilterField => ({ kind: "text", key: "q", label, placeholder });

export function opts(map: Record<string, string>): SelectOption[] {
  return Object.entries(map).map(([value, label]) => ({ value, label }));
}

/** Kiracı kimliği (tenant raporlarında her zaman dolu; kapı bunu garanti eder). */
export function tid(ctx: ReportContext): string {
  if (!ctx.tenantId) throw new Error("Kiracı bağlamı yok.");
  return ctx.tenantId;
}
