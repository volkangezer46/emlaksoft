/**
 * Statik ana sayfa paketleri (prebuild): src/static-home/** → public/statik/
 *  - runtime.js   : düz JS (IIFE), rota işleyicisi satır içi gömer.
 *  - adacıklar    : Preact (react/react-dom → preact/compat) ESM, ortak parça bölünmüş, içerik özetli adlar
 *                   (/statik/*.js, 1 yıl immutable önbellek — next.config.ts).
 *  - manifest.json: { runtime, islands: {pricing, seat, tour, preview}, classTokens } — classTokens, adacıkların
 *                   çizdiği sınıfları CSS ayıklamasında korumak için (src/lib/static-home/transform.ts).
 * Kullanım: tsx scripts/build-static-home.ts
 */
import { build } from "esbuild";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { STATIC_ISLAND_ENTRIES } from "../src/lib/static-home/registry";

const ROOT = resolve(__dirname, "..");
const SRC = join(ROOT, "src", "static-home");
const OUT = join(ROOT, "public", "statik");

const alias = {
  react: "preact/compat",
  "react-dom": "preact/compat",
  "react-dom/client": "preact/compat/client",
  "react/jsx-runtime": "preact/jsx-runtime",
  "react/jsx-dev-runtime": "preact/jsx-runtime",
  "next/link": join(SRC, "shims", "next-link.tsx"),
  "next/dynamic": join(SRC, "shims", "next-dynamic.tsx"),
};

async function main() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const common = {
    bundle: true,
    platform: "browser" as const,
    target: ["chrome111", "safari16.4", "firefox115", "edge111"],
    minify: true,
    legalComments: "none" as const,
    tsconfig: join(ROOT, "tsconfig.json"),
    jsx: "automatic" as const,
    jsxImportSource: "preact",
    alias,
    // Next gibi: NEXT_PUBLIC_* derleme anında gömülür; kalan process.env okumaları tanımsız döner (tarayıcıda process yok).
    define: {
      ...Object.fromEntries(
        Object.entries(process.env)
          .filter(([k]) => k.startsWith("NEXT_PUBLIC_"))
          .map(([k, v]) => [`process.env.${k}`, JSON.stringify(v ?? "")]),
      ),
      "process.env.NODE_ENV": '"production"',
      "process.env": "{}",
    },
    logLevel: "warning" as const,
  };

  const runtime = await build({ ...common, entryPoints: [join(SRC, "runtime.ts")], format: "iife", write: false });
  writeFileSync(join(OUT, "runtime.js"), runtime.outputFiles[0].text);

  // Adacık girişleri tek kaynaktan (statik sayfa kayıt defteri): anahtar → src/static-home/islands/<dosya>.tsx.
  const entries = STATIC_ISLAND_ENTRIES;
  const res = await build({
    ...common,
    entryPoints: Object.fromEntries(Object.entries(entries).map(([k, f]) => [k, join(SRC, "islands", `${f}.tsx`)])),
    format: "esm",
    splitting: true,
    outdir: OUT,
    entryNames: "[name].[hash]",
    chunkNames: "ortak.[hash]",
    metafile: true,
  });

  const islands: Record<string, string> = {};
  const tokens = new Set<string>();
  for (const [file, meta] of Object.entries(res.metafile.outputs)) {
    const rel = file.replace(/^.*public\//, "/");
    if (meta.entryPoint) {
      const key = Object.entries(entries).find(([, f]) => meta.entryPoint!.endsWith(`islands/${f}.tsx`))?.[0];
      if (key) islands[key] = rel;
    }
    // Adacık kodundaki olası sınıf belirteçleri (CSS ayıklamasında korunur). Bilerek kapsayıcı: kod metni sınıf adında
    // bulunamayacak karakterlerden bölünür; fazladan belirteç yalnız birkaç kural fazla tutar, eksik belirteç görünümü bozar.
    const text = readFileSync(join(ROOT, file), "utf8");
    for (const t of text.split(/[\s"'`{}$\\;]+/)) {
      if (t.length >= 2 && t.length <= 200 && /^[a-z!@\-[]/i.test(t) && /[a-z]/.test(t)) tokens.add(t);
    }
  }
  for (const k of Object.keys(entries)) if (!islands[k]) throw new Error(`ada çıktısı bulunamadı: ${k}`);
  writeFileSync(join(OUT, "manifest.json"), JSON.stringify({ runtime: "/statik/runtime.js", islands, classTokens: [...tokens].sort() }));
  console.log(`statik ana sayfa: runtime ${(runtime.outputFiles[0].text.length / 1024).toFixed(1)} KB, ${Object.keys(res.metafile.outputs).length} dosya, ${tokens.size} belirteç`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
