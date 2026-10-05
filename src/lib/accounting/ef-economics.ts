/**
 * EmlakFiyati kontör GELİR / MALİYET hesabı (SAF: DB yok).
 * Toptan maliyet (kardeş firma tarifesi) `platform_settings` içinde `ef.wholesale` anahtarında tutulur:
 * { valuationTl, pdfTl } = işlem başına TL, KDV HARİÇ. Varsayılan 0/0 (EmlakFiyati kullanım tarifesi 0 TL).
 * Kontör kullanımı `ef_credit_reservations` (state='committed') kayıtlarından sayılır; rapor detayı (JSON)
 * çağrısının toptan maliyeti yoktur (kardeş firma tarifesinde ayrı kalem değil).
 */
import { z } from "zod";
import type { EfItem } from "@/lib/ef-credits/config";
import { inPeriod, type Period } from "@/lib/accounting/period";

export const EF_WHOLESALE_SETTING_KEY = "ef.wholesale";

export const efWholesaleSchema = z.object({
  /** Ada/parsel değerleme (arsa ve konut) işlem başı maliyet, TL, KDV hariç. */
  valuationTl: z.number().min(0).max(100_000),
  /** İlk PDF indirme işlem başı maliyet, TL, KDV hariç. */
  pdfTl: z.number().min(0).max(100_000),
});
export type EfWholesale = z.infer<typeof efWholesaleSchema>;

export const EF_WHOLESALE_DEFAULT: EfWholesale = { valuationTl: 0, pdfTl: 0 };

export function parseEfWholesale(raw: string | null | undefined): EfWholesale {
  if (!raw) return EF_WHOLESALE_DEFAULT;
  try {
    const parsed = efWholesaleSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : EF_WHOLESALE_DEFAULT;
  } catch {
    return EF_WHOLESALE_DEFAULT;
  }
}

export function serializeEfWholesale(v: EfWholesale): string {
  return JSON.stringify(efWholesaleSchema.parse(v));
}

/** "1.234,56" / "12.5" / "0" -> sayı (>=0, en çok 4 ondalık, üst sınırlı); geçersiz null. Sıfır GEÇERLİDİR. */
export function parseWholesaleTl(raw: string): number | null {
  let s = raw.trim().replace(/\s/g, "").replace(/₺|TRY|TL/gi, "");
  if (!s) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,4})?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n <= 100_000 ? n : null;
}

export const EF_USAGE_ITEMS: readonly EfItem[] = ["valuation_arsa", "valuation_konut", "pdf_first", "report_detail"];

export const EF_ITEM_LABELS: Record<EfItem, string> = {
  valuation_arsa: "Ada/parsel değerleme (arsa)",
  valuation_konut: "Ada/parsel değerleme (konut)",
  pdf_first: "İlk PDF indirme",
  report_detail: "Rapor detayı",
};

export type EfUsageRow = { item: string; units: number; tenantId?: string | null };
export type EfItemUsage = { item: EfItem; transactions: number; units: number; costKurus: number };

/** Kuruş cinsinden işlem başı maliyet. */
export function wholesaleUnitCostKurus(item: EfItem, w: EfWholesale): number {
  if (item === "valuation_arsa" || item === "valuation_konut") return Math.round(w.valuationTl * 100);
  if (item === "pdf_first") return Math.round(w.pdfTl * 100);
  return 0;
}

export type EfEconomics = {
  byItem: EfItemUsage[];
  transactions: number;
  units: number;
  costKurus: number;
  /** Dönemde satılan kontör paketlerinin net geliri (kuruş). */
  revenueNetKurus: number;
  /** Brüt marj = gelir − maliyet (kuruş). */
  marginKurus: number;
  /** Net gelir ÷ harcanan kontör (kuruş); harcama yoksa null. */
  revenuePerSpentUnitKurus: number | null;
};

/**
 * `usage`: kesinleşmiş rezervasyon satırları (item + units). Bilinmeyen item sayılmaz (sessiz kayıp olmasın diye
 * `unknownItems` ayrı döner). Maliyet = işlem sayısı × toptan tarife (kontör sayısı değil).
 */
export function computeEfEconomics(
  usage: readonly EfUsageRow[],
  wholesale: EfWholesale,
  revenueNetKurus: number,
): EfEconomics & { unknownItems: number } {
  const map = new Map<EfItem, EfItemUsage>(EF_USAGE_ITEMS.map((item) => [item, { item, transactions: 0, units: 0, costKurus: 0 }]));
  let unknownItems = 0;
  for (const row of usage) {
    const entry = map.get(row.item as EfItem);
    if (!entry) {
      unknownItems += 1;
      continue;
    }
    entry.transactions += 1;
    entry.units += Math.max(0, Math.trunc(Number(row.units) || 0));
    entry.costKurus += wholesaleUnitCostKurus(entry.item, wholesale);
  }
  const byItem = [...map.values()];
  const transactions = byItem.reduce((s, r) => s + r.transactions, 0);
  const units = byItem.reduce((s, r) => s + r.units, 0);
  const costKurus = byItem.reduce((s, r) => s + r.costKurus, 0);
  return {
    byItem,
    transactions,
    units,
    costKurus,
    revenueNetKurus,
    marginKurus: revenueNetKurus - costKurus,
    revenuePerSpentUnitKurus: units > 0 ? Math.round(revenueNetKurus / units) : null,
    unknownItems,
  };
}

