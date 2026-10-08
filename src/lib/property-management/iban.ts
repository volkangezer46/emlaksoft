/**
 * IBAN (TR) yardımcıları. IBAN KİŞİSEL VERİdir: arayüzde maskeli gösterilir, AI bağlamına GİTMEZ
 * (`src/lib/ai/redact.ts` metin içindeki IBAN'ı ayrıca maskeler). Saklama biçimi boşluksuz büyük harf `TR` + 24 rakam.
 */

export function normalizeIban(raw: string): string {
  return raw.replace(/[\s-]+/g, "").toUpperCase();
}

/** ISO 13616 mod-97 sağlaması + TR biçimi (26 karakter). */
export function isValidTrIban(raw: string): boolean {
  const iban = normalizeIban(raw);
  if (!/^TR[0-9]{24}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const code = ch >= "A" && ch <= "Z" ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of code) remainder = (remainder * 10 + Number(d)) % 97;
  }
  return remainder === 1;
}

/** `TR12 **** **** **** **** **34` — ilk 4 ve son 2 karakter görünür. */
export function maskIban(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const iban = normalizeIban(raw);
  if (iban.length < 8) return "****";
  return `${iban.slice(0, 4)} **** **** **** **** **${iban.slice(-2)}`;
}

/** Gösterim için 4'lü gruplar (açık gösterim yalnız denetimli "göster" eyleminden sonra). */
export function formatIban(raw: string): string {
  return normalizeIban(raw).replace(/(.{4})/g, "$1 ").trim();
}
