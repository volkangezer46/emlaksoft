import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DAY_MS, now, trDayKey } from "@/lib/clock";
import { METADATA_ONLY_FILE_PREFIX } from "@/lib/doc-request/doc-request";
import { DEFAULT_KEYS, ROOM_TEMPLATES, type Condition, type InspectionRoom, type KeyEntry, type Meters } from "@/lib/rentals/inspection";
import { samplePhone } from "@/lib/sample-data/catalog";

/**
 * Kayıt modüllerinin örnek verisi — finans bütçesi (`finance_budgets`), evrak talepleri (`document_requests` +
 * `document_request_files`), kiracı başvuru bağlantısı/başvurusu (`rental_application_links`, `rental_applications`) ve
 * teslim/tahliye tutanağı (`rental_inspections`). TEK kaynak; `seedModuleData` üzerinden İKİ çağıranı vardır (demo-ofis
 * `sample:false`, "Demo veriyle başla" `sample:true`).
 *
 * KURALLAR
 *  - Veri, çağıranın ZATEN yazdığı örnek kayıtlardan türer (müşteri, portföy, kira, gider): kimlik uydurulmaz, her satır
 *    gerçek bir örnek müşteri/portföy/kiraya bağlıdır. Kaynak yoksa grup 0 yazar.
 *  - Tarihler son 6 aya yayılır; `created_at` gelecekte değildir. Para tam TL.
 *  - Evrak dosyaları YALNIZ KAYIT BİLGİSİDİR: `storage_path` depo yolu değil `METADATA_ONLY_FILE_PREFIX` işaretidir, durum
 *    `verified` (bekleyen yükleme temizliği yalnız `pending` satıra bakar). Depoda nesne yoktur; silinecek nesne de yoktur.
 *  - Başvuru bağlantısının ve evrak linkinin token'ı rastgeledir ve hiçbir yerde gösterilmez (örnek bağlantı public
 *    çözücülerde zaten reddedilir: `is_sample`).
 *  - İDEMPOTENT: her grup kendi tablosunda bu ofisin (örnek modda örnek işaretli) satırı varsa hiçbir şey yazmaz.
 *  - Evrak talepleri `seed_sample_document_requests` RPC'siyle yazılır (service_role'da tabloya INSERT yetkisi bilerek yok;
 *    token özeti RPC'de üretilir; RPC yalnız demo-ofis ya da kilitsiz demo modundaki ofiste yazar).
 *  - Genel demo ofisinin gece sıfırlaması altı tabloyu da taban görüntüsünden geri yükler (20261026010100).
 *  - "Gerçek kullanıma geç": beş tablo da `purge_tenant_sample_data` v2 isteğe bağlı listesindedir (çocuk → ebeveyn).
 */

export type RecordsSeedContext = {
  db: SupabaseClient;
  tenantId: string;
  ownerId: string;
  advisorId: string;
  sample: boolean;
};

type Dict = Record<string, unknown>;
type DbError = { message?: string; code?: string } | null;

class SeedFail extends Error {
  code?: string;
  constructor(label: string, e: { message?: string; code?: string }) {
    super(`${label}: ${e.message ?? "hata"}`);
    this.code = e.code;
  }
}

function must<T>(label: string, res: { data: T | null; error: DbError }): T {
  if (res.error) throw new SeedFail(label, res.error);
  return res.data as T;
}

async function insertRows(db: SupabaseClient, table: string, rows: Dict[]): Promise<Dict[]> {
  if (rows.length === 0) return [];
  return must(table, await db.from(table).insert(rows).select()) ?? [];
}

/** Bu ofiste (örnek modda örnek işaretli) satır var mı? İkinci çalıştırma çoğaltmasın. */
async function alreadySeeded(ctx: RecordsSeedContext, table: string): Promise<boolean> {
  let q = ctx.db.from(table).select("id").eq("tenant_id", ctx.tenantId).limit(1);
  if (ctx.sample) q = q.eq("is_sample", true);
  return (must(table, await q) as unknown[]).length > 0;
}

const flagOf = (ctx: RecordsSeedContext) => (ctx.sample ? { is_sample: true } : {});

// ---------------------------------------------------------------------------
// Tarih yardımcıları (saat yalnız clock.ts üzerinden)
// ---------------------------------------------------------------------------
const FUTURE_GUARD_MS = 20 * 60_000;

/** `daysAgo` gün önce, TR saatiyle `hour`:00 (gelecekteyse şimdi − 20 dk). */
export function isoDaysAgo(nowMs: number, daysAgo: number, hour = 11): string {
  const key = trDayKey(nowMs - daysAgo * DAY_MS);
  const t = Date.parse(`${key}T${String(hour).padStart(2, "0")}:00:00+03:00`);
  return new Date(Math.min(t, nowMs - FUTURE_GUARD_MS)).toISOString();
}

/** TR gün anahtarına göre `n` gün ötesi (gelecek serbest: son geçerlilik tarihi gibi). */
function plannedIso(nowMs: number, daysAhead: number, hour = 18): string {
  const key = trDayKey(nowMs + daysAhead * DAY_MS);
  return new Date(Date.parse(`${key}T${String(hour).padStart(2, "0")}:00:00+03:00`)).toISOString();
}

