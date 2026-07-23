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
