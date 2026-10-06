import { REASON_LABELS, type ExitKind, type ReasonCode } from "./types";

/**
 * Kapanış kontrol listesi ve eksik kapanış alarmı (SAF). Hesap kaynaklarını (deals, commissions, contracts,
 * deal_checklist_items) ÇOĞALTMAZ: çağıran var/yok bilgisini verir; bilinmeyen madde null = ölçülemedi.
 * Satış/kiralama için tam liste, diğer çıkışlar (iptal, yetki doldu, vazgeçti...) için yalnız portal kaldırma + neden.
 */

export type ClosureFacts = {
  exitKind: ExitKind;
  portalsRemoved: boolean | null;
  hasReasonRecorded: boolean | null;
  dealRecorded: boolean | null;
  finalPriceRecorded: boolean | null;
  commissionRecorded: boolean | null;
  closedDateRecorded: boolean | null;
  counterpartyRecorded: boolean | null;
  contractRecorded: boolean | null;
  collectionRecorded: boolean | null;
  documentsComplete: boolean | null;
};

export type ClosureItem = { key: string; label: string; required: boolean; done: boolean | null };
export type ClosureChecklist = {
  items: ClosureItem[];
  /** Zorunlu ve YAPILMAMIŞ (false) maddelerin etiketleri. Ölçülemeyen (null) eksik sayılmaz. */
  missing: string[];
  unmeasured: string[];
  complete: boolean;
  percent: number;
};

export function evaluateClosureChecklist(f: ClosureFacts): ClosureChecklist {
  const deal = f.exitKind === "sold" || f.exitKind === "rented";
  const items: ClosureItem[] = [
    { key: "portals_removed", label: "Portal ilanları kaldırıldı", required: true, done: f.portalsRemoved },
    { key: "reason", label: "Kapanış nedeni kaydedildi", required: true, done: f.hasReasonRecorded },
    { key: "deal", label: "İşlem (anlaşma) kaydı", required: deal, done: f.dealRecorded },
    { key: "final_price", label: "Gerçekleşen fiyat", required: deal, done: f.finalPriceRecorded },
    { key: "commission", label: "Komisyon kaydı", required: deal, done: f.commissionRecorded },
    { key: "closed_date", label: "İşlem tarihi", required: deal, done: f.closedDateRecorded },
    { key: "counterparty", label: "Alıcı / kiracı", required: deal, done: f.counterpartyRecorded },
    { key: "contract", label: "Sözleşme", required: deal, done: f.contractRecorded },
    { key: "collection", label: "Tahsilat", required: deal, done: f.collectionRecorded },
    { key: "documents", label: "Evrak kontrol listesi", required: deal, done: f.documentsComplete },
  ];
  const required = items.filter((i) => i.required);
  const missing = required.filter((i) => i.done === false).map((i) => i.label);
  const unmeasured = required.filter((i) => i.done === null).map((i) => i.label);
  const done = required.filter((i) => i.done === true).length;
  return {
    items,
    missing,
    unmeasured,
    complete: missing.length === 0 && unmeasured.length === 0,
    percent: required.length === 0 ? 100 : Math.round((done / required.length) * 100),
  };
}

/**
 * "Satıldı/Kiralandı" açıklaması seçilince CRM kapanış akışı ÖNERİLİR; otomatik durum değişikliği YAPILMAZ (insan onayı).
 */
export function suggestCrmClosure(reason: ReasonCode): { suggest: boolean; kind: "sold" | "rented" | null; label: string | null } {
  if (reason === "sold" || reason === "rented") {
    return { suggest: true, kind: reason, label: `Neden "${REASON_LABELS[reason]}" seçildi: CRM'de ${reason === "sold" ? "satış" : "kiralama"} işlemini kaydetmek ister misiniz?` };
  }
  return { suggest: false, kind: null, label: null };
}

/** Açıklama doğrulaması (UI ve action ortak): kodlu neden zorunlu, "diğer" için not zorunlu. */
export function validateExplanation(
  reason: string | null | undefined,
  note: string | null | undefined,
): { ok: true; reason: ReasonCode; note: string | null } | { ok: false; error: string } {
  const codes = Object.keys(REASON_LABELS) as ReasonCode[];
  if (!reason || !codes.includes(reason as ReasonCode)) return { ok: false, error: "Açıklama nedeni seçin." };
  const n = (note ?? "").trim();
  if (n.length > 500) return { ok: false, error: "Not en fazla 500 karakter olabilir." };
  if (reason === "other" && n.length < 3) return { ok: false, error: "\"Diğer\" nedeni için açıklama yazın." };
  return { ok: true, reason: reason as ReasonCode, note: n === "" ? null : n };
}