/** Bulunulan TR ayından `monthsBack` ay önceki ayın 1'i (`YYYY-MM-01`). */
export function monthKeyBack(nowMs: number, monthsBack: number): string {
  const [y, m] = trDayKey(nowMs).split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 - monthsBack, 1)).toISOString().slice(0, 10);
}

const SIX_MONTHS_DAYS = 178;
const daysBetween = (fromMs: number, toMs: number) => Math.floor((toMs - fromMs) / DAY_MS);

// ---------------------------------------------------------------------------
// 1) Finans bütçesi (aylık gelir hedefi + gider bütçesi) — gerçekleşen örnek giderlerden türetilir
// ---------------------------------------------------------------------------

/** Gider kategorisi → bütçe anahtarı (SQL `finance_v2_budget_category` ile aynı iniş: portal → reklam, kira/aidat → ofis). */
const EXPENSE_BUDGET_KEY: Record<string, string> = {
  ofis: "ofis", kira: "ofis", aidat: "ofis", muhasebe: "ofis", reklam: "reklam", portal: "reklam", ulasim: "ulasim", egitim: "egitim",
};

/**
 * Ay ve kategori başına bütçe çarpanı (en eski → bu ay). 1'in altı "aşım", 1,0–1,25 arası "uyarı/sınırda" görünür: ofis
 * bütçesi rahat, reklam son ay aşılıyor, ulaşım sınırda — gerçek bir ofisin bütçe ekranı gibi.
 */
const BUDGET_FACTORS: Record<string, readonly number[]> = {
  ofis: [1.15, 1.15, 1.12, 1.12, 1.1, 1.1],
  reklam: [1.2, 1.15, 1.1, 1.05, 1, 0.9],
  ulasim: [1.3, 1.25, 1.2, 1.15, 1.1, 1.05],
  egitim: [1, 1, 1, 1, 1, 1],
};

/** Aylık gelir hedefleri (tam TL): komisyon hedefi yavaşça büyür, hizmet bedeli sabit. */
const INCOME_TARGETS: { category: string; amounts: readonly number[] }[] = [
  { category: "komisyon", amounts: [250_000, 250_000, 275_000, 275_000, 300_000, 300_000] },
  { category: "hizmet_bedeli", amounts: [15_000, 15_000, 15_000, 20_000, 20_000, 20_000] },
];

export type BudgetRowPlan = { period_month: string; direction: "in" | "out"; category: string; amount: number };

const roundUp = (n: number, step: number) => Math.max(step, Math.ceil(n / step) * step);

/**
 * SAF: son 6 ayın bütçe satırları. Gider bütçesi = o kategorinin aylık ortalama gerçekleşeni × ay çarpanı (1.000 TL'ye
 * yuvarlanır, ulaşım 500 TL). Hiç gideri olmayan kategoriye bütçe açılmaz (boş vaat yok); gelir hedefleri sabittir.
 */
export function buildBudgetRows(nowMs: number, expenses: readonly { category: string; amount: number; expense_date: string }[]): BudgetRowPlan[] {
  const months = [5, 4, 3, 2, 1, 0].map((b) => monthKeyBack(nowMs, b));
  const first = months[0]!;
  const totals = new Map<string, number>();
  const activeMonths = new Map<string, Set<string>>();
  for (const e of expenses) {
    const key = EXPENSE_BUDGET_KEY[e.category];
    if (!key || !(e.expense_date >= first)) continue;
    totals.set(key, (totals.get(key) ?? 0) + Number(e.amount || 0));
    const set = activeMonths.get(key) ?? new Set<string>();
    set.add(e.expense_date.slice(0, 7));
    activeMonths.set(key, set);
  }
  const rows: BudgetRowPlan[] = [];
  for (const [category, factors] of Object.entries(BUDGET_FACTORS)) {
    const total = totals.get(category) ?? 0;
    const spanMonths = activeMonths.get(category)?.size ?? 0;
    if (!(total > 0) || spanMonths === 0) continue;
    const avg = total / spanMonths;
    const step = avg < 10_000 ? 500 : 1_000;
    months.forEach((period, i) => rows.push({ period_month: period, direction: "out", category, amount: roundUp(avg * factors[i]!, step) }));
  }
  for (const t of INCOME_TARGETS) months.forEach((period, i) => rows.push({ period_month: period, direction: "in", category: t.category, amount: t.amounts[i]! }));
  return rows;
}

