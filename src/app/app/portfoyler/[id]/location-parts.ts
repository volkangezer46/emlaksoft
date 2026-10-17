/**
 * Portföy künyesi konum satırı (F10): `address_line` çoğu kayıtta ilçe ve ili zaten içeriyor ("Kadıköy, İstanbul");
 * eski satır üçünü körlemesine birleştirip "Kadıköy, İstanbul · Kadıköy · İstanbul" yazıyordu. İlçe / il adı adres
 * satırında tam kelime olarak geçiyorsa tekrar eklenmez; adres satırının kendi tekrar eden parçaları da tekilleşir.
 * Saf (sunucu + test).
 */
const norm = (s: string) => s.toLocaleLowerCase("tr-TR").replace(/\s+/g, " ").trim();
const SEP = /\s*[,·/]\s*/;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Adres metninde `name` tam kelime olarak geçiyor mu (Türkçe küçük harf, harf sınırı Unicode). */
function containsWord(haystack: string, name: string): boolean {
  const n = norm(name);
  if (!n) return true;
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(n)}($|[^\\p{L}\\p{N}])`, "u").test(norm(haystack));
}

export function propertyLocationParts(addressLine: string | null | undefined, district: string | null | undefined, province: string | null | undefined): string[] {
  const parts: string[] = [];
  const seen = new Set<string>();
  const address = (addressLine ?? "").trim();
  if (address) {
    // Adres satırı içindeki aynı parçanın tekrarı ("Kadıköy, Kadıköy, İstanbul") tek kez yazılır.
    const segs = address.split(SEP).map((s) => s.trim()).filter(Boolean);
    const unique = segs.filter((s) => {
      const k = norm(s);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    parts.push(unique.length === segs.length ? address : unique.join(", "));
  }
  for (const name of [district, province]) {
    const v = (name ?? "").trim();
    if (!v || seen.has(norm(v))) continue;
    if (address && containsWord(address, v)) continue;
    seen.add(norm(v));
    parts.push(v);
  }
  return parts;
}
