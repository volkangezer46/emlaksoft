"use server";

import { revalidatePath } from "next/cache";
import { revalidateTenantData } from "@/lib/revalidate";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { now, trDayKey } from "@/lib/clock";
import { IMPORT_CHUNK_SIZE, IMPORT_ROW_LIMIT } from "@/app/app/ice-aktarma/import-config";
import { checkRateLimit } from "@/lib/rate-limit";
import { neutralizeFormulaCells } from "@/lib/import-sanitize";
import { removeCreated, restoreUpdated } from "@/lib/import-undo";
import { enqueueListingPoolBatch } from "@/lib/pool/server";
import { notifyPoolBatch } from "@/lib/pool/notify";
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
import {
  appointmentKey,
  expenseKey,
  isActivityTarget,
  parseTrDateTime,
  planActivityRows,
  taskKey,
  validateAppointmentRow,
  validateExpenseRow,
  validateTaskRow,
} from "@/lib/import-rows-activity";

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
  /** Yalnız portföy + danışmansız içe aktarma: ilan havuzuna alınan kayıt sayısı (havuz açıksa). */
  pooled?: number;
};

const ENTITY: Record<
  ImportTarget,
  { action: string; entityType: string; path: string; module: "customers" | "properties" | "demands" | "tasks" | "appointments" | "expenses" }
> = {
  customers: { action: "customer.import", entityType: "customer", path: "/app/musteriler", module: "customers" },
  properties: { action: "property.import", entityType: "property", path: "/app/portfoyler", module: "properties" },
  demands: { action: "demand.import", entityType: "customer_demand", path: "/app/talepler", module: "demands" },
  tasks: { action: "task.import", entityType: "task", path: "/app/gorevler", module: "tasks" },
  appointments: { action: "appointment.import", entityType: "appointment", path: "/app/randevular", module: "appointments" },
  expenses: { action: "expense.import", entityType: "expense", path: "/app/giderler", module: "expenses" },
};

const TABLE: Record<ImportTarget, string> = {
  customers: "customers",
  properties: "properties",
  demands: "customer_demands",
  tasks: "tasks",
  appointments: "appointments",
  expenses: "expenses",
};

type Db = Awaited<ReturnType<typeof createClient>>;

