import { parseMoneyInput } from "@/lib/money-input";
import { isDueDirection, type DueDirection } from "@/lib/finance/dues/dues";

const DATE_ONLY_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function validDateOnly(value: string): boolean {
  if (!DATE_ONLY_RE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

export type DueInput = {
  title: string;
  amount: number;
  period: string;
  dueDate: string | null;
  propertyId: string | null;
  notes: string | null;
  /** Ofis öder (payable, varsayılan) ya da ofis tahsil eder (receivable). */
  direction: DueDirection;
};

export type DueInputResult =
  | { ok: true; value: DueInput }
  | { ok: false; error: string };

export function parseDueInput(fd: FormData, today = new Date()): DueInputResult {
  const title = String(fd.get("title") ?? "").trim();
  const rawPeriod = String(fd.get("period") ?? "").trim();
  const period = rawPeriod || today.toISOString().slice(0, 10);
  const rawDueDate = String(fd.get("due_date") ?? "").trim();
  const propertyId = String(fd.get("property_id") ?? "").trim() || null;
  const notes = String(fd.get("notes") ?? "").trim() || null;
  const rawDirection = String(fd.get("direction") ?? "").trim() || "payable";
  const amount = parseMoneyInput(fd.get("amount"), { max: 9_999_999_999.99 });

  if (!title) return { ok: false, error: "Başlık zorunludur." };
  if (title.length > 160) return { ok: false, error: "Başlık en fazla 160 karakter olabilir." };
  if (!amount.ok || amount.value == null) return { ok: false, error: "Geçerli bir tutar girin." };
  if (!validDateOnly(period)) return { ok: false, error: "İlgili ay tarihi geçersiz." };
  if (rawDueDate && !validDateOnly(rawDueDate)) {
    return { ok: false, error: "Son ödeme tarihi geçersiz." };
  }
  if (rawDueDate && rawDueDate < period) return { ok: false, error: "Son ödeme tarihi ilgili aydan önce olamaz." };
  if (notes && notes.length > 1_000) {
    return { ok: false, error: "Not en fazla 1.000 karakter olabilir." };
  }
  if (!isDueDirection(rawDirection)) return { ok: false, error: "Aidatın yönünü seçin." };

  return {
    ok: true,
    value: {
      title,
      amount: amount.value,
      period,
      dueDate: rawDueDate || null,
      propertyId,
      notes,
      direction: rawDirection,
    },
  };
}
