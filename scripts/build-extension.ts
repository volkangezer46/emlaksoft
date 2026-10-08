/**
 * Tarayıcı eklentisini derler ve paketler: `extensions/emlaksoft-ilan-kontrol/src` → `dist/` (Manifest V3; Chrome/Edge),
 * ardından sürüm numaralı ZIP (`release/emlaksoft-ilan-kontrol-<sürüm>.zip`) ve uygulamanın indirme ucu için kopya
 * (`public/downloads/`, depoya girmez). Çıktılar depoya girmez.
 *
 *   npm run build:extension          # tsc tip denetimi + derleme + ZIP
 *   tsx scripts/build-extension.ts --soft   # `prebuild`: hata olursa uyarır, uygulama derlemesini ENGELLEMEZ
 *
 * - `host_permissions` YALNIZ portal adaptör kayıt defterinden (`allPortalHosts()`): sahibinden/hepsiemlak/emlakjet.
 * - İçerik betiği YALNIZ EmlakSoft alanında: `emlaksoft.vercel.app` + `NEXT_PUBLIC_APP_URL` host'u (varsa).
 * - İzinler yalnız `storage` + `alarms`. `externally_connectable` YOK.
 * - Sürüm tek kaynak: `src/lib/listing-control/worker/extension-release.ts` (manifest.base.json ile eşitliği test kilitler).
 * - Köprü sözleşmesi, hız kuralı ve ayrıştırıcılar uygulamanın `src/lib/listing-control/**` dosyalarından DOĞRUDAN derlenir.
 */
import { build } from "esbuild";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative, resolve } from "node:path";
import { allPortalHosts } from "../src/lib/listing-control/adapters/html";
import { createZip, listZipEntries, type ZipFile } from "../src/lib/listing-control/server/extension-zip";
import { EXTENSION_PACKAGE_DIR, EXTENSION_VERSION, EXTENSION_ZIP_PREFIX, extensionZipFileName } from "../src/lib/listing-control/worker/extension-release";

const ROOT = resolve(__dirname, "..");
const EXT = join(ROOT, "extensions", "emlaksoft-ilan-kontrol");
const SRC = join(EXT, "src");
const DIST = join(EXT, "dist");
const RELEASE = join(EXT, "release");
const PUBLIC_DOWNLOADS = join(ROOT, EXTENSION_PACKAGE_DIR);
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

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

async function main() {
  const origins = appOrigins();
  rmSync(DIST, { recursive: true, force: true });
  mkdirSync(DIST, { recursive: true });

  const baseManifest = JSON.parse(readFileSync(join(EXT, "manifest.base.json"), "utf8")) as Record<string, unknown>;
  if (baseManifest.version !== EXTENSION_VERSION) {
    throw new Error(`manifest.base.json sürümü (${String(baseManifest.version)}) extension-release.ts ile (${EXTENSION_VERSION}) aynı olmalı.`);
  }

  const common = {
    bundle: true,
    platform: "browser" as const,
    target: ["chrome116"],
    tsconfig: join(EXT, "tsconfig.json"),
    legalComments: "none" as const,
    logLevel: "warning" as const,
    define: {
      __EMLAKSOFT_APP_ORIGIN__: JSON.stringify(origins[origins.length - 1]),
      __EMLAKSOFT_APP_ORIGINS__: JSON.stringify(origins),
    },
  };
  await build({ ...common, entryPoints: [join(SRC, "background.ts")], outfile: join(DIST, "background.js"), format: "esm" });
  await build({ ...common, entryPoints: [join(SRC, "content.ts")], outfile: join(DIST, "content.js"), format: "iife" });
  await build({ ...common, entryPoints: [join(SRC, "popup.ts")], outfile: join(DIST, "popup.js"), format: "iife" });
  copyFileSync(join(SRC, "popup.html"), join(DIST, "popup.html"));

  mkdirSync(join(DIST, "icons"), { recursive: true });
  for (const size of [16, 32, 48, 128]) {
    const icon = join(EXT, "icons", `icon-${size}.png`);
    if (!existsSync(icon)) throw new Error(`İkon yok: ${icon} (npx tsx scripts/generate-extension-icons.ts)`);
    copyFileSync(icon, join(DIST, "icons", `icon-${size}.png`));
  }

  const manifest = { ...baseManifest, version: EXTENSION_VERSION } as Record<string, unknown>;
  manifest.host_permissions = allPortalHosts().map((h) => `https://*.${h}/*`);
  manifest.content_scripts = [{ matches: origins.map((o) => `${o}/*`), js: ["content.js"], run_at: "document_start", all_frames: false }];
  writeFileSync(join(DIST, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  // ZIP: dist'in tamamı (yerel yol → ZIP adı, her zaman "/" ayraçlı).
  const files: ZipFile[] = walk(DIST).map((p) => ({ name: relative(DIST, p).split("\\").join("/"), data: readFileSync(p) }));
  const zip = createZip(files);
  const names = listZipEntries(zip).map((e) => e.name);
  if (!names.includes("manifest.json") || names.length !== files.length) throw new Error("ZIP doğrulaması başarısız");
  const zipName = extensionZipFileName();
  mkdirSync(RELEASE, { recursive: true });
  writeFileSync(join(RELEASE, zipName), zip);

  mkdirSync(PUBLIC_DOWNLOADS, { recursive: true });
  for (const n of readdirSync(PUBLIC_DOWNLOADS)) if (n.startsWith(`${EXTENSION_ZIP_PREFIX}-`) && n.endsWith(".zip")) rmSync(join(PUBLIC_DOWNLOADS, n));
  writeFileSync(join(PUBLIC_DOWNLOADS, zipName), zip);
  const sha256 = createHash("sha256").update(zip).digest("hex");
  writeFileSync(join(PUBLIC_DOWNLOADS, `${EXTENSION_ZIP_PREFIX}.json`), `${JSON.stringify({ version: EXTENSION_VERSION, file: zipName, sha256, bytes: zip.length }, null, 2)}\n`);

  console.log(`Eklenti derlendi: ${DIST}`);
  console.log(`  sürüm: ${EXTENSION_VERSION} · ZIP: ${join(RELEASE, zipName)} (${zip.length} bayt, sha256 ${sha256.slice(0, 12)}…)`);
  console.log(`  portal izinleri: ${(manifest.host_permissions as string[]).join(", ")}`);
  console.log(`  EmlakSoft alanları: ${origins.join(", ")}`);
}

main().catch((err) => {
  if (process.argv.includes("--soft")) {
    console.warn("Eklenti paketi üretilemedi (uygulama derlemesi sürüyor):", err instanceof Error ? err.message : err);
    return;
  }
  console.error(err);
  process.exit(1);
});