// ---------------------------------------------------------------------------
// Kontör ekonomisi (admin /admin/ef-kontor): ofis bazlı kullanım, yükümlülük, hak dağılımı. Hepsi SAF.
// ---------------------------------------------------------------------------

/** İki toptan tarife de 0 ise maliyet BİLİNMİYOR demektir (varsayılan 0 gerçek maliyet değildir): arayüz açıkça uyarır. */
export function isWholesaleUnknown(w: EfWholesale): boolean {
  return w.valuationTl === 0 && w.pdfTl === 0;
}

export type EfOfficeUsage = { tenantId: string; transactions: number; units: number; costKurus: number };

/** Kesinleşmiş kullanımı ofise göre toplar. Ofis kimliği olmayan satırlar `untagged` sayılır (sessiz kayıp yok). Kontöre göre azalan. */
export function groupUsageByTenant(
  usage: readonly EfUsageRow[],
  wholesale: EfWholesale,
): { rows: EfOfficeUsage[]; untagged: number } {
  const map = new Map<string, EfOfficeUsage>();
  let untagged = 0;
  for (const row of usage) {
    if (!EF_USAGE_ITEMS.includes(row.item as EfItem)) continue;
    if (!row.tenantId) {
      untagged += 1;
      continue;
    }
    const e = map.get(row.tenantId) ?? { tenantId: row.tenantId, transactions: 0, units: 0, costKurus: 0 };
    e.transactions += 1;
    e.units += Math.max(0, Math.trunc(Number(row.units) || 0));
    e.costKurus += wholesaleUnitCostKurus(row.item as EfItem, wholesale);
    map.set(row.tenantId, e);
  }
  return { rows: [...map.values()].sort((a, b) => b.units - a.units || b.transactions - a.transactions), untagged };
}

export type EfLedgerEntry = { tenantId: string; amount: number; feature: string | null; createdAt: string };

/** Ofis başına defter bakiyesi = Σ tutar (grant +, spend −); açık rezervler düşülmez. */
export function ledgerBalanceByTenant(entries: readonly EfLedgerEntry[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of entries) m.set(e.tenantId, (m.get(e.tenantId) ?? 0) + Math.trunc(Number(e.amount) || 0));
  return m;
}

/** Kullanılmamış kontör toplamı: yalnız pozitif ofis bakiyeleri (eksi bakiye yükümlülük değildir). */
export function sumUnusedUnits(balances: ReadonlyMap<string, number>): { units: number; tenantCount: number } {
  let units = 0;
  let tenantCount = 0;
  for (const v of balances.values()) {
    if (v > 0) {
      units += v;
      tenantCount += 1;
    }
  }
  return { units, tenantCount };
}

export type EfPackSale = { units: number; netKurus: number };

/** Satılan paketlerin kontör başına AĞIRLIKLI ortalama net fiyatı (kuruş) = Σnet ÷ Σkontör; satış yoksa null. */
export function weightedAvgNetUnitPriceKurus(sales: readonly EfPackSale[]): number | null {
  let units = 0;
  let net = 0;
  for (const s of sales) {
    if (!(s.units > 0) || !(s.netKurus >= 0)) continue;
    units += s.units;
    net += s.netKurus;
  }
  return units > 0 ? Math.round(net / units) : null;
}

export type EfLiability = { unusedUnits: number; avgUnitPriceKurus: number | null; liabilityKurus: number | null };

/**
 * Kullanılmamış kontör yükümlülüğü = toplam kullanılmamış kontör × ağırlıklı ortalama net kontör fiyatı.
 * ÜST SINIR: ücretsiz verilen (hoş geldin, plan hakkı) kontör de çarpıma girer. Satış yoksa fiyat bilinmez: tutar null.
 */
export function computeEfLiability(unusedUnits: number, avgUnitPriceKurus: number | null): EfLiability {
  return {
    unusedUnits,
    avgUnitPriceKurus,
    liabilityKurus: avgUnitPriceKurus === null ? null : Math.round(unusedUnits * avgUnitPriceKurus),
  };
}

export const EF_GRANT_KIND_LABELS: Record<string, string> = {
  plan_monthly: "Plan aylık hakkı",
  bonus: "Hoş geldin / bonus",
  purchase: "Satın alınan paket",
  admin: "Elle yükleme (admin)",
  refund: "İade",
  other: "Diğer",
};

export type EfGrantBreakdownRow = { kind: string; label: string; units: number; count: number };

