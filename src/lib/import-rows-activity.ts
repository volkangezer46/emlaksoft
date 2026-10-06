/**
 * İçe aktarma — faaliyet kayıtları (görev, randevu, gider). SAF modül (DOM/DB yok; birim testli).
 * `import-rows.ts` ile aynı sözleşme: doğrula → planla (yeni / atla / hatalı). Bu türlerde
 * "güncelle" politikası YOKTUR (kimlik anahtarı yok); mükerrer = dosya içi ya da mevcut kayıtla
 * aynı anahtar. Telefon `parsePhoneStrict`, e-posta `normalizeEmail` ile doğrulanır (iletişim sözleşmesi).
 *
 * Kiralama içe aktarma bilinçli olarak YOK: aktif kira kaydı kazanılmış kiralama anlaşması + komisyon
 * zinciri ister (`rentals_guard_atomic_lifecycle`); toplu yazım bu değişmezi delmeden yapılamaz.
 */
import { parsePhoneStrict } from "@/lib/phone-rules";
import { isValidEmail, normalizeEmail } from "@/lib/email";
import { APPOINTMENT_TYPE_LABELS } from "@/lib/appointment-labels";
import { EXPENSE_CATEGORIES } from "@/lib/definition-defaults";
import {
  clean,
  findCustomerMatch,
  foldText,
  parseTurkishNumber,
  type CustomerLookup,
  type DuplicatePolicy,
  type ImportRow,
  type PlannedRow,
  type RowIssue,
} from "@/lib/import-rows";

export type ActivityTarget = "tasks" | "appointments" | "expenses";
export const ACTIVITY_TARGETS: readonly ActivityTarget[] = ["tasks", "appointments", "expenses"];

export function isActivityTarget(t: string): t is ActivityTarget {
  return (ACTIVITY_TARGETS as readonly string[]).includes(t);
}

/**
 * Tarih/saat çözümleme: "GG.AA.YYYY", "GG/AA/YYYY", "YYYY-MM-DD", isteğe bağlı " SS:DD".
 * Saat Türkiye saatidir (UTC+3). Dönen `iso` gerçek an; `day` takvim günü.
 */
export function parseTrDateTime(raw: string): { iso: string; day: string; hasTime: boolean } | null {
  const v = clean(raw);
  if (!v) return null;
  const m =
    /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:[ T](\d{1,2})[:.](\d{2}))?$/.exec(v) ??
    null;
  const iso8601 = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2})[:.](\d{2}))?/.exec(v);
  let y: number, mo: number, d: number, hh = 0, mi = 0, hasTime = false;
  if (m) {
    d = Number(m[1]);
    mo = Number(m[2]);
    y = Number(m[3]);
    if (m[4] !== undefined) {
      hh = Number(m[4]);
      mi = Number(m[5]);
      hasTime = true;
    }
  } else if (iso8601) {
    y = Number(iso8601[1]);
    mo = Number(iso8601[2]);
    d = Number(iso8601[3]);
    if (iso8601[4] !== undefined) {
      hh = Number(iso8601[4]);
      mi = Number(iso8601[5]);
      hasTime = true;
    }
  } else {
    return null;
  }
  if (y < 1990 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31 || hh > 23 || mi > 59) return null;
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  const day = `${y}-${pad(mo)}-${pad(d)}`;
  const ms = Date.UTC(y, mo - 1, d, hh, mi) - 3 * 3_600_000;
  return { iso: new Date(ms).toISOString(), day, hasTime };
}

function contactMatch(
  r: ImportRow,
  lookup: CustomerLookup,
  issues: RowIssue[],
): { id: string; name: string | null } | null | "error" {
  const phoneRaw = clean(r.customer_phone);
  const email = normalizeEmail(clean(r.customer_email));
  if (!phoneRaw && !email) return null;
  const parsed = phoneRaw ? parsePhoneStrict(phoneRaw) : null;
  if (parsed && !parsed.ok) {
    issues.push({ level: "error", message: `Müşteri telefonu geçersiz: "${phoneRaw}".` });
    return "error";
  }
  if (email && !isValidEmail(email)) {
    issues.push({ level: "error", message: `Müşteri e-postası geçersiz: "${email}".` });
    return "error";
  }
  const match = findCustomerMatch(lookup, parsed?.stored ?? "", email);
  if (!match) {
    issues.push({ level: "warning", message: "Eşleşen müşteri bulunamadı; kayıt müşterisiz eklenir." });
    return null;
  }
  return { id: match.customer.id, name: match.customer.full_name ?? null };
}

