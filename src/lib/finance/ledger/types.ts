/**
 * Finans v2 (Muhasebe, /app/giderler) paylaşılan tipleri — FN1 sözleşmesi. SAF (sunucu/istemci ikisi de içe aktarabilir).
 * DB karşılıkları: supabase/migrations/20261014001000_finance_ledger_v2.sql (tablolar/görünümler) ve 001100 (RPC'ler).
 */
import type { EffectivePermissions } from "@/lib/permissions-merge";

export type EffectivePerms = EffectivePermissions;

/** Sekme kimlikleri (`?sekme=`). İlk 5'i görünür şeritte, kalan 5'i "Diğer" altında. */
export type FinanceTabId =
  | "genel"
  | "hareketler"
  | "kasa-banka"
  | "cari"
  | "belgeler"
  | "duzenli"
  | "butce"
  | "vergi"
  | "raporlar"
  | "ayarlar";

export const FINANCE_TAB_IDS: readonly FinanceTabId[] = [
  "genel",
  "hareketler",
  "kasa-banka",
  "cari",
  "belgeler",
  "duzenli",
  "butce",
  "vergi",
  "raporlar",
  "ayarlar",
] as const;

export function isFinanceTabId(v: unknown): v is FinanceTabId {
  return typeof v === "string" && (FINANCE_TAB_IDS as readonly string[]).includes(v);
}

/** Her sekme bileşeninin aldığı ortak prop'lar; sekme kendi verisini kendisi çeker. */
export type FinanceTabProps = {
  params: Record<string, string | undefined>;
  perms: EffectivePerms;
  tenantId: string;
  userId: string;
  role: string;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  /** Maaş kategorisini görme/yazma (ofis sahibi + genel müdür). */
  canSalary: boolean;
  isOwnerGm: boolean;
};

export type Money = number;
export type CurrencyCode = "TRY" | "USD" | "EUR";
export type Direction = "in" | "out";
export type OpenItemDirection = "receivable" | "payable";

// ---------------------------------------------------------------------------
// Cari
// ---------------------------------------------------------------------------
export type PartyKind = "musteri" | "malik" | "kiraci" | "tedarikci" | "danisman" | "diger";
export const PARTY_KINDS: readonly PartyKind[] = ["musteri", "malik", "kiraci", "tedarikci", "danisman", "diger"] as const;

export type Party = {
  id: string;
  kind: PartyKind;
  name: string;
  taxId: string | null;
  ibanLast4: string | null;
  phone: string | null;
  email: string | null;
  customerId: string | null;
  userId: string | null;
  note: string | null;
  archivedAt: string | null;
  createdAt: string;
  isSample: boolean;
};

/** `finance_party_balances` satırı: balance = açık alacak − açık borç (+ = bize borçlu). */
export type PartyBalance = {
  partyId: string;
  name: string;
  kind: PartyKind;
  receivableOpen: Money;
  payableOpen: Money;
  paidIn: Money;
  paidOut: Money;
  balance: Money;
  overdueAmount: Money;
  lastActivity: string | null;
};

export type PartyStatementDocType = "devir" | "alacak" | "borc" | "tahsilat" | "odeme" | "pesin_tahsilat" | "pesin_odeme";
export type PartyStatementRow = {
  date: string | null;
  docType: PartyStatementDocType;
  refId: string | null;
  title: string;
  debit: Money;
  credit: Money;
  runningBalance: Money;
  href: string | null;
};

// ---------------------------------------------------------------------------
// Açık kalem (vade)
// ---------------------------------------------------------------------------
export type OpenItemStatus = "open" | "partial" | "paid" | "cancelled";

export type OpenItem = {
  id: string;
  direction: OpenItemDirection;
  partyId: string | null;
  title: string;
  category: string | null;
  /** KDV dahil brüt belge tutarı. */
  amount: Money;
  currency: CurrencyCode;
  vatRate: number | null;
  vatAmount: Money | null;
  withholdingAmount: Money | null;
  issueDate: string;
  dueDate: string;
  paidAmount: Money;
  status: OpenItemStatus;
  sourceType: string | null;
  sourceId: string | null;
  propertyId: string | null;
  note: string | null;
  createdAt: string;
  cancelledAt: string | null;
  cancelReason: string | null;
  isSample: boolean;
};

export type OpenItemSource = "manual" | "rent" | "commission" | "recurring" | "owner_payout";

/** `finance_open_items_v` satırı (tüm kaynakların birleşimi; her satır tıklanabilir). */
export type OpenItemView = {
  key: string;
  source: OpenItemSource;
  sourceId: string;
  direction: OpenItemDirection;
  partyId: string | null;
  partyLabel: string;
  title: string;
  category: string | null;
  amountOpen: Money;
  currency: CurrencyCode;
  dueDate: string;
  href: string;
};

export type AgingBucketKey = "vadesi_gelmedi" | "0-30" | "31-60" | "61-90" | "90+" | "vadesiz";
export const AGING_BUCKETS: readonly AgingBucketKey[] = ["vadesi_gelmedi", "0-30", "31-60", "61-90", "90+", "vadesiz"] as const;
export type AgingBucket = { bucket: AgingBucketKey; count: number; amount: Money };

// ---------------------------------------------------------------------------
// Defter
// ---------------------------------------------------------------------------
export type LedgerOrigin = "entry" | "legacy_expense";

