import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { EXTENSION_PACKAGE_DIR, extensionZipFileName } from "../worker/extension-release";

/**
 * Derleme çıktısı eklenti paketi (`npm run build:extension` / `prebuild` → `public/downloads/`). Yalnız sunucuda okunur;
 * dosya derlenmemişse `null` döner (arayüz "henüz hazır değil" der, sahte bağlantı üretmez). Yol sabittir (kullanıcı girdisi YOK).
 */

function packagePath(): string {
  return path.join(/* turbopackIgnore: true */ process.cwd(), EXTENSION_PACKAGE_DIR, extensionZipFileName());
}

export async function getExtensionPackageInfo(): Promise<{ fileName: string; bytes: number } | null> {
  try {
    const s = await stat(packagePath());
    return s.isFile() && s.size > 0 ? { fileName: extensionZipFileName(), bytes: s.size } : null;
  } catch {
    return null;
  }
}

export async function readExtensionPackage(): Promise<{ fileName: string; data: Buffer } | null> {
  try {
    const data = await readFile(packagePath());
    return data.length > 0 ? { fileName: extensionZipFileName(), data } : null;
  } catch {
    return null;
  }
}
