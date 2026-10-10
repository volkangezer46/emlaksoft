import { z } from "zod";
import { EF_GRANT_KINDS, type EfBalance } from "@/lib/ef-credits/config";

/**
 * Kontör defteri GÖRÜNÜM mantığı (SAF; istemci/sunucu güvenli). Cüzdan SQL'i ayrı ajanda yazıldığından
 * satır okuyucusu sütun adlarında HOŞGÖRÜLÜDÜR (kind/entry_type, units/amount, item/feature, created_at/available_at).
 * Kişisel veri alanı (meta, ref) HİÇ okunmaz.
 */

export const EF_HISTORY_PAGE_SIZE = 20;

export type EfMovementCategory = "degerleme" | "pdf" | "satin-alma" | "iade" | "sona-erme" | "diger";

export type EfMovement = {
  id: string;
  at: string | null;
  category: EfMovementCategory;
  label: string;
  /** Kontör (artı = yükleme/iade, eksi = harcama). */
  units: number;
  userId: string | null;
  balanceAfter: number | null;
};

export const EF_CATEGORY_LABEL: Record<EfMovementCategory, string> = {
  degerleme: "Değerleme",
  pdf: "PDF rapor",
  "satin-alma": "Satın alma / yükleme",
  iade: "İade",
  "sona-erme": "Süresi dolan",
  diger: "Diğer",
};

export function parseEfBalance(data: unknown): EfBalance | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const r = data as Record<string, unknown>;
  const s = z.object({
    available: z.coerce.number(),
    reserved: z.coerce.number(),
    granted_total: z.coerce.number(),
    committed_total: z.coerce.number(),
    // Süreli parti şeması (20261010000300) sonrası gelir; eski şemada yok.
    expired_total: z.coerce.number().optional(),
    next_expiry_at: z.string().nullable().optional(),
    next_expiry_units: z.coerce.number().optional(),
  }).safeParse(r);
  return s.success ? s.data : null;
}

const GRANT_LABEL: Record<string, string> = {
  purchase: "Paket satın alma",
  plan_monthly: "Plan kontörü",
  bonus: "Bonus",
  admin: "Yönetici yüklemesi",
};

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** Ham defter satırını görünür harekete çevirir; ofise gösterilmeyecek (rezerve/serbest bırakma) satırlar için null. */
export function normalizeLedgerRow(raw: Record<string, unknown>): EfMovement | null {
  const kindRaw = (str(raw.kind) ?? str(raw.entry_type) ?? str(raw.type) ?? "").toLowerCase();
  const grantKind = kindRaw.startsWith("grant_") ? kindRaw.slice(6) : kindRaw;
  const amount = Number(raw.units ?? raw.amount ?? 0);
  if (!Number.isFinite(amount) || amount === 0) return null;
  const item = (str(raw.item) ?? str(raw.feature) ?? "").toLowerCase();
  const base = {
    id: String(raw.id ?? `${kindRaw}-${String(raw.created_at ?? raw.available_at ?? "")}-${amount}`),
    at: str(raw.created_at) ?? str(raw.available_at),
    userId: str(raw.user_id) ?? str(raw.created_by),
    balanceAfter: raw.balance_after == null || !Number.isFinite(Number(raw.balance_after)) ? null : Number(raw.balance_after),
  };
  if ((EF_GRANT_KINDS as readonly string[]).includes(grantKind) && grantKind !== "refund") {
    return { ...base, category: "satin-alma", label: GRANT_LABEL[grantKind] ?? "Yükleme", units: Math.abs(amount) };
  }
  if (grantKind === "refund") {
    return { ...base, category: "iade", label: "İade", units: Math.abs(amount) };
  }
  if (kindRaw === "commit" || kindRaw === "spend") {
    // Süre dolumu (yanma): kullanım değil. Yeni (ef_expire_lot, source expire) ve eski devir tavanı (ef_expire_plan) satırları.
    if (str(raw.source) === "expire" || item.startsWith("ef_expire")) {
      return { ...base, category: "sona-erme", label: "Süresi doldu (yandı)", units: -Math.abs(amount) };
    }
    if (item.startsWith("valuation")) return { ...base, category: "degerleme", label: "Değerleme", units: -Math.abs(amount) };
    if (item.startsWith("pdf")) return { ...base, category: "pdf", label: "PDF rapor", units: -Math.abs(amount) };
    return { ...base, category: "diger", label: "Kullanım", units: -Math.abs(amount) };
  }
  return null; // reserve / release: ofis geçmişinde gösterilmez
}

export function categoryOf(raw: string | null | undefined): EfMovementCategory | null {
  return raw && raw in EF_CATEGORY_LABEL ? (raw as EfMovementCategory) : null;
}

/** Süzgeç + sayfalama (URL kontratı: kalem, kullanici, sayfa). Sayfa sınırlara kıstırılır. */
export function filterAndPage(
  rows: EfMovement[],
  opts: { category?: EfMovementCategory | null; userId?: string | null; page?: number; pageSize?: number },
): { rows: EfMovement[]; total: number; page: number; pages: number } {
  const size = opts.pageSize ?? EF_HISTORY_PAGE_SIZE;
  const filtered = rows.filter(
    (r) => (!opts.category || r.category === opts.category) && (!opts.userId || r.userId === opts.userId),
  );
  const pages = Math.max(1, Math.ceil(filtered.length / size));
  const page = Math.min(pages, Math.max(1, Math.floor(opts.page ?? 1) || 1));
  return { rows: filtered.slice((page - 1) * size, page * size), total: filtered.length, page, pages };
}