export async function seedFinanceBudgets(ctx: RecordsSeedContext): Promise<number> {
  const { db, tenantId } = ctx;
  if (await alreadySeeded(ctx, "finance_budgets")) return 0;
  const nowMs = now();
  let q = db.from("expenses").select("category, amount, expense_date").eq("tenant_id", tenantId).gte("expense_date", monthKeyBack(nowMs, 5)).limit(1000);
  if (ctx.sample) q = q.eq("is_sample", true);
  const expenses = (must("expenses", await q) as { category: string; amount: number | string; expense_date: string }[]).map((e) => ({
    category: e.category, amount: Number(e.amount), expense_date: e.expense_date,
  }));
  const rows = buildBudgetRows(nowMs, expenses).map((r) => ({
    tenant_id: tenantId, ...r, created_by: ctx.ownerId, updated_at: isoDaysAgo(nowMs, Math.max(0, daysBetween(Date.parse(`${r.period_month}T12:00:00Z`), nowMs)), 10), ...flagOf(ctx),
  }));
  // Gerçek bütçe satırı (aynı ay/yön/kategori) varsa ona dokunulmaz.
  const { data, error } = await db.from("finance_budgets").upsert(rows, { onConflict: "tenant_id,period_month,direction,category", ignoreDuplicates: true }).select("id");
  if (error) throw new SeedFail("finance_budgets", error);
  return (data ?? []).length;
}

// ---------------------------------------------------------------------------
// Ortak okuma: örnek müşteri / portföy / kira
// ---------------------------------------------------------------------------
type PropRow = { id: string; property_code: string | null; title: string; transaction_type: string | null; property_type: string | null; status: string | null; list_price: number | null; owner_customer_id: string | null };
type RentalRow = { id: string; property_id: string | null; renter_customer_id: string | null; monthly_rent: number | null; deposit: number | null; start_date: string; end_date: string | null; status: string; created_at: string };
type CustomerRow = { id: string; full_name: string; phone: string | null };

async function loadProperties(ctx: RecordsSeedContext): Promise<PropRow[]> {
  let q = ctx.db
    .from("properties")
    .select("id, property_code, title, transaction_type, property_type, status, list_price, owner_customer_id")
    .eq("tenant_id", ctx.tenantId)
    .is("deleted_at", null)
    .order("property_code", { ascending: true })
    .limit(200);
  if (ctx.sample) q = q.eq("is_sample", true);
  return must("properties", await q) as PropRow[];
}

async function loadRentals(ctx: RecordsSeedContext): Promise<RentalRow[]> {
  let q = ctx.db
    .from("rentals")
    .select("id, property_id, renter_customer_id, monthly_rent, deposit, start_date, end_date, status, created_at")
    .eq("tenant_id", ctx.tenantId)
    .eq("status", "active")
    .order("start_date", { ascending: true })
    .limit(50);
  if (ctx.sample) q = q.eq("is_sample", true);
  return must("rentals", await q) as RentalRow[];
}

async function loadCustomers(ctx: RecordsSeedContext, ids: string[]): Promise<Map<string, CustomerRow>> {
  if (ids.length === 0) return new Map();
  const rows = must("customers", await ctx.db.from("customers").select("id, full_name, phone").eq("tenant_id", ctx.tenantId).in("id", [...new Set(ids)])) as CustomerRow[];
  return new Map(rows.map((c) => [c.id, c]));
}

const isRent = (tx: string | null | undefined) => /kira/i.test(tx ?? "");
const codeOf = (p: PropRow | undefined) => p?.property_code ?? p?.title.slice(0, 40) ?? "portföy";

// ---------------------------------------------------------------------------
// 2) Evrak talepleri (tapu, kimlik, iskan, yetki) + yalnız-kayıt dosyaları
// ---------------------------------------------------------------------------
type FileDef = { doc_type: string; file_name: string; mime_type: string; file_size: number };
type RequestDef = {
  who: "owner" | "renter";
  idx: number;
  title: (code: string) => string;
  types: string[];
  state: "completed" | "active" | "revoked" | "expired";
  daysAgo: number;
  files: FileDef[];
};

const PDF = "application/pdf";
const JPG = "image/jpeg";

/** Evrak talebi senaryoları: 4 tamamlanmış (dosyalı), 2 açık (biri kısmi), 1 iptal, 1 süresi dolmuş. */
export const DOC_REQUEST_DEFS: readonly RequestDef[] = [
  { who: "owner", idx: 0, title: (c) => `Tapu ve iskan belgesi — ${c}`, types: ["title_deed", "other"], state: "completed", daysAgo: 152,
    files: [{ doc_type: "title_deed", file_name: "tapu-senedi.jpg", mime_type: JPG, file_size: 1_842_311 }, { doc_type: "other", file_name: "iskan-belgesi.pdf", mime_type: PDF, file_size: 412_906 }] },
  { who: "owner", idx: 1, title: (c) => `Kimlik ve yetki sözleşmesi — ${c}`, types: ["identity", "authorization_contract"], state: "completed", daysAgo: 118,
    files: [{ doc_type: "identity", file_name: "kimlik-on-yuz.jpg", mime_type: JPG, file_size: 958_120 }, { doc_type: "authorization_contract", file_name: "yetki-sozlesmesi-imzali.pdf", mime_type: PDF, file_size: 655_402 }] },
  { who: "renter", idx: 0, title: (c) => `Kiracı kimlik belgesi — ${c}`, types: ["identity"], state: "completed", daysAgo: 84,
    files: [{ doc_type: "identity", file_name: "kimlik.jpg", mime_type: JPG, file_size: 1_104_877 }] },
  { who: "owner", idx: 2, title: (c) => `Güncel tapu belgesi — ${c}`, types: ["title_deed"], state: "completed", daysAgo: 41,
    files: [{ doc_type: "title_deed", file_name: "tapu-e-devlet-dokumu.pdf", mime_type: PDF, file_size: 288_514 }] },
  { who: "owner", idx: 3, title: (c) => `Vekâletname ve tapu — ${c}`, types: ["power_of_attorney", "title_deed"], state: "active", daysAgo: 3,
    files: [{ doc_type: "title_deed", file_name: "tapu.jpg", mime_type: JPG, file_size: 1_506_233 }] },
  { who: "renter", idx: 1, title: (c) => `Kiracı kimliği ve vergi levhası — ${c}`, types: ["identity", "tax_document"], state: "active", daysAgo: 1, files: [] },
  { who: "owner", idx: 1, title: (c) => `İskan belgesi (yeniden) — ${c}`, types: ["other"], state: "revoked", daysAgo: 63, files: [] },
  { who: "owner", idx: 4, title: (c) => `Kimlik belgesi — ${c}`, types: ["identity"], state: "expired", daysAgo: 26, files: [] },
];

