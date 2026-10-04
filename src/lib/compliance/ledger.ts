/**
 * Yasal kayıt defteri (F1) — saf, yan etkisiz yardımcılar (sunucu + istemci ortak).
 *
 * HUKUKİ UYARI: Eşikler ve saklama süresi OFİS AYARIDIR; mevzuattaki bir eşik/süre değildir.
 * Mevzuata uygunluk ofisin ve hukuk/mali müşavirinin sorumluluğundadır. Sistem hiçbir kuruma
 * bildirim GÖNDERMEZ.
 * Kayıt değiştirilemez: düzeltme, `correction` türünde YENİ kayıttır.
 * TC kimlik no saklanmaz; yalnız "kimlik görüldü" bayrağı vardır.
 */

export const LEDGER_TX_TYPES = ["sale", "rental", "deposit", "commission", "service_fee", "other"] as const;
export type LedgerTxType = (typeof LEDGER_TX_TYPES)[number];
export const LEDGER_TX_LABELS: Record<LedgerTxType, string> = {
  sale: "Satış",
  rental: "Kiralama",
  deposit: "Kapora / depozito",
  commission: "Komisyon",
  service_fee: "Hizmet bedeli",
  other: "Diğer",
};

export const LEDGER_PARTY_ROLES = ["buyer", "seller", "tenant", "landlord", "other"] as const;
export type LedgerPartyRole = (typeof LEDGER_PARTY_ROLES)[number];
export const LEDGER_PARTY_LABELS: Record<LedgerPartyRole, string> = {
  buyer: "Alıcı",
  seller: "Satıcı",
  tenant: "Kiracı",
  landlord: "Ev sahibi",
  other: "Diğer",
};

export const LEDGER_METHODS = ["bank_transfer", "cash", "card", "cheque", "other"] as const;
export type LedgerMethod = (typeof LEDGER_METHODS)[number];
export const LEDGER_METHOD_LABELS: Record<LedgerMethod, string> = {
  bank_transfer: "Banka havalesi / EFT",
  cash: "Nakit",
  card: "Kart",
  cheque: "Çek / senet",
  other: "Diğer",
};

export const LEDGER_FLAGS = ["cash_over_threshold", "amount_over_threshold", "identity_not_checked"] as const;
export type LedgerFlag = (typeof LEDGER_FLAGS)[number];
export const LEDGER_FLAG_LABELS: Record<LedgerFlag, string> = {
  cash_over_threshold: "Nakit tutar ofis eşiğinin üzerinde",
  amount_over_threshold: "Tutar ofis eşiğinin üzerinde",
  identity_not_checked: "Kimlik görüldü işaretlenmemiş",
};

export type LedgerThresholds = {
  cashThresholdTry: number;
  amountThresholdTry: number;
  retentionYears: number;
};

/** Makul başlangıç değerleri: mevzuat eşiği DEĞİLDİR, ofis değiştirir. */
export const DEFAULT_LEDGER_THRESHOLDS: LedgerThresholds = {
  cashThresholdTry: 100_000,
  amountThresholdTry: 1_000_000,
  retentionYears: 5,
};

export const LEDGER_DISCLAIMER =
  "Bu ekran hukuki danışmanlık değildir. Eşikler ve saklama süresi ofis ayarıdır, mevzuattaki değerler değildir; güncel yükümlülükleri hukukçunuz veya mali müşavirinizle doğrulayın. Sistem hiçbir kuruma bildirim göndermez.";

export function isTxType(v: unknown): v is LedgerTxType {
  return typeof v === "string" && (LEDGER_TX_TYPES as readonly string[]).includes(v);
}
export function isPartyRole(v: unknown): v is LedgerPartyRole {
  return typeof v === "string" && (LEDGER_PARTY_ROLES as readonly string[]).includes(v);
}
export function isMethod(v: unknown): v is LedgerMethod {
  return typeof v === "string" && (LEDGER_METHODS as readonly string[]).includes(v);
}
export function isLedgerFlag(v: unknown): v is LedgerFlag {
  return typeof v === "string" && (LEDGER_FLAGS as readonly string[]).includes(v);
}

