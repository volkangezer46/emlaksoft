import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // React Compiler ön-uyarıları: Server Component'lerde Date.now() gibi
      // saf olmayan çağrılar ve ilk senkronizasyon amaçlı setState-in-effect
      // desenleri bu kod tabanında bilinçli ve doğru kullanılıyor.
      // CI'ı kırmasın diye uyarıya düşürüldü — derleyici hatası değil, öneri.
      "react-hooks/purity": "warn",
      "react-hooks/set-state-in-effect": "warn",
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