/**
 * Evrak talebi tohum satırları (dosyalar `files` içinde gömülü). SAF: kimlik/token üretmez — `token_hash`, `file_count`,
 * `tenant_id` ve örnek işareti `seed_sample_document_requests` RPC'sinde (20261026010000) yazılır.
 */
export function buildDocumentRequestRows(ctx: Pick<RecordsSeedContext, "ownerId" | "advisorId" | "sample">, props: PropRow[], rentals: RentalRow[], nowMs: number): Dict[] {
  const owners = props.filter((p) => p.owner_customer_id && p.status !== "draft");
  const renters = rentals.filter((r) => r.renter_customer_id);
  const propById = new Map(props.map((p) => [p.id, p]));
  if (owners.length === 0 && renters.length === 0) return [];

  const rows: Dict[] = [];
  for (const def of DOC_REQUEST_DEFS) {
    let customerId: string | null = null;
    let prop: PropRow | undefined;
    if (def.who === "owner" && owners.length) {
      prop = owners[def.idx % owners.length]!;
      customerId = prop.owner_customer_id;
    } else if (def.who === "renter" && renters.length) {
      const r = renters[def.idx % renters.length]!;
      customerId = r.renter_customer_id;
      prop = r.property_id ? propById.get(r.property_id) : undefined;
    } else continue;
    const created = isoDaysAgo(nowMs, def.daysAgo, 10);
    const createdMs = Date.parse(created);
    const expires = def.state === "active" ? plannedIso(nowMs, 7 - Math.min(def.daysAgo, 6)) : def.state === "expired" ? isoDaysAgo(nowMs, def.daysAgo - 7, 23) : new Date(createdMs + 7 * DAY_MS).toISOString();
    const uploadedAt = def.files.length ? isoDaysAgo(nowMs, Math.max(0, def.daysAgo - (def.state === "active" ? 1 : 2)), 15) : null;
    const files = uploadedAt
      ? def.files.map((file, i) => ({
          doc_type: file.doc_type, file_name: file.file_name, file_size: file.file_size, mime_type: file.mime_type,
          // Yalnız kayıt bilgisi: depoda nesne YOK (indirme/OCR bu işareti tanır ve dosya yok der).
          storage_path: `${METADATA_ONLY_FILE_PREFIX}${file.doc_type}/${file.file_name}`,
          created_at: new Date(Date.parse(uploadedAt) + i * 60_000).toISOString(), verified_at: new Date(Date.parse(uploadedAt) + (i + 1) * 60_000).toISOString(),
        }))
      : [];
    rows.push({
      customer_id: customerId, property_id: prop?.id ?? null, title: def.title(codeOf(prop)).slice(0, 160),
      requested_types: def.types, max_files: 5, status: def.state === "expired" ? "active" : def.state, expires_at: expires,
      revoked_at: def.state === "revoked" ? isoDaysAgo(nowMs, def.daysAgo - 1, 12) : null,
      completed_at: def.state === "completed" ? uploadedAt : null,
      last_opened_at: def.state === "revoked" ? null : def.state === "expired" ? isoDaysAgo(nowMs, def.daysAgo - 2, 20) : (uploadedAt ?? null),
      created_by: def.who === "renter" ? ctx.advisorId : ctx.ownerId, created_at: created, is_sample: ctx.sample, files,
    });
  }
  return rows;
}

/**
 * service_role'un `document_requests` INSERT yetkisi BİLEREK yoktur (oturumlu kullanıcı RLS kapsamlı action ile ekler):
 * tohum dar SECURITY DEFINER RPC'ye gider. RPC yalnız demo-ofis ya da `sample_seed_guard` izinli ofiste yazar,
 * kendi içinde de idempotenttir. RPC yoksa (migration uygulanmamış) grup "etkin değil" diye atlanır.
 */
/** RPC'nin yazdığı iki tablo (talep + yalnız kayıt bilgisi dosyaları). */
const DOC_REQUEST_TABLES = ["document_requests", "document_request_files"] as const;

