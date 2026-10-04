import type { FeatureKey } from "@/lib/modules/registry";

/**
 * Modül kapatılırken uyarılacak "bekleyen iş" tanımları (saf veri; istemciden de import edilir).
 * Her satır, ilgili listenin AYNI süzgeçle açıldığı bağlantıya gider (sıfır çıkmaz kuralı).
 * Yalnız gerçek ve doğrulanmış durum değerleri yazılır; kapatma yine de serbesttir (veri silinmez).
 */
export type PendingDef = {
  id: string;
  module: FeatureKey;
  /** "{n} {label}" biçiminde okunur. */
  label: string;
  table: string;
  column: string;
  values: readonly string[];
  href: string;
};

export const PENDING_DEFS: readonly PendingDef[] = [
  { id: "campaign-scheduled", module: "campaigns", label: "zamanlanmış kampanya", table: "campaigns", column: "status", values: ["scheduled"], href: "/app/kampanyalar?durum=scheduled" },
  { id: "campaign-sending", module: "campaigns", label: "gönderilmekte olan kampanya", table: "campaigns", column: "status", values: ["sending"], href: "/app/kampanyalar?durum=sending" },
  { id: "contract-sent", module: "contracts", label: "imza bekleyen sözleşme", table: "contracts", column: "status", values: ["sent"], href: "/app/sozlesmeler?durum=sent" },
  { id: "approval-open", module: "approvals", label: "bekleyen onay", table: "approval_requests",column: "status", values: ["bekliyor"], href: "/app/onaylar" },
  { id: "offer-submitted", module: "offers", label: "yanıt bekleyen teklif", table: "offers", column: "status", values: ["submitted"], href: "/app/teklifler?durum=submitted" },
  { id: "offer-countered", module: "offers", label: "karşı teklif aşamasındaki teklif", table: "offers", column: "status", values: ["countered"], href: "/app/teklifler?durum=countered" },
  { id: "automation-active", module: "automation", label: "aktif otomasyon kuralı", table: "automations", column: "status", values: ["active"], href: "/app/otomasyonlar?durum=aktif" },
];

export type PendingItem = { id: string; label: string; count: number; href: string };

/** Sayılardan, yalnız 0'dan büyük olanları modül anahtarına göre gruplar (saf). */
export function groupPending(counts: ReadonlyMap<string, number>): Record<string, PendingItem[]> {
  const out: Record<string, PendingItem[]> = {};
  for (const def of PENDING_DEFS) {
    const count = counts.get(def.id) ?? 0;
    if (count <= 0) continue;
    (out[def.module] ??= []).push({ id: def.id, label: def.label, count, href: def.href });
  }
  return out;
}
