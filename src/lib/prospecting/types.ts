/**
 * Sahibinden ilanlar (portföy avı) — ortak türler ve Türkçe etiketler (SAF, import yan etkisi yok).
 * Arayüzde "FSBO" kelimesi geçmez; kod/rota adı "portföy avı" (modül `prospecting`, /app/portfoy-avi).
 */

export const FSBO_PORTALS = ["sahibinden", "hepsiemlak", "emlakjet", "other"] as const;
export type FsboPortal = (typeof FSBO_PORTALS)[number];

export const FSBO_SOURCES = ["extension", "manual", "import"] as const;
export type FsboSource = (typeof FSBO_SOURCES)[number];

export const FSBO_STATUSES = ["yeni", "arandi", "randevu", "yetki_alindi", "portfoye_donustu", "kayip"] as const;
export type FsboStatus = (typeof FSBO_STATUSES)[number];

export const FSBO_LOST_REASONS = [
  "satti",
  "emlakci_istemiyor",
  "baska_ofis",
  "fiyat_gercekci_degil",
  "ilan_kalkti",
  "aslinda_emlakci",
  "ulasilamadi",
  "diger",
] as const;
export type FsboLostReason = (typeof FSBO_LOST_REASONS)[number];

export const FSBO_OUTCOMES = ["ulasilamadi", "mesgul", "gorusuldu", "ilgilenmiyor", "sonra_ara", "randevu", "yetki", "aranmasin"] as const;
export type FsboOutcome = (typeof FSBO_OUTCOMES)[number];

export const FSBO_ACTIVITY_KINDS = ["call", "note", "status", "meeting", "message"] as const;
export type FsboActivityKind = (typeof FSBO_ACTIVITY_KINDS)[number];

export const FSBO_DNC_REASONS = ["ilan_sahibi_istedi", "aslinda_emlakci", "diger"] as const;
export type FsboDncReason = (typeof FSBO_DNC_REASONS)[number];

export const FSBO_TRANSACTIONS = ["sale", "rent"] as const;
export type FsboTransaction = (typeof FSBO_TRANSACTIONS)[number];

export const PORTAL_LABELS: Record<FsboPortal, string> = {
  sahibinden: "Sahibinden",
  hepsiemlak: "Hepsiemlak",
  emlakjet: "Emlakjet",
  other: "Diğer",
};

export const STATUS_LABELS: Record<FsboStatus, string> = {
  yeni: "Yeni",
  arandi: "Arandı",
  randevu: "Randevu",
  yetki_alindi: "Yetki alındı",
  portfoye_donustu: "Portföye döndü",
  kayip: "Kayıp",
};

export const LOST_REASON_LABELS: Record<FsboLostReason, string> = {
  satti: "Sattı / kiraladı",
  emlakci_istemiyor: "Emlakçı istemiyor",
  baska_ofis: "Başka ofisle anlaştı",
  fiyat_gercekci_degil: "Fiyat gerçekçi değil",
  ilan_kalkti: "İlan yayından kalktı",
  aslinda_emlakci: "Aslında emlakçı",
  ulasilamadi: "Ulaşılamadı",
  diger: "Diğer",
};

export const OUTCOME_LABELS: Record<FsboOutcome, string> = {
  ulasilamadi: "Ulaşılamadı",
  mesgul: "Meşgul",
  gorusuldu: "Görüşüldü",
  ilgilenmiyor: "İlgilenmiyor",
  sonra_ara: "Sonra ara",
  randevu: "Randevu alındı",
  yetki: "Yetki alındı",
  aranmasin: "Aranmasın",
};

export const DNC_REASON_LABELS: Record<FsboDncReason, string> = {
  ilan_sahibi_istedi: "İlan sahibi istedi",
  aslinda_emlakci: "Aslında emlakçı",
  diger: "Diğer",
};

export const TRANSACTION_LABELS: Record<FsboTransaction, string> = { sale: "Satılık", rent: "Kiralık" };

/** Hâlâ takip edilen (kapanmamış) durumlar. */
export const OPEN_STATUSES: readonly FsboStatus[] = ["yeni", "arandi", "randevu", "yetki_alindi"];

export function isFsboStatus(v: unknown): v is FsboStatus {
  return typeof v === "string" && (FSBO_STATUSES as readonly string[]).includes(v);
}
export function isFsboLostReason(v: unknown): v is FsboLostReason {
  return typeof v === "string" && (FSBO_LOST_REASONS as readonly string[]).includes(v);
}
export function isFsboOutcome(v: unknown): v is FsboOutcome {
  return typeof v === "string" && (FSBO_OUTCOMES as readonly string[]).includes(v);
}