/** Defter `feature` değeri `ef_grant:<tür>`; bilinmeyen/boş "other". */
export function grantKindOfFeature(feature: string | null | undefined): string {
  const m = /^ef_grant:([a-z_]+)$/.exec(feature ?? "");
  return m && m[1] && m[1] in EF_GRANT_KIND_LABELS ? m[1] : "other";
}

/** Türe göre yükleme dağılımı (yalnız pozitif satırlar; dönem süzgeci çağıranda). Kontöre göre azalan. */
export function summarizeEfGrants(entries: readonly Pick<EfLedgerEntry, "amount" | "feature">[]): EfGrantBreakdownRow[] {
  const map = new Map<string, EfGrantBreakdownRow>();
  for (const e of entries) {
    const amount = Math.trunc(Number(e.amount) || 0);
    if (amount <= 0) continue;
    const kind = grantKindOfFeature(e.feature);
    const r = map.get(kind) ?? { kind, label: EF_GRANT_KIND_LABELS[kind] ?? kind, units: 0, count: 0 };
    r.units += amount;
    r.count += 1;
    map.set(kind, r);
  }
  return [...map.values()].sort((a, b) => b.units - a.units);
}

export type EfOfficeRow = {
  tenantId: string;
  transactions: number;
  units: number;
  costKurus: number;
  /** Defter bakiyesi (Σ yükleme − Σ harcama); ofis defterde yoksa 0. */
  balance: number;
};

export type EfEconomicsView = {
  econ: EfEconomics & { unknownItems: number };
  wholesaleUnknown: boolean;
  /** Dönemde ödenen (iade edilmemiş) paket faturalarının net geliri (kuruş) ve adedi. */
  packRevenueNetKurus: number;
  packCount: number;
  offices: EfOfficeRow[];
  untaggedUsage: number;
  liability: EfLiability;
  grants: EfGrantBreakdownRow[];
};

/**
 * Tüm bölümü SAF olarak kurar. `sales` tüm zamanların paket satışlarıdır: dönem geliri `paidAt` ile süzülür,
 * ağırlıklı ortalama fiyat ise tüm satışlardan hesaplanır (yükümlülük güncel durumdur, dönemden bağımsız).
 * Hak dağılımı yalnız dönemdeki yüklemeleri sayar.
 */
export function buildEfEconomicsView(input: {
  usage: readonly EfUsageRow[];
  ledger: readonly EfLedgerEntry[];
  sales: readonly (EfPackSale & { paidAt: string | null })[];
  wholesale: EfWholesale;
  period: Pick<Period, "fromIso" | "toIso">;
}): EfEconomicsView {
  const inSales = input.sales.filter((s) => inPeriod(s.paidAt, input.period) || (!input.period.fromIso && !input.period.toIso));
  const packRevenueNetKurus = inSales.reduce((a, s) => a + s.netKurus, 0);
  const econ = computeEfEconomics(input.usage, input.wholesale, packRevenueNetKurus);

  const balances = ledgerBalanceByTenant(input.ledger);
  const grouped = groupUsageByTenant(input.usage, input.wholesale);
  const byTenant = new Map<string, EfOfficeRow>();
  for (const u of grouped.rows) byTenant.set(u.tenantId, { ...u, balance: balances.get(u.tenantId) ?? 0 });
  for (const [tenantId, balance] of balances) {
    if (!byTenant.has(tenantId)) byTenant.set(tenantId, { tenantId, transactions: 0, units: 0, costKurus: 0, balance });
  }
  const offices = [...byTenant.values()].sort((a, b) => b.units - a.units || b.balance - a.balance);

  const unused = sumUnusedUnits(balances);
  const liability = computeEfLiability(unused.units, weightedAvgNetUnitPriceKurus(input.sales));
  const grants = summarizeEfGrants(input.ledger.filter((e) => inPeriod(e.createdAt, input.period) || (!input.period.fromIso && !input.period.toIso)));

  return {
    econ,
    wholesaleUnknown: isWholesaleUnknown(input.wholesale),
    packRevenueNetKurus,
    packCount: inSales.length,
    offices,
    untaggedUsage: grouped.untagged,
    liability,
    grants,
  };
}

/** Fatura satırından kontör paketi satışı (meta.units + net tutar). Paket değilse, geçersizse ya da iade edilmişse null. */
export function packSaleOfInvoice(row: { amount_try: unknown; meta?: unknown }): EfPackSale | null {
  const meta = row.meta && typeof row.meta === "object" && !Array.isArray(row.meta) ? (row.meta as Record<string, unknown>) : {};
  if (meta.kind !== "credit_pack" || meta.refund) return null;
  const units = Math.trunc(Number(meta.units));
  const net = Number(row.amount_try);
  if (!Number.isFinite(units) || units <= 0 || !Number.isFinite(net) || net < 0) return null;
  return { units, netKurus: Math.round(net * 100) };
}
