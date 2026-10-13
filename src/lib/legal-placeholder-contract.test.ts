import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readCached, walkAll } from "./test-support/src-tree";
import { LEGAL_ENTITY_PENDING, legalEntityFields } from "./legal-entity";

/**
 * Yasal sayfalarda doldurulmamış şablon yer tutucusu yayına çıkmaz: sağlayıcı kimliği src/lib/legal-entity.ts'ten (env)
 * okunur, boş alan açık "tamamlanıyor" notuyla gösterilir. Bilgi uydurulmaz.
 */
const MARKER = ["DOLDUR", "ULACAK"].join("");
const LEGAL_PAGES = ["src/app/mesafeli-satis/page.tsx", "src/app/on-bilgilendirme/page.tsx"];

describe("yasal yer tutucu sözleşmesi", () => {
  afterEach(() => vi.unstubAllEnvs());

  it(`src altında '${MARKER}' geçmez`, () => {
    const offenders = walkAll(path.join(process.cwd(), "src"))
      .filter((f) => /\.(ts|tsx|js|jsx|md|json|html|css)$/.test(f))
      .filter((f) => readCached(f).includes(MARKER));
    expect(offenders).toEqual([]);
  });

  it("mesafeli satış ve ön bilgilendirme sağlayıcı kimliğini tek kaynaktan okur, köşeli parantezli yer tutucu yok", () => {
    for (const rel of LEGAL_PAGES) {
      const src = readCached(path.join(process.cwd(), rel));
      expect(src, rel).toContain("legalEntityFields()");
      expect(src, rel).not.toMatch(/\[[A-ZÇĞİÖŞÜ ]{4,}[^\]]*\]/);
    }
  });

  it("env boşsa her alan 'tamamlanıyor' notuna düşer, doluysa değeri aynen verir", () => {
    for (const k of ["LEGAL_UNVAN", "LEGAL_ADRES", "LEGAL_MERSIS", "LEGAL_VERGI", "LEGAL_KEP"]) vi.stubEnv(k, "");
    expect(legalEntityFields().every((f) => f.value === null)).toBe(true);
    expect(LEGAL_ENTITY_PENDING).toMatch(/destek adresinden/);

    vi.stubEnv("LEGAL_UNVAN", "  Örnek Yazılım A.Ş.  ");
    const unvan = legalEntityFields().find((f) => f.key === "unvan");
    expect(unvan?.value).toBe("Örnek Yazılım A.Ş.");
  });
});
