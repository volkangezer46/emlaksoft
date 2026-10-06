/**
 * İçe aktarma çekirdeği (SAF modül — DOM/DB yok; birim testli).
 *
 * Müşteri, portföy ve talep içe aktarmasının ortak doğrulama + mükerrer
 * planlama mantığı. Sunucu (dry-run önizleme ve gerçek yazma) ve istemci
 * AYNI fonksiyonları kullanır; böylece önizlemedeki sayaçlar kayıt sonrası
 * sonuçtan sapmaz.
 *
 * Telefon `parsePhone`, e-posta `normalizeEmail`/`isValidEmail`, talep
 * değerleri `parseDemandValues` ile doğrulanır (iletişim sözleşmesi).
 */

import { parsePhoneStrict } from "@/lib/phone-rules";
import { isValidEmail, normalizeEmail } from "@/lib/email";
import { DEFAULT_DEFINITIONS, defaultLabelMap } from "@/lib/definition-defaults";
import { parseDemandValues, type DemandColumns, type DemandCriteria } from "@/lib/demand-criteria";

/** Faaliyet türleri (görev / randevu / gider) `import-rows-activity.ts`te doğrulanır; yalnız "atla"/"yeni oluştur". */
export type ImportTarget = "customers" | "properties" | "demands" | "tasks" | "appointments" | "expenses";
export type DuplicatePolicy = "skip" | "update" | "create";
export type RowStatus = "new" | "update" | "skip" | "error";

export type ImportRow = { row: number; [key: string]: string | number | undefined };

export type RowIssue = { level: "error" | "warning"; message: string };

export type PlannedRow<T = unknown> = {
  row: number;
  status: RowStatus;
  issues: RowIssue[];
  data?: T;
  existingId?: string;
  existingName?: string;
  matchedBy?: string;
  /** Yalnız "update": uygulanacak alanlar ve geri alma için eski değerleri. */
  patch?: Record<string, unknown>;
  prev?: Record<string, unknown>;
};

export type ImportCounters = {
  total: number;
  new: number;
  update: number;
  skip: number;
  error: number;
  warning: number;
};

export function emptyCounters(): ImportCounters {
  return { total: 0, new: 0, update: 0, skip: 0, error: 0, warning: 0 };
}

export function countPlanned(rows: Pick<PlannedRow, "status" | "issues">[]): ImportCounters {
  const c = emptyCounters();
  for (const r of rows) {
    c.total += 1;
    c[r.status] += 1;
    if (r.status !== "error" && r.issues.some((i) => i.level === "warning")) c.warning += 1;
  }
  return c;
}

export function mergeCounters(a: ImportCounters, b: ImportCounters): ImportCounters {
  return {
    total: a.total + b.total,
    new: a.new + b.new,
    update: a.update + b.update,
    skip: a.skip + b.skip,
    error: a.error + b.error,
    warning: a.warning + b.warning,
  };
}

// ---------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------

export const clean = (v: unknown): string => String(v ?? "").trim();

