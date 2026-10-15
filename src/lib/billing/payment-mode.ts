import "server-only";
import { isIyzicoConfigured } from "@/lib/billing/iyzico";
import { billingDemoAllowed } from "@/lib/feature-flags/registry";

/**
 * Online abonelik ödemesinin durumu (TEK bayrak): abonelik sayfası metni ve satın al düğmeleri, kurulumdaki Paket adımı
 * aynı kararı okur.
 *  - `live`: iyzico anahtarları tanımlı, gerçek ödeme alınır.
 *  - `demo`: iyzico yok ama demo ödeme açık (geliştirme ya da canlıda `ALLOW_BILLING_DEMO=true`).
 *  - `off`: ikisi de kapalı; satın alma düğmesi gösterilmez, paket değişikliği destek üzerinden yapılır (boş vaat yok).
 */
export type OnlinePaymentMode = "live" | "demo" | "off";

export function onlinePaymentMode(): OnlinePaymentMode {
  if (isIyzicoConfigured()) return "live";
  return billingDemoAllowed() ? "demo" : "off";
}

/** Online ödeme kapalıyken kullanıcıya gösterilen tek cümle (abonelik ve kurulum aynı metni kullanır). */
export const PAYMENT_OFF_TEXT = "Online ödeme şu an kapalı; paketinizi değiştirmek için destekle iletişime geçin.";

/** Paket değişikliği talebi için destek formu. */
export const PAYMENT_SUPPORT_HREF = "/app/destek/yeni";
