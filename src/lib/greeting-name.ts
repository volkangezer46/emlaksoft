/**
 * Selamlamada kullanılacak ad: "Volkan Gezer" → "Volkan"; ikinci sözcük küçük harfle başlıyorsa ad bir unvandır
 * ("Süper admin", "Müşteri temsilcisi") ve bütün olarak kullanılır ("İyi akşamlar, Süper" yazmaz).
 */
export function greetingNameOf(full: string | null | undefined): string | undefined {
  const parts = (full ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return undefined;
  const second = parts[1];
  if (parts.length === 2 && second && second[0] === second[0]!.toLocaleLowerCase("tr-TR") && second[0] !== second[0]!.toLocaleUpperCase("tr-TR")) return parts.join(" ");
  return parts[0];
}
