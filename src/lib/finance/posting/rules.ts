/**
 * Kayıt kuralları (SAF): `public.finance_posting_rules` tablosunun BİREBİR aynası (20261017010000_finance_posting_core.sql).
 * Tasarım: docs/design/FINANS_ENTEGRASYON_2026-10.md "Kayıt kuralları". pglite testi tabloyu bu sabitle satır satır eşler;
 * birini değiştiren diğerini de değiştirir.
 *
 * Değişmez: her operasyonel olayın `posting_key` ile tanımlı tam olarak bir açık kalemi ve/veya nakit kaydı vardır.
 * Kural: tetikleyici yalnız tahakkuk (açık kalem), RPC yalnız nakit.
 */

export const POSTING_EVENT_TYPES = [
  "commission.accrued",
  "commission.split_accrued",
  "commission.collected",
  "payout.paid",
  "payout.approved",
  "payout.personal",
  "rent.accrued",
  "rent.collected",
  "owner.paid",
  "deposit.received",
  "deposit.returned",
  "building.charged",
  "building.collected",
  "dues.accrued",
  "dues.settled",
  "invoice.issued",
  "invoice.received",
  "expense.paid",
  "transfer",
  "subscription.invoiced",
] as const;
export type PostingEventType = (typeof POSTING_EVENT_TYPES)[number];

/** none: bu olay o tarafı yazmaz; required: olay onu taşımak zorunda; optional: taşıyabilir. */
export type PostingMode = "none" | "required" | "optional";
export type ItemDirection = "receivable" | "payable" | "either";
export type CashDirection = "in" | "out" | "either" | "transfer";
/** K/Z etkisi: memo = yalnız görünüm (kayıt yok); conditional = ofis üstleniyorsa gider; none = K/Z'ye girmez (kapama). */
export type PnlTreatment = "income" | "expense" | "excluded" | "memo" | "conditional" | "none";
export type PermissionModule = "commissions" | "rentals" | "expenses";
export type PermissionAction = "view" | "create" | "edit" | "delete";

export type PostingRule = {
  eventType: PostingEventType;
  label: string;
  keyPrefix: string;
  sourceType: string;
  sourceRequired: boolean;
  itemMode: PostingMode;
  itemDirection: ItemDirection | null;
  itemCategory: string | null;
  cashMode: PostingMode;
  cashDirection: CashDirection | null;
  cashCategory: string | null;
  accountScope: "office" | "user";
  pnl: PnlTreatment;
  permModule: PermissionModule;
  permAction: PermissionAction;
  ownerGmOnly: boolean;
  tdhp: string;
};

type Row = [
  PostingEventType, string, string, string, boolean,
  PostingMode, ItemDirection | null, string | null,
  PostingMode, CashDirection | null, string | null,
  "office" | "user", PnlTreatment, PermissionModule, PermissionAction, boolean, string,
];

