import { isValidTcKimlik } from "@/lib/ai/redact";

/**
 * Kimlik alanı saf yardımcıları (istemci + sunucu güvenli; ağ/DB/node:crypto yok).
 * Açık değer yalnız doğrulama/son 4 hane için bellekte kullanılır; hiçbir yere yazılmaz.
 */

export function normalizeTc(raw: string | null | undefined): string {
  return (raw ?? "").replace(/[\s.-]/g, "");
}

export function tcError(raw: string | null | undefined): string | null {
  const v = normalizeTc(raw);
  if (!v) return null;
  return isValidTcKimlik(v) ? null : "TC kimlik numarası geçersiz (11 hane, sağlama hanesi tutmuyor).";
}

export function normalizeIban(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\s+/g, "").toUpperCase();
}

/** ISO 13616 mod 97; TR IBAN'ı ayrıca 26 hane olmalıdır. */
export function isValidIban(raw: string | null | undefined): boolean {
  const v = normalizeIban(raw);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(v)) return false;
  if (v.startsWith("TR") && v.length !== 26) return false;
  const rearranged = v.slice(4) + v.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const digits = ch >= "A" && ch <= "Z" ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of digits) remainder = (remainder * 10 + Number(d)) % 97;
  }
  return remainder === 1;
}

export function ibanError(raw: string | null | undefined): string | null {
  const v = normalizeIban(raw);
  if (!v) return null;
  return isValidIban(v) ? null : "IBAN geçersiz (TR ile başlayan 26 haneli, sağlaması tutan IBAN girin).";
}

export function last4(value: string): string {
  return value.slice(-4);
}

/** Liste/ekran gösterimi: `•••••••1234` (TC). Son 4 yoksa null. */
export function maskTc(last4Value: string | null | undefined): string | null {
  return last4Value && /^\d{4}$/.test(last4Value) ? `•••••••${last4Value}` : null;
}

/** `•••• •••• •••• 1234` (IBAN). Son 4 yoksa null. */
export function maskIban(last4Value: string | null | undefined): string | null {
  return last4Value && /^[0-9A-Za-z]{4}$/.test(last4Value) ? `•••• •••• •••• ${last4Value}` : null;
}

/** Denetim/log için güvenli özet: yalnız hangi alanların yazıldığı, değer asla. */
export function changedFieldNames(fields: Record<string, unknown>): string[] {
  return Object.entries(fields)
    .filter(([, v]) => v !== undefined)
    .map(([k]) => k)
    .sort();
}
