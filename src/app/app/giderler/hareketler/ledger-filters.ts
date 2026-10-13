/**
 * Hareketler (defter v2) filtre sözleşmesi (SAF; DB/saat yok). URL -> filtre -> sunucu sorgu adımları tek yerde:
 * her URL filtresi `ledgerQueryOps` ile finance_ledger_v sorgusuna birebir yansır (filtre kontratı), arayüz aynı
 * anahtarlarla URL'i günceller. Test: ledger-filters.test.ts.
 */

export const LEDGER_PAGE_SIZE = 50;

/** URL'de filtre anahtarları (sekme/sayfa/görünüm hariç). Kayıtlı görünümler yalnız bunları saklar. */
export const LEDGER_FILTER_KEYS = ["hesap", "tur", "kategori", "cari", "kaynak", "mutabik", "belge", "from", "to", "q"] as const;
export type LedgerFilterKey = (typeof LEDGER_FILTER_KEYS)[number];

export type LedgerFilters = {
  accountId: string;
  tur: "" | "gelir" | "gider" | "transfer";
  kategori: string;
  cari: string;
  /** hareket = deftere işlenmiş (origin entry); eski = hesaba bağlanmamış eski gider (origin legacy_expense). */
  kaynak: "" | "hareket" | "eski";
  mutabikYok: boolean;
  belgeYok: boolean;
  from: string;
  to: string;
  q: string;
  page: number;
};

type Raw = Record<string, string | string[] | undefined | null>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const CATEGORY_RE = /^[a-z0-9_]{1,60}$/;

function one(raw: Raw, key: string): string {
  const v = raw[key];
  return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
}

/** URL parametrelerini doğrulanmış filtreye çevirir; geçersiz değer filtre DEĞİLDİR (sessizce yok sayılır). */
export function parseLedgerFilters(raw: Raw, opts: { canSalary: boolean }): LedgerFilters {
  const tur = one(raw, "tur");
  const kaynak = one(raw, "kaynak");
  const kategori = one(raw, "kategori");
  const from = one(raw, "from");
  const to = one(raw, "to");
  const page = Math.max(1, Number.parseInt(one(raw, "sayfa"), 10) || 1);
  return {
    accountId: UUID_RE.test(one(raw, "hesap")) ? one(raw, "hesap") : "",
    tur: tur === "gelir" || tur === "gider" || tur === "transfer" ? tur : "",
    kategori: CATEGORY_RE.test(kategori) && (opts.canSalary || kategori !== "maas") ? kategori : "",
    cari: UUID_RE.test(one(raw, "cari")) ? one(raw, "cari") : "",
    kaynak: kaynak === "hareket" || kaynak === "eski" ? kaynak : "",
    mutabikYok: one(raw, "mutabik") === "hayir",
    belgeYok: one(raw, "belge") === "yok",
    from: ISO_RE.test(from) ? from : "",
    to: ISO_RE.test(to) ? to : "",
    q: one(raw, "q").replace(/[,()%*_\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60),
    page,
  };
}

/** Filtrenin URL karşılığı (boşlar atılır). Kayıtlı görünüm ve "aynı görünüm mü" karşılaştırması bunu kullanır. */
export function ledgerFilterParams(f: LedgerFilters): Record<string, string> {
  const out: Record<string, string> = {};
  if (f.accountId) out.hesap = f.accountId;
  if (f.tur) out.tur = f.tur;
  if (f.kategori) out.kategori = f.kategori;
  if (f.cari) out.cari = f.cari;
  if (f.kaynak) out.kaynak = f.kaynak;
  if (f.mutabikYok) out.mutabik = "hayir";
  if (f.belgeYok) out.belge = "yok";
  if (f.from) out.from = f.from;
  if (f.to) out.to = f.to;
  if (f.q) out.q = f.q;
  return out;
}

export type QueryOp =
  | { op: "eq" | "neq"; col: string; val: string | number }
  | { op: "is"; col: string; val: null }
  | { op: "gte" | "lte"; col: string; val: string }
  | { op: "or"; val: string };

/**
 * finance_ledger_v sorgu adımları. İptal edilmiş satırlar hiçbir görünümde yoktur. Gelir/gider transferi kapsamaz;
 * "mutabık değil" yalnız deftere işlenmiş hareketlerde anlamlıdır (eski giderin hesabı yok).
 * `omitKaynak`: kaynak sayaçları (hareket / hesapsız) diğer filtreleri korur, kaynak süzgecini kendisi ekler.
 */
export function ledgerQueryOps(f: LedgerFilters, opts: { omitKaynak?: boolean } = {}): QueryOp[] {
  const ops: QueryOp[] = [{ op: "is", col: "voided_at", val: null }];
  if (f.accountId) ops.push({ op: "eq", col: "account_id", val: f.accountId });
  if (f.tur === "gelir") ops.push({ op: "eq", col: "direction", val: "in" }, { op: "neq", col: "kind", val: "transfer" });
  else if (f.tur === "gider") ops.push({ op: "eq", col: "direction", val: "out" }, { op: "neq", col: "kind", val: "transfer" });
  else if (f.tur === "transfer") ops.push({ op: "eq", col: "kind", val: "transfer" });
  if (f.kategori) ops.push({ op: "eq", col: "category", val: f.kategori });
  if (f.cari) ops.push({ op: "eq", col: "party_id", val: f.cari });
  if (!opts.omitKaynak) {
    if (f.kaynak === "hareket") ops.push({ op: "eq", col: "origin", val: "entry" });
    else if (f.kaynak === "eski") ops.push({ op: "eq", col: "origin", val: "legacy_expense" });
  }
  if (f.mutabikYok) ops.push({ op: "is", col: "reconciled_at", val: null }, { op: "eq", col: "origin", val: "entry" });
  if (f.belgeYok) ops.push({ op: "eq", col: "attachment_count", val: 0 });
  if (f.from) ops.push({ op: "gte", col: "entry_date", val: f.from });
  if (f.to) ops.push({ op: "lte", col: "entry_date", val: f.to });
  if (f.q) ops.push({ op: "or", val: `title.ilike.%${f.q}%,counterparty.ilike.%${f.q}%` });
  return ops;
}

// ---------------------------------------------------------------------------
// Dönem kilidi
// ---------------------------------------------------------------------------

const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

/** "YYYY-MM-DD" -> "YYYY-MM". */
export const monthKeyOf = (isoDate: string): string => isoDate.slice(0, 7);

/** Kilitli ayın kullanıcıya görünen nedeni; kilitli değilse null. */
export function lockReasonFor(entryDate: string, lockedMonths: ReadonlySet<string>): string | null {
  const key = monthKeyOf(entryDate);
  if (!lockedMonths.has(key)) return null;
  const month = MONTHS[Number(key.slice(5, 7)) - 1] ?? key;
  return `${month} ${key.slice(0, 4)} dönemi kapatıldı; bu aydaki kayıtlar düzenlenemez. Kilidi Diğer > Ayarlar > Dönem kapanışı'ndan açabilirsiniz.`;
}
