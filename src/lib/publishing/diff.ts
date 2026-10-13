/**
 * Alan bazlı JSON farkı (SAF): yayın masasının "fark çekmecesi" ve "Bu sürüme dön" onayı.
 * Diziler: tüm öğeler nesne ve `id` (string/number) taşıyorsa id ile, aksi halde indeksle eşlenir.
 * Yol biçimi: "hero.title", "groups[g1].items[2].label" (id ile eşlenen öğe köşeli parantezde id'yi taşır).
 */

export type DiffKind = "changed" | "added" | "removed";
export type DiffRow = { path: string; kind: DiffKind; before: unknown; after: unknown };
export type DiffResult = { rows: DiffRow[]; total: number; more: number };

export const MAX_DIFF_ROWS = 200;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === "object" && !Array.isArray(v);
const idOf = (v: unknown): string | number | null => (isObj(v) && (typeof v.id === "string" || typeof v.id === "number") ? v.id : null);

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

const join = (base: string, key: string) => (base ? `${base}.${key}` : key);

function walk(a: unknown, b: unknown, path: string, out: DiffRow[]): void {
  if (same(a, b)) return;
  if (Array.isArray(a) && Array.isArray(b)) {
    const byId = [...a, ...b].length > 0 && [...a, ...b].every((x) => idOf(x) !== null);
    if (byId) {
      const left = new Map(a.map((x) => [idOf(x)!, x]));
      const right = new Map(b.map((x) => [idOf(x)!, x]));
      for (const [id, x] of left) {
        const p = `${path}[${id}]`;
        if (!right.has(id)) out.push({ path: p, kind: "removed", before: x, after: undefined });
        else walk(x, right.get(id), p, out);
      }
      for (const [id, y] of right) if (!left.has(id)) out.push({ path: `${path}[${id}]`, kind: "added", before: undefined, after: y });
      // Yalnız sıra değiştiyse tek satır.
      const order = (arr: unknown[]) => arr.map((x) => String(idOf(x))).join("|");
      const common = (arr: unknown[], other: Map<string | number, unknown>) => arr.filter((x) => other.has(idOf(x)!));
      if (order(common(a, right)) !== order(common(b, left))) {
        out.push({ path: `${path} (sıra)`, kind: "changed", before: common(a, right).map(idOf), after: common(b, left).map(idOf) });
      }
      return;
    }
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i += 1) {
      const p = `${path}[${i}]`;
      if (i >= a.length) out.push({ path: p, kind: "added", before: undefined, after: b[i] });
      else if (i >= b.length) out.push({ path: p, kind: "removed", before: a[i], after: undefined });
      else walk(a[i], b[i], p, out);
    }
    return;
  }
  if (isObj(a) && isObj(b)) {
    for (const k of Object.keys(a)) {
      if (!(k in b) || b[k] === undefined) {
        if (a[k] !== undefined) out.push({ path: join(path, k), kind: "removed", before: a[k], after: undefined });
      } else walk(a[k], b[k], join(path, k), out);
    }
    for (const k of Object.keys(b)) {
      if ((!(k in a) || a[k] === undefined) && b[k] !== undefined) out.push({ path: join(path, k), kind: "added", before: undefined, after: b[k] });
    }
    return;
  }
  if (a === undefined || a === null) {
    if (b !== undefined && b !== null) out.push({ path: path || "(tümü)", kind: "added", before: a, after: b });
    return;
  }
  if (b === undefined || b === null) {
    out.push({ path: path || "(tümü)", kind: "removed", before: a, after: b });
    return;
  }
  out.push({ path: path || "(tümü)", kind: "changed", before: a, after: b });
}

/** a (önce) -> b (sonra) farkı; en çok `limit` satır, kalan sayı `more`. */
export function diffJson(a: unknown, b: unknown, limit: number = MAX_DIFF_ROWS): DiffResult {
  const out: DiffRow[] = [];
  walk(a, b, "", out);
  return { rows: out.slice(0, limit), total: out.length, more: Math.max(0, out.length - limit) };
}

/** "ve N değişiklik daha" özeti (fazlası yoksa boş). */
export function moreLabel(more: number): string {
  return more > 0 ? `ve ${more.toLocaleString("tr-TR")} değişiklik daha` : "";
}

/** Değeri çekmecede göstermek için kısa metne çevirir (uzun değer kırpılır). */
export function previewValue(v: unknown, max = 240): string {
  if (v === undefined) return "—";
  if (v === null) return "(boş)";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