/** "1.250.000,50" / "1250000.5" / "1250000" → sayı; geçersiz veya negatifse null. */
export function parseAmountTry(raw: unknown): number | null {
  const s = typeof raw === "string" ? raw.trim().replace(/\s/g, "").replace(/₺|TL/gi, "") : "";
  if (!s) return null;
  let normalized = s;
  if (s.includes(",")) normalized = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) normalized = s.replace(/\./g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const n = Number(normalized);
  return Number.isFinite(n) && n >= 0 && n <= 99_999_999_999 ? n : null;
}

/** Esik ayari: boş → varsayılan; negatif/geçersiz → null. */
export function parseThreshold(raw: unknown, fallback: number): number | null {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) return fallback;
  return parseAmountTry(s);
}

export function parseRetentionYears(raw: unknown): number | null {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) return DEFAULT_LEDGER_THRESHOLDS.retentionYears;
  if (!/^\d{1,2}$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 && n <= 30 ? n : null;
}

/** Kayıt işaretleri: yalnız ofis eşiklerine göre hesaplanır; "şüpheli" hükmü VERMEZ. */
export function computeLedgerFlags(
  input: { amountTry: number; method: LedgerMethod; identityChecked: boolean },
  thresholds: LedgerThresholds,
): LedgerFlag[] {
  const flags: LedgerFlag[] = [];
  if (input.method === "cash" && thresholds.cashThresholdTry > 0 && input.amountTry >= thresholds.cashThresholdTry) {
    flags.push("cash_over_threshold");
  }
  if (thresholds.amountThresholdTry > 0 && input.amountTry >= thresholds.amountThresholdTry) {
    flags.push("amount_over_threshold");
  }
  if (!input.identityChecked) flags.push("identity_not_checked");
  return flags;
}

/** Eşik üstü işaretler (kimlik eksikliği hariç): "işaretli işlem" sayacı bunlara bakar. */
export function isThresholdFlagged(flags: readonly string[]): boolean {
  return flags.includes("cash_over_threshold") || flags.includes("amount_over_threshold");
}

/** İşlem tarihine saklama yılı ekler (YYYY-MM-DD). 29 Şubat → 28 Şubat. */
export function computeRetainUntil(transactionDate: string, years: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(transactionDate);
  if (!m) return null;
  const y = Number(m[1]) + years;
  const mo = Number(m[2]);
  let d = Number(m[3]);
  if (mo === 2 && d === 29 && !(y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0))) d = 28;
  return `${String(y).padStart(4, "0")}-${m[2]}-${String(d).padStart(2, "0")}`;
}

