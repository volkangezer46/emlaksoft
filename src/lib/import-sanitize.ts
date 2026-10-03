import type { ImportRow } from "@/lib/import-rows";

/**
 * CSV formül enjeksiyonu (denetim B4/B18): serbest metin alanlarında =, +, -, @, sekme veya CR ile
 * başlayan hücreler başka tüketicilerde (xlsx, rapor, kampanya CSV'si) formül olarak çalışabilir.
 * İçe aktarmada bu hücreler `'` önekiyle saklanır ve satıra uyarı eklenir (veri reddedilmez).
 * Telefon/e-posta/sayı alanları kendi doğrulayıcılarından geçtiği için burada dokunulmaz.
 */
export const FORMULA_TEXT_FIELDS = ["full_name", "notes", "title", "address_line", "source"] as const;

const FORMULA_PREFIX = /^[=+\-@\t\r]/;

export function hasFormulaPrefix(value: unknown): boolean {
  return typeof value === "string" && FORMULA_PREFIX.test(value.trimStart());
}

export type NeutralizeResult<R extends ImportRow> = { rows: R[]; flaggedRows: Set<number> };

export function neutralizeFormulaCells<R extends ImportRow>(rows: R[]): NeutralizeResult<R> {
  const flaggedRows = new Set<number>();
  const out = rows.map((r) => {
    let copy: R | null = null;
    for (const f of FORMULA_TEXT_FIELDS) {
      const v = r[f];
      if (typeof v === "string" && hasFormulaPrefix(v)) {
        copy ??= { ...r };
        (copy as Record<string, unknown>)[f] = `'${v.trimStart()}`;
        flaggedRows.add(r.row);
      }
    }
    return copy ?? r;
  });
  return { rows: out, flaggedRows };
}
