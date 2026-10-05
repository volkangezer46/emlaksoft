/**
 * TL HESAP KREDİSİ (birim `try`) — SÖZLEŞME dosyası (SAF: sunucu/istemci güvenli, DB yok).
 * SQL: supabase/migrations/20260826000400_try_credit_wallet.sql + 20260826000500_try_credit_invoice_payment.sql.
 * RPC adı, parametre adı/sırası ve dönüş JSON anahtarları SQL ile BİREBİR (sözleşme testi:
 * try-wallet-sql-contract.test.ts). DEĞİŞTİRİLİRSE iki migration da yeni dosyayla güncellenir.
 *
 * Kredi PARA DEĞİLDİR: yalnız EmlakSoft faturalarından (plan / ek kullanıcı / kontör paketi) düşer, nakde çevrilmez.
 * Bakiye: balance = canlı kovalar − borç (EKSİ olabilir: clawback); available = max(balance − açık rezerv, 0).
 * Eksi bakiye HARCANAMAZ.
 */
import { z } from "zod";
import { TRY_DEFAULT_MAX_SHARE } from "./constants";

export {
  KURUS,
  TRY_DEFAULT_MAX_SHARE,
  TRY_FULL_CREDIT_SHARE,
  TRY_GRANT_KINDS,
  TRY_GRANT_KIND_LABELS,
  TRY_MAX_SHARE_SETTING_KEY,
  TRY_UNIT,
  TRY_WALLET_LINKS,
  type TryGrantKind,
} from "./constants";

