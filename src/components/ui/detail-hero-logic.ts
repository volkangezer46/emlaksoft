/**
 * DetailHero'nun SAF yerleşim kuralları (istemci/sunucu güvenli, React'e bağlı değil; test: detail-hero-logic.test.ts).
 *
 * - Eylem satırı en çok `DETAIL_HERO_MAX_ACTIONS` görünür eylem taşır; kalanlar "Daha fazla" menüsünün BAŞINA geçer
 *   (sıra korunur). Böylece 1366 px'te satır asla ikinci satıra kırılmaz.
 * - Boş yuvalar (koşullu `null`/`false`/`undefined`/"") sayılmaz: yetkisi olmayan kullanıcıda boşluk kalmaz,
 *   sıradaki eylem yukarı kayar.
 * - Başlık en çok 2 satır (ya da 1 satır + "…"); tam metin `title` ipucunda kalır.
 */

export const DETAIL_HERO_MAX_ACTIONS = 4;

/** Koşullu JSX yuvası: `cond ? <X/> : null` kalıbının boş değerleri. */
export function isPresent<T>(item: T | null | undefined | false | ""): item is T {
  return item !== null && item !== undefined && item !== false && item !== "";
}

/**
 * Görünür eylemleri ve taşanları ayırır. `max` 0'dan küçükse 0 sayılır; tüm eylemler menüye gider.
 * `overflow` = taşan görünür adaylar + `more` (önce taşanlar, sonra seyrek eylemler).
 */
export function splitHeroActions<T>(
  actions: ReadonlyArray<T | null | undefined | false | "">,
  more: ReadonlyArray<T | null | undefined | false | ""> = [],
  max: number = DETAIL_HERO_MAX_ACTIONS,
): { visible: T[]; overflow: T[] } {
  const cap = Math.max(0, Math.floor(max));
  const present = actions.filter(isPresent);
  const extra = more.filter(isPresent);
  return { visible: present.slice(0, cap), overflow: [...present.slice(cap), ...extra] };
}

/** Başlık sığma sınıfı: 1 satır → kırp + "…", 2 satır → iki satırda kes (uzun kelime de kırılır). */
export function heroTitleClass(lines: 1 | 2): string {
  return lines === 1 ? "truncate" : "line-clamp-2 break-words [overflow-wrap:anywhere]";
}

/** Başlığın tam metni (`title` ipucu): boşluklar sadeleşir; boşsa yedek metin. */
export function heroTitleText(title: string | null | undefined, fallback: string): string {
  const t = (title ?? "").replace(/\s+/g, " ").trim();
  return t || fallback;
}

/** Kahraman çipi tonları (koyu cam üstü okunur renkler). */
export type HeroChipTone = "neutral" | "good" | "warn" | "bad" | "info" | "gold";

const CHIP_BASE =
  "inline-flex max-w-full items-center gap-1 truncate rounded-full border px-2.5 py-1 text-xs font-bold leading-none";
const CHIP_TONE: Record<HeroChipTone, string> = {
  neutral: "border-white/15 bg-white/10 text-white/85",
  good: "border-mint-400/30 bg-mint-500/20 text-mint-300",
  warn: "border-amber-300/30 bg-amber-400/20 text-amber-200",
  bad: "border-danger-400/35 bg-danger-500/25 text-danger-300",
  info: "border-cyan-300/25 bg-cyan-400/15 text-cyan-200",
  gold: "border-[#f6d58e]/30 bg-[#e0aa4f]/20 text-[#f6d58e]",
};

/** Koyu cam çip sınıfı (DetailHero çip yuvası ve kapak fotoğrafı üstü). */
export function heroChipClass(tone: HeroChipTone = "neutral"): string {
  return `${CHIP_BASE} ${CHIP_TONE[tone]}`;
}
