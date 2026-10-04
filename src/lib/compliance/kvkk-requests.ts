/** KVKK / hesap talepleri: tür etiketleri, durumlar ve süre hesabı (sunucu + istemci ortak, yan etkisiz). */
export const KVKK_REQUEST_TYPES = [
  "access",
  "portability",
  "rectification",
  "objection",
  "erasure",
  "account_closure",
  "data_export",
] as const;
export type KvkkRequestType = (typeof KVKK_REQUEST_TYPES)[number];

export const KVKK_REQUEST_LABELS: Record<KvkkRequestType, string> = {
  access: "Erişim (bilgi talebi)",
  portability: "Veri taşınabilirliği",
  rectification: "Düzeltme",
  objection: "İtiraz",
  erasure: "Silme / anonimleştirme",
  account_closure: "Ofis hesabını kapatma",
  data_export: "Ofis verisini indirme",
};

/** Müşteriye (veri sahibine) bağlı türler; hesap kapatma ve veri indirme ofis düzeyindedir. */
export const KVKK_CUSTOMER_TYPES: readonly KvkkRequestType[] = [
  "access",
  "portability",
  "rectification",
  "objection",
  "erasure",
];
export const KVKK_OFFICE_TYPES: readonly KvkkRequestType[] = ["account_closure", "data_export"];

export const KVKK_STATUSES = ["open", "in_progress", "completed", "rejected"] as const;
export type KvkkStatus = (typeof KVKK_STATUSES)[number];
export const KVKK_STATUS_LABELS: Record<KvkkStatus, string> = {
  open: "Açık",
  in_progress: "İşlemde",
  completed: "Tamamlandı",
  rejected: "Reddedildi",
};

export const DEFAULT_DUE_DAYS = 30;
export const MIN_DUE_DAYS = 1;
export const MAX_DUE_DAYS = 90;

export function isKvkkType(v: unknown): v is KvkkRequestType {
  return typeof v === "string" && (KVKK_REQUEST_TYPES as readonly string[]).includes(v);
}
export function isKvkkStatus(v: unknown): v is KvkkStatus {
  return typeof v === "string" && (KVKK_STATUSES as readonly string[]).includes(v);
}

/** Yanıt süresi (gün): boş → 30; 1..90 dışı reddedilir (null). */
export function parseDueDays(raw: unknown): number | null {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) return DEFAULT_DUE_DAYS;
  if (!/^\d{1,3}$/.test(s)) return null;
  const n = Number(s);
  return n >= MIN_DUE_DAYS && n <= MAX_DUE_DAYS ? n : null;
}

/** Açık talep için kalan gün (negatif: gecikmiş). */
export function daysLeft(dueIso: string, nowMs: number): number {
  return Math.ceil((new Date(dueIso).getTime() - nowMs) / 86_400_000);
}
