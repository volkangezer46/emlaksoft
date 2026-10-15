/**
 * Teklif koşulları (SP2) — SAF modül: form ayrıştırma, etiketler ve yan yana karşılaştırma rozetleri.
 * Sunucu eylemi, teklif formları, karşılaştırma sayfası ve malik portalı aynı kaynaktan okur.
 *
 * Rozetler yalnız OLGUSAL karşılaştırmadır (en yüksek tutar, en yüksek kapora, en erken tapu, kredi şartı yok);
 * uydurma "güç puanı" üretilmez.
 */

export const OFFER_PAYMENT_METHODS = [
  { value: "pesin", label: "Peşin" },
  { value: "kredi", label: "Konut kredisi" },
  { value: "takas", label: "Takas" },
  { value: "karma", label: "Karma (peşin + kredi/takas)" },
] as const;
export type OfferPaymentMethod = (typeof OFFER_PAYMENT_METHODS)[number]["value"];

export const OFFER_PAYMENT_LABELS: Record<OfferPaymentMethod, string> = Object.fromEntries(
  OFFER_PAYMENT_METHODS.map((m) => [m.value, m.label]),
) as Record<OfferPaymentMethod, string>;

export function isOfferPaymentMethod(v: unknown): v is OfferPaymentMethod {
  return typeof v === "string" && OFFER_PAYMENT_METHODS.some((m) => m.value === v);
}

export type OfferTerms = {
  payment_method: OfferPaymentMethod | null;
  deposit_amount: number | null;
  proposed_deed_date: string | null;
  credit_contingency: boolean;
  swap_note: string | null;
};

export const EMPTY_OFFER_TERMS: OfferTerms = {
  payment_method: null,
  deposit_amount: null,
  proposed_deed_date: null,
  credit_contingency: false,
  swap_note: null,
};

const SWAP_NOTE_MAX = 1000;
const MAX_AMOUNT = 100_000_000_000;

/** "1.250.000" / "1250000,50" / "1250000" → sayı; boş → null; geçersiz → NaN. */
function parseLooseMoney(raw: unknown): number | null {
  const t = String(raw ?? "").trim();
  if (!t) return null;
  const normalized = t.replace(/\s|₺|TL/gi, "");
  // Türkçe biçim: nokta binlik, virgül ondalık.
  const value = /,/.test(normalized)
    ? Number(normalized.replace(/\./g, "").replace(",", "."))
    : Number(normalized.replace(/\.(?=\d{3}(\.|$))/g, ""));
  return Number.isFinite(value) ? value : Number.NaN;
}

