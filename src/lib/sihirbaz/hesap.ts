/**
 * Sihirbaz yan panelinin canlı hesapları — SAF. Aritmetik `lib/commission.ts`'ten gelir (KDV oranı, kuruş yuvarlama
 * orada); burada yalnız sihirbaz girdisinden (metin) önizleme kurulur. Kayıt değerini SUNUCU belirler:
 *   · Satış komisyonu (KDV hariç) = tutar × portföy oranı (`transition_deal_stage_atomic`), pay tutarı = komisyon × pay oranı
 *     (`updateCommissionSplits`).
 *   · Kira komisyonu = aylık kira × portföy oranı (`create_rental_atomic`; %100 = bir aylık kira).
 */
import { calculateCommission } from "@/lib/commission";
import { parseLooseNumber } from "@/lib/form-tabs";
import { moneyTextToNumber } from "@/lib/money-typing";

const kurus = (n: number) => Math.round(n * 100) / 100;

/** "2,5" / "%2,5" / "2.5" → 2.5; boş, negatif, 100'den büyük ya da 2'den çok ondalık → null. */
export function parsePercent(raw: string | null | undefined): number | null {
  const text = String(raw ?? "").replace("%", "").trim();
  if (!text) return null;
  const n = parseLooseNumber(text.includes(",") ? text : text.replace(".", ","));
  if (n == null || n <= 0 || n > 100) return null;
  if (Math.round(n * 100) / 100 !== n) return null;
  return n;
}

/** Para metni (MoneyInput biçimi "4.500.000" ya da "4500000,50") → sayı; boş/geçersiz → null. */
export function parseMoney(raw: string | null | undefined): number | null {
  const n = moneyTextToNumber(String(raw ?? ""));
  return n != null && Number.isFinite(n) && n > 0 ? n : null;
}

export type SplitInput = { label: string; rate: string };
export type SplitPreviewRow = { label: string; rate: number; amount: number };

export type SalePreview = {
  /** KDV hariç komisyon (komisyon kaydının `gross_amount`ı). */
  net: number;
  vat: number;
  /** Müşteriden tahsil edilecek (KDV dahil). */
  gross: number;
  rows: SplitPreviewRow[];
  totalRate: number;
  /** Paylaştırılmayan oran (ofiste kalır). */
  remainderRate: number;
  remainderAmount: number;
};

/** Satış komisyonu + paylaşım önizlemesi. Tutar ya da oran yoksa null (uydurma sayı gösterilmez). */
export function salePreview(price: number | null, ratePct: number | null, splits: readonly SplitInput[]): SalePreview | null {
  if (!price || price <= 0 || !ratePct) return null;
  const c = calculateCommission({ amount: price, rate: ratePct });
  const rows = splits
    .map((s) => ({ label: s.label.trim(), rate: Number(String(s.rate).replace(",", ".")) || 0 }))
    .filter((s) => s.label && s.rate > 0)
    .map((s) => ({ ...s, amount: kurus(c.net * (s.rate / 100)) }));
  const totalRate = kurus(rows.reduce((a, r) => a + r.rate, 0));
  const remainderRate = kurus(Math.max(0, 100 - totalRate));
  const remainderAmount = kurus(Math.max(0, c.net - rows.reduce((a, r) => a + r.amount, 0)));
  return { net: c.net, vat: c.vat, gross: c.gross, rows, totalRate, remainderRate, remainderAmount };
}

/** Paylaşım satırı sorunu (sunucu `updateCommissionSplits` ile aynı kural: en az bir satır, toplam ≤ %100). */
export function splitRowsError(splits: readonly SplitInput[]): string | null {
  const valid = splits.filter((s) => s.label.trim() && (Number(String(s.rate).replace(",", ".")) || 0) > 0);
  if (valid.length === 0) return "En az bir paylaşım satırı girin (taraf ve oran).";
  const total = kurus(valid.reduce((a, s) => a + (Number(String(s.rate).replace(",", ".")) || 0), 0));
  if (total > 100.01) return `Toplam oran %100'ü aşamaz (şu an %${String(total).replace(".", ",")}).`;
  return null;
}

/** Paylaşım satırlarını tek metin alanında taşır (taslak + değer nesnesi düz metin): "Danışman:50|Ofis:50". */
export function encodeSplits(rows: readonly SplitInput[]): string {
  return rows.map((r) => `${r.label.replace(/[|:]/g, " ").trim()}:${String(r.rate).trim()}`).join("|");
}

