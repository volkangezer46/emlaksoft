import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * "use server" dosyaları YALNIZ async fonksiyon dışa aktarabilir (tip dışa aktarımları serbest). Aksi halde Next
 * modülü çalışma anında yükleyemez ve o eylemi kullanan TÜM sayfa çöker ("A 'use server' file can only export
 * async functions, found object") — 2026-10-13: anlaşma detay sayfası `export const DEAL_STAGES` yüzünden açılmadı.
 * Sabitleri sıradan bir modüle (ör. src/lib/workflow-state.ts) koyun.
 */
const ROOT = join(process.cwd(), "src");

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" ? [] : files(p);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}

describe('"use server" dışa aktarım sözleşmesi', () => {
  it("yalnız async fonksiyon (ve tip) dışa aktarılır", () => {
    const bad: string[] = [];
    for (const f of files(ROOT)) {
      const src = readFileSync(f, "utf8");
      if (!/^\s*["']use server["'];?/.test(src)) continue;
      src.split("\n").forEach((line, i) => {
        if (!/^export\s/.test(line)) return;
        if (/^export\s+(async\s+function|type\s|interface\s|declare\s)/.test(line)) return;
        if (/^export\s+\{[^}]*\}\s+from\s/.test(line) && /^export\s+\{\s*type\s/.test(line)) return;
        bad.push(`${relative(process.cwd(), f)}:${i + 1}: ${line.trim().slice(0, 100)}`);
      });
    }
    expect(bad).toEqual([]);
  });
});
