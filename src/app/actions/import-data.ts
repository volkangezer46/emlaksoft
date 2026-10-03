"use server";

import { revalidatePath } from "next/cache";
import { revalidateTenantData } from "@/lib/revalidate";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { now } from "@/lib/clock";
import { IMPORT_ROW_LIMIT } from "@/app/app/ice-aktarma/import-config";
import {
  buildCustomerLookup,
  collectCustomerKeys,
  countPlanned,
  planCustomerRows,
  planDemandRows,
  planPropertyRows,
  propertyKey,
  demandKey,
  validatePropertyRow,
  type CustomerLookup,
  type DuplicatePolicy,
  type ExistingCustomer,
  type ExistingProperty,
  type ImportCounters,
  type ImportRow,
  type ImportTarget,
  type PlannedRow,
  type RowIssue,
  type RowStatus,
} from "@/lib/import-rows";

/**
 * İçe aktarma (müşteri / portföy / talep) — /app/ice-aktarma sihirbazı.
 *
 * Tasarım:
 *  - Dosya çözümleme ve kolon eşleme istemcidedir; sunucu satırları parçalar halinde
 *    (IMPORT_CHUNK_SIZE) alır. Her parça HER ZAMAN sunucuda yeniden doğrulanır
 *    (istemciye güvenilmez); doğrulama/planlama `src/lib/import-rows.ts` saf modülündedir.
 *  - `previewImportChunk` yazmaz (dry-run); `importChunk` aynı planı uygular. Böylece
 *    önizleme sayaçları ile sonuç aynı mantıktan çıkar.
 *  - GERİ ALMA için migration yok: her parça tek audit kaydı yazar (action `<varlık>.import`);
 *    `new_value.batch_id` + oluşturulan id'ler, `old_value.updated_prev` güncellenen kayıtların
 *    eski değerleridir. Geri alma `import-rollback.ts`'te bu kayıtlardan yapılır.
 *  - Insert'ler 100'lük parçalarda; bir parça patlarsa yalnız o parçadaki satırlar hatalı
 *    sayılır, kalanlar denenmeye devam eder.
 */

const INSERT_CHUNK = 100;
const LOOKUP_CHUNK = 200;
const UPDATE_PARALLEL = 10;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ImportRowError = { row: number; reason: string };

/** Eski sözleşme (importCustomers / importProperties dönüşü). */
export type ImportSummary = {
  ok?: boolean;
  error?: string;
  inserted?: number;
  skipped?: number;
  errors?: ImportRowError[];
};

export type CustomerImportRow = {
  /** Dosyadaki satır numarası (başlık hariç, 1'den başlar) — hata raporu için. */
  row: number;
  full_name?: string;
  phone?: string;
  email?: string;
  customer_type?: string;
  source?: string;
  notes?: string;
};

export type PropertyImportRow = {
  row: number;
  title?: string;
  transaction_type?: string;
  property_type?: string;
  list_price?: string;
  rooms?: string;
  sqm?: string;
  address_line?: string;
};

export type DemandImportRow = {
  row: number;
  customer_phone?: string;
  customer_email?: string;
  transaction_type?: string;
  property_type?: string;
  budget_min?: string;
  budget_max?: string;
  rooms?: string;
  min_sqm?: string;
  urgency?: string;
};

export type ImportOptions = {
  /** Varsayılan "skip". */
  duplicatePolicy?: DuplicatePolicy;
  /** undefined → işlemi yapan kullanıcı; "" → danışmansız; aksi halde ofisteki bir kullanıcının id'si. */
  assignTo?: string;
  /** Aynı dosyanın parçalarını birbirine bağlar (UUID). Yazma sırasında zorunludur. */
  batchId?: string;
  fileName?: string;
  /** Yalnız önizleme: önceki parçalarda görülen dosya içi anahtarlar. */
  seen?: string[];
};

export type PlannedRowView = {
  row: number;
  status: RowStatus;
  issues: RowIssue[];
  existingName?: string;
  matchedBy?: string;
  /** Önizleme tablosu için kısa özet (ad / başlık). */
  label?: string;
};

export type ChunkResult = {
  ok?: boolean;
  error?: string;
  rows?: PlannedRowView[];
  counters?: ImportCounters;
  /** Yalnız önizleme: sonraki parçaya taşınacak dosya içi anahtarlar. */
  seen?: string[];
  created?: number;
  updated?: number;
};

const ENTITY: Record<ImportTarget, { action: string; entityType: string; path: string; module: "customers" | "properties" | "demands" }> = {
  customers: { action: "customer.import", entityType: "customer", path: "/app/musteriler", module: "customers" },
  properties: { action: "property.import", entityType: "property", path: "/app/portfoyler", module: "properties" },
  demands: { action: "demand.import", entityType: "customer_demand", path: "/app/talepler", module: "demands" },
};