// ── Görev ───────────────────────────────────────────────────────────────────
const TASK_KIND_BY_LABEL: Record<string, string> = {
  takip: "followup", followup: "followup", arama: "call", call: "call", telefon: "call",
  ziyaret: "visit", visit: "visit", evrak: "document", belge: "document", document: "document", diger: "other", other: "other",
};
const PRIORITY_BY_LABEL: Record<string, string> = { dusuk: "low", low: "low", normal: "normal", orta: "normal", yuksek: "high", high: "high", acil: "high" };

export type NormalizedTask = {
  title: string;
  due_at: string | null;
  kind: string;
  priority: string;
  notes: string | null;
  customer_id: string | null;
};

export const taskKey = (t: { title: string; due_at: string | null; customer_id: string | null }) =>
  [foldText(t.title), t.due_at ?? "", t.customer_id ?? ""].join("|");

export function validateTaskRow(r: ImportRow, lookup: CustomerLookup): { data?: NormalizedTask; issues: RowIssue[]; customerName?: string | null } {
  const issues: RowIssue[] = [];
  const title = clean(r.title).slice(0, 200);
  if (!title) return { issues: [{ level: "error", message: "Görev başlığı zorunlu." }] };
  const dueRaw = clean(r.due_at);
  const due = dueRaw ? parseTrDateTime(dueRaw) : null;
  if (dueRaw && !due) issues.push({ level: "warning", message: `Son tarih tanınmadı, tarihsiz eklenir: "${dueRaw}".` });
  const kindRaw = clean(r.kind);
  const kind = kindRaw ? (TASK_KIND_BY_LABEL[foldText(kindRaw)] ?? "") : "followup";
  if (kindRaw && !kind) issues.push({ level: "warning", message: `Görev türü tanınmadı ("${kindRaw}"); "Takip" varsayıldı.` });
  const prRaw = clean(r.priority);
  const priority = prRaw ? (PRIORITY_BY_LABEL[foldText(prRaw)] ?? "") : "normal";
  if (prRaw && !priority) issues.push({ level: "warning", message: `Öncelik tanınmadı ("${prRaw}"); "Normal" varsayıldı.` });
  const customer = contactMatch(r, lookup, issues);
  if (customer === "error") return { issues };
  return {
    issues,
    customerName: customer?.name ?? null,
    data: {
      title,
      due_at: due ? (due.hasTime ? due.iso : parseTrDateTime(`${due.day} 09:00`)!.iso) : null,
      kind: kind || "followup",
      priority: priority || "normal",
      notes: clean(r.notes).slice(0, 2000) || null,
      customer_id: customer?.id ?? null,
    },
  };
}

// ── Randevu ─────────────────────────────────────────────────────────────────
const APPT_TYPE_BY_LABEL: Record<string, string> = (() => {
  const out: Record<string, string> = { gosterim: "showing", "yer gosterme": "showing", ofis: "office", degerleme: "valuation", sozlesme: "contract", imza: "contract" };
  for (const [value, label] of Object.entries(APPOINTMENT_TYPE_LABELS)) {
    out[foldText(label)] = value;
    out[foldText(value)] = value;
  }
  return out;
})();

export type NormalizedAppointment = {
  scheduled_at: string;
  appointment_type: string;
  duration_min: number | null;
  location: string | null;
  notes: string | null;
  customer_id: string | null;
};

export const appointmentKey = (a: { scheduled_at: string; appointment_type: string; customer_id: string | null }) =>
  [a.scheduled_at, a.appointment_type, a.customer_id ?? ""].join("|");

export function validateAppointmentRow(
  r: ImportRow,
  lookup: CustomerLookup,
): { data?: NormalizedAppointment; issues: RowIssue[]; customerName?: string | null } {
  const issues: RowIssue[] = [];
  const whenRaw = clean(r.scheduled_at);
  const when = whenRaw ? parseTrDateTime(whenRaw) : null;
  if (!when) return { issues: [{ level: "error", message: whenRaw ? `Randevu tarihi tanınmadı: "${whenRaw}" (GG.AA.YYYY SS:DD).` : "Randevu tarihi zorunlu." }] };
  if (!when.hasTime) issues.push({ level: "warning", message: "Saat yok; 10:00 varsayıldı." });
  const typeRaw = clean(r.appointment_type);
  const type = typeRaw ? (APPT_TYPE_BY_LABEL[foldText(typeRaw)] ?? "") : "showing";
  if (typeRaw && !type) issues.push({ level: "warning", message: `Randevu türü tanınmadı ("${typeRaw}"); "Yer gösterme" varsayıldı.` });
  const durRaw = clean(r.duration_min);
  const durNum = durRaw ? parseTurkishNumber(durRaw) : null;
  const duration = durNum != null && durNum > 0 && durNum <= 24 * 60 ? Math.round(durNum) : null;
  if (durRaw && duration == null) issues.push({ level: "warning", message: `Süre tanınmadı, yok sayıldı: "${durRaw}".` });
  const customer = contactMatch(r, lookup, issues);
  if (customer === "error") return { issues };
  return {
    issues,
    customerName: customer?.name ?? null,
    data: {
      scheduled_at: when.hasTime ? when.iso : parseTrDateTime(`${when.day} 10:00`)!.iso,
      appointment_type: type || "showing",
      duration_min: duration,
      location: clean(r.location).slice(0, 300) || null,
      notes: clean(r.notes).slice(0, 2000) || null,
      customer_id: customer?.id ?? null,
    },
  };
}

