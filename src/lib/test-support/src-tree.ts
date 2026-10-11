import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { inject } from "vitest";

/**
 * Sözleşme testleri için paylaşılan, tek seferlik src/ ağacı önbelleği.
 * Dizin taraması ve dosya içeriği süreç başına BİR kez okunur (globalThis üstünde: aynı worker'daki
 * tüm test dosyaları paylaşır). Salt-okunur; testlerin kapsamını/katılığını değiştirmez.
 */
type Cache = {
  dirs: Map<string, string[]>;
  text: Map<string, string>;
  stat: Map<string, "file" | "dir" | null>;
  derived: Map<string, unknown>;
};
const KEY = Symbol.for("emlaksoft.test-support.src-tree");
const g = globalThis as unknown as Record<symbol, Cache | undefined>;
const cache: Cache = (g[KEY] ??= { dirs: new Map(), text: new Map(), stat: new Map(), derived: new Map() });

/** Bir dizindeki TÜM dosyalar (özyinelemeli, mutlak yol, ayırıcı "/"). */
export function walkAll(dir: string): string[] {
  const root = dir.replace(/\\/g, "/");
  const hit = cache.dirs.get(root);
  if (hit) return hit;
  const out: string[] = [];
  const rec = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = `${d}/${e.name}`;
      if (e.isDirectory()) rec(full);
      else out.push(full);
    }
  };
  rec(root);
  cache.dirs.set(root, out);
  return out;
}

/** Üretim kaynağı: .ts/.tsx, .test.* dışı. */
export function walkSource(dir: string): string[] {
  return walkAll(dir).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f));
}

/** vitest.global-setup.ts anlık görüntüsü (koşu başına tek okuma); yoksa null ve diske düşülür. */
function snapshot(): Record<string, string> | null {
  return memo("src-tree.snapshot", () => {
    try {
      const path = inject("srcSnapshotPath");
      return path ? (JSON.parse(readFileSync(path, "utf8")) as { files: Record<string, string> }).files : null;
    } catch {
      return null;
    }
  });
}

export function readCached(file: string): string {
  const k = resolve(file).replace(/\\/g, "/");
  let t = cache.text.get(k);
  if (t === undefined) {
    t = snapshot()?.[k] ?? readFileSync(k, "utf8");
    cache.text.set(k, t);
  }
  return t;
}

export function statKind(p: string): "file" | "dir" | null {
  const k = p.replace(/\\/g, "/");
  if (cache.stat.has(k)) return cache.stat.get(k)!;
  const v = existsSync(k) ? (statSync(k).isFile() ? "file" : "dir") : null;
  cache.stat.set(k, v);
  return v;
}

/** Türetilmiş değeri (ör. dosya başına ayrıştırılmış metin) bir kez hesaplar. */
export function memo<T>(key: string, make: () => T): T {
  if (!cache.derived.has(key)) cache.derived.set(key, make());
  return cache.derived.get(key) as T;
}