export function isValidIsoDate(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export type LedgerEntryInput = {
  kind: "entry" | "correction";
  correctsEntryId: string | null;
  transactionType: LedgerTxType;
  transactionDate: string;
  partyName: string;
  partyRole: LedgerPartyRole;
  counterpartyName: string | null;
  identityChecked: boolean;
  amountTry: number;
  method: LedgerMethod;
  note: string | null;
  customerId: string | null;
  propertyId: string | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clean = (v: FormDataEntryValue | null, max: number) =>
  String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/**
 * Form verisini doğrular. Gelecek tarihli işlem `todayIso` ile reddedilmez (planlı kapora olabilir);
 * yalnız biçim denetlenir. TC kimlik no benzeri 11 haneli sayı ad/not alanlarına YAZILAMAZ.
 */
export function parseLedgerForm(
  fd: FormData,
): { ok: true; value: LedgerEntryInput } | { ok: false; error: string } {
  const correctsRaw = clean(fd.get("corrects_entry_id"), 40);
  const kind = correctsRaw ? "correction" : "entry";
  if (correctsRaw && !UUID_RE.test(correctsRaw)) return { ok: false, error: "Düzeltilecek kayıt geçersiz." };

  const type = clean(fd.get("transaction_type"), 30);
  if (!isTxType(type)) return { ok: false, error: "İşlem türünü seçin." };
  const date = clean(fd.get("transaction_date"), 10);
  if (!isValidIsoDate(date)) return { ok: false, error: "İşlem tarihini seçin." };
  const partyName = clean(fd.get("party_name"), 160);
  if (!partyName) return { ok: false, error: "Taraf adını yazın." };
  const role = clean(fd.get("party_role"), 20);
  if (!isPartyRole(role)) return { ok: false, error: "Tarafın rolünü seçin." };
  const amount = parseAmountTry(String(fd.get("amount_try") ?? ""));
  if (amount === null) return { ok: false, error: "Tutarı geçerli bir sayı olarak yazın." };
  const method = clean(fd.get("payment_method"), 20);
  if (!isMethod(method)) return { ok: false, error: "Ödeme yöntemini seçin." };

  const counterparty = clean(fd.get("counterparty_name"), 160) || null;
  const note = String(fd.get("note") ?? "").trim().slice(0, 1000) || null;
  for (const text of [partyName, counterparty ?? "", note ?? ""]) {
    if (/\d{11}/.test(text.replace(/[\s.-]/g, ""))) {
      return { ok: false, error: "Kimlik numarası bu deftere yazılmaz; yalnız 'kimlik görüldü' işaretlenir." };
    }
  }
  const customerId = clean(fd.get("customer_id"), 40);
  if (customerId && !UUID_RE.test(customerId)) return { ok: false, error: "Müşteri geçersiz." };
  const propertyId = clean(fd.get("property_id"), 40);
  if (propertyId && !UUID_RE.test(propertyId)) return { ok: false, error: "Portföy geçersiz." };

  return {
    ok: true,
    value: {
      kind,
      correctsEntryId: correctsRaw || null,
      transactionType: type,
      transactionDate: date,
      partyName,
      partyRole: role,
      counterpartyName: counterparty,
      identityChecked: fd.get("identity_checked") === "on" || fd.get("identity_checked") === "true",
      amountTry: amount,
      method,
      note,
      customerId: customerId || null,
      propertyId: propertyId || null,
    },
  };
}

export type LedgerFilters = {
  /** isaretli: eşik üstü · kimliksiz · nakit · suredoldu: saklama bitişi geçmiş */
  filtre: "" | "isaretli" | "kimliksiz" | "nakit" | "suredoldu";
  tur: LedgerTxType | "";
  sayfa: number;
};
export const LEDGER_PAGE_SIZE = 25;

export function parseLedgerFilters(sp: { filtre?: string; tur?: string; sayfa?: string }): LedgerFilters {
  const filtre =
    sp.filtre === "isaretli" || sp.filtre === "kimliksiz" || sp.filtre === "nakit" || sp.filtre === "suredoldu"
      ? sp.filtre
      : "";
  const tur = isTxType(sp.tur) ? sp.tur : "";
  const n = Number(sp.sayfa);
  return { filtre, tur, sayfa: Number.isInteger(n) && n >= 1 && n <= 10_000 ? n : 1 };
}

export type LedgerCsvRow = {
  created_at: string;
  transaction_date: string;
  kind: string;
  transaction_type: string;
  party_name: string;
  party_role: string;
  counterparty_name: string | null;
  identity_checked: boolean;
  amount_try: number | string;
  payment_method: string;
  flags: string[] | null;
  retain_until: string;
  corrects_entry_id: string | null;
  note: string | null;
  creator: string | null;
};

/** CSV satırlarını Türkçe etiketli kolonlara çevirir (hücre kaçışı toCsv'de). */
export function mapLedgerCsvRow(r: LedgerCsvRow): Record<string, unknown> {
  return {
    "Kayıt zamanı": r.created_at,
    "İşlem tarihi": r.transaction_date,
    "Kayıt türü": r.kind === "correction" ? "Düzeltme" : "Kayıt",
    "Düzeltilen kayıt": r.corrects_entry_id ?? "",
    "İşlem türü": LEDGER_TX_LABELS[r.transaction_type as LedgerTxType] ?? r.transaction_type,
    Taraf: r.party_name,
    "Taraf rolü": LEDGER_PARTY_LABELS[r.party_role as LedgerPartyRole] ?? r.party_role,
    "Karşı taraf": r.counterparty_name ?? "",
    "Kimlik görüldü": r.identity_checked ? "Evet" : "Hayır",
    "Tutar (TL)": r.amount_try,
    "Ödeme yöntemi": LEDGER_METHOD_LABELS[r.payment_method as LedgerMethod] ?? r.payment_method,
    İşaretler: (r.flags ?? []).map((f) => LEDGER_FLAG_LABELS[f as LedgerFlag] ?? f).join("; "),
    "Saklama bitişi (ofis ayarı)": r.retain_until,
    Not: r.note ?? "",
    Kaydeden: r.creator ?? "",
  };
}
