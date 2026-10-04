/**
 * Askıdaki / iptal edilmiş ofis için /app altında erişilebilir yollar (P0-12).
 * Askıda: /app/askida ve /app/abonelik (ödeme/yükseltme). İptal: yalnız /app/askida.
 * Veri silinmez; diğer her yol /app/askida'ya yönlenir.
 */
export function isSuspendedAllowedPath(path: string, tenantStatus: string | null | undefined): boolean {
  const under = (base: string) => path === base || path.startsWith(`${base}/`);
  if (under("/app/askida")) return true;
  if (tenantStatus === "suspended" && under("/app/abonelik")) return true;
  return false;
}
