/**
 * Anahtar & emanet takibi — saf yardımcılar.
 *
 * Hem portföy detayındaki bölüm, hem anahtar panosu, hem de gecikme cron'u
 * aynı "dışarıda mı / kaç gün gecikmiş" tanımını kullansın diye tek yerde.
 * Bilerek SAF: `Date.now()` çağırmaz — çağıran anı `nowMs` olarak geçirir
 * (React Compiler saflık kuralı + test edilebilirlik, bkz. src/lib/clock.ts).
 */

export const KEY_STATUSES = ["ofiste", "danisanda", "musteride", "kayip", "iade_edildi"] as const;
export type KeyStatus = (typeof KEY_STATUSES)[number];

const STATUS_LABELS: Record<KeyStatus, string> = {
  ofiste: "Ofiste",
  danisanda: "Danışmanda",
  musteride: "Müşteride",
  kayip: "Kayıp",
  iade_edildi: "İade edildi",
};

/** Durumun Türkçe etiketi — bilinmeyen değer ham haliyle döner. */
export function keyStatusLabel(status: string): string {
  return STATUS_LABELS[status as KeyStatus] ?? status;
}

/**
 * Rozet renk sınıfları — ofiste=mint, danışanda/müşteride=amber,
 * kayıp=kırmızı, iade=gri. (Mor yok; proje paleti.)
 */
export function keyStatusTone(status: string): string {
  if (status === "ofiste") return "bg-mint-500/12 text-mint-700 ring-1 ring-inset ring-mint-600/25";
  if (status === "danisanda" || status === "musteride")
    return "bg-amber-400/15 text-amber-700 ring-1 ring-inset ring-amber-500/25";
  if (status === "kayip") return "bg-danger-500/10 text-danger-600 ring-1 ring-inset ring-danger-500/25";
  return "bg-ink-950/6 text-text-muted ring-1 ring-inset ring-ink-950/8";
}

/** Anahtar şu an ofis dışında mı (birinin üzerinde). */
export function isKeyOut(status: string): boolean {
  return status === "danisanda" || status === "musteride";
}

export type OverdueInput = {
  status: string;
  due_at: string | null;
  returned_at: string | null;
};

/**
 * Gecikme gün sayısı. Gecikme yoksa 0.
 *
 * Kurallar:
 *  - Yalnız DIŞARIDAKİ anahtarlar gecikebilir (ofiste/kayıp/iade sayılmaz).
 *  - due_at yoksa süresiz çıkıştır, gecikmez.
 *  - returned_at doluysa iade alınmıştır, gecikmez.
 *  - Gün sayısı yukarı yuvarlanır: vade 1 saat geçtiyse "1 gün gecikmiş".
 */
export function keyOverdueDays(key: OverdueInput, nowMs: number): number {
  if (!isKeyOut(key.status)) return 0;
  if (key.returned_at) return 0;
  if (!key.due_at) return 0;
  const due = new Date(key.due_at).getTime();
  if (Number.isNaN(due) || due >= nowMs) return 0;
  return Math.max(1, Math.ceil((nowMs - due) / 86_400_000));
}

/** Gecikmiş mi (kısayol). */
export function isKeyOverdue(key: OverdueInput, nowMs: number): boolean {
  return keyOverdueDays(key, nowMs) > 0;
}

/** "Kimde?" metni — danışman adı, yoksa müşteri adı, ikisi de yoksa "Ofiste". */
export function keyHolderLabel(input: {
  status: string;
  staffName?: string | null;
  holder_name?: string | null;
}): string {
  if (input.status === "ofiste") return "Ofiste";
  if (input.status === "kayip") return input.staffName || input.holder_name || "Bilinmiyor";
  if (input.status === "iade_edildi") return input.holder_name || input.staffName || "İade edildi";
  return input.staffName || input.holder_name || "Bilinmiyor";
}

/** ?durum= kontratı — anahtar panosu filtreleri. */
export const KEY_BOARD_FILTERS = [
  { value: "", label: "Tümü" },
  { value: "ofiste", label: "Ofiste" },
  { value: "disarida", label: "Dışarıda" },
  { value: "gecikmis", label: "Gecikmiş" },
  { value: "kayip", label: "Kayıp" },
] as const;

export type KeyBoardFilter = (typeof KEY_BOARD_FILTERS)[number]["value"];

/** Pano filtresi — bellekte tek satır eşleşmesi (sunucu sorgusuyla aynı tanım). */
export function matchesKeyBoardFilter(key: OverdueInput, filter: string, nowMs: number): boolean {
  if (filter === "ofiste") return key.status === "ofiste";
  if (filter === "disarida") return isKeyOut(key.status);
  if (filter === "gecikmis") return isKeyOverdue(key, nowMs);
  if (filter === "kayip") return key.status === "kayip";
  return true;
}
