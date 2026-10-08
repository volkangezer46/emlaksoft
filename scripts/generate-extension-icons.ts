/**
 * Eklenti ikonlarını marka işaretinden (public/icon.svg) üretir: 16/32/48/128 px PNG →
 * extensions/emlaksoft-ilan-kontrol/icons/. Çıktı depoya GİRER (derleme sharp'a bağımlı olmasın); marka değişirse yeniden üret:
 *
 *   npx tsx scripts/generate-extension-icons.ts
 */
import sharp from "sharp";
import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "..");
const OUT = join(ROOT, "extensions", "emlaksoft-ilan-kontrol", "icons");

async function main() {
  const svg = readFileSync(join(ROOT, "public", "icon.svg"));
  mkdirSync(OUT, { recursive: true });
  for (const size of [16, 32, 48, 128]) {
    await sharp(svg, { density: 384 }).resize(size, size).png({ compressionLevel: 9 }).toFile(join(OUT, `icon-${size}.png`));
    console.log(`icon-${size}.png`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
