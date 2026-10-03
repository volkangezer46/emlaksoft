import { calculateCommission } from "@/lib/commission";

/**
 * "Kaçan komisyon" hesaplayıcısı — saf mantık.
 *
 * Tüm girdiler ziyaretçinin KENDİ sayılarıdır; sektör ortalaması/varsayılan
 * oran kullanılmaz. Komisyon aritmetiği `commission.ts` üzerinden gider.
 *
 * Model (arayüzde de yazılıdır):
 *   takipsiz talep      = aylık talep × takipsiz oranı
 *   kaçan satış         = takipsiz talep × mevcut dönüşüm oranı
 *   kaçan komisyon (ay) = kaçan satış × (satış bedeli × komisyon oranı), KDV hariç
 * Varsayım: takipsiz kalan talepler, takip edilseydi mevcut dönüşüm oranınızla
 * kapanırdı. Bu bir TAHMİNDİR.
 */

export type RoiRaw = {
  monthlyLeads: string;
  avgPrice: string;
  commissionRate: string;
  conversionRate: string;
  untrackedRate: string;
  advisors: string;
};

export type RoiPlanRef = { monthlyTry: number; seats: number };

export type RoiResult =
  | { status: "empty" }
  | { status: "invalid"; fields: (keyof RoiRaw)[] }
  | {
      status: "ok";
      untrackedLeads: number;
      missedDeals: number;
      commissionPerDeal: number;
      missedMonthly: number;
      missedYearly: number;
      planMonthly: number;
      /** Kaçan komisyon / paket bedeli (paket bedeli 0 ise null). */
      coverage: number | null;
      /** Paket bedelini karşılamak için gereken kapanış sayısı (aylık, kesirli). */
      breakEvenDeals: number | null;
      /** Aylık net etki: kaçan komisyon - paket bedeli. */
      netMonthly: number;
      seatsExceeded: boolean;
    };

/** "1.500.000" ve "3,5" biçimlerini okur; boş/geçersiz → null (NaN sızmaz). */
export function parseTrNumber(raw: string): number | null {
  const s = raw.trim().replace(/\s/g, "");
  if (!s) return null;
  const normalized = s.includes(",")
    ? s.replace(/\./g, "").replace(",", ".")
    : /^\d{1,3}(\.\d{3})+$/.test(s)
      ? s.replace(/\./g, "")
      : s;
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

const PERCENT_FIELDS: (keyof RoiRaw)[] = ["commissionRate", "conversionRate", "untrackedRate"];
const ALL_FIELDS: (keyof RoiRaw)[] = ["monthlyLeads", "avgPrice", "commissionRate", "conversionRate", "untrackedRate", "advisors"];

function safe(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function calculateRoi(raw: RoiRaw, plan: RoiPlanRef): RoiResult {
  if (ALL_FIELDS.every((f) => raw[f].trim() === "")) return { status: "empty" };

  const values = {} as Record<keyof RoiRaw, number | null>;
  const bad: (keyof RoiRaw)[] = [];
  for (const f of ALL_FIELDS) {
    const n = parseTrNumber(raw[f]);
    values[f] = n;
    if (n === null) {
      // Danışman sayısı yalnız paket kapsamı uyarısı içindir; boş olabilir.
      if (f !== "advisors" || raw.advisors.trim() !== "") bad.push(f);
    } else if (PERCENT_FIELDS.includes(f) && n > 100) bad.push(f);
  }
  if (bad.length > 0) return { status: "invalid", fields: bad };

  const leads = values.monthlyLeads!;
  const price = values.avgPrice!;
  const rate = values.commissionRate!;
  const conv = values.conversionRate!;
  const untracked = values.untrackedRate!;
  const advisors = values.advisors ?? 0;

  const untrackedLeads = safe(leads * (untracked / 100));
  const missedDeals = safe(untrackedLeads * (conv / 100));
  const commissionPerDeal = calculateCommission({ amount: price, rate, vatIncluded: false }).net;
  const missedMonthly = safe(missedDeals * commissionPerDeal);
  const planMonthly = safe(plan.monthlyTry);

  return {
    status: "ok",
    untrackedLeads,
    missedDeals,
    commissionPerDeal,
    missedMonthly,
    missedYearly: missedMonthly * 12,
    planMonthly,
    coverage: planMonthly > 0 ? missedMonthly / planMonthly : null,
    breakEvenDeals: planMonthly > 0 && commissionPerDeal > 0 ? planMonthly / commissionPerDeal : null,
    netMonthly: missedMonthly - planMonthly,
    seatsExceeded: advisors > plan.seats,
  };
}

const TRY = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 });
const NUM = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 });

export function formatTry(n: number): string {
  return TRY.format(Number.isFinite(n) ? n : 0);
}
export function formatNum(n: number): string {
  return NUM.format(Number.isFinite(n) ? n : 0);
}