/** `finance_ledger_v` satırı. legacy_expense = deftere bağlanmamış eski gider (hesapsız; bakiyeye girmez). */
export type LedgerRow = {
  id: string;
  origin: LedgerOrigin;
  accountId: string | null;
  direction: Direction;
  amount: Money;
  currency: CurrencyCode;
  entryDate: string;
  kind: "income" | "expense" | "transfer" | "adjust";
  category: string | null;
  title: string;
  counterparty: string | null;
  partyId: string | null;
  vatRate: number | null;
  vatAmount: Money | null;
  withholdingAmount: Money | null;
  propertyId: string | null;
  openItemId: string | null;
  sourceType: string;
  sourceId: string | null;
  expenseId: string | null;
  reconciledAt: string | null;
  voidedAt: string | null;
  attachmentCount: number;
  isSample: boolean;
  note: string | null;
  createdAt: string;
};

/** Hareketler sekmesinin URL filtresi (iki yönlü filtre sözleşmesi). */
export type LedgerFilter = {
  /** 'in' | 'out' | 'transfer' */
  tur?: "in" | "out" | "transfer";
  hesap?: string;
  kategori?: string;
  cari?: string;
  /** YYYY-MM-DD (dahil) */
  from?: string;
  /** YYYY-MM-DD (dahil) */
  to?: string;
  q?: string;
  /** 'evet' = mutabık, 'hayir' = mutabık olmayan */
  mutabik?: "evet" | "hayir";
  origin?: LedgerOrigin;
  /** İptal edilenleri de göster. */
  iptal?: boolean;
};

export type LedgerPage = { rows: LedgerRow[]; total: number; page: number; pageSize: number };

// ---------------------------------------------------------------------------
// Ekler
// ---------------------------------------------------------------------------
export type OcrStatus = "none" | "pending" | "done" | "failed";
export type Attachment = {
  id: string;
  entryId: string | null;
  openItemId: string | null;
  storagePath: string;
  fileName: string;
  fileType: string | null;
  fileSize: number | null;
  ocrStatus: OcrStatus;
  ocrJson: Record<string, unknown> | null;
  uploadedBy: string | null;
  createdAt: string;
};
export type AttachmentFilter = { inbox?: boolean; entryId?: string; openItemId?: string; limit?: number };

// ---------------------------------------------------------------------------
// Kategori, kural, bütçe, ayar
// ---------------------------------------------------------------------------
export type FinanceCategory = {
  /** Sistem kategorisinde kod anahtarı, ofis kategorisinde satır kimliği. */
  id: string;
  key: string;
  label: string;
  direction: Direction;
  source: "system" | "custom";
  icon: string | null;
  defaultVatRate: number | null;
  defaultWithholdingRate: number | null;
  expenseCategory: string | null;
  sort: number;
  archived: boolean;
};

export type RuleMode = "suggest" | "auto";
export type FinanceRule = {
  id: string;
  direction: Direction | null;
  matchText: string | null;
  matchIbanLast4: string | null;
  amountMin: Money | null;
  amountMax: Money | null;
  setCategory: string;
  setPartyId: string | null;
  mode: RuleMode;
  active: boolean;
  hits: number;
  createdAt: string;
};
export type RuleSuggestion = { ruleId: string; category: string; partyId: string | null; mode: RuleMode };

export type Budget = { direction: Direction; category: string; budget: Money; actual: Money };

export type FinanceSettings = {
  baseCurrency: CurrencyCode;
  defaultVatRate: number;
  vatIncludedDefault: boolean;
  ocrEnabled: boolean;
  forecastMinBalance: Money | null;
  updatedAt: string | null;
};

export const DEFAULT_FINANCE_SETTINGS: FinanceSettings = {
  baseCurrency: "TRY",
  defaultVatRate: 20,
  vatIncludedDefault: true,
  ocrEnabled: false,
  forecastMinBalance: null,
  updatedAt: null,
};

export type PeriodLock = { periodMonth: string; lockedAt: string; lockedBy: string | null; note: string | null };

export type SavedView = { id: string; tab: FinanceTabId; name: string; params: Record<string, string>; createdAt: string };

// ---------------------------------------------------------------------------
// Pano, tahmin, kâr/zarar, vergi
// ---------------------------------------------------------------------------
export type OverviewSummary = {
  from: string;
  to: string;
  cashTotalTry: Money;
  byCurrency: { currency: CurrencyCode; amount: Money }[];
  /** TL dışı hesap var ama kuru yok: toplam o hesabı içermiyor. */
  fxMissing: boolean;
  inTotal: Money;
  outTotal: Money;
  net: Money;
  receivableOpen: Money;
  payableOpen: Money;
  overdueCount: number;
  reviewCount: number;
  legacyUnadoptedCount: number;
  vatPayableMonth: Money;
};

export type ForecastPoint = { date: string; inflow: Money; outflow: Money; balance: Money; isActual: boolean };

export type PnlRow = {
  month: string;
  income: Money;
  expense: Money;
  net: Money;
  incomeByCategory: Record<string, Money>;
  expenseByCategory: Record<string, Money>;
};

export type VatRow = {
  month: string;
  outputVat: Money;
  inputVat: Money;
  payable: Money;
  withholdingPaid: Money;
  withholdingCollected: Money;
};

/** Server action sonucu (finance-ledger.ts). */
export type LedgerActionResult = { ok: true; id?: string; count?: number } | { ok: false; error: string };