export async function seedDocumentRequests(ctx: RecordsSeedContext): Promise<number> {
  const { db, tenantId } = ctx;
  if (await alreadySeeded(ctx, "document_requests")) return 0;
  const [props, rentals] = await Promise.all([loadProperties(ctx), loadRentals(ctx)]);
  const rows = buildDocumentRequestRows(ctx, props, rentals, now());
  if (rows.length === 0) return 0;
  const { data, error } = await db.rpc("seed_sample_document_requests", { p_tenant: tenantId, p_rows: rows });
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") {
      throw new SeedFail(DOC_REQUEST_TABLES.join("+"), { code: "42883", message: "seed_sample_document_requests does not exist (migration 20261026010000 uygulanmamış)" });
    }
    throw new SeedFail(DOC_REQUEST_TABLES.join("+"), error);
  }
  const res = (data ?? {}) as { requests?: number; files?: number };
  return Number(res.requests ?? 0) + Number(res.files ?? 0);
}

// ---------------------------------------------------------------------------
// 3) Kiracı başvuru bağlantıları + başvurular (aday + kefil + malik kararı)
// ---------------------------------------------------------------------------
type ApplicantDef = {
  full_name: string; occupation: string; employer: string; incomeX: number; household: number; pets: string | null; smoker: boolean;
  message: string; guarantor: { name: string; relation: string; occupation: string; incomeX: number } | null;
  status: "new" | "shortlisted" | "owner_review" | "rejected"; daysAgo: number; office_note: string | null;
};

/** Açık ilanlara gelen adaylar (ilk bağlantıya 3, ikinciye 2). Gelir kira katı olarak (tam TL'ye yuvarlanır). */
export const APPLICANT_DEFS: readonly (readonly ApplicantDef[])[] = [
  [
    { full_name: "Eren Kocabaş", occupation: "Yazılım geliştirici", employer: "Maslak'ta teknoloji şirketi", incomeX: 3.4, household: 2, pets: null, smoker: false,
      message: "Eşimle birlikte taşınmak istiyoruz; ay başında giriş yapabiliriz.", guarantor: { name: "Hüseyin Kocabaş", relation: "Baba", occupation: "Emekli öğretmen", incomeX: 1.6 },
      status: "owner_review", daysAgo: 9, office_note: "Gelir belgesi ve SGK dökümü görüldü; malike önerildi." },
    { full_name: "Dilan Yurt", occupation: "Hemşire", employer: "Özel hastane", incomeX: 2.6, household: 1, pets: "Bir kedi", smoker: false,
      message: "Hastaneye yakın olduğu için ilgileniyorum; evcil hayvan kabul ediliyor mu?", guarantor: { name: "Nurcan Yurt", relation: "Anne", occupation: "Esnaf", incomeX: 1.3 },
      status: "shortlisted", daysAgo: 6, office_note: "Kedi için malikin onayı sorulacak." },
    { full_name: "Barış Tunç", occupation: "Serbest çalışan", employer: "Kendi işi", incomeX: 2.1, household: 3, pets: null, smoker: true,
      message: "Hafta sonu görmek isterim.", guarantor: null, status: "new", daysAgo: 2, office_note: null },
  ],
  [
    { full_name: "Sena Akgül", occupation: "Mimar", employer: "Mimarlık ofisi", incomeX: 3.1, household: 2, pets: null, smoker: false,
      message: "Uzun süreli kiralamak istiyoruz, depozito konusunda esneğiz.", guarantor: { name: "Ali Akgül", relation: "Baba", occupation: "Mühendis", incomeX: 2 },
      status: "new", daysAgo: 4, office_note: null },
    { full_name: "Oğuz Kalkan", occupation: "Satış temsilcisi", employer: "Dağıtım firması", incomeX: 1.7, household: 4, pets: "Köpek", smoker: true,
      message: "Hemen taşınabilirim.", guarantor: null, status: "rejected", daysAgo: 15, office_note: "Gelir kira için yetersiz, kefil yok; aday bilgilendirildi." },
  ],
];

const lastName = (full: string) => full.trim().split(/\s+/).at(-1) ?? full;
const tokenOf = () => randomBytes(32).toString("base64url");
const plusDaysIso = (iso: string, days: number) => new Date(Date.parse(iso) + days * DAY_MS).toISOString();
const roundTl = (n: number, step = 1_000) => Math.round(n / step) * step;

