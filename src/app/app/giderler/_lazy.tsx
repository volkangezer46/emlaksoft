"use client";

import dynamic from "next/dynamic";

/**
 * Muhasebe sekmelerinin AĞIR istemci parçaları (form/çekmece, ekstre yükleme, kural ve kategori yöneticileri, fatura
 * düzenleyici). `/app/giderler` tek rota + `?sekme=`; sunucu sekme bileşenleri statik içe aktarınca hepsi açılış sekmesi
 * (Genel bakış) dahil HER sekmenin ilk yük JS'ine giriyordu. Burada `next/dynamic` ile ayrı parçaya alınır: SSR çıktısı
 * aynıdır (ssr açık), parça yalnız o sekme çizildiğinde iner. Yüklenirken aynı boyutta iskelet (yerleşim kaymaz).
 */
const BTN = () => <span aria-hidden="true" className="skeleton inline-block h-9 w-28 rounded-[var(--radius-control)] touch:h-11" />;
const PANEL = () => <div aria-hidden="true" className="skeleton h-40 w-full rounded-[var(--radius-card)]" />;

export const CategoryManager = dynamic(() => import("./ayarlar/category-manager").then((m) => m.CategoryManager), { loading: PANEL });
export const PeriodLocks = dynamic(() => import("./ayarlar/period-locks").then((m) => m.PeriodLocks), { loading: PANEL });
export const RulesList = dynamic(() => import("./ayarlar/rules-list").then((m) => m.RulesList), { loading: PANEL });
export const FinanceSettingsForm = dynamic(() => import("./ayarlar/settings-form").then((m) => m.FinanceSettingsForm), { loading: PANEL });

export const AccountFormButton = dynamic(() => import("./accounts-panel").then((m) => m.AccountFormButton), { loading: BTN });
export const TransferButton = dynamic(() => import("./accounts-panel").then((m) => m.TransferButton), { loading: BTN });
export const ArchiveAccountButton = dynamic(() => import("./accounts-panel").then((m) => m.ArchiveAccountButton), { loading: BTN });
export const StatementUploadButton = dynamic(() => import("./statement-upload").then((m) => m.StatementUploadButton), { loading: BTN });

export const FinanceBudgetForm = dynamic(() => import("./budget-form").then((m) => m.FinanceBudgetForm), { loading: PANEL });
export const FinanceBudgetRemove = dynamic(() => import("./budget-form").then((m) => m.FinanceBudgetRemove), { loading: BTN });

export const RuleFormButton = dynamic(() => import("./recurring-panel").then((m) => m.RuleFormButton), { loading: BTN });
export const RuleRowActions = dynamic(() => import("./recurring-panel").then((m) => m.RuleRowActions), { loading: BTN });
export const PendingActions = dynamic(() => import("./recurring-panel").then((m) => m.PendingActions), { loading: BTN });
export const ConvertSeriesButton = dynamic(() => import("./recurring-panel").then((m) => m.ConvertSeriesButton), { loading: BTN });

export const InvoiceEditor = dynamic(() => import("./faturalar/invoice-editor").then((m) => m.InvoiceEditor), { loading: PANEL });
export const UploadDropzone = dynamic(() => import("./belgeler/upload-dropzone").then((m) => m.UploadDropzone), { loading: PANEL });
export const ReceiptInbox = dynamic(() => import("./belgeler/receipt-inbox").then((m) => m.ReceiptInbox), { loading: PANEL });
export const SubscriptionSuggestions = dynamic(() => import("./belgeler/subscription-suggestions").then((m) => m.SubscriptionSuggestions));
export const ReconcileQueue = dynamic(() => import("./kasa-banka/reconcile-queue").then((m) => m.ReconcileQueue), { loading: PANEL });
export const CommissionCashQueue = dynamic(() => import("./kasa-banka/commission-cash-queue").then((m) => m.CommissionCashQueue), { loading: PANEL });
export const StatementReviewTable = dynamic(() => import("./statement-review-table").then((m) => m.StatementReviewTable), { loading: PANEL });
export const InvoiceRowActions = dynamic(() => import("./faturalar/invoice-actions").then((m) => m.InvoiceRowActions), { loading: BTN });
export const IssuePanel = dynamic(() => import("./faturalar/invoice-actions").then((m) => m.IssuePanel), { loading: PANEL });
/** Toplu çubuk yalnız seçim varken görünür; hiçbir şey çizmeden iner. */
export const LedgerBulkBar = dynamic(() => import("./_hareketler/bulk-bar").then((m) => m.LedgerBulkBar));
export const AdoptLegacyButton = dynamic(() => import("./_hareketler/legacy-adopt").then((m) => m.AdoptLegacyButton), { loading: BTN });
