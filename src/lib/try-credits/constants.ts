/**
 * TL kredi cüzdanı — istemci güvenli SABİTLER (zod/DB bağımlılığı YOK; paket bütçesi için ayrı dosya).
 * Sözleşmenin geri kalanı (RPC adları, şemalar) `config.ts`'tedir ve oradan yeniden dışa aktarılır.
 */
export const TRY_UNIT = "try" as const;

/** Tek faturada kredinin KDV dahil toplamdaki en yüksek payı (platform_settings; yoksa varsayılan). */
export const TRY_MAX_SHARE_SETTING_KEY = "try_credit.max_invoice_share";
export const TRY_DEFAULT_MAX_SHARE = 0.5;
/** Tam kredi ile ödeme (iyzico'suz yol) yalnız pay = 1 yapılandırıldığında mümkündür. */
export const TRY_FULL_CREDIT_SHARE = 1;

/** Hesaplanabilir en küçük para birimi: kuruş. */
export const KURUS = 100;

export const TRY_GRANT_KINDS = ["referral", "partner", "campaign", "manual", "bonus", "refund"] as const;
export type TryGrantKind = (typeof TRY_GRANT_KINDS)[number];

export const TRY_GRANT_KIND_LABELS: Record<TryGrantKind, string> = {
  referral: "Davet ödülü",
  partner: "Ortaklık ödülü",
  campaign: "Kampanya kredisi",
  manual: "Yönetici yüklemesi",
  bonus: "Hediye kredi",
  refund: "İade edilen kredi",
};

/** Cüzdan ekranından gidilen hedefler (sıfır çıkmaz metrik). */
export const TRY_WALLET_LINKS = {
  wallet: "/app/abonelik?sekme=cuzdan",
  plans: "/app/abonelik?sekme=plan#paketler",
  seats: "/app/abonelik?sekme=plan#koltuk",
  packs: "/app/abonelik?sekme=kontor",
  invoices: "/app/abonelik?sekme=faturalar",
} as const;
