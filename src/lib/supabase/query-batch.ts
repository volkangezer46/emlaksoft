export type QueryBatchFailure = {
  index: number;
  label: string;
  code: string | null;
};

function errorCode(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && /^[A-Za-z0-9_-]{1,32}$/.test(code) ? code : null;
}

/**
 * Supabase returns query failures as values instead of throwing them. Batch
 * dashboards must inspect every result or an outage silently becomes a set of
 * convincing zeroes. Raw provider messages are intentionally not propagated.
 */
export function failedQueryResults(
  results: readonly object[],
  labels: readonly string[],
): QueryBatchFailure[] {
  if (results.length !== labels.length) {
    throw new Error("Sorgu sonucu ve etiket sayısı eşleşmiyor.");
  }

  return results.flatMap((result, index) => {
    const error = "error" in result ? result.error : undefined;
    return error
      ? [{ index, label: labels[index] ?? `query-${index}`, code: errorCode(error) }]
      : [];
  });
}

export function assertQueryBatchSucceeded(
  results: readonly object[],
  labels: readonly string[],
  context: string,
): void {
  const failures = failedQueryResults(results, labels);
  if (failures.length === 0) return;

  const summary = failures
    .map((failure) => `${failure.label}${failure.code ? `:${failure.code}` : ""}`)
    .join(", ");
  throw new Error(`${context} verileri eksik yüklendi (${summary}).`);
}

/**
 * `Promise.all` yerine liste sayfalarında kullanılır: bekler, her Supabase sonucunu
 * (iç içe diziler dahil) denetler ve herhangi biri hata döndürdüyse fırlatır; hata
 * `error.tsx` sınırına düşer ve oradan reportClientError ile kayda geçer. Böylece sorgu
 * hatası sessizce "kayıt yok" ekranına dönüşmez. Hata/sayı olmayan değerler (dizi,
 * metin, Map ...) denetlenmez. Etiketler yalnız teşhis içindir (index sırasıyla).
 */
export async function batchAll<const T extends readonly unknown[]>(
  context: string,
  labels: readonly string[],
  values: T,
): Promise<{ -readonly [K in keyof T]: Awaited<T[K]> }> {
  const results = await Promise.all(values);
  const isResult = (x: unknown): x is object =>
    typeof x === "object" && x !== null && !Array.isArray(x) && "error" in x;
  const failures: QueryBatchFailure[] = [];
  results.forEach((entry, index) => {
    const label = labels[index] ?? `query-${index}`;
    const items = Array.isArray(entry) && entry.some(isResult) ? entry : [entry];
    items.forEach((item, sub) => {
      if (!isResult(item)) return;
      const error = (item as { error?: unknown }).error;
      if (error) {
        failures.push({ index, label: items.length > 1 ? `${label}[${sub}]` : label, code: errorCode(error) });
      }
    });
  });
  if (failures.length > 0) {
    const summary = failures.map((f) => `${f.label}${f.code ? `:${f.code}` : ""}`).join(", ");
    throw new Error(`${context} verileri eksik yüklendi (${summary}).`);
  }
  return results as never;
}