/** tr-TR küçük harf + aksan katlama + noktalama → boşluk (eşleme ve karşılaştırma anahtarı). */
export function foldText(input: string): string {
  return input
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** "1.250.000,50" / "1250000.50" / "1 250 000 TL" → sayı; geçersizse null. */
export function parseTurkishNumber(raw: string): number | null {
  const s = clean(raw).replace(/[^\d.,]/g, "");
  if (!s) return null;
  let normalized = s;
  if (s.includes(",")) {
    normalized = s.replace(/\./g, "").replace(",", ".");
  } else {
    const dots = (s.match(/\./g) ?? []).length;
    if (dots > 1 || /^\d{1,3}(\.\d{3})+$/.test(s)) normalized = s.replace(/\./g, "");
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

/** Serbest metni tanım listesindeki kanonik değere çevirir (bulunamazsa null). */
function canonicalFromDefaults(
  category: "customer_type" | "property_type" | "transaction_type",
  raw: string,
  loose: boolean,
): string | null {
  const f = foldText(raw);
  if (!f) return null;
  for (const d of DEFAULT_DEFINITIONS[category]) {
    const dv = foldText(d.value);
    if (f === dv) return d.value;
    // "satis" → Satılık, "kira" → Kiralık gibi kök eşleşmesi (yalnız gevşek modda).
    if (loose && dv.length >= 3 && f.startsWith(dv.slice(0, 3))) return d.value;
  }
  return null;
}

const URGENCY_BY_LABEL: Record<string, string> = Object.fromEntries(
  Object.entries(defaultLabelMap("demand_urgency")).flatMap(([value, label]) => [
    [foldText(label), value],
    [foldText(value), value],
  ]),
);

// ---------------------------------------------------------------------------
// Müşteri
// ---------------------------------------------------------------------------

export type NormalizedCustomer = {
  full_name: string;
  phone: string;
  email: string;
  customer_type: string;
  source: string;
  notes: string;
};

export type ExistingCustomer = {
  id: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  customer_types?: string[] | null;
  source?: string | null;
  notes?: string | null;
};

export type CustomerLookup = {
  byPhone: Map<string, ExistingCustomer>;
  byEmail: Map<string, ExistingCustomer>;
};

export const DEFAULT_IMPORT_SOURCE = "İçe aktarma";

export function validateCustomerRow(r: ImportRow): { data?: NormalizedCustomer; issues: RowIssue[] } {
  const issues: RowIssue[] = [];
  const fullName = clean(r.full_name);
  const phoneRaw = clean(r.phone);
  const email = normalizeEmail(clean(r.email));
  if (!fullName) issues.push({ level: "error", message: "Ad soyad boş." });
  const parsedPhone = phoneRaw ? parsePhoneStrict(phoneRaw) : null;
  if (parsedPhone && !parsedPhone.ok) {
    issues.push({
      level: "error",
      message: `Telefon geçersiz: "${phoneRaw}" (${parsedPhone.error ?? "05XX XXX XX XX veya +<ülke kodu> numara bekleniyor"}).`,
    });
  }
  if (email && !isValidEmail(email)) {
    issues.push({ level: "error", message: `E-posta biçimi geçersiz: "${email}".` });
  }
  if (issues.some((i) => i.level === "error")) return { issues };

  const phone = parsedPhone?.stored ?? "";
  if (!phone && !email) {
    issues.push({
      level: "warning",
      message: "Telefon ve e-posta yok; mükerrer kontrolü yapılamaz, kişiye ulaşılamaz.",
    });
  }
  const typeRaw = clean(r.customer_type);
  const type = typeRaw ? (canonicalFromDefaults("customer_type", typeRaw, false) ?? typeRaw) : "";
  return {
    issues,
    data: {
      full_name: fullName,
      phone,
      email,
      customer_type: type,
      source: clean(r.source),
      notes: clean(r.notes),
    },
  };
}

/** Eşleşme aramak için doğrulanmış satırlardaki telefon/e-posta anahtarları. */
export function collectCustomerKeys(rows: ImportRow[]): { phones: string[]; emails: string[] } {
  const phones = new Set<string>();
  const emails = new Set<string>();
  for (const r of rows) {
    const v = validateCustomerRow(r);
    if (!v.data) continue;
    if (v.data.phone) phones.add(v.data.phone);
    if (v.data.email) emails.add(v.data.email);
  }
  return { phones: [...phones], emails: [...emails] };
}

export function emptyCustomerLookup(): CustomerLookup {
  return { byPhone: new Map(), byEmail: new Map() };
}

export function buildCustomerLookup(existing: ExistingCustomer[]): CustomerLookup {
  const l = emptyCustomerLookup();
  for (const c of existing) {
    if (c.phone) l.byPhone.set(c.phone, c);
    if (c.email) l.byEmail.set(normalizeEmail(c.email), c);
  }
  return l;
}

export function findCustomerMatch(
  lookup: CustomerLookup,
  phone: string,
  email: string,
): { customer: ExistingCustomer; by: "telefon" | "e-posta" } | null {
  if (phone) {
    const c = lookup.byPhone.get(phone);
    if (c) return { customer: c, by: "telefon" };
  }
  if (email) {
    const c = lookup.byEmail.get(email);
    if (c) return { customer: c, by: "e-posta" };
  }
  return null;
}

/** Güncelleme yaması: yalnız dosyada dolu olup farklı olan alanlar; eski değerler `prev`'e. */
export function buildCustomerPatch(
  existing: ExistingCustomer,
  data: NormalizedCustomer,
): { patch: Record<string, unknown>; prev: Record<string, unknown> } {
  const patch: Record<string, unknown> = {};
  const prev: Record<string, unknown> = {};
  const set = (key: string, next: unknown, old: unknown) => {
    patch[key] = next;
    prev[key] = old ?? null;
  };
  if (data.full_name && data.full_name !== (existing.full_name ?? "")) set("full_name", data.full_name, existing.full_name);
  if (data.email && data.email !== normalizeEmail(existing.email ?? "")) set("email", data.email, existing.email);
  if (data.phone && !existing.phone) set("phone", data.phone, existing.phone);
  if (data.source && data.source !== (existing.source ?? "")) set("source", data.source, existing.source);
  if (data.notes && data.notes !== (existing.notes ?? "")) set("notes", data.notes, existing.notes);
  if (data.customer_type) {
    const types = existing.customer_types ?? [];
    if (!types.includes(data.customer_type)) set("customer_types", [...types, data.customer_type], types);
  }
  return { patch, prev };
}

/**
 * Müşteri satırlarını planlar (yazma yok). Mükerrer: önce telefon, sonra e-posta.
 * `seen`, aynı dosyada önceki satırlarda görülen anahtarlardır ("p:<tel>" / "e:<posta>");
 * çağıran parçalar arasında taşıyabilir. Dosya içi tekrar her zaman İLK satır kazanır:
 * "atla" ve "güncelle" politikalarında sonraki satırlar atlanır, "yeni oluştur"da
 * tekrar kayıt açılır.
 */
export function planCustomerRows(
  rows: ImportRow[],
  lookup: CustomerLookup,
  policy: DuplicatePolicy,
  seen: Set<string> = new Set(),
): PlannedRow<NormalizedCustomer>[] {
  return rows.map((r) => {
    const v = validateCustomerRow(r);
    if (!v.data) return { row: r.row, status: "error" as const, issues: v.issues };
    const { data, issues } = v;
    const keys = [data.phone ? `p:${data.phone}` : "", data.email ? `e:${data.email}` : ""].filter(Boolean);

    const dupInFile = keys.some((k) => seen.has(k));
    keys.forEach((k) => seen.add(k));
    if (dupInFile && policy !== "create") {
      return {
        row: r.row,
        status: "skip" as const,
        issues: [...issues, { level: "warning" as const, message: "Aynı telefon/e-posta dosyada daha önce geçiyor." }],
        data,
        matchedBy: "dosyada önceki satır",
      };
    }

    const match = findCustomerMatch(lookup, data.phone, data.email);
    if (!match || policy === "create") {
      const out: PlannedRow<NormalizedCustomer> = { row: r.row, status: "new", issues, data };
      if (match) {
        out.issues = [...issues, { level: "warning", message: `Mevcut müşteriyle aynı ${match.by}; yeni kayıt açılacak.` }];
        out.existingId = match.customer.id;
        out.existingName = match.customer.full_name ?? undefined;
        out.matchedBy = match.by;
      }
      return out;
    }

    const base = {
      row: r.row,
      issues,
      data,
      existingId: match.customer.id,
      existingName: match.customer.full_name ?? undefined,
      matchedBy: match.by,
    };
    if (policy === "skip") {
      return {
        ...base,
        status: "skip" as const,
        issues: [...issues, { level: "warning" as const, message: `Atlandı (mevcut): bu ${match.by} zaten kayıtlı.` }],
      };
    }
    const { patch, prev } = buildCustomerPatch(match.customer, data);
    if (!Object.keys(patch).length) {
      return {
        ...base,
        status: "skip" as const,
        issues: [...issues, { level: "warning" as const, message: "Mevcut kayıtla aynı; güncellenecek alan yok." }],
      };
    }
    return { ...base, status: "update" as const, patch, prev };
  });
}

// ---------------------------------------------------------------------------
// Portföy
// ---------------------------------------------------------------------------

export type NormalizedProperty = {
  title: string;
  transaction_type: string;
  property_type: string;
  list_price: number | null;
  rooms: string | null;
  sqm: number | null;
  address_line: string | null;
};

export type ExistingProperty = {
  id: string;
  title: string;
  address_line: string | null;
  list_price: number | null;
  features: Record<string, unknown> | null;
};

export const propertyKey = (title: string, address: string | null | undefined) =>
  `${foldText(title)}|${foldText(address ?? "")}`;

export function validatePropertyRow(r: ImportRow): { data?: NormalizedProperty; issues: RowIssue[] } {
  const issues: RowIssue[] = [];
  const title = clean(r.title);
  if (!title) return { issues: [{ level: "error", message: "Başlık boş." }] };

  const priceRaw = clean(r.list_price);
  let listPrice: number | null = null;
  if (priceRaw) {
    listPrice = parseTurkishNumber(priceRaw);
    if (listPrice === null || listPrice <= 0) {
      return { issues: [{ level: "error", message: `Fiyat sayı değil: "${priceRaw}".` }] };
    }
  } else {
    issues.push({ level: "warning", message: "Fiyat boş; portföy fiyatsız eklenecek." });
  }
  const sqmRaw = clean(r.sqm);
  let sqm: number | null = null;
  if (sqmRaw) {
    sqm = parseTurkishNumber(sqmRaw);
    if (sqm === null || sqm <= 0) {
      issues.push({ level: "warning", message: `m² sayı değil, yok sayıldı: "${sqmRaw}".` });
      sqm = null;
    }
  }

  const txRaw = clean(r.transaction_type);
  let transaction = canonicalFromDefaults("transaction_type", txRaw, true);
  if (!transaction) {
    transaction = DEFAULT_DEFINITIONS.transaction_type[0].value;
    issues.push({
      level: "warning",
      message: txRaw
        ? `İşlem türü tanınmadı ("${txRaw}"); "${transaction}" varsayıldı.`
        : `İşlem türü boş; "${transaction}" varsayıldı.`,
    });
  }
  const ptRaw = clean(r.property_type);
  const propertyType = ptRaw
    ? (canonicalFromDefaults("property_type", ptRaw, false) ?? ptRaw)
    : (DEFAULT_DEFINITIONS.property_type.find((d) => d.value === "Diğer")?.value ?? "Diğer");
  if (!ptRaw) issues.push({ level: "warning", message: `Portföy türü boş; "${propertyType}" varsayıldı.` });

  return {
    issues,
    data: {
      title,
      transaction_type: transaction,
      property_type: propertyType,
      list_price: listPrice,
      rooms: clean(r.rooms) || null,
      sqm,
      address_line: clean(r.address_line) || null,
    },
  };
}

export function planPropertyRows(
  rows: ImportRow[],
  existing: Map<string, ExistingProperty>,
  policy: DuplicatePolicy,
  seen: Set<string> = new Set(),
): PlannedRow<NormalizedProperty>[] {
  return rows.map((r) => {
    const v = validatePropertyRow(r);
    if (!v.data) return { row: r.row, status: "error" as const, issues: v.issues };
    const { data, issues } = v;
    const key = propertyKey(data.title, data.address_line);
    const dupInFile = seen.has(key);
    seen.add(key);
    if (dupInFile && policy !== "create") {
      return {
        row: r.row,
        status: "skip" as const,
        issues: [...issues, { level: "warning" as const, message: "Aynı başlık ve adres dosyada daha önce geçiyor." }],
        data,
        matchedBy: "dosyada önceki satır",
      };
    }
    const match = existing.get(key);
    if (!match || policy === "create") {
      return { row: r.row, status: "new" as const, issues, data };
    }
    const base = { row: r.row, issues, data, existingId: match.id, existingName: match.title, matchedBy: "başlık + adres" };
    if (policy === "skip") {
      return {
        ...base,
        status: "skip" as const,
        issues: [...issues, { level: "warning" as const, message: "Atlandı (mevcut): aynı başlık ve adres zaten kayıtlı." }],
      };
    }
    const patch: Record<string, unknown> = {};
    const prev: Record<string, unknown> = {};
    if (data.list_price !== null && data.list_price !== match.list_price) {
      patch.list_price = data.list_price;
      prev.list_price = match.list_price;
    }
    const oldFeatures = match.features ?? {};
    const nextFeatures = { ...oldFeatures };
    if (data.rooms && data.rooms !== oldFeatures.rooms) nextFeatures.rooms = data.rooms;
    if (data.sqm !== null && data.sqm !== oldFeatures.sqm) nextFeatures.sqm = data.sqm;
    if (JSON.stringify(nextFeatures) !== JSON.stringify(oldFeatures)) {
      patch.features = nextFeatures;
      prev.features = oldFeatures;
    }
    if (!Object.keys(patch).length) {
      return {
        ...base,
        status: "skip" as const,
        issues: [...issues, { level: "warning" as const, message: "Mevcut kayıtla aynı; güncellenecek alan yok." }],
      };
    }
    return { ...base, status: "update" as const, patch, prev };
  });
}

// ---------------------------------------------------------------------------
// Talep
// ---------------------------------------------------------------------------

export type NormalizedDemand = {
  customer_phone: string;
  customer_email: string;
  columns: DemandColumns;
  criteria: DemandCriteria;
};

export type ExistingDemand = {
  customer_id: string;
  transaction_type: string;
  property_type: string | null;
  rooms: string | null;
  budget_max: number | null;
};

export const demandKey = (
  customerId: string,
  c: { transaction_type: string; property_type: string | null; rooms: string | null; budget_max: number | null },
) => [customerId, foldText(c.transaction_type), foldText(c.property_type ?? ""), foldText(c.rooms ?? ""), c.budget_max ?? ""].join("|");

export function validateDemandRow(r: ImportRow): { data?: NormalizedDemand; issues: RowIssue[] } {
  const issues: RowIssue[] = [];
  const phoneRaw = clean(r.customer_phone);
  const email = normalizeEmail(clean(r.customer_email));
  const parsedPhone = phoneRaw ? parsePhoneStrict(phoneRaw) : null;
  if (parsedPhone && !parsedPhone.ok) {
    issues.push({ level: "error", message: `Müşteri telefonu geçersiz: "${phoneRaw}" (${parsedPhone.error ?? "geçersiz numara"}).` });
  }
  if (email && !isValidEmail(email)) issues.push({ level: "error", message: `Müşteri e-postası geçersiz: "${email}".` });
  if (!phoneRaw && !email) {
    issues.push({ level: "error", message: "Talebi bağlamak için müşteri telefonu veya e-postası gerekir." });
  }
  if (issues.length) return { issues };

  const txRaw = clean(r.transaction_type);
  let transaction = canonicalFromDefaults("transaction_type", txRaw, true);
  if (!transaction) {
    transaction = DEFAULT_DEFINITIONS.transaction_type[0].value;
    issues.push({
      level: "warning",
      message: txRaw
        ? `İşlem türü tanınmadı ("${txRaw}"); "${transaction}" varsayıldı.`
        : `İşlem türü boş; "${transaction}" varsayıldı.`,
    });
  }
  const ptRaw = clean(r.property_type);
  const propertyType = ptRaw ? (canonicalFromDefaults("property_type", ptRaw, false) ?? ptRaw) : "";
  const urgRaw = clean(r.urgency);
  let urgency = "";
  if (urgRaw) {
    urgency = URGENCY_BY_LABEL[foldText(urgRaw)] ?? "";
    if (!urgency) issues.push({ level: "warning", message: `Aciliyet tanınmadı, yok sayıldı: "${urgRaw}".` });
  }

  const parsed = parseDemandValues({
    transaction_type: transaction,
    property_type: propertyType,
    budget_min: numericText(r.budget_min),
    budget_max: numericText(r.budget_max),
    rooms: clean(r.rooms),
    min_sqm: numericText(r.min_sqm),
    urgency,
  });
  if (!parsed.ok) return { issues: [{ level: "error", message: parsed.error }] };
  return {
    issues,
    data: {
      customer_phone: parsedPhone?.stored ?? "",
      customer_email: email,
      columns: parsed.columns,
      criteria: parsed.criteria,
    },
  };
}

/** "4.500.000" gibi TR yazımını parseMoneyInput'un beklediği yalın sayıya çevirir. */
function numericText(v: unknown): string {
  const raw = clean(v);
  if (!raw) return "";
  const n = parseTurkishNumber(raw);
  return n === null ? raw : String(n);
}

export function planDemandRows(
  rows: ImportRow[],
  lookup: CustomerLookup,
  existing: Set<string>,
  policy: DuplicatePolicy,
  seen: Set<string> = new Set(),
): PlannedRow<NormalizedDemand & { customer_id: string }>[] {
  return rows.map((r) => {
    const v = validateDemandRow(r);
    if (!v.data) return { row: r.row, status: "error" as const, issues: v.issues };
    const { data, issues } = v;
    const match = findCustomerMatch(lookup, data.customer_phone, data.customer_email);
    if (!match) {
      return {
        row: r.row,
        status: "error" as const,
        issues: [
          ...issues,
          { level: "error" as const, message: "Eşleşen müşteri bulunamadı. Önce müşterileri içe aktarın veya telefon/e-postayı düzeltin." },
        ],
      };
    }
    const key = demandKey(match.customer.id, data.columns);
    const dupInFile = seen.has(key);
    seen.add(key);
    const planned = { ...data, customer_id: match.customer.id };
    const base = {
      row: r.row,
      issues,
      data: planned,
      existingId: match.customer.id,
      existingName: match.customer.full_name ?? undefined,
      matchedBy: match.by,
    };
    if ((dupInFile || existing.has(key)) && policy !== "create") {
      return {
        ...base,
        status: "skip" as const,
        issues: [
          ...issues,
          {
            level: "warning" as const,
            message: dupInFile
              ? "Aynı müşteri için aynı talep dosyada daha önce geçiyor."
              : "Atlandı (mevcut): bu müşterinin aynı kriterli aktif talebi var.",
          },
        ],
      };
    }
    return { ...base, status: "new" as const };
  });
}

// ---------------------------------------------------------------------------
// Rapor (CSV)
// ---------------------------------------------------------------------------

const STATUS_LABEL: Record<RowStatus, string> = {
  new: "Yeni",
  update: "Güncellenecek",
  skip: "Atlandı",
  error: "Hatalı",
};

export function statusLabel(s: RowStatus): string {
  return STATUS_LABEL[s];
}

function csvCell(v: string): string {
  return /[",;\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/**
 * Hatalı (ve istenirse atlanan) satırları, ORİJİNAL dosya sütunlarıyla birlikte CSV'ye çevirir;
 * kullanıcı düzeltip aynı dosyayı yeniden yükleyebilir. Excel TR için BOM + noktalı virgül.
 */
export function buildIssueCsv(
  headers: string[],
  sourceRows: string[][],
  planned: Pick<PlannedRow, "row" | "status" | "issues">[],
  include: RowStatus[] = ["error"],
): string {
  const head = ["Satır", "Durum", "Sebep", ...headers].map(csvCell).join(";");
  const lines = [head];
  for (const p of planned) {
    if (!include.includes(p.status)) continue;
    const src = sourceRows[p.row - 2] ?? [];
    const reason = p.issues.map((i) => i.message).join(" | ");
    lines.push(
      [String(p.row), statusLabel(p.status), reason, ...headers.map((_, i) => src[i] ?? "")].map(csvCell).join(";"),
    );
  }
  return `﻿${lines.join("\r\n")}\r\n`;
}