export async function seedRentalApplications(ctx: RecordsSeedContext): Promise<number> {
  const { db, tenantId } = ctx;
  if (await alreadySeeded(ctx, "rental_application_links")) return 0;
  const nowMs = now();
  const [props, rentals] = await Promise.all([loadProperties(ctx), loadRentals(ctx)]);
  const rentedPropIds = new Set(rentals.map((r) => r.property_id));
  const open = props.filter((p) => isRent(p.transaction_type) && p.status === "live" && !rentedPropIds.has(p.id) && Number(p.list_price) > 0).slice(0, APPLICANT_DEFS.length);
  const customers = await loadCustomers(ctx, rentals.map((r) => r.renter_customer_id).filter((x): x is string => Boolean(x)));
  const flag = flagOf(ctx);
  let n = 0;
  let phoneSeq = 600;

  // (a) Açık ilanlar: aktif bağlantı + adaylar.
  for (const [li, prop] of open.entries()) {
    const defs = APPLICANT_DEFS[li]!;
    const rent = Number(prop.list_price);
    const linkCreated = isoDaysAgo(nowMs, Math.max(...defs.map((d) => d.daysAgo)) + 5 + li * 3, 10);
    const [link] = await insertRows(db, "rental_application_links", [{
      tenant_id: tenantId, property_id: prop.id, token: tokenOf(), status: "active", asking_rent: rent,
      expires_at: plusDaysIso(linkCreated, 60), application_count: defs.length, created_by: ctx.advisorId, created_at: linkCreated, ...flag,
    }]);
    n += 1;
    const rows = defs.map((d) => applicationRow(ctx, nowMs, { linkId: String(link!.id), propertyId: prop.id, rent, def: d, phone: samplePhone(phoneSeq++), guarantorPhone: d.guarantor ? samplePhone(phoneSeq++) : null }));
    n += (await insertRows(db, "rental_applications", rows.map((r) => ({ ...r, ...flag })))).length;
  }

  // (b) Kiraya verilmiş portföy: kapanmış bağlantı, onaylanan aday = bugünkü kiracı (kira kaydına bağlı) + reddedilen aday.
  const won = rentals.filter((r) => r.renter_customer_id && r.property_id && customers.has(r.renter_customer_id)).slice(0, 2);
  for (const [wi, r] of won.entries()) {
    const renter = customers.get(r.renter_customer_id!)!;
    const rent = Number(r.monthly_rent) || 0;
    if (!(rent > 0)) continue;
    const startMs = Date.parse(`${r.start_date}T12:00:00Z`);
    const linkDaysAgo = Math.min(SIX_MONTHS_DAYS, Math.max(10, daysBetween(startMs, nowMs) + 21));
    const linkCreated = isoDaysAgo(nowMs, linkDaysAgo, 10);
    const closedAt = isoDaysAgo(nowMs, Math.max(1, linkDaysAgo - 16), 17);
    const [link] = await insertRows(db, "rental_application_links", [{
      tenant_id: tenantId, property_id: r.property_id, token: tokenOf(), status: "closed", asking_rent: rent,
      expires_at: plusDaysIso(linkCreated, 60), application_count: 2, created_by: ctx.advisorId, created_at: linkCreated, closed_at: closedAt, ...flag,
    }]);
    n += 1;
    const approvedAt = isoDaysAgo(nowMs, Math.max(1, linkDaysAgo - 14), 16);
    const phoneOk = /^(0[0-9]{10}|\+[1-9][0-9]{6,14})$/.test(renter.phone ?? "");
    const approved = {
      ...applicationRow(ctx, nowMs, {
        linkId: String(link!.id), propertyId: r.property_id!, rent,
        def: { full_name: renter.full_name, occupation: wi === 0 ? "Akademisyen" : "Şirket yöneticisi", employer: wi === 0 ? "Vakıf üniversitesi" : "Lojistik şirketi",
          incomeX: 3.2, household: 2, pets: null, smoker: false, message: "İlanı görür görmez başvurmak istedim; sözleşme için hazırım.",
          guarantor: { name: `${wi === 0 ? "Melahat" : "Kemal"} ${lastName(renter.full_name)}`, relation: wi === 0 ? "Anne" : "Kardeş", occupation: wi === 0 ? "Emekli" : "Esnaf", incomeX: 1.5 },
          status: "new", daysAgo: linkDaysAgo - 3, office_note: "Evrak tamam; malik onayıyla sözleşmeye geçildi." },
        phone: phoneOk ? renter.phone! : samplePhone(phoneSeq++), guarantorPhone: samplePhone(phoneSeq++),
      }),
      customer_id: renter.id, rental_id: r.id, status: "approved", status_changed_at: approvedAt, owner_decision: "approved",
      owner_note: "Kiracı adayını uygun buldum, sözleşme hazırlanabilir.", owner_decided_at: approvedAt,
      retain_until: plusDaysIso(approvedAt, 730), updated_at: approvedAt,
    };
    const rejected = applicationRow(ctx, nowMs, {
      linkId: String(link!.id), propertyId: r.property_id!, rent,
      def: { full_name: wi === 0 ? "Tuna Erkol" : "Gülşen Aksu", occupation: "Öğrenci", employer: "Üniversite", incomeX: 0.9, household: 1, pets: null, smoker: false,
        message: "Bursla ödeyeceğim, kefilim var.", guarantor: null, status: "rejected", daysAgo: linkDaysAgo - 5, office_note: "Malik öğrenci kiracı istemedi." },
      phone: samplePhone(phoneSeq++), guarantorPhone: null,
    });
    n += (await insertRows(db, "rental_applications", [approved, { ...rejected, owner_decision: "rejected", owner_note: "Başka aday tercih edildi.", owner_decided_at: approvedAt }].map((x) => ({ ...x, ...flag })))).length;
  }
  return n;
}

