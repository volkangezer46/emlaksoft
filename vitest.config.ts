import { configDefaults, defineConfig } from "vitest/config";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Vitest yapılandırması.
 *
 * KAPSAM SEÇİMİ: Bu proje neredeyse tamamen Server Component + Server Action
 * mimarisi. Bileşenleri jsdom altında render etmek RSC sınırını taklit etmek
 * demek — kırılgan ve düşük getirili. Bunun yerine testler SAF MANTIK
 * modüllerine odaklanıyor: telefon normalizasyonu, Türkçe metin katlama,
 * PostgREST filtre temizleme, lead skoru, eşleştirme, izin matrisi.
 *
 * Bunlar zaten hatanın sessizce geçtiği yerler: hepsi girdi→çıktı saf
 * fonksiyon, hepsi para ya da veri doğruluğunu etkiliyor, ve hiçbirinde
 * derleyici yanlış sonucu yakalayamıyor.
 *
 * `environment: "node"` bilinçli — jsdom kurmuyoruz, gerekmiyor.
 */
const TEST_INCLUDE = ["src/**/*.test.ts", "scripts/**/*.test.ts"];

/**
 * SK1/B181: varsayılan testTimeout 30 sn; gerçek Postgres'i (pglite, WASM) açan dosyalar ayrı projede 120 sn alır.
 * Liste yapılandırma yüklenirken çıkarılır (pglite paketini ya da pglite yardımcısını içe aktaran test dosyaları),
 * elle tutulmaz.
 */
const PGLITE_IMPORT = /@electric-sql\/pglite|from\s+["'][^"']*pglite/;
function pgliteTestFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const full = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith(".test.ts") && PGLITE_IMPORT.test(readFileSync(full, "utf8"))) out.push(full);
    }
  };
  walk("src");
  walk("scripts");
  return out.sort();
}
const PGLITE_FILES = pgliteTestFiles();

export default defineConfig({
  test: {
    environment: "node",
    // SK1/B042: aynı 8 çekirdekte canlı uygulama + DB + realtime koşuyor; kapı en çok 4 iş parçacığı kullanır
    // (VITEST_MAX_WORKERS ile değiştirilebilir). scripts/gate/fast.sh ayrıca nice/ionice ile en düşük öncelikte koşar.
    maxWorkers: Number(process.env.VITEST_MAX_WORKERS) || 4,
    // SK1/B181: varsayılan 30 sn (fast.sh'taki --testTimeout=300000 kaldırıldı); pglite projesi 120 sn.
    testTimeout: 30_000,
    // scripts/*.test.ts: derleme araçlarının saf mantığı (ör. check-bundle-budget). `include` YALNIZ projelerde: kök
    // değer `extends: true` ile projelerin listesine EKLENİR (diziler birleşir), her dosya iki kez koşardı.
    projects: [
      { extends: true, test: { name: "birim", include: TEST_INCLUDE, exclude: [...configDefaults.exclude, ...PGLITE_FILES] } },
      { extends: true, test: { name: "pglite", include: PGLITE_FILES, testTimeout: 120_000 } },
    ],
    // src/ metin dosyaları koşu başına bir kez okunur (sözleşme testleri paylaşır): test-support/src-tree.ts.
    globalSetup: ["./vitest.global-setup.ts"],
    // SK1/B177: TEST_TIME_SHIFT_DAYS=<n> ile saat n gün ileri (yalnız Date; pglite now() dahil). Gece +30/+60/+365.
    setupFiles: ["./src/test/time-shift-setup.ts"],
    // pglite'lı SQL testlerinin beforeAll kurulumu tam koşu yükünde 10 sn varsayılanı aşıyor.
    hookTimeout: 60_000,
    // Testler .env.local'a bağımlı olmamalı; DB'ye giden hiçbir test yok.
    env: {},
    // Yalnız tanım (eşik YOK); @vitest/coverage-v8 devDependency; `npm run test:coverage` (CI birim test adımı bunu koşar).
    coverage: {
      provider: "v8",
      // SK1/B175: sunucu eylemleri ve kancalar da raporda (CI özeti eylem kapsamını ayrı satırda gösterir).
      include: ["src/lib/**/*.ts", "src/app/api/**/*.ts", "src/app/actions/**/*.ts", "src/hooks/**/*.ts"],
      exclude: ["**/*.test.ts"],
      // json-summary: CI özet adımı (coverage/coverage-summary.json) için; eşik YOK (yalnız görünürlük).
      reporter: ["text-summary", "json-summary", "lcov"],
    },
  },
  resolve: {
    alias: {
      // tsconfig'deki "@/*" yolu Vitest'e ayrıca tanıtılmalı.
      "@": path.resolve(import.meta.dirname, "./src"),
      // "server-only" Next'in içinden gelir, node_modules'ta yok; testlerde boş modüle eşlenir.
      "server-only": path.resolve(import.meta.dirname, "./src/test/server-only-stub.ts"),
    },
  },
});
