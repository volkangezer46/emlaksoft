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