function isIsoDay(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/**
 * Formdaki koşul alanlarını ayrıştırır. Alanların hiçbiri formda yoksa `present: false` döner (eski form / alan
 * gönderilmedi): eylem bu durumda koşul sütunlarına hiç dokunmaz.
 */
export function parseOfferTerms(
  fd: FormData,
  opts: { offerAmount?: number | null; todayKey?: string } = {},
): { ok: true; present: boolean; value: OfferTerms } | { ok: false; error: string } {
  const keys = ["payment_method", "deposit_amount", "proposed_deed_date", "credit_contingency", "swap_note"];
  const present = keys.some((k) => fd.has(k));
  if (!present) return { ok: true, present: false, value: EMPTY_OFFER_TERMS };

  const methodRaw = String(fd.get("payment_method") ?? "").trim();
  if (methodRaw && !isOfferPaymentMethod(methodRaw)) return { ok: false, error: "Geçerli bir ödeme şekli seçin." };
  const payment_method = methodRaw ? (methodRaw as OfferPaymentMethod) : null;

  const deposit = parseLooseMoney(fd.get("deposit_amount"));
  if (deposit !== null && (Number.isNaN(deposit) || deposit < 0 || deposit > MAX_AMOUNT)) {
    return { ok: false, error: "Geçerli bir kapora tutarı girin." };
  }
  const deposit_amount = deposit === null ? null : Math.round(deposit * 100) / 100;
  if (deposit_amount !== null && opts.offerAmount != null && deposit_amount > opts.offerAmount) {
    return { ok: false, error: "Kapora, teklif tutarından büyük olamaz." };
  }

  const deedRaw = String(fd.get("proposed_deed_date") ?? "").trim();
  if (deedRaw && !isIsoDay(deedRaw)) return { ok: false, error: "Geçerli bir tapu tarihi girin." };
  if (deedRaw && opts.todayKey && deedRaw < opts.todayKey) return { ok: false, error: "Önerilen tapu tarihi geçmişte olamaz." };

  const creditRaw = String(fd.get("credit_contingency") ?? "").trim().toLowerCase();
  const credit_contingency = creditRaw === "on" || creditRaw === "true" || creditRaw === "1";

  const swap = String(fd.get("swap_note") ?? "").trim();
  if (swap.length > SWAP_NOTE_MAX) return { ok: false, error: `Takas açıklaması en fazla ${SWAP_NOTE_MAX} karakter olabilir.` };

  return {
    ok: true,
    present: true,
    value: {
      payment_method,
      deposit_amount: deposit_amount === 0 ? 0 : deposit_amount,
      proposed_deed_date: deedRaw || null,
      credit_contingency,
      swap_note: swap || null,
    },
  };
}

/** Satırdan güvenli okuma (sütunlar yoksa varsayılan). */
export function readOfferTerms(row: Record<string, unknown> | null | undefined): OfferTerms {
  if (!row) return EMPTY_OFFER_TERMS;
  const method = row.payment_method;
  const deposit = row.deposit_amount;
  return {
    payment_method: isOfferPaymentMethod(method) ? method : null,
    deposit_amount: deposit == null || deposit === "" ? null : Number(deposit),
    proposed_deed_date: typeof row.proposed_deed_date === "string" ? row.proposed_deed_date.slice(0, 10) : null,
    credit_contingency: row.credit_contingency === true,
    swap_note: typeof row.swap_note === "string" && row.swap_note.trim() ? row.swap_note : null,
  };
}

export function hasAnyOfferTerm(t: OfferTerms): boolean {
  return Boolean(t.payment_method || t.deposit_amount != null || t.proposed_deed_date || t.credit_contingency || t.swap_note);
}

export type ComparableOffer = {
  id: string;
  amount: number;
  status: string;
  valid_until: string | null;
  terms: OfferTerms;
};

export type OfferBadge = "highest_amount" | "highest_deposit" | "earliest_deed" | "no_credit_condition";

export const OFFER_BADGE_LABELS: Record<OfferBadge, string> = {
  highest_amount: "En yüksek tutar",
  highest_deposit: "En yüksek kapora",
  earliest_deed: "En erken tapu",
  no_credit_condition: "Kredi şartı yok",
};

/**
 * Yan yana karşılaştırma rozetleri. Bir rozet ancak en az iki teklif varken ve kazanan TEKSE verilir
 * (eşitlikte rozet yok; tek teklifte karşılaştırma anlamsız). "Kredi şartı yok": ödeme şekli belirtilmiş ve
 * kredi şartı işaretlenmemiş teklifler — yalnız diğerlerinden en az biri kredi şartlıysa.
 */
export function compareOfferBadges(offers: readonly ComparableOffer[]): Map<string, OfferBadge[]> {
  const out = new Map<string, OfferBadge[]>(offers.map((o) => [o.id, []]));
  if (offers.length < 2) return out;

  const uniqueMax = (values: { id: string; v: number | null }[], pickMin = false) => {
    const known = values.filter((x): x is { id: string; v: number } => x.v != null && Number.isFinite(x.v));
    if (known.length < 2) return null;
    const best = known.reduce((a, b) => (pickMin ? (b.v < a.v ? b : a) : b.v > a.v ? b : a));
    return known.filter((x) => x.v === best.v).length === 1 ? best.id : null;
  };

  const amountWinner = uniqueMax(offers.map((o) => ({ id: o.id, v: o.amount })));
  if (amountWinner) out.get(amountWinner)!.push("highest_amount");
  const depositWinner = uniqueMax(offers.map((o) => ({ id: o.id, v: o.terms.deposit_amount })));
  if (depositWinner) out.get(depositWinner)!.push("highest_deposit");
  const deedWinner = uniqueMax(
    offers.map((o) => ({ id: o.id, v: o.terms.proposed_deed_date ? Date.parse(`${o.terms.proposed_deed_date}T00:00:00Z`) : null })),
    true,
  );
  if (deedWinner) out.get(deedWinner)!.push("earliest_deed");

  const anyCredit = offers.some((o) => o.terms.credit_contingency);
  if (anyCredit) {
    for (const o of offers) {
      if (o.terms.payment_method && !o.terms.credit_contingency) out.get(o.id)!.push("no_credit_condition");
    }
  }
  return out;
}

/** İlan fiyatına göre yüzde (bir ondalık). */
export function pctOfList(amount: number, listPrice: number | null): number | null {
  if (!listPrice || listPrice <= 0) return null;
  return Math.round(((amount - listPrice) / listPrice) * 1000) / 10;
}