// ── Gider ───────────────────────────────────────────────────────────────────
const EXPENSE_CAT_BY_LABEL: Record<string, string> = (() => {
  const out: Record<string, string> = { reklam: "reklam", pazarlama: "reklam", ofis: "ofis", kira: "ofis", ulasim: "ulasim", yakit: "ulasim", egitim: "egitim", komisyon: "komisyon_gider", diger: "diger" };
  for (const c of EXPENSE_CATEGORIES) {
    out[foldText(c.label)] = c.value;
    out[foldText(c.value)] = c.value;
  }
  return out;
})();

export type NormalizedExpense = {
  title: string;
  amount: number;
  category: string;
  expense_date: string;
  notes: string | null;
};

export const expenseKey = (x: { title: string; amount: number; expense_date: string }) =>
  [foldText(x.title), x.amount.toFixed(2), x.expense_date].join("|");

export function validateExpenseRow(r: ImportRow, todayKey: string): { data?: NormalizedExpense; issues: RowIssue[] } {
  const issues: RowIssue[] = [];
  const title = clean(r.title).slice(0, 160);
  if (!title) return { issues: [{ level: "error", message: "Gider başlığı zorunlu." }] };
  const amountRaw = clean(r.amount);
  const amount = amountRaw ? parseTurkishNumber(amountRaw) : null;
  if (amount == null || amount <= 0 || amount > 9_999_999_999.99) {
    return { issues: [{ level: "error", message: amountRaw ? `Tutar geçersiz: "${amountRaw}".` : "Tutar zorunlu." }] };
  }
  const catRaw = clean(r.category);
  const category = catRaw ? (EXPENSE_CAT_BY_LABEL[foldText(catRaw)] ?? "") : "diger";
  if (catRaw && !category) issues.push({ level: "warning", message: `Kategori tanınmadı ("${catRaw}"); "Diğer" varsayıldı.` });
  const dateRaw = clean(r.expense_date);
  const date = dateRaw ? parseTrDateTime(dateRaw) : null;
  if (dateRaw && !date) issues.push({ level: "warning", message: `Tarih tanınmadı ("${dateRaw}"); bugün varsayıldı.` });
  return {
    issues,
    data: {
      title,
      amount: Math.round(amount * 100) / 100,
      category: category || "diger",
      expense_date: date?.day ?? todayKey,
      notes: clean(r.notes).slice(0, 2000) || null,
    },
  };
}

// ── Ortak planlama ──────────────────────────────────────────────────────────
type Validated<T> = { data?: T; issues: RowIssue[]; customerName?: string | null };

/**
 * Doğrulanmış satırları planlar: hatalı → error; dosya içi ya da mevcut anahtar → skip ("create" politikası
 * hariç); aksi halde new. Güncelleme yoktur.
 */
export function planActivityRows<T>(
  rows: ImportRow[],
  validate: (r: ImportRow) => Validated<T>,
  keyOf: (d: T) => string,
  existing: Set<string>,
  policy: DuplicatePolicy,
  seen: Set<string> = new Set(),
): PlannedRow<T>[] {
  return rows.map((r) => {
    const v = validate(r);
    if (!v.data) return { row: r.row, status: "error" as const, issues: v.issues };
    const key = keyOf(v.data);
    const dupInFile = seen.has(key);
    seen.add(key);
    const base = { row: r.row, issues: v.issues, data: v.data, existingName: v.customerName ?? undefined };
    if ((dupInFile || existing.has(key)) && policy !== "create") {
      return {
        ...base,
        status: "skip" as const,
        issues: [
          ...v.issues,
          { level: "warning" as const, message: dupInFile ? "Aynı kayıt dosyada daha önce geçiyor." : "Atlandı (mevcut): aynı kayıt zaten var." },
        ],
      };
    }
    return { ...base, status: "new" as const };
  });
}
