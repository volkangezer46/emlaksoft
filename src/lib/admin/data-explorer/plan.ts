/**
 * Veri gezgini (SN4) GÜVENLİ SORGU OLUŞTURUCU — saf. URL parametreleri (`?tablo=&ofis=&f_<sütun>=&bas=&bit=&sayfa=&kayit=`)
 * yalnız kayıt (`registry.ts`) üzerinden yorumlanır: bilinmeyen tablo/sütun yok sayılır, değerler türüne göre doğrulanır,
 * `ilike` deseni `safeLike` ile temizlenir, maskeli sütun süzülmez. Sonuç bir PLAN'dır; sorguyu `read.ts` kurar.
 * Ham SQL ya da serbest PostgREST dizgesi (or/not/select) kullanıcıdan alınmaz.
 */
import { safeLike } from "@/lib/pgrst";
import { explorerTable, filterColumns, type ExplorerColumn, type ExplorerTable } from "./registry";

export const EXPLORER_BASE = "/admin/sistem?sekme=veri";
export const EXPLORER_PAGE_SIZE = 25;
const MAX_PAGE = 400;
const MAX_TEXT = 80;

export type ExplorerFilter =
  | { column: string; label: string; op: "eq"; value: string }
  | { column: string; label: string; op: "ilike"; value: string; pattern: string }
  | { column: string; label: string; op: "bool"; value: boolean };

export type ExplorerOffice = { id: string } | { slug: string } | null;

export type ExplorerPlan = {
  table: ExplorerTable;
  office: ExplorerOffice;
  filters: ExplorerFilter[];
  /** Tarih aralığı (`orderBy` sütunu üzerinde, Türkiye günü; YYYY-AA-GG). */
  from: string | null;
  to: string | null;
  page: number;
  recordId: string | null;
};

export type ExplorerParams = Record<string, string | string[] | undefined>;

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const one = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? "") : (v ?? "")).trim();

export const filterParam = (column: string) => `f_${column}`;

function parseFilter(col: ExplorerColumn, raw: string): ExplorerFilter | null {
  if (!raw || col.mask || !col.filter) return null;
  const v = raw.slice(0, MAX_TEXT);
  if (col.filter === "bool") {
    if (v === "evet") return { column: col.key, label: col.label, op: "bool", value: true };
    if (v === "hayir") return { column: col.key, label: col.label, op: "bool", value: false };
    return null;
  }
  if (col.filter === "search") {
    const pattern = safeLike(v, MAX_TEXT);
    return pattern === "%%" ? null : { column: col.key, label: col.label, op: "ilike", value: v, pattern };
  }
  if (col.kind === "uuid") return UUID_RE.test(v) ? { column: col.key, label: col.label, op: "eq", value: v.toLowerCase() } : null;
  if (col.options) return col.options.includes(v) ? { column: col.key, label: col.label, op: "eq", value: v } : null;
  return { column: col.key, label: col.label, op: "eq", value: v };
}

function parseOffice(raw: string): ExplorerOffice {
  if (!raw) return null;
  if (UUID_RE.test(raw)) return { id: raw.toLowerCase() };
  const slug = raw.toLowerCase();
  return SLUG_RE.test(slug) ? { slug } : null;
}

const parseDay = (raw: string): string | null => (DAY_RE.test(raw) ? raw : null);

/** URL → plan. Tablo seçilmemiş ya da kayıtta yoksa null (tablo listesi gösterilir). */
export function parseExplorerParams(sp: ExplorerParams): ExplorerPlan | null {
  const table = explorerTable(one(sp.tablo));
  if (!table) return null;
  const filters = filterColumns(table)
    .map((c) => parseFilter(c, one(sp[filterParam(c.key)])))
    .filter((f): f is ExplorerFilter => f !== null);
  const pageNum = Number(one(sp.sayfa));
  const record = one(sp.kayit);
  return {
    table,
    office: table.tenantColumn ? parseOffice(one(sp.ofis)) : null,
    filters,
    from: parseDay(one(sp.bas)),
    to: parseDay(one(sp.bit)),
    page: Number.isInteger(pageNum) && pageNum > 1 ? Math.min(pageNum, MAX_PAGE) : 1,
    recordId: UUID_RE.test(record) ? record.toLowerCase() : null,
  };
}

/** Türkiye günü sınırları (UTC+3 sabit; Türkiye yaz saati uygulamaz). */
export const dayStartIso = (day: string) => `${day}T00:00:00+03:00`;
export const dayEndIso = (day: string) => `${day}T23:59:59.999+03:00`;

type HrefInput = {
  table: string;
  office?: string | null;
  filters?: readonly Pick<ExplorerFilter, "column" | "value">[];
  from?: string | null;
  to?: string | null;
  page?: number;
  recordId?: string | null;
};

/** Gezgin adresi: süzgeçler korunur (sayfalama, kayıt ayrıntısı, ofise süz bağlantıları). */
export function explorerHref(p: HrefInput): string {
  const sp = new URLSearchParams();
  sp.set("tablo", p.table);
  if (p.office) sp.set("ofis", p.office);
  for (const f of p.filters ?? []) sp.set(filterParam(f.column), typeof f.value === "boolean" ? (f.value ? "evet" : "hayir") : f.value);
  if (p.from) sp.set("bas", p.from);
  if (p.to) sp.set("bit", p.to);
  if (p.page && p.page > 1) sp.set("sayfa", String(p.page));
  if (p.recordId) sp.set("kayit", p.recordId);
  return `${EXPLORER_BASE}&${sp.toString()}`;
}

/** Planın adres girdisi (ofis çözümlenmiş kimlikle). */
export const planHrefInput = (plan: ExplorerPlan, officeId: string | null): HrefInput => ({
  table: plan.table.key,
  office: officeId ?? (plan.office && "slug" in plan.office ? plan.office.slug : null),
  filters: plan.filters,
  from: plan.from,
  to: plan.to,
  page: plan.page,
});

/**
 * Denetim izi meta'sı: kim (aktör satırda), hangi tablo, hangi süzgeç. Süzgeç değerleri yalnız MASKESİZ sütunlardan
 * gelir (maskeli sütun süzülemez), bu yüzden meta'ya kişisel veri girmez.
 */
export function explorerAuditMeta(plan: ExplorerPlan, officeId: string | null): Record<string, unknown> {
  return {
    tablo: plan.table.table,
    ofis: officeId,
    suzgecler: Object.fromEntries(plan.filters.map((f) => [f.column, f.value])),
    tarih: plan.from || plan.to ? { sutun: plan.table.orderBy, bas: plan.from, bit: plan.to } : null,
    sayfa: plan.recordId ? null : plan.page,
    kayit: plan.recordId,
  };
}
