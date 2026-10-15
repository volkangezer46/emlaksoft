import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { assertMutationE2ETarget, isProductionHost, mutationE2EBlockReason } from "./mutation-guard";

describe("oturumlu E2E hedef kapısı (SK1/B178)", () => {
  it("mutasyon kapalıyken (public smoke) hiçbir şey engellenmez — canlıya karşı public koşu serbest", () => {
    expect(mutationE2EBlockReason({ APP_URL: "https://emlaksoft.com.tr" })).toBeNull();
    expect(() => assertMutationE2ETarget({ APP_URL: "https://emlaksoft.com.tr", E2E_MUTATION_ALLOWED: "false" })).not.toThrow();
  });

  it("APP_URL canlı host (kök, www, api ve alt alanlar) ise başlamaz", () => {
    for (const url of ["https://emlaksoft.com.tr", "https://www.emlaksoft.com.tr/", "https://api.emlaksoft.com.tr", "https://EMLAKSOFT.com.tr."]) {
      expect(() => assertMutationE2ETarget({ E2E_MUTATION_ALLOWED: "true", APP_URL: url }), url).toThrow(/canlı host/);
    }
  });

  it("APP_URL yoksa yerel sunucunun bağlanacağı Supabase denetlenir", () => {
    expect(() =>
      assertMutationE2ETarget({ E2E_MUTATION_ALLOWED: "true", NEXT_PUBLIC_SUPABASE_URL: "https://api.emlaksoft.com.tr" }),
    ).toThrow(/canlı Supabase/);
    expect(mutationE2EBlockReason({ E2E_MUTATION_ALLOWED: "true", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" })).toBeNull();
    expect(mutationE2EBlockReason({ E2E_MUTATION_ALLOWED: "true" })).toMatch(/bilinmiyor/);
  });

  it("izole hedef serbest; benzer adlı başka alan adı canlı sayılmaz", () => {
    expect(mutationE2EBlockReason({ E2E_MUTATION_ALLOWED: "true", APP_URL: "http://localhost:3000" })).toBeNull();
    expect(isProductionHost("notemlaksoft.com.tr", ["emlaksoft.com.tr"])).toBe(false);
    expect(mutationE2EBlockReason({ E2E_MUTATION_ALLOWED: "true", APP_URL: "https://staging.example.test", E2E_PRODUCTION_HOSTS: "example.test" })).toMatch(/canlı host/);
  });

  it("playwright.config.ts kapıyı yüklenirken uygular (mutasyon projesi canlıya karşı başlamaz)", () => {
    const cfg = readFileSync(resolve(process.cwd(), "playwright.config.ts"), "utf8");
    expect(cfg).toContain("assertMutationE2ETarget(process.env)");
    expect(cfg.indexOf("assertMutationE2ETarget(process.env)")).toBeLessThan(cfg.indexOf("export default defineConfig"));
  });
});
