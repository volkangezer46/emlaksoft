import "server-only";

type ReportingError = {
  code?: string | null;
  message?: string | null;
};

type ReportingResult<T> = {
  data: T | null;
  error: ReportingError | null;
};

/**
 * Reporting queries must fail visibly. Treating a failed aggregate as an
 * empty result silently turns an outage or authorization drift into fake 0s.
 */
export function requireReportingData<T>(
  source: string,
  result: ReportingResult<T>,
): T {
  if (result.error) {
    console.error("[reporting] aggregate query failed", {
      source,
      code: result.error.code ?? "unknown",
    });
    throw new Error(`Rapor verisi yüklenemedi: ${source}`);
  }
  if (result.data === null || result.data === undefined) {
    console.error("[reporting] aggregate query returned no payload", { source });
    throw new Error(`Rapor verisi eksik: ${source}`);
  }
  return result.data;
}

export function requireReportingCount(
  source: string,
  result: ReportingResult<unknown> & { count: number | null },
): number {
  if (result.error) {
    console.error("[reporting] count query failed", {
      source,
      code: result.error.code ?? "unknown",
    });
    throw new Error(`Rapor verisi yüklenemedi: ${source}`);
  }
  if (result.count === null) {
    console.error("[reporting] count query returned no count", { source });
    throw new Error(`Rapor sayımı eksik: ${source}`);
  }
  return result.count;
}
