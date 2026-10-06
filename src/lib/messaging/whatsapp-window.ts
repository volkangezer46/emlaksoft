/**
 * WhatsApp 24 saatlik müşteri hizmet penceresi (SAF). Meta kuralı: müşterinin SON gelen mesajından sonraki 24 saat içinde
 * serbest metin yanıt verilebilir; pencere dışında yalnız onaylı şablon gönderilebilir.
 */
export const WHATSAPP_WINDOW_MS = 24 * 3_600_000;

export type WindowState = { open: boolean; remainingMs: number; expiresAt: string | null };

export function whatsappWindowState(lastInboundAt: string | null | undefined, nowMs: number): WindowState {
  const at = lastInboundAt ? Date.parse(lastInboundAt) : NaN;
  if (!Number.isFinite(at)) return { open: false, remainingMs: 0, expiresAt: null };
  const expires = at + WHATSAPP_WINDOW_MS;
  const remaining = expires - nowMs;
  return { open: remaining > 0, remainingMs: Math.max(0, remaining), expiresAt: new Date(expires).toISOString() };
}

/** "5 sa 20 dk kaldı" */
export function windowLabel(state: WindowState): string {
  if (!state.open) return "24 saat penceresi kapandı: yalnız onaylı şablon gönderilebilir";
  const mins = Math.floor(state.remainingMs / 60_000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `Serbest yanıt penceresi: ${h > 0 ? `${h} sa ` : ""}${m} dk kaldı`;
}
