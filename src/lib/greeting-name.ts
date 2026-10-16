import { ROLE_LABELS } from "@/lib/role-labels";

/**
 * Ana ekran SELAMLAMASI (sahip kararı 2026-10-16): günün saatine göre selam + kullanıcının AD SOYADI
 * ("Günaydın, Hacer Gezertaşar"). Saat OFİS saat diliminde (Türkiye, `clock.ts` `trParts().hour`) ve sunucuda
 * hesaplanır (hidrasyon farkı yok). "Hanım/Bey" EKLENMEZ: profilde açık hitap alanı yoktur, cinsiyet addan tahmin edilmez.
 *
 *  05:00–11:59 Günaydın · 12:00–17:59 İyi günler · 18:00–21:59 İyi akşamlar · 22:00–04:59 İyi geceler
 */
export function timeGreeting(hour: number): string {
  const h = ((Math.floor(hour) % 24) + 24) % 24;
  if (h >= 5 && h < 12) return "Günaydın";
  if (h >= 12 && h < 18) return "İyi günler";
  if (h >= 18 && h < 22) return "İyi akşamlar";
  return "İyi geceler";
}

const TITLE_LIKE = new Set([...Object.values(ROLE_LABELS), "Süper admin", "Yönetici", "Admin", "Kullanıcı"].map((t) => t.toLocaleLowerCase("tr-TR")));

/** Ad unvana benziyor mu (demo/sistem hesapları: "Ofis sahibi", "Süper admin")? Öyleyse aynen gösterilir. */
export function isTitleLikeName(name: string): boolean {
  return TITLE_LIKE.has(name.trim().replace(/\s+/g, " ").toLocaleLowerCase("tr-TR"));
}

const cap = (w: string) => (w ? w.charAt(0).toLocaleUpperCase("tr-TR") + w.slice(1) : w);

/**
 * Selamda gösterilecek ad: (1) profil `full_name` (boşlukları sadeleştirilmiş, olduğu gibi; unvan benzeri adlar da
 * aynen), (2) yoksa e-posta yerel kısmı ("hacer.gezertasar@…" → "Hacer Gezertasar"), (3) yoksa rol unvanı; hiçbiri
 * yoksa null (yalnız selam).
 */
export function greetingName(input: { fullName?: string | null; email?: string | null; roleTitle?: string | null }): string | null {
  const full = input.fullName?.trim().replace(/\s+/g, " ");
  if (full && !full.includes("@")) return full;
  const local = input.email?.split("@")[0]?.trim();
  if (local) {
    const words = local.split(/[._\-+]+/).filter((w) => /[\p{L}]/u.test(w)).map((w) => cap(w.replace(/\d+/g, "")));
    const text = words.filter(Boolean).join(" ").trim();
    if (text) return text;
  }
  const title = input.roleTitle?.trim();
  return title || null;
}

/** "Günaydın, Hacer Gezertaşar" (ad yoksa yalnız selam). */
export function greetingLine(hour: number, name: string | null): string {
  const g = timeGreeting(hour);
  return name ? `${g}, ${name}` : g;
}
