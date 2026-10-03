import type { PillTone } from "@/components/ui/list-kit";

/** Sözleşme listesi saf yardımcıları (sayfadan ayrıldı: test edilebilir; zaman dışarıdan verilir). */

export const CONTRACT_TYPE_LABELS: Record<string, string> = {
  satis: "Satış",
  kira: "Kira",
  sozlesme: "Sözleşme",
  teklif: "Teklif",
  yer_gosterme: "Yer gösterme",
  kapora: "Kapora",
  diger: "Diğer",
};

export const CONTRACT_STATUS_LABELS: Record<string, string> = {
  draft: "Taslak",
  sent: "Gönderildi",
  signed: "İmzalandı",
  rejected: "Reddedildi",
  cancelled: "İptal",
};

export function contractStatusTone(status: string): PillTone {
  switch (status) {
    case "sent":
      return "info";
    case "signed":
      return "success";
    case "rejected":
      return "danger";
    default:
      return "neutral"; // draft, cancelled
  }
}

const DAY_MS = 86_400_000;

/** İptal/red edilmiş sözleşmede süre uyarısının anlamı yok. */
function expiryApplies(expiresAt: string | null, status: string): expiresAt is string {
  return Boolean(expiresAt) && status !== "cancelled" && status !== "rejected";
}

/** Süresi 30 gün içinde dolacak sözleşme için kalan gün; değilse null. */
export function renewalDays(expiresAt: string | null, status: string, nowMs: number): number | null {
  if (!expiryApplies(expiresAt, status)) return null;
  const days = Math.ceil((new Date(expiresAt).getTime() - nowMs) / DAY_MS);
  return days >= 0 && days <= 30 ? days : null;
}

/** Süresi geçmiş (iptal/red hariç). */
export function isExpired(expiresAt: string | null, status: string, nowMs: number): boolean {
  if (!expiryApplies(expiresAt, status)) return false;
  return new Date(expiresAt).getTime() < nowMs;
}

/** contract_type dağılımı; tanımsız tip ham değeriyle sayılır. */
export function countContractTypes(rows: ReadonlyArray<{ contract_type: string | null }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const key = (r.contract_type ?? "").trim();
    if (key) out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

/** İmza oranı: gönderilen + imzalananlar içinde imzalananlar; payda 0 ise null (uydurma yok). */
export function signRate(signed: number, sent: number): number | null {
  return signed + sent > 0 ? Math.round((signed / (signed + sent)) * 100) : null;
}
