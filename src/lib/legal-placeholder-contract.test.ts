import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readCached, walkAll } from "./test-support/src-tree";
import { entityFieldsFrom, resolveLegalEntity } from "./legal-entity";

/**
 * Yasal sayfalarda doldurulmamış şablon yer tutucusu yayına çıkmaz: sağlayıcı kimliği src/lib/legal-entity.ts'ten
 * (ayar defteri > env yedeği) okunur, boş alan hiç gösterilmez. Bilgi uydurulmaz.
 */
const MARKER = ["DOLDUR", "ULACAK"].join("");
const LEGAL_PAGES = ["src/app/mesafeli-satis/page.tsx", "src/app/on-bilgilendirme/page.tsx"];
const ENV = ["LEGAL_UNVAN", "LEGAL_ADRES", "LEGAL_MERSIS", "LEGAL_VERGI", "LEGAL_VERGI_DAIRESI", "LEGAL_VERGI_NO", "LEGAL_KEP", "LEGAL_TELEFON"];

describe("yasal yer tutucu sözleşmesi", () => {
  afterEach(() => vi.unstubAllEnvs());

  it(`src altında '${MARKER}' geçmez`, () => {
    const offenders = walkAll(path.join(process.cwd(), "src"))
      .filter((f) => /\.(ts|tsx|js|jsx|md|json|html|css)$/.test(f))
      .filter((f) => readCached(f).includes(MARKER));
    expect(offenders).toEqual([]);
  });

  it("mesafeli satış, ön bilgilendirme ve fatura başlığı sağlayıcı kimliğini tek kaynaktan okur, köşeli parantezli yer tutucu yok", () => {
    for (const rel of [...LEGAL_PAGES, "src/app/app/abonelik/fatura/[id]/page.tsx"]) {
      const src = readCached(path.join(process.cwd(), rel));
      expect(src, rel).toContain("legalEntityFields()");
      expect(src, rel).not.toMatch(/\[[A-ZÇĞİÖŞÜ ]{4,}[^\]]*\]/);
      expect(src, rel).not.toContain("tamamlanıyor");
    }
  });

  it("ayar ve env boşsa hiçbir alan gösterilmez ('tamamlanıyor' notu yok)", () => {
    for (const k of ENV) vi.stubEnv(k, "");
    expect(entityFieldsFrom(resolveLegalEntity({}))).toEqual([]);
  });

  it("adminden girilen MERSİS env'den önce gelir ve satırda görünür; boş ayar env yedeğine düşer", () => {
    for (const k of ENV) vi.stubEnv(k, "");
    vi.stubEnv("LEGAL_UNVAN", "  Env Yazılım A.Ş.  ");
    const raw = resolveLegalEntity({ "legal.entity_mersis": "0123456789012345", "legal.entity_unvan": "" });
    const rows = entityFieldsFrom(raw);
    expect(rows.find((f) => f.key === "mersis")?.value).toBe("0123456789012345");
    expect(rows.find((f) => f.key === "unvan")?.value).toBe("Env Yazılım A.Ş.");
    expect(rows.some((f) => f.key === "adres")).toBe(false);
  });

  it("vergi dairesi + no tek satır; ikisi de yoksa eski birleşik LEGAL_VERGI", () => {
    for (const k of ENV) vi.stubEnv(k, "");
    expect(entityFieldsFrom(resolveLegalEntity({ "legal.entity_vergi_dairesi": "Kadıköy", "legal.entity_vergi_no": "1234567890" })).find((f) => f.key === "vergi")?.value).toBe(
      "Kadıköy / 1234567890",
    );
    vi.stubEnv("LEGAL_VERGI", "Eski VD / 999");
    expect(entityFieldsFrom(resolveLegalEntity({})).find((f) => f.key === "vergi")?.value).toBe("Eski VD / 999");
  });
});
