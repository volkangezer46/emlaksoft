/** "Kaydı çoğalt" ortak yardımcıları (SAF). */

export const COPY_SUFFIX = " (kopya)";

/** Başlığa "(kopya)" ekler; zaten kopyaysa tekrar eklemez; en çok `max` karakter. */
export function copyTitle(title: string, max: number): string {
  const base = title.trim() || "Kayıt";
  if (base.endsWith(COPY_SUFFIX)) return base.slice(0, max);
  const room = Math.max(1, max - COPY_SUFFIX.length);
  return `${base.slice(0, room)}${COPY_SUFFIX}`;
}