function limitCheck<T>(rows: T[], max: number = IMPORT_ROW_LIMIT): string | null {
  if (!Array.isArray(rows) || rows.length === 0) return "İçe aktarılacak satır bulunamadı.";
  if (rows.length > max) {
    return max === IMPORT_ROW_LIMIT
      ? `Tek seferde en fazla ${IMPORT_ROW_LIMIT} satır içe aktarılabilir. Dosyayı bölerek tekrar deneyin.`
      : `Tek istekte en fazla ${max} satır gönderilebilir.`;
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
  if (target === "tasks" || target === "expenses") return String(r.title ?? "").trim();
  if (target === "appointments") return String(p.existingName ?? r.scheduled_at ?? "").trim();
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
  if (isActivityTarget(target)) return planActivityChunk(supabase, tenantId, target, rows, policy, seen);
  const lookup = await loadCustomerLookup(supabase, tenantId, rows, { phone: "customer_phone", email: "customer_email" });
  if (!lookup) return null;
  const customerIds = [...new Set([...lookup.byPhone.values(), ...lookup.byEmail.values()].map((c) => c.id))];
  const existing = await loadExistingDemandKeys(supabase, tenantId, customerIds);
  if (!existing) return null;
  return planDemandRows(rows, lookup, existing, policy, seen) as unknown as AnyPlan[];
}

/**
 * Faaliyet türleri (görev / randevu / gider): müşteri bağı isteğe bağlı (telefon/e-posta), mükerrer anahtarı
 * mevcut kayıtlardan aynı ofiste okunur. Okuma hatasında null (çağıran "kontrol yapılamadı" döner).
 */
async function planActivityChunk(
  supabase: Db,
  tenantId: string,
  target: "tasks" | "appointments" | "expenses",
  rows: ImportRow[],
  policy: DuplicatePolicy,
  seen: Set<string>,
): Promise<AnyPlan[] | null> {
  const existing = new Set<string>();
  if (target === "expenses") {
    const today = trDayKey(now());
    const dates = new Set<string>();
    for (const r of rows) {
      const d = parseTrDateTime(String(r.expense_date ?? ""));
      dates.add(d?.day ?? today);
    }
    for (const part of chunked([...dates], LOOKUP_CHUNK)) {
      const { data, error } = await supabase.from("expenses").select("title, amount, expense_date").eq("tenant_id", tenantId).in("expense_date", part).limit(5000);
      if (error) return null;
      for (const x of data ?? []) existing.add(expenseKey({ title: String(x.title), amount: Number(x.amount), expense_date: String(x.expense_date).slice(0, 10) }));
    }
    return planActivityRows(rows, (r) => validateExpenseRow(r, today), expenseKey, existing, policy, seen) as unknown as AnyPlan[];
  }
  const lookup = await loadCustomerLookup(supabase, tenantId, rows, { phone: "customer_phone", email: "customer_email" });
  if (!lookup) return null;
  if (target === "tasks") {
    const titles = [...new Set(rows.map((r) => String(r.title ?? "").trim()).filter(Boolean))];
    for (const part of chunked(titles, LOOKUP_CHUNK)) {
      const { data, error } = await supabase.from("tasks").select("title, due_at, customer_id").eq("tenant_id", tenantId).in("title", part).limit(5000);
      if (error) return null;
      for (const t of data ?? []) {
        existing.add(taskKey({ title: String(t.title), due_at: t.due_at ? new Date(String(t.due_at)).toISOString() : null, customer_id: (t.customer_id as string | null) ?? null }));
      }
    }
    return planActivityRows(rows, (r) => validateTaskRow(r, lookup), taskKey, existing, policy, seen) as unknown as AnyPlan[];
  }
  const whens = new Set<string>();
  for (const r of rows) {
    const w = parseTrDateTime(String(r.scheduled_at ?? ""));
    if (w) whens.add(w.hasTime ? w.iso : parseTrDateTime(`${w.day} 10:00`)!.iso);
  }
  for (const part of chunked([...whens], LOOKUP_CHUNK)) {
    const { data, error } = await supabase
      .from("appointments")
      .select("scheduled_at, appointment_type, customer_id")
      .eq("tenant_id", tenantId)
      .in("scheduled_at", part)
      .limit(5000);
    if (error) return null;
    for (const a of data ?? []) {
      existing.add(appointmentKey({ scheduled_at: new Date(String(a.scheduled_at)).toISOString(), appointment_type: String(a.appointment_type), customer_id: (a.customer_id as string | null) ?? null }));
    }
  }
  return planActivityRows(rows, (r) => validateAppointmentRow(r, lookup), appointmentKey, existing, policy, seen) as unknown as AnyPlan[];
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

/** Parça API'leri (sihirbaz) tek istekte en fazla bu kadar satır alır; eski tek-çağrı API'leri IMPORT_ROW_LIMIT'e kadar. */
const CHUNK_API_MAX_ROWS = IMPORT_CHUNK_SIZE;
/** Kullanıcı başına 10 dakikada yazma/önizleme parça sayısı: 5000 satırlık dosya = 20 parça, makul tekrarlara yer bırakır. */
const WRITE_CHUNKS_PER_WINDOW = 60;
const PREVIEW_CHUNKS_PER_WINDOW = 120;
const RATE_WINDOW_SEC = 10 * 60;

async function runChunk(
  target: ImportTarget,
  rawRows: ImportRow[],
  options: ImportOptions,
  dryRun: boolean,
  maxRows: number = IMPORT_ROW_LIMIT,
): Promise<ChunkResult> {
  const meta = ENTITY[target];
  const policy: DuplicatePolicy = options.duplicatePolicy ?? "skip";
  if (!["skip", "update", "create"].includes(policy)) return { error: "Mükerrer politikası geçersiz." };

  const gate = await requirePermission(meta.module, "create");
  if (!gate.ok) return { error: gate.error };
  if (policy === "update") {
    if (target === "demands") return { error: "Talepler için güncelleme politikası desteklenmez (atla veya yeni oluştur)." };
    if (isActivityTarget(target)) return { error: "Görev, randevu ve gider aktarımında güncelleme politikası yoktur (atla veya yeni oluştur)." };
    const edit = await requirePermission(meta.module, "edit");
    if (!edit.ok) return { error: "Mevcut kayıtları güncellemek için düzenleme yetkisi gerekir." };
  }
  const limitError = limitCheck(rawRows, maxRows);
  if (limitError) return { error: limitError };
  if (!dryRun && !(options.batchId && UUID_RE.test(options.batchId))) {
    return { error: "İçe aktarma kimliği geçersiz. Sayfayı yenileyip tekrar deneyin." };
  }
  // Sunucu tarafı hız sınırı (istemci döngüsüyle sınırsız tekrarı keser).
  const rate = await checkRateLimit(`${dryRun ? "import-preview" : "import-write"}:${gate.userId}`, {
    limit: dryRun ? PREVIEW_CHUNKS_PER_WINDOW : WRITE_CHUNKS_PER_WINDOW,
    windowSec: RATE_WINDOW_SEC,
    failurePolicy: "deny",
  });
  if (!rate.allowed) return { error: "Çok fazla içe aktarma isteği gönderildi. Birkaç dakika sonra tekrar deneyin." };
  // Formül önekli serbest metin hücreleri güvenle saklanır (başında ' ile) ve satıra uyarı eklenir.
  const { rows, flaggedRows } = neutralizeFormulaCells(rawRows);

  const supabase = await createClient();
  const assignee = await resolveAssignee(supabase, gate.tenantId, gate.userId, options.assignTo);
  if (!assignee.ok) return { error: assignee.error };

  const seen = new Set(options.seen ?? []);
  const plans = await planChunk(supabase, gate.tenantId, target, rows, policy, seen);
  if (!plans) return { error: "Mükerrer kontrolü yapılamadı. Lütfen tekrar deneyin." };
  for (const p of plans) {
    if (flaggedRows.has(p.row)) {
      p.issues = [
        ...p.issues,
        { level: "warning", message: "Metin =, +, - veya @ ile başlıyordu; formül sayılmaması için başına ' eklenerek kaydedilir." },
      ];
    }
  }

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
    if (target === "tasks") {
      return {
        tenant_id: gate.tenantId,
        title: d.title,
        notes: d.notes,
        kind: d.kind,
        priority: d.priority,
        status: "open",
        due_at: d.due_at,
        customer_id: d.customer_id,
        assigned_to: assignee.id,
        created_by: gate.userId,
      };
    }
    if (target === "appointments") {
      return {
        tenant_id: gate.tenantId,
        customer_id: d.customer_id,
        appointment_type: d.appointment_type,
        scheduled_at: d.scheduled_at,
        duration_min: d.duration_min,
        location: d.location,
        notes: d.notes,
        status: "pending",
        assigned_to: assignee.id,
        created_by: gate.userId,
      };
    }
    if (target === "expenses") {
      return {
        tenant_id: gate.tenantId,
        created_by: gate.userId,
        title: d.title,
        amount: d.amount,
        category: d.category,
        expense_date: d.expense_date,
        notes: d.notes,
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

  const table = TABLE[target];
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
  const audit = await logActivity({
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

  if (!audit.ok) {
    // Audit günlüğü geri almanın tek kaynağıdır: yazılamadıysa bu parça başarılı sayılmaz,
    // yapılan değişiklikler hemen geri çekilir (yetim, geri alınamaz kayıt bırakılmaz).
    const undoCreated = await removeCreated(supabase, {
      target,
      tenantId: gate.tenantId,
      ids: createdIds,
      checkLinks: false,
    });
    const undoUpdated = await restoreUpdated(supabase, {
      target,
      tenantId: gate.tenantId,
      entries: updatedPrev.map((u) => ({ id: u.id, prev: u.prev, importAt: new Date(now() + 3_600_000).toISOString() })),
    });
    revalidatePath(meta.path);
    revalidateTenantData(gate.tenantId);
    const leftover = undoCreated.failed + undoUpdated.failed;
    return {
      error: leftover
        ? `Denetim kaydı yazılamadığı için içe aktarma iptal edildi ancak ${leftover} kayıt geri çekilemedi; lütfen İçe aktarma günlüğünü ve kayıtları kontrol edin.`
        : "Denetim kaydı yazılamadığı için bu parça içe aktarılmadı (değişiklikler geri çekildi). Lütfen tekrar deneyin.",
    };
  }

  // İlan havuzu: danışmansız içe aktarılan portföyler (ofiste havuz açıksa) tek seferde havuza alınır.
  // Havuz kapalıysa/şema yoksa hiçbir şey olmaz; hata içe aktarmayı bozmaz (kayıtlar zaten yazıldı ve denetlendi).
  let pooled = 0;
  if (target === "properties" && assignee.id === null && createdIds.length > 0) {
    const pool = await enqueueListingPoolBatch(supabase, {
      tenantId: gate.tenantId,
      actorId: gate.userId,
      source: "import",
      propertyIds: createdIds,
    });
    pooled = pool.queued;
    if (pooled > 0) {
      await notifyPoolBatch(supabase, {
        tenantId: gate.tenantId,
        actorId: gate.userId,
        count: pooled,
        firstPropertyId: createdIds[0]!,
        sourceLabel: "İçe aktarma",
      });
      revalidatePath("/app/ilan-havuzu");
    }
  }

  revalidatePath(meta.path);
  revalidateTenantData(gate.tenantId);
  return { ok: true, rows: toView(target, rows, plans, false), counters, created, updated, ...(pooled ? { pooled } : {}) };
}

/** Önizleme: yazmaz; satır bazlı durum + sayaçlar döner. Parça parça çağrılır. */
export async function previewImportChunk(
  target: ImportTarget,
  rows: ImportRow[],
  options: ImportOptions = {},
): Promise<ChunkResult> {
  if (!(target in ENTITY)) return { error: "Hedef geçersiz." };
  return runChunk(target, rows, options, true, CHUNK_API_MAX_ROWS);
}

/** Gerçek yazma: bir parçayı uygular, audit kaydını (geri alma kaynağı) yazar. */
export async function importChunk(
  target: ImportTarget,
  rows: ImportRow[],
  options: ImportOptions,
): Promise<ChunkResult> {
  if (!(target in ENTITY)) return { error: "Hedef geçersiz." };
  return runChunk(target, rows, options, false, CHUNK_API_MAX_ROWS);
}
