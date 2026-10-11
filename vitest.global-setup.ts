import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestProject } from "vitest/node";

/**
 * src/ metin dosyalarını koşu başına BİR kez okuyup tek JSON anlık görüntüsüne yazar.
 * Sözleşme testleri (terminology, perf-budget, role-labels, deal-stage-labels, ux-accessibility ...)
 * `src/lib/test-support/src-tree.ts` üzerinden bunu okur: binlerce küçük dosyayı her worker'da ayrı
 * açmak (Windows'ta dosya başına açma maliyeti) yerine tek dosya okunur. Anlık görüntü yoksa yardımcı
 * doğrudan diske düşer (testler tek başına da çalışır).
 */
const TEXT_EXT = /\.(?:ts|tsx|css|json|md|sql|mjs|js|svg|txt)$/;

export default function setup(project: TestProject) {
  const root = process.cwd().replace(/\\/g, "/");
  const files: Record<string, string> = {};
  const rec = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = `${dir}/${e.name}`;
      if (e.isDirectory()) rec(full);
      else if (TEXT_EXT.test(e.name)) files[full] = readFileSync(full, "utf8");
    }
  };
  rec(`${root}/src`);
  const dir = mkdtempSync(join(tmpdir(), "emlaksoft-src-"));
  const snapshot = join(dir, "src-snapshot.json");
  writeFileSync(snapshot, JSON.stringify({ root, files }));
  project.provide("srcSnapshotPath", snapshot);
  return () => rmSync(dir, { recursive: true, force: true });
}

declare module "vitest" {
  export interface ProvidedContext {
    srcSnapshotPath: string;
  }
}
