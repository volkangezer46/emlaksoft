import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { logPlatformActivityChecked } from "@/lib/platform-activity";
import { formatRow } from "./cells";
import { dayEndIso, dayStartIso, EXPLORER_PAGE_SIZE, explorerAuditMeta, type ExplorerPlan } from "./plan";
import { selectList, type ExplorerRecordLink } from "./registry";

/**
 * Veri gezgini (SN4) OKUYUCU — yalnız SELECT. service_role ile okur çünkü platform personeli ofis RLS'inin dışındadır;
 * bu yüzden üç kilit burada: (1) yalnız kayıtlı tablo/sütun (`selectList`), (2) maskeler sunucuda uygulanır ve ham satır
 * dönmez (`formatRow`), (3) her okuma denetim izine yazılır ve iz YAZILAMAZSA veri gösterilmez (fail-closed).
 * Denetim yazımı ile sorgu paralel koşar (HIZ ilkesi); sonuç yalnız iz başarılıysa döner.
 */

export const DATA_EXPLORER_LIST_ACTION = "data_explorer.list";
export const DATA_EXPLORER_RECORD_ACTION = "data_explorer.record";

export type ExplorerDisplayRow = {
  id: string;
  tenantId: string | null;
  cells: Record<string, string | null>;
  link: ExplorerRecordLink | null;
};

export type ExplorerOfficeRef = { id: string; name: string | null };

export type ExplorerListResult =
  | { kind: "ok"; rows: ExplorerDisplayRow[]; total: number; office: ExplorerOfficeRef | null; officeNames: Record<string, string> }
  | { kind: "office_not_found" }
  | { kind: "audit_failed" }
  | { kind: "error" };

export type ExplorerRecordResult =
  | { kind: "ok"; row: ExplorerDisplayRow; officeNames: Record<string, string> }
  | { kind: "not_found" }
  | { kind: "audit_failed" }
  | { kind: "error" };

type Raw = Record<string, unknown>;
type QueryResult = { data: unknown; count?: number | null; error: unknown };
type Admin = ReturnType<typeof createAdminClient>;

/** Süzgeç uygulanabilen sorgu (PostgREST oluşturucusunun kullandığımız alt kümesi). */
type Filterable<Q> = {
  eq(column: string, value: unknown): Q;
  ilike(column: string, pattern: string): Q;
  gte(column: string, value: string): Q;
  lte(column: string, value: string): Q;
};

/** Liste sorgusu (dinamik tablo adında PostgREST tür çıkarımı derinleşmesin diye dar arayüz). */
interface ListQuery extends Filterable<ListQuery> {
  order(column: string, opts: { ascending: boolean; nullsFirst?: boolean }): ListQuery;
  range(from: number, to: number): PromiseLike<QueryResult>;
}

/** Planın süzgeçlerini sorguya uygular (değerler parametre olarak gider; sütun adları yalnız kayıttan). */
export function applyExplorerFilters<Q extends Filterable<Q>>(q: Q, plan: ExplorerPlan, officeId: string | null): Q {
  let out = q;
  if (officeId && plan.table.tenantColumn) out = out.eq(plan.table.tenantColumn, officeId);
  for (const f of plan.filters) out = f.op === "ilike" ? out.ilike(f.column, f.pattern) : out.eq(f.column, f.value);
  if (plan.from) out = out.gte(plan.table.orderBy, dayStartIso(plan.from));
  if (plan.to) out = out.lte(plan.table.orderBy, dayEndIso(plan.to));
  return out;
}

function toDisplay(plan: ExplorerPlan, raw: Raw): ExplorerDisplayRow {
  const t = plan.table;
  const tenantId = t.tenantColumn === "id" ? String(raw.id) : typeof raw.tenant_id === "string" ? raw.tenant_id : null;
  return { id: String(raw.id), tenantId, cells: formatRow(t.columns, raw), link: t.recordLink(raw) };
}

async function officeNames(admin: Admin, ids: string[]): Promise<Record<string, string>> {
  const uniq = [...new Set(ids)].filter(Boolean);
  if (!uniq.length) return {};
  const { data } = await admin.from("tenants").select("id, name").in("id", uniq);
  return Object.fromEntries(((data ?? []) as { id: string; name: string | null }[]).map((r) => [r.id, r.name ?? r.id.slice(0, 8)]));
}

async function resolveOfficeId(admin: Admin, plan: ExplorerPlan): Promise<string | null | "missing"> {
  if (!plan.office) return null;
  if ("id" in plan.office) return plan.office.id;
  const { data } = await admin.from("tenants").select("id").eq("slug", plan.office.slug).maybeSingle();
  return (data as { id: string } | null)?.id ?? "missing";
}

/** Sayfalı liste: 25 satır, `orderBy` azalan + id (kararlı sayfalama), tahmini sayım (büyük tablolarda tam sayım pahalı). */
export async function readExplorerList(plan: ExplorerPlan, actorId: string): Promise<ExplorerListResult> {
  const admin = createAdminClient();
  const officeId = await resolveOfficeId(admin, plan);
  if (officeId === "missing") return { kind: "office_not_found" };

  const t = plan.table;
  const start = (plan.page - 1) * EXPLORER_PAGE_SIZE;
  const query = applyExplorerFilters(admin.from(t.table).select(selectList(t), { count: "estimated" }) as unknown as ListQuery, plan, officeId)
    .order(t.orderBy, { ascending: false, nullsFirst: false })
    .order("id", { ascending: false })
    .range(start, start + EXPLORER_PAGE_SIZE - 1);

  const [audit, res] = await Promise.all([
    logPlatformActivityChecked({ actorId, action: DATA_EXPLORER_LIST_ACTION, entityType: t.table, entityId: officeId, meta: explorerAuditMeta(plan, officeId) }),
    query,
  ]);
  if (!audit.ok) return { kind: "audit_failed" };
  if (res.error) return { kind: "error" };

  const rows = ((res.data ?? []) as unknown as Raw[]).map((r) => toDisplay(plan, r));
  const names = await officeNames(admin, [...rows.map((r) => r.tenantId ?? ""), officeId ?? ""]);
  return {
    kind: "ok",
    rows,
    total: res.count ?? rows.length,
    office: officeId ? { id: officeId, name: names[officeId] ?? null } : null,
    officeNames: names,
  };
}

/** Tek kayıt ayrıntısı (tüm kayıtlı sütunlar, maskeli). */
export async function readExplorerRecord(plan: ExplorerPlan, actorId: string): Promise<ExplorerRecordResult> {
  if (!plan.recordId) return { kind: "not_found" };
  const admin = createAdminClient();
  const t = plan.table;
  const [audit, res] = await Promise.all([
    logPlatformActivityChecked({
      actorId,
      action: DATA_EXPLORER_RECORD_ACTION,
      entityType: t.table,
      entityId: plan.recordId,
      meta: explorerAuditMeta(plan, null),
    }),
    admin.from(t.table).select(selectList(t)).eq("id", plan.recordId).maybeSingle(),
  ]);
  if (!audit.ok) return { kind: "audit_failed" };
  if (res.error) return { kind: "error" };
  if (!res.data) return { kind: "not_found" };
  const row = toDisplay(plan, res.data as unknown as Raw);
  return { kind: "ok", row, officeNames: await officeNames(admin, row.tenantId ? [row.tenantId] : []) };
}