type Db = Awaited<ReturnType<typeof createClient>>;

function limitCheck<T>(rows: T[]): string | null {
  if (!Array.isArray(rows) || rows.length === 0) return "İçe aktarılacak satır bulunamadı.";
  if (rows.length > IMPORT_ROW_LIMIT) {
    return `Tek seferde en fazla ${IMPORT_ROW_LIMIT} satır içe aktarılabilir. Dosyayı bölerek tekrar deneyin.`;
  }
  return null;
}

function chunked<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// ---------------------------------------------------------------------------
// Mevcut kayıt aramaları (tenant + silinmemiş)
// ---------------------------------------------------------------------------

async function loadCustomerLookup(
  supabase: Db,
  tenantId: string,
  rows: ImportRow[],
  columns: { phone: string; email: string },
): Promise<CustomerLookup | null> {
  // Müşteri ve talep satırları farklı kolon adı kullanır; anahtarları ortak biçime çevir.
  const mapped = rows.map((r) => ({ row: r.row, full_name: "x", phone: r[columns.phone], email: r[columns.email] }));
  const { phones, emails } = collectCustomerKeys(mapped);
  const found: ExistingCustomer[] = [];
  const select = "id, full_name, phone, email, customer_types, source, notes";
  for (const [col, values] of [
    ["phone", phones],
    ["email", emails],
  ] as const) {
    for (const part of chunked(values, LOOKUP_CHUNK)) {
      const { data, error } = await supabase
        .from("customers")
        .select(select)
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .in(col, part);
      if (error) {
        console.error("import customer lookup", error);
        return null;
      }
      for (const d of (data ?? []) as ExistingCustomer[]) found.push(d);
    }
  }
  return buildCustomerLookup(found);
}

async function loadExistingProperties(
  supabase: Db,
  tenantId: string,
  rows: ImportRow[],
): Promise<Map<string, ExistingProperty> | null> {
  const titles = new Set<string>();
  for (const r of rows) {
    const v = validatePropertyRow(r);
    if (v.data) titles.add(v.data.title);
  }
  const map = new Map<string, ExistingProperty>();
  for (const part of chunked([...titles], LOOKUP_CHUNK)) {
    const { data, error } = await supabase
      .from("properties")
      .select("id, title, address_line, list_price, features")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .in("title", part);
    if (error) {
      console.error("import property lookup", error);
      return null;
    }
    for (const d of (data ?? []) as ExistingProperty[]) map.set(propertyKey(d.title, d.address_line), d);
  }
  return map;
}

async function loadExistingDemandKeys(
  supabase: Db,
  tenantId: string,
  customerIds: string[],
): Promise<Set<string> | null> {
  const keys = new Set<string>();
  for (const part of chunked(customerIds, LOOKUP_CHUNK)) {
    const { data, error } = await supabase
      .from("customer_demands")
      .select("customer_id, transaction_type, property_type, rooms, budget_max, status")
      .eq("tenant_id", tenantId)
      .in("customer_id", part);
    if (error) {
      console.error("import demand lookup", error);
      return null;
    }
    for (const d of data ?? []) {
      if (d.status === "cancelled" || d.status === "closed") continue;
      keys.add(
        demandKey(d.customer_id as string, {
          transaction_type: String(d.transaction_type ?? ""),
          property_type: (d.property_type as string | null) ?? null,
          rooms: (d.rooms as string | null) ?? null,
          budget_max: d.budget_max == null ? null : Number(d.budget_max),
        }),
      );
    }
  }
  return keys;
}

// ---------------------------------------------------------------------------
// Planlama (sunucuda yeniden doğrulama) + uygulama
// ---------------------------------------------------------------------------

type AnyPlan = PlannedRow<Record<string, unknown>>;

function labelOf(target: ImportTarget, r: ImportRow, p: AnyPlan): string {
  if (target === "customers") return String(r.full_name ?? "").trim();
  if (target === "properties") return String(r.title ?? "").trim();
  return String(p.existingName ?? r.customer_phone ?? r.customer_email ?? "").trim();
}

