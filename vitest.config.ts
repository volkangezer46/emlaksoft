import { defineConfig } from "vitest/config";
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
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Testler .env.local'a bağımlı olmamalı; DB'ye giden hiçbir test yok.
    env: {},
  },
  resolve: {
    alias: {
      // tsconfig'deki "@/*" yolu Vitest'e ayrıca tanıtılmalı.
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
