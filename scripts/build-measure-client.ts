/**
 * Ölçüm istemcisi paketi (prebuild, statik ana sayfa paketinden SONRA — o adım public/statik'i sıfırlar):
 *   src/lib/measure/client/main.ts (+ web-vitals@4, aynı dosyada) → public/statik/m-<içerik-özeti>.js (immutable)
 *   public/statik/measure.json → { "file": "/statik/m-<özet>.js", "bytes": <ham>, "gzip": <gzip> }
 * <PublicMeasure /> dosya adını measure.json'dan okur. Gzip bütçesi 3 KB: aşılırsa derleme DURUR.
 * Kullanım: tsx scripts/build-measure-client.ts
 */
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";

const ROOT = resolve(process.cwd());
const OUT = join(ROOT, "public", "statik");
export const MEASURE_GZIP_BUDGET = 3 * 1024;

/** Paketi bellekte üretir (test de bunu kullanır). */
export async function bundleMeasureClient(): Promise<{ code: string; hash: string; bytes: number; gzip: number }> {
  const res = await build({
    entryPoints: [join(ROOT, "src", "lib", "measure", "client", "main.ts")],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: ["chrome111", "safari16.4", "firefox115", "edge111"],
    minify: true,
    legalComments: "none",
    tsconfig: join(ROOT, "tsconfig.json"),
    write: false,
    logLevel: "warning",
  });
  const code = res.outputFiles[0].text;
  const buf = Buffer.from(code);
  return {
    code,
    hash: createHash("sha256").update(buf).digest("hex").slice(0, 10),
    bytes: buf.length,
    gzip: gzipSync(buf, { level: 9 }).length,
  };
}

async function main() {
  const b = await bundleMeasureClient();
  if (b.gzip > MEASURE_GZIP_BUDGET) throw new Error(`ölçüm istemcisi bütçeyi aştı: ${b.gzip} B gzip > ${MEASURE_GZIP_BUDGET} B`);
  mkdirSync(OUT, { recursive: true });
  for (const f of readdirSync(OUT)) if (/^m-[0-9a-f]+\.js$/.test(f)) rmSync(join(OUT, f));
  const file = `m-${b.hash}.js`;
  writeFileSync(join(OUT, file), b.code);
  writeFileSync(join(OUT, "measure.json"), JSON.stringify({ file: `/statik/${file}`, bytes: b.bytes, gzip: b.gzip }));
  console.log(`ölçüm istemcisi: /statik/${file} ${(b.bytes / 1024).toFixed(1)} KB, gzip ${b.gzip} B`);
}

// Doğrudan çalıştırıldığında (tsx) yazar; test içe aktarımında yan etkisiz.
if (/build-measure-client\.ts$/.test(process.argv[1] ?? "")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
