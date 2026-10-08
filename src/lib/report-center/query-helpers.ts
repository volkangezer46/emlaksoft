/**
 * Rapor sorgusu yardımcıları: tarih aralığı, aktör kapsamı ve ad çözümü.
 * Kapsam kuralları mevcut dışa aktarma kurallarıyla BİREBİR aynıdır:
 *  - `hasOfficeWideDataScope` yoksa (danışman, çağrı merkezi...) yalnız kendi kayıtları;
 *  - ofis geneli ise ofis bayrağıyla (`office.access.scope_enforcement`) çözümlenmiş liste kapsamı yalnız DARALTIR;
 *  - kazanç raporlarında (komisyon, denetim...) `earnings_all` yoksa yalnız kendi kayıtları.
 * Her kiracı raporu kendi sorgusunda `.eq("tenant_id", ctx.tenantId!)` taşır (sözleşme testi bunu doğrular).
 */
import { TR_OFFSET_MS } from "@/lib/clock";
import { orIlike } from "@/lib/pgrst";
import type { CellValue, Filters, ReportContext, Row } from "./types";

/** Zincirlenebilir sorgu (Supabase kurucusunun derin generiğine girmeden). */
type Chain = {
  eq: (c: string, v: unknown) => Chain;
  in: (c: string, v: unknown[]) => Chain;
  gte: (c: string, v: unknown) => Chain;
  lt: (c: string, v: unknown) => Chain;
  lte: (c: string, v: unknown) => Chain;
  or: (f: string) => Chain;
};

/** Gün başlangıcı (TR) ISO. */
export function dayStartIso(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) - TR_OFFSET_MS).toISOString();
}

/** Ertesi günün başlangıcı (TR) ISO — bitiş tarihi DAHİL olsun diye `lt` ile kullanılır. */
export function nextDayStartIso(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000 - TR_OFFSET_MS).toISOString();
}

/** `from`/`to` filtrelerini zaman damgalı (timestamptz) sütuna uygular. */
export function applyTimestampRange<Q>(query: Q, column: string, f: Filters): Q {
  let q = query as unknown as Chain;
  if (f.from) q = q.gte(column, dayStartIso(f.from));
  if (f.to) q = q.lt(column, nextDayStartIso(f.to));
  return q as unknown as Q;
}

/** `from`/`to` filtrelerini takvim günü (date) sütununa uygular. */
export function applyDateRange<Q>(query: Q, column: string, f: Filters): Q {
  let q = query as unknown as Chain;
  if (f.from) q = q.gte(column, f.from);
  if (f.to) q = q.lte(column, f.to);
  return q as unknown as Q;
}

/**
 * Aktör kapsamı. `actorColumn`: kaydın sahibi/oluşturanı (danışman için `eq` uygulanır);
 * `ownerColumn` verilirse (ör. `customer.assigned_to`) ofis kapsamı bayrağı o sütuna bağlanır.
 */
export function applyActorScope<Q>(
  ctx: ReportContext,
  query: Q,
  opts: { actorColumn: string; ownerColumn?: string; earnings?: boolean; sample?: boolean },
): Q {
  // `is_sample` taşıyan tablolarda örnek veri kapsamı (eşik altı ofiste örnek dahil, gerçek ofiste hariç).
  if (opts.sample) query = ctx.sample.apply(query);
  const q = query as unknown as Chain;
  if (!ctx.officeWide || (opts.earnings && !ctx.seeAllEarnings)) return q.eq(opts.actorColumn, ctx.userId) as unknown as Q;
  const col = opts.ownerColumn ?? opts.actorColumn;
  const s = ctx.listScope;
  if (s.kind === "self") return q.eq(col, s.userId) as unknown as Q;
  if (s.kind === "members") return q.in(col, s.ids) as unknown as Q;
  return query;
}

/** Satırdan embed (obje ya da dizi) tek kayda. */
export function one<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/** Kimlik → ad eşlemesini (`ctx.names`) tek sorguda tamamlar. */
export async function fillNames(ctx: ReportContext, table: "profiles" | "tenants" | "platform_staff" | "customers", column: string, ids: Iterable<string | null | undefined>): Promise<void> {
  const need = [...new Set([...ids].filter((v): v is string => !!v && !ctx.names.has(v)))];
  for (let i = 0; i < need.length; i += 150) {
    const chunk = need.slice(i, i + 150);
    let q = ctx.supabase.from(table).select(`id, ${column}`).in("id", chunk);
    if ((table === "profiles" || table === "customers") && ctx.tenantId) q = q.eq("tenant_id", ctx.tenantId);
    const { data } = await q;
    for (const r of (data ?? []) as unknown as Row[]) ctx.names.set(String(r.id), String(r[column] ?? ""));
  }
}

export const nameOf = (ctx: ReportContext, id: string | null | undefined): string => (id ? (ctx.names.get(id) ?? "") : "");

/** Profil adlarını (aynı ofis) çözen `enrich` üreticisi. */
export function enrichProfiles(idsOf: (row: Row) => (string | null | undefined)[]) {
  return async (rows: Row[], ctx: ReportContext) => {
    await fillNames(ctx, "profiles", "full_name", rows.flatMap(idsOf));
  };
}

/** Müşteri adlarını (aynı ofis) çözen `enrich` üreticisi. */
export function enrichCustomers(idsOf: (row: Row) => (string | null | undefined)[]) {
  return async (rows: Row[], ctx: ReportContext) => {
    await fillNames(ctx, "customers", "full_name", rows.flatMap(idsOf));
  };
}

/** Ofis adlarını çözen `enrich` üreticisi (platform raporları). */
export function enrichTenants(idsOf: (row: Row) => (string | null | undefined)[]) {
  return async (rows: Row[], ctx: ReportContext) => {
    await fillNames(ctx, "tenants", "name", rows.flatMap(idsOf));
  };
}

/** Personel adlarını çözen `enrich` üreticisi (platform raporları). */
export function enrichStaff(idsOf: (row: Row) => (string | null | undefined)[]) {
  return async (rows: Row[], ctx: ReportContext) => {
    await fillNames(ctx, "platform_staff", "full_name", rows.flatMap(idsOf));
  };
}

/** İki `enrich` işlevini art arda çalıştırır. */
export function chainEnrich(...fns: ((rows: Row[], ctx: ReportContext) => Promise<void>)[]) {
  return async (rows: Row[], ctx: ReportContext) => {
    for (const fn of fns) await fn(rows, ctx);
  };
}

/** Sözlük etiketi (bilinmeyen değer olduğu gibi). */
export function label(map: Record<string, string>, value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  return map[String(value)] ?? String(value);
}

export const joinList = (v: unknown): CellValue => (Array.isArray(v) ? v.filter(Boolean).join(", ") : (v as CellValue));

/** Serbest metin aramasını (güvenli `ilike`) verilen sütunlara uygular. */
export function searchOr<Q>(query: Q, columns: string[], term: string | undefined): Q {
  if (!term || !term.trim()) return query;
  return (query as unknown as Chain).or(orIlike(columns, term)) as unknown as Q;
}
