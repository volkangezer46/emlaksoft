/**
 * AD11 destek erişimi gerekçesi (SAF): gerekçe 10–500 karakter, bilet no 1–64 karakter (harf, rakam, # . _ / -).
 * Sunucu (`startImpersonation`) ve istemci penceresi aynı kuralı kullanır; DB CHECK'i de aynı sınırları uygular.
 */
export const IMPERSONATION_REASON_MIN = 10;
export const IMPERSONATION_REASON_MAX = 500;
export const IMPERSONATION_TICKET_MAX = 64;
export const IMPERSONATION_TICKET_RE = /^[\p{L}\p{N}#._/-]{1,64}$/u;

export type ImpersonationJustification =
  | { ok: true; reason: string; ticketId: string }
  | { ok: false; code: "gerekce" | "bilet"; error: string };

export function parseImpersonationReason(reasonRaw: unknown, ticketRaw: unknown): ImpersonationJustification {
  const reason = String(reasonRaw ?? "").trim().replace(/\s+/g, " ");
  const ticketId = String(ticketRaw ?? "").trim();
  if (reason.length < IMPERSONATION_REASON_MIN || reason.length > IMPERSONATION_REASON_MAX) {
    return { ok: false, code: "gerekce", error: `Gerekçe ${IMPERSONATION_REASON_MIN}-${IMPERSONATION_REASON_MAX} karakter olmalı.` };
  }
  if (!IMPERSONATION_TICKET_RE.test(ticketId)) {
    return { ok: false, code: "bilet", error: "Destek bileti numarasını yazın (boşluksuz; harf, rakam, # . _ / -)." };
  }
  return { ok: true, reason, ticketId };
}
