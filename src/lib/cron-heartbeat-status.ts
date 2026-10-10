/**
 * Cron heartbeat durumu tek kuralla hesaplanır: hata sayacı > 0 ya da liste kesildiyse "error".
 * Sabit "ok" yazmak yasaktır (scripts/check-cron-contracts.ts); yalnız "atlandı" dalı istisnadır.
 */
export function heartbeatFor(input: { failed?: number; truncated?: boolean }): "ok" | "error" {
  return (input.failed ?? 0) > 0 || input.truncated ? "error" : "ok";
}

/** Heartbeat detayına eklenecek kısa hata notu (boşsa ""). */
export function failureNote(input: { failed?: number; truncated?: boolean }): string {
  const parts: string[] = [];
  if ((input.failed ?? 0) > 0) parts.push(`${input.failed} hata`);
  if (input.truncated) parts.push("TAVAN: liste kesildi, kalanı bu turda işlenmedi");
  return parts.length ? ` · ${parts.join(", ")}` : "";
}
