export type MoneyParseResult =
  | { ok: true; value: number | null }
  | { ok: false; value: null };

/**
 * Türkçe para alanlarını fail-closed ayrıştırır.
 *
 * Eski `replace(/[^\d.,]/g, "")` deseni `-500` değerini sessizce `500`
 * yapıyordu. Burada bilinmeyen karakter, işaret, bozuk gruplama ve ikiden fazla
 * kuruş hanesi reddedilir; boş opsiyonel alan ise `null` kalır.
 */
export function parseMoneyInput(
  input: FormDataEntryValue | string | number | null | undefined,
  options: { allowZero?: boolean; max?: number } = {},
): MoneyParseResult {
  if (input == null) return { ok: true, value: null };
  if (typeof input === "number") {
    return valid(input, options) ? { ok: true, value: input } : { ok: false, value: null };
  }

  let raw = String(input).trim();
  if (!raw) return { ok: true, value: null };
  if (/[+-]/.test(raw)) return { ok: false, value: null };

  raw = raw
    .replace(/\b(?:TRY|TL)\b/giu, "")
    .replace(/₺/g, "")
    .replace(/\s/g, "");
  if (!raw || !/^\d[\d.,]*$/.test(raw)) return { ok: false, value: null };

  const commaCount = (raw.match(/,/g) ?? []).length;
  const dotCount = (raw.match(/\./g) ?? []).length;
  let normalized: string;

  if (commaCount > 0 && dotCount > 0) {
    const decimalSeparator = raw.lastIndexOf(",") > raw.lastIndexOf(".") ? "," : ".";
    const groupingSeparator = decimalSeparator === "," ? "." : ",";
    if ((raw.match(new RegExp(`\\${decimalSeparator}`, "g")) ?? []).length !== 1) {
      return { ok: false, value: null };
    }
    const [whole, fraction = ""] = raw.split(decimalSeparator);
    if (!validGroupedWhole(whole, groupingSeparator) || !/^\d{1,2}$/.test(fraction)) {
      return { ok: false, value: null };
    }
    normalized = `${whole.split(groupingSeparator).join("")}.${fraction}`;
  } else if (commaCount > 0) {
    if (commaCount !== 1) return { ok: false, value: null };
    const [whole, fraction = ""] = raw.split(",");
    if (!/^\d+$/.test(whole) || !/^\d{1,2}$/.test(fraction)) {
      return { ok: false, value: null };
    }
    normalized = `${whole}.${fraction}`;
  } else if (dotCount > 0) {
    const groups = raw.split(".");
    if (dotCount > 1 || groups[1]?.length === 3) {
      if (!validGroupedWhole(raw, ".")) return { ok: false, value: null };
      normalized = groups.join("");
    } else {
      const [whole, fraction = ""] = groups;
      if (!/^\d+$/.test(whole) || !/^\d{1,2}$/.test(fraction)) {
        return { ok: false, value: null };
      }
      normalized = `${whole}.${fraction}`;
    }
  } else {
    normalized = raw;
  }

  const value = Number(normalized);
  return valid(value, options) ? { ok: true, value } : { ok: false, value: null };
}

function validGroupedWhole(value: string, separator: "." | ","): boolean {
  const groups = value.split(separator);
  return /^\d{1,3}$/.test(groups[0] ?? "")
    && groups.length > 1
    && groups.slice(1).every((group) => /^\d{3}$/.test(group));
}

function valid(value: number, options: { allowZero?: boolean; max?: number }): boolean {
  if (!Number.isFinite(value)) return false;
  if (options.allowZero ? value < 0 : value <= 0) return false;
  if (options.max != null && value > options.max) return false;
  return Math.abs(Math.round(value * 100) - value * 100) < 1e-8;
}
