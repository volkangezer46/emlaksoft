/**
 * Tarayıcı eklentisini derler: `extensions/emlaksoft-ilan-kontrol/src` → `extensions/emlaksoft-ilan-kontrol/dist`
 * (Manifest V3; Chrome/Edge). Çıktı depoya girmez (klasörün .gitignore'u).
 *
 *   npm run build:extension
 *
 * - `host_permissions` YALNIZ portal adaptör kayıt defterinden (`allPortalHosts()`): sahibinden/hepsiemlak/emlakjet.
 * - İçerik betiği YALNIZ EmlakSoft alanında: `emlaksoft.vercel.app` + `NEXT_PUBLIC_APP_URL` host'u (varsa).
 * - Köprü sözleşmesi, hız kuralı ve ayrıştırıcılar uygulamanın `src/lib/listing-control/**` dosyalarından DOĞRUDAN derlenir.
 */
import { build } from "esbuild";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { allPortalHosts } from "../src/lib/listing-control/adapters/html";

const ROOT = resolve(__dirname, "..");
const EXT = join(ROOT, "extensions", "emlaksoft-ilan-kontrol");
const SRC = join(EXT, "src");
const DIST = join(EXT, "dist");
const DEFAULT_APP_ORIGIN = "https://emlaksoft.vercel.app";

function appOrigins(): string[] {
  const out = new Set<string>([DEFAULT_APP_ORIGIN]);
  const raw = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim();
  if (raw) {
    try {
      const u = new URL(raw);
      if (u.protocol === "https:" || u.hostname === "localhost") out.add(`${u.protocol}//${u.hostname}`);
    } catch {
      console.warn(`NEXT_PUBLIC_APP_URL geçersiz, yok sayıldı: ${raw}`);
    }
  }
  return [...out];
}

async function main() {
  const origins = appOrigins();
  rmSync(DIST, { recursive: true, force: true });
  mkdirSync(DIST, { recursive: true });

  const common = {
    bundle: true,
    platform: "browser" as const,
    target: ["chrome116"],
    tsconfig: join(EXT, "tsconfig.json"),
    legalComments: "none" as const,
    logLevel: "warning" as const,
    define: { __EMLAKSOFT_APP_ORIGIN__: JSON.stringify(origins[origins.length - 1]) },
  };
  await build({ ...common, entryPoints: [join(SRC, "background.ts")], outfile: join(DIST, "background.js"), format: "esm" });
  await build({ ...common, entryPoints: [join(SRC, "content.ts")], outfile: join(DIST, "content.js"), format: "iife" });
  await build({ ...common, entryPoints: [join(SRC, "popup.ts")], outfile: join(DIST, "popup.js"), format: "iife" });
  copyFileSync(join(SRC, "popup.html"), join(DIST, "popup.html"));

  const manifest = JSON.parse(readFileSync(join(EXT, "manifest.base.json"), "utf8")) as Record<string, unknown>;
  manifest.host_permissions = allPortalHosts().map((h) => `https://*.${h}/*`);
  manifest.content_scripts = [{ matches: origins.map((o) => `${o}/*`), js: ["content.js"], run_at: "document_start", all_frames: false }];
  writeFileSync(join(DIST, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(`Eklenti derlendi: ${DIST}`);
  console.log(`  portal izinleri: ${(manifest.host_permissions as string[]).join(", ")}`);
  console.log(`  EmlakSoft alanları: ${origins.join(", ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