async function planChunk(
  supabase: Db,
  tenantId: string,
  target: ImportTarget,
  rows: ImportRow[],
  policy: DuplicatePolicy,
  seen: Set<string>,
): Promise<AnyPlan[] | null> {
  if (target === "customers") {
    const lookup = await loadCustomerLookup(supabase, tenantId, rows, { phone: "phone", email: "email" });
    if (!lookup) return null;
    return planCustomerRows(rows, lookup, policy, seen) as unknown as AnyPlan[];
  }
  if (target === "properties") {
    const existing = await loadExistingProperties(supabase, tenantId, rows);
    if (!existing) return null;
    return planPropertyRows(rows, existing, policy, seen) as unknown as AnyPlan[];
  }
  const lookup = await loadCustomerLookup(supabase, tenantId, rows, { phone: "customer_phone", email: "customer_email" });
  if (!lookup) return null;
  const customerIds = [...new Set([...lookup.byPhone.values(), ...lookup.byEmail.values()].map((c) => c.id))];
  const existing = await loadExistingDemandKeys(supabase, tenantId, customerIds);
  if (!existing) return null;
  return planDemandRows(rows, lookup, existing, policy, seen) as unknown as AnyPlan[];
}

async function resolveAssignee(
  supabase: Db,
  tenantId: string,
  userId: string,
  assignTo: string | undefined,
): Promise<{ ok: true; id: string | null } | { ok: false; error: string }> {
  if (assignTo === undefined) return { ok: true, id: userId };
  if (assignTo === "") return { ok: true, id: null };
  if (!UUID_RE.test(assignTo)) return { ok: false, error: "Danışman seçimi geçersiz." };
  const { data } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", assignTo)
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .maybeSingle();
  if (!data) return { ok: false, error: "Seçilen danışman bu ofiste aktif değil." };
  return { ok: true, id: assignTo };
}

function toView(target: ImportTarget, rows: ImportRow[], plans: AnyPlan[], withLabel: boolean): PlannedRowView[] {
  return plans.map((p, i) => ({
    row: p.row,
    status: p.status,
    issues: p.issues,
    existingName: p.existingName,
    matchedBy: p.matchedBy,
    label: withLabel ? labelOf(target, rows[i], p) : undefined,
  }));
}