// Sıra ve değerler SQL INSERT ile aynı.
const ROWS: readonly Row[] = [
  ["commission.accrued", "Komisyon alacağı", "commission", "commission", true, "required", "receivable", "komisyon",
    "none", null, null, "office", "income", "commissions", "edit", false, "120 / 600 + 391"],
  ["commission.split_accrued", "Danışman hakedişi", "split", "commission_split", true, "required", "payable", "danisman_hakedis",
    "none", null, null, "office", "expense", "commissions", "edit", false, "740/770 / 335/320"],
  ["commission.collected", "Komisyon tahsilatı", "commission", "commission", true, "none", null, null,
    "required", "in", "komisyon", "office", "none", "commissions", "edit", false, "102 / 120"],
  ["payout.paid", "Hakediş ödemesi", "payout", "commission_payout", true, "optional", "payable", "stopaj",
    "required", "out", "danisman_hakedis", "office", "none", "commissions", "edit", true, "335 / 102, 360"],
  ["payout.approved", "Hakediş tahakkuku", "payout", "commission_payout", true, "required", "payable", "danisman_hakedis",
    "none", null, null, "office", "expense", "commissions", "edit", true, "740/770 / 335"],
  ["payout.personal", "Hakediş (Kasam)", "payout", "commission_payout", true, "none", null, null,
    "required", "in", "danisman_hakedis", "user", "excluded", "commissions", "view", false, "-"],
  ["rent.accrued", "Kira tahakkuku", "rent_charge", "rent_charge", true, "none", null, null,
    "none", null, null, "office", "memo", "rentals", "view", false, "memo"],
  ["rent.collected", "Kira tahsilatı", "rent", "rent", true, "optional", "payable", "mulk_sahibi_odeme",
    "required", "in", "kira_tahsilat", "office", "excluded", "rentals", "edit", false, "102/336, 336/600"],
  ["owner.paid", "Mülk sahibi ödemesi", "owner_payout", "owner_payout", true, "none", null, null,
    "required", "out", "mulk_sahibi_odeme", "office", "excluded", "rentals", "edit", false, "336 / 102"],
  ["deposit.received", "Depozito alındı", "deposit", "deposit", true, "required", "payable", "depozito",
    "required", "in", "depozito", "office", "excluded", "rentals", "edit", false, "102 / 336"],
  ["deposit.returned", "Depozito iadesi", "deposit", "deposit", true, "none", null, null,
    "required", "out", "depozito", "office", "excluded", "rentals", "edit", false, "102 / 336"],
  ["building.charged", "Bina aidatı tahakkuku", "building_charge", "building_charge", true, "required", "receivable", "aidat_tahsilat",
    "none", null, null, "office", "excluded", "expenses", "edit", false, "102 / 336"],
  ["building.collected", "Bina aidatı tahsilatı", "building", "building", true, "none", null, null,
    "required", "in", "aidat_tahsilat", "office", "excluded", "expenses", "edit", false, "102 / 336"],
  ["dues.accrued", "Aidat borcu/alacağı", "due", "due", true, "required", "either", "aidat",
    "none", null, null, "office", "conditional", "expenses", "create", false, "770"],
  ["dues.settled", "Aidat ödemesi", "due", "due", true, "none", null, null,
    "required", "either", "aidat", "office", "none", "expenses", "create", false, "770"],
  ["invoice.issued", "Kesilen fatura", "einvoice", "invoice", true, "optional", "receivable", null,
    "none", null, null, "office", "income", "expenses", "create", false, "120/600/391"],
  ["invoice.received", "Gelen fatura", "invoice_in", "invoice", false, "required", "payable", null,
    "optional", "out", null, "office", "expense", "expenses", "create", false, "770 / 320 + 191"],
  ["expense.paid", "Gider ödemesi", "expense", "manual", false, "none", null, null,
    "required", "out", null, "office", "expense", "expenses", "create", false, "770 / 100-102"],
  ["transfer", "Hesaplar arası transfer", "transfer", "manual", false, "none", null, null,
    "required", "transfer", "transfer", "office", "excluded", "expenses", "create", false, "102 / 100"],
  ["subscription.invoiced", "Abonelik faturası", "subscription", "subscription", true, "required", "payable", "yazilim",
    "none", null, null, "office", "expense", "expenses", "create", false, "770 / 320"],
];

export const POSTING_RULES: readonly PostingRule[] = ROWS.map(
  ([eventType, label, keyPrefix, sourceType, sourceRequired, itemMode, itemDirection, itemCategory,
    cashMode, cashDirection, cashCategory, accountScope, pnl, permModule, permAction, ownerGmOnly, tdhp]) => ({
    eventType, label, keyPrefix, sourceType, sourceRequired, itemMode, itemDirection, itemCategory,
    cashMode, cashDirection, cashCategory, accountScope, pnl, permModule, permAction, ownerGmOnly, tdhp,
  }),
);

const BY_TYPE: ReadonlyMap<string, PostingRule> = new Map(POSTING_RULES.map((r) => [r.eventType, r]));

export function isPostingEventType(value: unknown): value is PostingEventType {
  return typeof value === "string" && BY_TYPE.has(value);
}

export function postingRule(eventType: PostingEventType): PostingRule {
  return BY_TYPE.get(eventType)!;
}

/** Olay hiçbir satır yazmaz mı (yalnız görünüm, ör. kira tahakkuku). */
export function isMemoEvent(eventType: PostingEventType): boolean {
  const r = postingRule(eventType);
  return r.itemMode === "none" && r.cashMode === "none";
}

/** Kayıt servisinin yazdığı, elle seçilemeyen sistem kategorilerinin etiketleri (gösterim). */
export const POSTING_CATEGORY_LABEL: Readonly<Record<string, string>> = {
  danisman_hakedis: "Danışman hakedişi",
  stopaj: "Stopaj",
  depozito: "Depozito",
  yazilim: "Yazılım aboneliği",
  mulk_sahibi_odeme: "Mülk sahibi ödemesi",
};
