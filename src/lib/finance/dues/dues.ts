/**
 * Tekil mülk aidatı = `finance_open_items` (source_type 'due') — WP4, 20261017010500. SAF yardımcılar (sunucu + istemci):
 * olay anahtarları (SQL `'due:' || id` ve `'deposit:' || rental || ':' || event` aynası), satır → görünüm eşlemesi,
 * süzgeç anahtarları ve FN hata kodlarının Türkçe karşılıkları.
 */

export type DueDirection = "payable" | "receivable";
export type DueStatus = "unpaid" | "partial" | "paid" | "cancelled";
export type DepositEvent = "received" | "returned";

/** SQL `finance_due_create` / `finance_due_backfill` ile aynı anahtar. `id` = açık kalemin source_id'si. */
export function duePostingKey(sourceId: string): string {
  return `due:${sourceId}`;
}

/** SQL `rental_deposit_post` ile aynı anahtar. */
export function depositPostingKey(rentalId: string, event: DepositEvent): string {
  return `deposit:${rentalId}:${event}`;
}

/** Yöne göre açık kalem kategorisi (SQL ile aynı): ofis öder → 'aidat' (gider), ofis tahsil eder → 'aidat_tahsilat' (emanet). */
export function dueCategory(direction: DueDirection): "aidat" | "aidat_tahsilat" {
  return direction === "receivable" ? "aidat_tahsilat" : "aidat";
}

export function isDueDirection(v: unknown): v is DueDirection {
  return v === "payable" || v === "receivable";
}

export const DUE_DIRECTION_LABELS: Record<DueDirection, string> = {
  payable: "Ofis öder",
  receivable: "Ofis tahsil eder",
};

type PropertyRef = { id: string; property_code: string; title: string | null };

/** `finance_open_items` satırı (aidat sayfası seçimi). */
export type DueOpenItemRow = {
  id: string;
  source_id: string | null;
  title: string;
  amount: number | string;
  paid_amount: number | string;
  issue_date: string;
  due_date: string | null;
  status: string;
  note: string | null;
  direction: string;
  settled_on?: string | null;
  cancel_reason?: string | null;
  property?: PropertyRef | PropertyRef[] | null;
};

export type DueView = {
  id: string;
  /** owner_charge_links.ref_id (eski aidatta property_dues.id; yenide kalemin kendi kimliği). */
  sourceId: string;
  title: string;
  amount: number;
  paid: number;
  remaining: number;
  period: string;
  dueDate: string | null;
  status: DueStatus;
  direction: DueDirection;
  notes: string | null;
  settledOn: string | null;
  cancelReason: string | null;
  property: PropertyRef | null;
};

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function dueStatusOf(status: string): DueStatus {
  if (status === "paid") return "paid";
  if (status === "cancelled") return "cancelled";
  if (status === "partial") return "partial";
  return "unpaid";
}

export function mapDueRow(row: DueOpenItemRow): DueView {
  const amount = num(row.amount);
  const paid = num(row.paid_amount);
  const prop = Array.isArray(row.property) ? (row.property[0] ?? null) : (row.property ?? null);
  return {
    id: row.id,
    sourceId: row.source_id ?? row.id,
    title: row.title,
    amount,
    paid,
    remaining: Math.max(0, Math.round((amount - paid) * 100) / 100),
    period: String(row.issue_date).slice(0, 10),
    dueDate: row.due_date ? String(row.due_date).slice(0, 10) : null,
    status: dueStatusOf(row.status),
    direction: row.direction === "receivable" ? "receivable" : "payable",
    notes: row.note,
    settledOn: row.settled_on ? String(row.settled_on).slice(0, 10) : null,
    cancelReason: row.cancel_reason ?? null,
    property: prop,
  };
}

/** Açık (ödeme bekleyen) mi: kısmi dahil. */
export function isDueOpen(status: DueStatus): boolean {
  return status === "unpaid" || status === "partial";
}

/** Vadesi geçmiş açık kalem (bugün dahil; eski `due_date <= today` semantiği). */
export function isDueOverdue(due: Pick<DueView, "status" | "dueDate">, today: string): boolean {
  return isDueOpen(due.status) && due.dueDate != null && due.dueDate <= today;
}

/** ?durum= süzgeci → açık kalem durum kümesi. */
export const DUE_FILTER_STATUSES: Record<"paid" | "unpaid" | "overdue" | "iptal", readonly string[]> = {
  paid: ["paid"],
  unpaid: ["open", "partial"],
  overdue: ["open", "partial"],
  iptal: ["cancelled"],
};
