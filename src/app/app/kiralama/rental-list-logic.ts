import type { PillTone } from "@/components/ui/list-kit";

/** Kiralama listesi saf yardımcıları (sayfadan ayrıldı: test edilebilir; tarihler dışarıdan YYYY-MM-DD verilir). */

export const DURUM_FILTERS = ["paid", "partial", "collected", "pending", "overdue"] as const;
export type DurumFilter = (typeof DURUM_FILTERS)[number];
export const DURUM_LABELS: Record<DurumFilter, string> = {
  paid: "Bu ay tam ödenen",
  partial: "Bu ay kısmi ödenen",
  collected: "Bu ay tahsilat yapılan",
  pending: "Bu ay bekleyen (kısmi dahil)",
  overdue: "Geciken",
};

/** Mülk sahibi / yönetim ücreti süzgeçleri (kartların hedefi): ödenecek bakiyesi olan, bu ay ücret geliri olan kiralar. */
export const SAHIP_FILTERS = ["odenecek"] as const;
export type SahipFilter = (typeof SAHIP_FILTERS)[number];
export const SAHIP_LABELS: Record<SahipFilter, string> = { odenecek: "Mülk sahibine ödenecek bakiyesi olan" };
export const YONETIM_FILTERS = ["ucret"] as const;
export type YonetimFilter = (typeof YONETIM_FILTERS)[number];
export const YONETIM_LABELS: Record<YonetimFilter, string> = { ucret: "Bu ay yönetim ücreti alınan" };

/** Sözleşme yaşam döngüsü evreleri — çipler listeyi ?evre= ile süzer. */
export const EVRELER = ["yeni", "devam", "yenileme", "bitiyor", "bitti"] as const;
export type Evre = (typeof EVRELER)[number];
export const EVRE_META: Record<Evre, { label: string; tone: PillTone }> = {
  yeni: { label: "Yeni (ilk 90 gün)", tone: "info" },
  devam: { label: "Devam eden", tone: "success" },
  yenileme: { label: "Yenileme penceresi", tone: "warning" },
  bitiyor: { label: "Bitmek üzere (30 gün)", tone: "danger" },
  bitti: { label: "Sona ermiş", tone: "neutral" },
};

/** `YYYY-MM` + vade günü → `YYYY-MM-DD` vade tarihi (string karşılaştırması yeterli). */
export function dueDateOf(month: string, dueDay: number): string {
  return `${month}-${String(dueDay).padStart(2, "0")}`;
}

export function nextMonthOf(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

/**
 * start_date'in bugünden sonraki ilk yıldönümü (`YYYY-MM-DD`).
 * İlk yıl dolmadan yıldönümü sayılmaz; 29 Şubat 28'e sabitlenir.
 */
export function nextAnniversaryOf(startDate: string, today: string): string | null {
  const mm = startDate.slice(5, 7);
  const dd = mm === "02" && startDate.slice(8, 10) === "29" ? "28" : startDate.slice(8, 10);
  const y = Number(today.slice(0, 4));
  let cand = `${y}-${mm}-${dd}`;
  if (cand < today) cand = `${y + 1}-${mm}-${dd}`;
  return cand > startDate ? cand : null;
}

export type EvreInput = { id: string; status: string; start_date: string; end_date: string | null };
export type EvreContext = { today: string; in30: string; yeni90: string; renewalIds: ReadonlySet<string> };

/** Her kayıt tek evreye düşer (öncelik sıralı). */
export function evreOf(r: EvreInput, ctx: EvreContext): Evre {
  if (r.status !== "active") return "bitti";
  if (r.end_date && r.end_date >= ctx.today && r.end_date <= ctx.in30) return "bitiyor";
  if (ctx.renewalIds.has(r.id)) return "yenileme";
  if (r.start_date >= ctx.yeni90) return "yeni";
  return "devam";
}

export type RentalFilterState = {
  evre: Evre | "";
  ariza: boolean;
  durum: DurumFilter | "";
  q: string;
  sahip?: SahipFilter | "";
  yonetim?: YonetimFilter | "";
};
export type RentalFilterContext = {
  evreOf: (r: EvreInput) => Evre;
  openMaintRentals: ReadonlySet<string>;
  overdueRentals: ReadonlySet<string>;
  curMonthStatus: (rentalId: string) => string | undefined;
  /** Ödenecek bakiyesi olan yönetilen kiralar (mülk sahibi kartı). */
  payableRentals?: ReadonlySet<string>;
  /** Bu ay yönetim ücreti alınan kiralar (yönetim ücreti kartı). */
  feeRentals?: ReadonlySet<string>;
};

/** Liste filtreleri (KPI kartlarının drill-down hedefleri + arama). `text` aranabilir metin (küçük harf). */
export function matchesRentalFilters(
  r: EvreInput & { text: string },
  f: RentalFilterState,
  ctx: RentalFilterContext,
): boolean {
  if (f.evre && ctx.evreOf(r) !== f.evre) return false;
  if (f.ariza && !ctx.openMaintRentals.has(r.id)) return false;
  if (f.durum === "overdue" && !ctx.overdueRentals.has(r.id)) return false;
  if (f.durum === "paid" && ctx.curMonthStatus(r.id) !== "paid") return false;
  if (f.durum === "partial" && ctx.curMonthStatus(r.id) !== "partial") return false;
  if (f.durum === "collected" && !["paid", "partial"].includes(ctx.curMonthStatus(r.id) ?? "")) return false;
  if (f.durum === "pending" && !["pending", "partial"].includes(ctx.curMonthStatus(r.id) ?? "")) return false;
  if (f.sahip === "odenecek" && !ctx.payableRentals?.has(r.id)) return false;
  if (f.yonetim === "ucret" && !ctx.feeRentals?.has(r.id)) return false;
  if (f.q && !r.text.includes(f.q.toLocaleLowerCase("tr-TR"))) return false;
  return true;
}