export function decodeSplits(raw: string | null | undefined): SplitInput[] {
  if (!raw) return [];
  return raw
    .split("|")
    .map((part) => {
      const i = part.lastIndexOf(":");
      return i < 0 ? { label: part, rate: "" } : { label: part.slice(0, i), rate: part.slice(i + 1) };
    })
    .filter((r) => r.label || r.rate);
}

/** Varsayılan paylaşım: danışman payı ofis tanımından (yoksa 50), kalan ofis. */
export function defaultSplits(advisorShare: number | null | undefined): SplitInput[] {
  const share = advisorShare != null && advisorShare >= 0 && advisorShare <= 100 ? advisorShare : 50;
  return [
    { label: "Danışman", rate: String(share) },
    { label: "Ofis", rate: String(kurus(100 - share)) },
  ];
}

export type MoveInInput = {
  rent: number | null;
  deposit: number | null;
  /** Aylık aidat (kiracı öder). */
  dues: number | null;
  /** Portföy komisyon oranı (kira: aylık kira × oran). */
  commissionRate: number | null;
  /** Hizmet bedelini kiracı mı öder (taşınma maliyetine girer)? */
  tenantPaysCommission: boolean;
};

export type MoveInTotals = {
  firstRent: number;
  deposit: number;
  dues: number;
  /** Hizmet bedeli KDV hariç (komisyon kaydı). */
  commissionNet: number;
  commissionVat: number;
  /** Kiracının ödediği hizmet bedeli (KDV dahil; kiracı ödemiyorsa 0). */
  commissionPaidByTenant: number;
  /** Taşınma günü kiracının toplam ödemesi: ilk kira + depozito + ilk aidat + (varsa) hizmet bedeli. */
  total: number;
  annualRent: number;
};

/** Kira başlangıcı toplam maliyeti. Kira yoksa null. */
export function moveInTotals(i: MoveInInput): MoveInTotals | null {
  if (!i.rent || i.rent <= 0) return null;
  const deposit = i.deposit && i.deposit > 0 ? i.deposit : 0;
  const dues = i.dues && i.dues > 0 ? i.dues : 0;
  const c = i.commissionRate ? calculateCommission({ amount: i.rent, rate: i.commissionRate }) : null;
  const commissionNet = c?.net ?? 0;
  const commissionVat = c?.vat ?? 0;
  const commissionPaidByTenant = i.tenantPaysCommission && c ? c.gross : 0;
  return {
    firstRent: i.rent,
    deposit,
    dues,
    commissionNet,
    commissionVat,
    commissionPaidByTenant,
    total: kurus(i.rent + deposit + dues + commissionPaidByTenant),
    annualRent: kurus(i.rent * 12),
  };
}

/** Kira artış kuralı (kayıt notuna yazılır; yenileme radarı TÜFE tavanını ayrıca hesaplar). */
export const INCREASE_RULES = [
  { value: "tufe", label: "Her yıl TÜFE (12 aylık ortalama, TBK 344 tavanı)" },
  { value: "sabit", label: "Her yıl sabit oran" },
  { value: "yok", label: "Artış kuralı yazılmasın" },
] as const;
export type IncreaseRule = (typeof INCREASE_RULES)[number]["value"];

/**
 * Kira koşulu satırları (kira kaydının notuna eklenir; ayrı sütun yok). Artış ve aidat bu sayede sözleşme dosyasında
 * kalır; yenileme radarı yasal tavanı her yıl resmi TÜFE'den ayrıca hesaplar.
 */
export function rentTermLines(i: { rule: string; fixedRate: string; dues: number | null; formatMoney: (n: number) => string }): string[] {
  const out: string[] = [];
  if (i.rule === "tufe") out.push("Artış kuralı: her kira yılında TÜFE 12 aylık ortalaması (konutta TBK 344 tavanı).");
  else if (i.rule === "sabit") {
    const r = parsePercent(i.fixedRate);
    if (r != null) out.push(`Artış kuralı: her kira yılında %${String(r).replace(".", ",")} (konutta TÜFE tavanını aşamaz).`);
  }
  if (i.dues && i.dues > 0) out.push(`Aidat: ${i.formatMoney(i.dues)} / ay, kiracı öder.`);
  return out;
}

/** Kira bitişi önerisi: başlangıçtan bir yıl sonrasının bir gün öncesi ("2026-11-01" → "2027-10-31"). Geçersiz → "". */
export function oneYearTermEnd(start: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(start.trim());
  if (!m) return "";
  const d = new Date(Date.UTC(Number(m[1]) + 1, Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime())) return "";
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