function applicationRow(
  ctx: RecordsSeedContext,
  nowMs: number,
  a: { linkId: string; propertyId: string; rent: number; def: ApplicantDef; phone: string; guarantorPhone: string | null },
): Dict {
  const created = isoDaysAgo(nowMs, Math.max(0, a.def.daysAgo), 13);
  const changed = a.def.status === "new" ? created : isoDaysAgo(nowMs, Math.max(0, a.def.daysAgo - 2), 16);
  const g = a.def.guarantor;
  const moveIn = trDayKey(Date.parse(created) + 21 * DAY_MS);
  return {
    tenant_id: ctx.tenantId, link_id: a.linkId, property_id: a.propertyId, full_name: a.def.full_name, phone: a.phone, email: null,
    occupation: a.def.occupation, employer: a.def.employer, monthly_income: roundTl(a.rent * a.def.incomeX), household_size: a.def.household,
    has_pets: Boolean(a.def.pets), pets_note: a.def.pets, smoker: a.def.smoker, move_in_date: moveIn, message: a.def.message,
    guarantor_name: g?.name ?? null, guarantor_phone: g ? a.guarantorPhone : null, guarantor_relation: g?.relation ?? null,
    guarantor_occupation: g?.occupation ?? null, guarantor_income: g ? roundTl(a.rent * g.incomeX) : null, guarantor_address: g ? "İstanbul" : null,
    kvkk_consent_at: created, kvkk_notice_version: "platform-v1", status: a.def.status, status_changed_at: changed, office_note: a.def.office_note,
    file_count: 0, retain_until: new Date(Math.max(Date.parse(created) + 180 * DAY_MS, nowMs + 30 * DAY_MS)).toISOString(),
    created_at: created, updated_at: changed,
  };
}

// ---------------------------------------------------------------------------
// 4) Teslim (giriş) ve tahliye (çıkış) tutanakları — oda oda kalemler, sayaç, anahtar
// ---------------------------------------------------------------------------
const COMMERCIAL_ROOMS: Record<"ofis" | "dukkan", readonly { key: string; name: string; items: readonly string[] }[]> = {
  ofis: [
    { key: "giris", name: "Giriş ve resepsiyon", items: ["Giriş kapısı ve kartlı geçiş", "Zemin", "Duvar ve boya", "Aydınlatma"] },
    { key: "acik-ofis", name: "Açık ofis alanı", items: ["Yükseltilmiş döşeme", "Asma tavan", "Pencere ve doğrama", "Priz ve data hatları", "Klima santrali"] },
    { key: "toplanti", name: "Toplantı odası", items: ["Cam bölme", "Duvar ve boya", "Aydınlatma"] },
    { key: "islak-hacim", name: "Islak hacim ve mutfak", items: ["Lavabo ve batarya", "Klozet", "Mutfak tezgahı", "Fayans"] },
    { key: "tesisat", name: "Tesisat", items: ["Elektrik panosu", "Yangın algılama", "Su tesisatı"] },
  ],
  dukkan: [
    { key: "vitrin", name: "Vitrin ve giriş", items: ["Vitrin camı", "Kepenk", "Giriş kapısı ve kilit", "Tabela alanı"] },
    { key: "satis", name: "Satış alanı", items: ["Zemin", "Duvar ve boya", "Asma tavan ve aydınlatma", "Priz"] },
    { key: "depo", name: "Depo", items: ["Raf sistemi", "Zemin", "Havalandırma"] },
    { key: "wc", name: "WC", items: ["Klozet ve lavabo", "Fayans"] },
    { key: "tesisat", name: "Tesisat", items: ["Elektrik panosu", "Klima", "Su tesisatı"] },
  ],
};

function roomTemplate(propertyType: string | null): readonly { key: string; name: string; items: readonly string[] }[] {
  const t = (propertyType ?? "").toLocaleLowerCase("tr-TR");
  if (t.includes("ofis") || t.includes("plaza")) return COMMERCIAL_ROOMS.ofis;
  if (t.includes("dükkan") || t.includes("dukkan") || t.includes("işyeri") || t.includes("mağaza")) return COMMERCIAL_ROOMS.dukkan;
  return ROOM_TEMPLATES;
}

/** Girişte kayda geçen hafif kusurlar (kalem etiketine göre; şablonda yoksa atlanır). */
const MOVE_IN_NOTES: readonly { match: RegExp; condition: Condition; note: string }[] = [
  { match: /pencere|vitrin camı/i, condition: "worn", note: "Doğrama kenarında hafif boya dökülmesi; fotoğraflandı." },
  { match: /^zemin$/i, condition: "worn", note: "Zeminde eski mobilya izi." },
];
/** Çıkışta kötüleşen kalemler (depozito kesintisi önerisi bu farktan doğar). */
const MOVE_OUT_CHANGES: readonly { match: RegExp; condition: Condition; note: string }[] = [
  { match: /duvar ve boya/i, condition: "damaged", note: "Duvarda çivi delikleri ve lekeler; boya gerekiyor." },
  { match: /batarya/i, condition: "damaged", note: "Batarya damlatıyor, conta değişecek." },
  { match: /dolap|raf/i, condition: "missing", note: "Bir kapağın kulpu eksik." },
];