/** Ayar değerini ayrıştırır: (0, 1] aralığı dışı/boş = varsayılan (0.5). Yüzde olarak verildiyse ("50") 0.5'e çevrilir. */
export function parseMaxShare(raw: string | null | undefined): number {
  if (raw == null || raw.trim() === "") return TRY_DEFAULT_MAX_SHARE;
  const n = Number(raw.trim().replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return TRY_DEFAULT_MAX_SHARE;
  const share = n > 1 ? n / 100 : n;
  if (share <= 0 || share > 1) return TRY_DEFAULT_MAX_SHARE;
  return Math.round(share * 10000) / 10000;
}

// ---------------------------------------------------------------------------
// Yükleme türleri (defter source eşlemesi SQL'de; liste constants.ts'te)
// ---------------------------------------------------------------------------

/** p_idem biçimi (SQL ile aynı). */
export const TRY_IDEM_PATTERN = /^[A-Za-z0-9_.:-]{8,128}$/;

// ---------------------------------------------------------------------------
// RPC sözleşmesi (hepsi service_role-only; ofis okuması hariç)
// ---------------------------------------------------------------------------
export const TRY_RPC = {
  balance: "try_credit_balance", //   (p_tenant uuid) -> jsonb TryBalance
  grant: "try_credit_grant", //       (p_tenant uuid, p_amount numeric, p_kind text, p_idem text, p_expires_at timestamptz, p_meta jsonb) -> jsonb TryGrantResult
  reserve: "try_credit_reserve", //   (p_tenant uuid, p_user uuid, p_amount numeric, p_idem text, p_invoice uuid, p_max_share numeric) -> jsonb TryReserveResult
  commit: "try_credit_commit", //     (p_tenant uuid, p_reservation uuid, p_ref jsonb) -> jsonb TrySettleResult; yalnız reserved->committed
  release: "try_credit_release", //   (p_tenant uuid, p_reservation uuid, p_reason text) -> jsonb TrySettleResult; yalnız reserved->released
  reverse: "try_credit_reverse", //   (p_tenant uuid, p_amount numeric, p_reason text, p_idem text, p_original_idem text, p_meta jsonb) -> jsonb TryReverseResult (clawback)
  invoiceHold: "try_credit_invoice_hold", //       (p_tenant uuid, p_conversation_id text) -> jsonb TryInvoiceHold
  fulfillInvoice: "try_credit_fulfill_invoice", // (p_conversation_id text, p_expected_tenant_id uuid, p_payment_id text, p_source text, p_expected_plan text, p_expected_cycle text, p_cash_try numeric) -> fulfill sonucu + wallet alanları
  releaseInvoice: "try_credit_release_invoice", // (p_tenant uuid, p_invoice uuid, p_reason text) -> jsonb TrySettleResult
  releaseDead: "try_credit_release_dead", //       (p_limit integer default 500) -> integer
  refundInvoice: "try_credit_refund_invoice", //   (p_tenant uuid, p_invoice uuid, p_amount numeric, p_idem text, p_reason text) -> jsonb TryRefundResult
  ready: "try_credit_ready", //       () -> boolean (yalnız service_role kimliğinde true)
  myOverview: "try_credit_my_overview", // () -> jsonb TryOverview; authenticated, yalnız KENDİ tenant'ı
} as const;

/** Ofis hareket görünümü (security_invoker; idempotency_key/meta içermez). */
export const TRY_MOVEMENTS_VIEW = "try_credit_movements";

const money = z.number();
const expiryBucket = z.object({ amount: money, expires_at: z.string() });

export const tryBalanceSchema = z.object({
  available: money,
  balance: money,
  reserved: money,
  debt: money,
  granted_total: money,
  spent_total: money,
  next_expiry_at: z.string().nullable(),
  expiring_amount: money,
  expiring_buckets: z.array(expiryBucket),
});
export type TryBalance = z.infer<typeof tryBalanceSchema>;

export const tryOverviewSchema = tryBalanceSchema.extend({
  open_reservations: z.array(
    z.object({
      reservation_id: z.string().uuid(),
      invoice_id: z.string().uuid().nullable(),
      amount: money,
      created_at: z.string(),
    }),
  ),
});
export type TryOverview = z.infer<typeof tryOverviewSchema>;

export const tryGrantResultSchema = z.object({
  ok: z.boolean(),
  already: z.boolean(),
  available: money,
  balance: money,
});
export type TryGrantResult = z.infer<typeof tryGrantResultSchema>;

export const tryReserveResultSchema = z.union([
  z.object({
    ok: z.literal(true),
    code: z.enum(["ok", "duplicate"]),
    reservation_id: z.string().uuid(),
    state: z.enum(["reserved", "committed", "released"]),
    amount: money,
    available: money,
  }),
  z.object({
    ok: z.literal(false),
    code: z.enum(["insufficient", "over_cap", "invoice_not_found", "invoice_not_payable", "invoice_already_reserved"]),
    available: money.optional(),
    max_amount: money.optional(),
    reservation_id: z.string().uuid().optional(),
    state: z.enum(["reserved", "committed", "released"]).optional(),
  }),
]);
export type TryReserveResult = z.infer<typeof tryReserveResultSchema>;

export const trySettleResultSchema = z.object({
  ok: z.boolean(),
  state: z.enum(["reserved", "committed", "released", "unknown"]),
  already: z.boolean(),
  code: z.string().optional(),
});
export type TrySettleResult = z.infer<typeof trySettleResultSchema>;

export const tryReverseResultSchema = z.union([
  z.object({ ok: z.literal(true), already: z.boolean(), balance: money, available: money, debt: money }),
  z.object({
    ok: z.literal(false),
    code: z.enum(["original_not_found", "exceeds_original"]),
    remaining: money.optional(),
  }),
]);
export type TryReverseResult = z.infer<typeof tryReverseResultSchema>;

export const tryRefundResultSchema = z.union([
  z.object({
    ok: z.literal(true),
    already: z.boolean(),
    restored: money,
    remaining: money.optional(),
    available: money,
    balance: money,
  }),
  z.object({ ok: z.literal(false), code: z.enum(["no_credit_used", "exceeds_credit_used"]), remaining: money.optional() }),
]);
export type TryRefundResult = z.infer<typeof tryRefundResultSchema>;

export const tryInvoiceHoldSchema = z.union([
  z.object({
    has_hold: z.literal(true),
    reservation_id: z.string().uuid(),
    invoice_id: z.string().uuid(),
    state: z.enum(["reserved", "committed", "released"]),
    amount: money,
    total_try: money,
    cash_try: money,
  }),
  z.object({ has_hold: z.literal(false), invoice_id: z.string().uuid().optional(), total_try: money.optional() }),
]);
export type TryInvoiceHold = z.infer<typeof tryInvoiceHoldSchema>;