async function runChunk(
  target: ImportTarget,
  rows: ImportRow[],
  options: ImportOptions,
  dryRun: boolean,
): Promise<ChunkResult> {
  const meta = ENTITY[target];
  const policy: DuplicatePolicy = options.duplicatePolicy ?? "skip";
  if (!["skip", "update", "create"].includes(policy)) return { error: "Mükerrer politikası geçersiz." };

  const gate = await requirePermission(meta.module, "create");
  if (!gate.ok) return { error: gate.error };
  if (policy === "update") {
    if (target === "demands") return { error: "Talepler için güncelleme politikası desteklenmez (atla veya yeni oluştur)." };
    const edit = await requirePermission(meta.module, "edit");
    if (!edit.ok) return { error: "Mevcut kayıtları güncellemek için düzenleme yetkisi gerekir." };
  }
  const limitError = limitCheck(rows);
  if (limitError) return { error: limitError };
  if (!dryRun && !(options.batchId && UUID_RE.test(options.batchId))) {
    return { error: "İçe aktarma kimliği geçersiz. Sayfayı yenileyip tekrar deneyin." };
  }

  const supabase = await createClient();
  const assignee = await resolveAssignee(supabase, gate.tenantId, gate.userId, options.assignTo);
  if (!assignee.ok) return { error: assignee.error };

  const seen = new Set(options.seen ?? []);
  const plans = await planChunk(supabase, gate.tenantId, target, rows, policy, seen);
  if (!plans) return { error: "Mükerrer kontrolü yapılamadı. Lütfen tekrar deneyin." };

  if (dryRun) {
    return {
      ok: true,
      rows: toView(target, rows, plans, true),
      counters: countPlanned(plans),
      seen: [...seen],
    };
  }

  // ---- yazma ----
  const fail = (p: AnyPlan, reason: string) => {
    p.status = "error";
    p.issues = [...p.issues, { level: "error", message: reason }];
  };
  const toCreate = plans.filter((p) => p.status === "new");
  const toUpdate = plans.filter((p) => p.status === "update");
  const createdIds: string[] = [];
  const updatedPrev: { id: string; prev: Record<string, unknown> }[] = [];
  const stamp = new Date(now()).toISOString().slice(2, 7).replace("-", "");

  const buildInsert = (p: AnyPlan): Record<string, unknown> => {
    const d = p.data as Record<string, unknown>;
    if (target === "customers") {
      return {
        tenant_id: gate.tenantId,
        full_name: d.full_name,
        phone: d.phone || null,
        email: d.email || null,
        customer_types: d.customer_type ? [d.customer_type] : [],
        source: d.source || "İçe aktarma",
        notes: d.notes || null,
        assigned_to: assignee.id,
        created_by: gate.userId,
      };
    }
    if (target === "properties") {
      return {
        tenant_id: gate.tenantId,
        property_code: `ES-${stamp}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
        title: d.title,
        transaction_type: d.transaction_type,
        property_type: d.property_type,
        status: "draft",
        list_price: d.list_price,
        address_line: d.address_line,
        features: { rooms: d.rooms, sqm: d.sqm },
        assigned_to: assignee.id,
        created_by: gate.userId,
      };
    }
    return {
      tenant_id: gate.tenantId,
      customer_id: d.customer_id,
      ...(d.columns as Record<string, unknown>),
      criteria: d.criteria,
      status: "active",
    };
  };

  const table = target === "customers" ? "customers" : target === "properties" ? "properties" : "customer_demands";
  for (const part of chunked(toCreate, INSERT_CHUNK)) {
    const res = await supabase.from(table).insert(part.map(buildInsert)).select("id");
    if (res?.error) {
      console.error("import insert chunk", target, res.error);
      for (const p of part) fail(p, "Veritabanına yazılamadı.");
    } else {
      for (const d of (res?.data ?? []) as { id: string }[]) createdIds.push(d.id);
    }
  }

  for (const part of chunked(toUpdate, UPDATE_PARALLEL)) {
    await Promise.all(
      part.map(async (p) => {
        if (!p.existingId || !p.patch) return;
        const { error } = await supabase
          .from(table)
          .update(p.patch)
          .eq("id", p.existingId)
          .eq("tenant_id", gate.tenantId);
        if (error) {
          console.error("import update", target, error);
          fail(p, "Mevcut kayıt güncellenemedi.");
        } else {
          updatedPrev.push({ id: p.existingId, prev: p.prev ?? {} });
        }
      }),
    );
  }

  const counters = countPlanned(plans);
  const created = plans.filter((p) => p.status === "new").length;
  const updated = updatedPrev.length;
  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: meta.action,
    entityType: meta.entityType,
    oldValue: updatedPrev.length ? { updated_prev: updatedPrev } : null,
    newValue: {
      batch_id: options.batchId,
      file_name: (options.fileName ?? "").slice(0, 200),
      target,
      policy,
      assigned_to: assignee.id,
      total: rows.length,
      inserted: created,
      updated,
      skipped: counters.skip,
      failed: counters.error,
      created_ids: createdIds,
      updated_ids: updatedPrev.map((u) => u.id),
    },
  });

  revalidatePath(meta.path);
  revalidateTenantData(gate.tenantId);
  return { ok: true, rows: toView(target, rows, plans, false), counters, created, updated };
}

/** Önizleme: yazmaz; satır bazlı durum + sayaçlar döner. Parça parça çağrılır. */
export async function previewImportChunk(
  target: ImportTarget,
  rows: ImportRow[],
  options: ImportOptions = {},
): Promise<ChunkResult> {
  if (!(target in ENTITY)) return { error: "Hedef geçersiz." };
  return runChunk(target, rows, options, true);
}

/** Gerçek yazma: bir parçayı uygular, audit kaydını (geri alma kaynağı) yazar. */
export async function importChunk(
  target: ImportTarget,
  rows: ImportRow[],
  options: ImportOptions,
): Promise<ChunkResult> {
  if (!(target in ENTITY)) return { error: "Hedef geçersiz." };
  return runChunk(target, rows, options, false);
}

// ---------------------------------------------------------------------------
// Eski sözleşme (geriye dönük uyum — tek çağrıda tüm satırlar)
// ---------------------------------------------------------------------------

function legacySummary(res: ChunkResult): ImportSummary {
  if (res.error || !res.rows) return { error: res.error ?? "İçe aktarma başarısız." };
  const errors: ImportRowError[] = [];
  for (const r of res.rows) {
    if (r.status === "error" || r.status === "skip") {
      errors.push({ row: r.row, reason: r.issues.map((i) => i.message).join(" ") });
    }
  }
  errors.sort((a, b) => a.row - b.row);
  return { ok: true, inserted: res.created ?? 0, skipped: res.counters?.skip ?? 0, errors };
}

export async function importCustomers(rows: CustomerImportRow[], options: ImportOptions = {}): Promise<ImportSummary> {
  return legacySummary(
    await runChunk("customers", rows, { ...options, batchId: options.batchId ?? crypto.randomUUID() }, false),
  );
}

export async function importProperties(rows: PropertyImportRow[], options: ImportOptions = {}): Promise<ImportSummary> {
  return legacySummary(
    await runChunk("properties", rows, { ...options, batchId: options.batchId ?? crypto.randomUUID() }, false),
  );
}

export async function importDemands(rows: DemandImportRow[], options: ImportOptions = {}): Promise<ImportSummary> {
  return legacySummary(
    await runChunk("demands", rows, { ...options, batchId: options.batchId ?? crypto.randomUUID() }, false),
  );
}