export function buildInspectionRooms(propertyType: string | null, kind: "move_in" | "move_out"): InspectionRoom[] {
  const rooms: InspectionRoom[] = roomTemplate(propertyType).map((r) => ({
    key: r.key,
    name: r.name,
    items: r.items.map((label, i) => ({ key: `${r.key}-${i + 1}`, label, condition: "good" as Condition, note: "" })),
  }));
  const flat = rooms.flatMap((r) => r.items);
  const marked = new Set<string>();
  const apply = (marks: readonly { match: RegExp; condition: Condition; note: string }[]) => {
    for (const mark of marks) {
      const it = flat.find((x) => !marked.has(x.key) && mark.match.test(x.label));
      if (!it) continue;
      marked.add(it.key);
      it.condition = mark.condition;
      it.note = mark.note;
    }
  };
  apply(MOVE_IN_NOTES);
  if (kind === "move_out") apply(MOVE_OUT_CHANGES);
  return rooms;
}

export function buildMeters(seed: number, kind: "move_in" | "move_out", monthsUsed: number): Meters {
  const base = { electricity: 12_400 + seed * 1_731, water: 840 + seed * 97, gas: 3_150 + seed * 411 };
  const used = kind === "move_out" ? { electricity: 230 * monthsUsed, water: 9 * monthsUsed, gas: 95 * monthsUsed } : { electricity: 0, water: 0, gas: 0 };
  const fmt = (n: number) => String(n).replace(".", ",");
  return {
    electricity: { reading: fmt(base.electricity + used.electricity), subscriber: `40${String(1_200_345 + seed * 7_919).padStart(8, "0")}` },
    water: { reading: fmt(base.water + used.water), subscriber: `ISKI-${String(55_210 + seed * 113)}` },
    gas: { reading: fmt(base.gas + used.gas), subscriber: `IGDAS-${String(781_200 + seed * 271)}` },
  };
}

export async function seedRentalInspections(ctx: RecordsSeedContext): Promise<number> {
  const { db, tenantId } = ctx;
  if (await alreadySeeded(ctx, "rental_inspections")) return 0;
  const nowMs = now();
  const [rentals, props] = await Promise.all([loadRentals(ctx), loadProperties(ctx)]);
  const propById = new Map(props.map((p) => [p.id, p]));
  const pick = rentals.filter((r) => r.property_id).slice(0, 4);
  if (pick.length === 0) return 0;
  const flag = flagOf(ctx);
  const rows: Dict[] = [];
  const keysOf = (kind: "move_in" | "move_out"): KeyEntry[] => (kind === "move_in" ? DEFAULT_KEYS.map((k) => ({ ...k })) : DEFAULT_KEYS.map((k, i) => ({ ...k, count: i === 0 ? 1 : k.count })));
  for (const [i, r] of pick.entries()) {
    const prop = propById.get(r.property_id!);
    // Teslim: kira başlangıç günü, kesinleşmiş (kilitli) tutanak.
    const startMs = Date.parse(`${r.start_date}T14:00:00+03:00`);
    const inAt = new Date(Math.min(startMs, nowMs - FUTURE_GUARD_MS)).toISOString();
    rows.push({
      tenant_id: tenantId, rental_id: r.id, kind: "move_in", status: "final", inspected_on: trDayKey(Date.parse(inAt)),
      rooms: buildInspectionRooms(prop?.property_type ?? null, "move_in"), meters: buildMeters(i, "move_in", 0), keys: keysOf("move_in"),
      notes: "Mülk kiracıya temiz ve boş teslim edildi; sayaçlar kiracı adına devredildi. Taraflar tutanağı yerinde okudu.",
      created_by: ctx.advisorId, updated_by: ctx.advisorId, finalized_at: inAt, created_at: inAt, updated_at: inAt, ...flag,
    });
  }
  // Tahliye: en eski kirada kiracı erken tahliye bildirdi; ön kontrol yapıldı, kesin tutanak anahtar tesliminde (taslak).
  const leaving = pick[0]!;
  const leavingProp = propById.get(leaving.property_id!);
  const monthsUsed = Math.max(1, Math.round(daysBetween(Date.parse(`${leaving.start_date}T12:00:00Z`), nowMs) / 30));
  const outAt = isoDaysAgo(nowMs, 2, 15);
  rows.push({
    tenant_id: tenantId, rental_id: leaving.id, kind: "move_out", status: "draft", inspected_on: trDayKey(Date.parse(outAt)),
    rooms: buildInspectionRooms(leavingProp?.property_type ?? null, "move_out"), meters: buildMeters(0, "move_out", monthsUsed), keys: keysOf("move_out"),
    notes: "Kiracı tahliye bildiriminde bulundu. Ön kontrol yapıldı; boya ve batarya için depozitodan kesinti konuşulacak. Kesin tutanak anahtar tesliminde imzalanacak.",
    created_by: ctx.advisorId, updated_by: ctx.advisorId, finalized_at: null, created_at: outAt, updated_at: outAt, ...flag,
  });
  return (await insertRows(db, "rental_inspections", rows)).length;
}
