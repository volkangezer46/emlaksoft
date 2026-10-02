/**
 * DataTable saf mantığı — React'ten bağımsız, vitest ile test edilir.
 * (Arama normalizasyonu, sıralama, yoğunluk tercihi, klavye gezinme, seçim.)
 */

export type Density = "comfortable" | "normal" | "compact";

export const DENSITY_ORDER: Density[] = ["comfortable", "normal", "compact"];

/** Satır yüksekliği (px) + Tailwind sınıfları. 44 / 40 / 32. */
export const DENSITY_META: Record<
  Density,
  { label: string; height: number; rowClass: string; cellClass: string }
> = {
  comfortable: { label: "Rahat", height: 44, rowClass: "h-11", cellClass: "py-2.5" },
  normal: { label: "Normal", height: 40, rowClass: "h-10", cellClass: "py-2" },
  compact: { label: "Sıkı", height: 32, rowClass: "h-8", cellClass: "py-1" },
};

export function isDensity(value: unknown): value is Density {
  return typeof value === "string" && (DENSITY_ORDER as string[]).includes(value);
}

/** localStorage ham değerini güvenle okur (erişim engelliyse null). */
export function readStorageRaw(storageKey: string): string | null {
  try {
    return window.localStorage.getItem(storageKey);
  } catch {
    return null;
  }
}

export function writeStorageRaw(storageKey: string, value: string) {
  try {
    window.localStorage.setItem(storageKey, value);
  } catch {
    /* gizli mod / kota — tercih yalnız oturumda kalır */
  }
}

/** Kayıtlı yoğunluk metnini çözer; bozuk/yoksa fallback. */
export function parseStoredDensity(raw: string | null | undefined, fallback: Density): Density {
  return isDensity(raw) ? raw : fallback;
}

/** Kayıtlı gizli sütun listesini (JSON string[]) çözer; bozuksa []. */
export function parseStoredHidden(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Türkçe arama: küçült + diyakritikleri sadeleştir ("sisli" → "Şişli" bulur). */
export function normalizeText(value: string) {
  return value
    .toLocaleLowerCase("tr")
    .replace(/ı/g, "i")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

export type SortDir = "asc" | "desc";

/** aria-sort değeri. Aktif olmayan başlıkta özellik hiç yazılmaz. */
export function ariaSortFor(
  active: boolean,
  dir: SortDir,
): "ascending" | "descending" | undefined {
  if (!active) return undefined;
  return dir === "asc" ? "ascending" : "descending";
}

/** Başlığa tıklama: aynı sütun → yön çevir; yeni sütun → artan. */
export function nextSort(
  current: { key: string | null; dir: SortDir },
  key: string,
): { key: string; dir: SortDir } {
  if (current.key === key) return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  return { key, dir: "asc" };
}

export type KeyNavKey =
  | "ArrowDown"
  | "ArrowUp"
  | "j"
  | "k"
  | "Home"
  | "End"
  | "PageDown"
  | "PageUp";

/**
 * Klavye gezinmede yeni aktif satır indeksi. `current` -1 ise henüz odak yok.
 * Sınırlarda döngü yapmaz (ekran okuyucu için öngörülebilir).
 */
export function nextRowIndex(
  current: number,
  key: string,
  count: number,
  pageJump = 10,
): number | null {
  if (count <= 0) return null;
  const last = count - 1;
  switch (key) {
    case "ArrowDown":
    case "j":
      return current < 0 ? 0 : Math.min(last, current + 1);
    case "ArrowUp":
    case "k":
      return current < 0 ? 0 : Math.max(0, current - 1);
    case "Home":
      return 0;
    case "End":
      return last;
    case "PageDown":
      return current < 0 ? Math.min(last, pageJump - 1) : Math.min(last, current + pageJump);
    case "PageUp":
      return current < 0 ? 0 : Math.max(0, current - pageJump);
    default:
      return null;
  }
}

/** Seçim kümesini görünür id listesine göre budar (filtre/sayfa değişince). */
export function pruneSelection(selected: ReadonlySet<string>, validIds: ReadonlySet<string>) {
  const next = new Set<string>();
  for (const id of selected) if (validIds.has(id)) next.add(id);
  return next.size === selected.size ? (selected as Set<string>) : next;
}

export type CheckState = "none" | "some" | "all";

export function checkState(selectedCount: number, total: number): CheckState {
  if (selectedCount <= 0 || total <= 0) return "none";
  return selectedCount >= total ? "all" : "some";
}

/** Toplu eylem çubuğu metni. */
export function selectionLabel(count: number) {
  return `${count} kayıt seçili`;
}

/**
 * Mobil kart listesi için sütun ayrımı.
 * `priority: "primary"` (varsayılan: ilk sütun) başlığı oluşturur,
 * "secondary" olanlar etiketli satır olarak kartta görünür,
 * "hidden" mobilde hiç gösterilmez.
 */
export type ColumnPriority = "primary" | "secondary" | "hidden";

export function splitByPriority<T extends { priority?: ColumnPriority }>(columns: T[]) {
  const hasPrimary = columns.some((c) => c.priority === "primary");
  const primary: T[] = [];
  const secondary: T[] = [];
  columns.forEach((col, index) => {
    const p = col.priority ?? (!hasPrimary && index === 0 ? "primary" : "secondary");
    if (p === "primary") primary.push(col);
    else if (p === "secondary") secondary.push(col);
  });
  return { primary, secondary };
}
