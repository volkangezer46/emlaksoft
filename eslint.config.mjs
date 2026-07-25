import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // NOT: `react-hooks/purity` ve `react-hooks/set-state-in-effect`
      // eskiden burada "warn"a düşürülmüştü ("CI'ı kırmasın" gerekçesiyle).
      // Artık ikisi de eslint-config-next'in varsayılanı olan HATA seviyesinde:
      //  * purity → zaman okumaları `src/lib/clock.ts` yardımcılarına taşındı.
      //  * set-state-in-effect → efektle state kopyalama/sıfırlama desenleri
      //    action akışına, olay yöneticilerine veya türetmeye çevrildi.
      // Kalan iki bilinçli istisna (`use-api.ts`, `use-app-api.ts` — cache'ten
      // anında boyama) satır bazlı, gerekçeli disable ile işaretli. Böylece
      // yeni ihlaller sessizce birikmek yerine CI'da yakalanır.
      //
      // `_fd`, `_m` gibi alt çizgi önekli isimler "bilinçli kullanılmıyor"
      // demektir (imza gereği duran parametreler). Konvansiyonu kurala tanıt.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    // scripts/*.js dosyaları Node ile doğrudan çalıştırılan CommonJS scriptleri
    // (package.json'da "type": "module" yok), dolayısıyla `require()` burada
    // doğru kullanım — ESM'e çevirmek çalışan scriptleri bozar. Kural bu
    // dosyalar için kapatıldı; tsconfig da `scripts` dizinini hariç tutuyor.
    files: ["scripts/**/*.js", "scripts/**/*.cjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
