/**
 * Rapor filtreleri: tanımdaki alan listesinden zod şeması üretir, URL parametrelerini doğrular ve
 * dosya üst bilgisi için okunur özet çıkarır. Saf modül (istemciden de çağrılabilir).
 */
import { z } from "zod";
import type { FilterField, Filters, ReportDef } from "./types";

export const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
export const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validDay(v: string): boolean {
  if (!ISO_DAY.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

function fieldSchema(field: FilterField): z.ZodType<string> {
  switch (field.kind) {
    case "date":
      return z.string().refine(validDay, `${field.label}: geçerli bir tarih girin (GG.AA.YYYY).`);
    case "select": {
      const allowed = new Set(field.options.map((o) => o.value));
      return z.string().refine((v) => allowed.has(v), `${field.label}: geçersiz seçim.`);
    }
    case "advisor":
    case "campaign":
      return z.string().refine((v) => UUID_RX.test(v), `${field.label}: geçersiz seçim.`);
    case "text":
      return z.string().trim().max(120, `${field.label}: en fazla 120 karakter.`);
  }
}

/** Tanımın filtre alanlarından zod şeması (tüm alanlar isteğe bağlı). */
export function filterSchema(fields: readonly FilterField[]) {
  const shape: Record<string, z.ZodType<string | undefined>> = {};
  for (const f of fields) shape[f.key] = fieldSchema(f).optional();
  return z.object(shape);
}

export type ParsedFilters = { ok: true; filters: Filters } | { ok: false; error: string };

type RawInput = Record<string, string | string[] | undefined> | URLSearchParams;

function readRaw(input: RawInput, key: string): string | undefined {
  if (input instanceof URLSearchParams) return input.get(key) ?? undefined;
  const v = input[key];
  return Array.isArray(v) ? v[0] : v;
}

/** Yalnız tanımdaki anahtarları okur (bilinmeyen parametreler yok sayılır); boş değer atlanır. */
export function parseFilters(def: Pick<ReportDef, "filters">, input: RawInput): ParsedFilters {
  const raw: Record<string, string> = {};
  for (const f of def.filters) {
    const v = readRaw(input, f.key);
    if (v !== undefined && v.trim() !== "") raw[f.key] = v.trim();
  }
  const parsed = filterSchema(def.filters).safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Geçersiz filtre." };
  const filters = parsed.data as Filters;
  if (filters.from && filters.to && filters.from > filters.to) {
    return { ok: false, error: "Başlangıç tarihi bitiş tarihinden sonra olamaz." };
  }
  return { ok: true, filters };
}

/** Dosya üst bilgisi için okunur filtre özeti. `advisorNames`: danışman kimliği → ad. */
export function summarizeFilters(
  def: Pick<ReportDef, "filters">,
  filters: Filters,
  advisorNames?: ReadonlyMap<string, string>,
): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  for (const f of def.filters) {
    const v = filters[f.key];
    if (!v) continue;
    let value = v;
    if (f.kind === "date") value = `${v.slice(8, 10)}.${v.slice(5, 7)}.${v.slice(0, 4)}`;
    else if (f.kind === "select") value = f.options.find((o) => o.value === v)?.label ?? v;
    else if (f.kind === "advisor") value = advisorNames?.get(v) ?? "Seçili kişi";
    out.push({ label: f.label, value });
  }
  return out;
}

/** Filtreleri URL sorgu dizesine çevirir (boşlar atlanır). */
export function filtersToQuery(filters: Filters, extra: Record<string, string | undefined> = {}): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...extra, ...filters })) if (v) p.set(k, v);
  return p.toString();
}

/** Ortak "tarih aralığı" alanları (anahtarlar `from` / `to`). */
export const DATE_RANGE_FIELDS = (fromLabel = "Başlangıç tarihi", toLabel = "Bitiş tarihi"): FilterField[] => [
  { kind: "date", key: "from", label: fromLabel },
  { kind: "date", key: "to", label: toLabel },
];
