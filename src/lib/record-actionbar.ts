/**
 * Mobil kayıt eylem çubuğu (MP6) hücre reçetesi — sunucu bileşenleri de import edebilsin diye
 * "use client" dosyasının DIŞINDA (istemci modülünden dışa aktarılan sabit sunucuda istemci referansına dönüşür).
 * Her hücre eşit genişlikte, en az 48px yüksek, ikon üstte etiket altta.
 */
export const RECORD_BAR_CELL =
  "focus-ring press flex min-h-12 w-full flex-col items-center justify-center gap-0.5 rounded-[var(--radius-control)] px-1 py-1.5 text-xs font-semibold text-ink-950 transition hover:bg-surface-hover active:bg-surface-pressed";

/** Birincil hücre (ör. Ara): marka dolgulu. */
export const RECORD_BAR_CELL_PRIMARY =
  "focus-ring press flex min-h-12 w-full flex-col items-center justify-center gap-0.5 rounded-[var(--radius-control)] bg-brand-600 px-1 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-700";

export const RECORD_BAR_ICON = "h-5 w-5";
