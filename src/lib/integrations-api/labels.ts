/**
 * API kaynakları ve webhook olayları (SAF; istemci güvenle import eder — node:crypto YOK). Çekirdek: `core.ts`.
 * Değerler migration 20261007000320 CHECK kısıtlarıyla birebir aynıdır.
 */

export const API_RESOURCES = ["properties", "customers", "deals"] as const;
export type ApiResource = (typeof API_RESOURCES)[number];
export const API_RESOURCE_LABELS: Record<ApiResource, string> = { properties: "Portföyler", customers: "Müşteriler", deals: "Anlaşmalar" };

export const WEBHOOK_EVENTS = ["customer.created", "customer.updated", "property.created", "property.updated", "deal.created", "deal.updated"] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];
export const WEBHOOK_EVENT_LABELS: Record<WebhookEvent, string> = {
  "customer.created": "Müşteri oluşturuldu",
  "customer.updated": "Müşteri güncellendi",
  "property.created": "Portföy oluşturuldu",
  "property.updated": "Portföy güncellendi",
  "deal.created": "Anlaşma oluşturuldu",
  "deal.updated": "Anlaşma güncellendi",
};

export function isApiResource(v: unknown): v is ApiResource {
  return typeof v === "string" && (API_RESOURCES as readonly string[]).includes(v);
}
export function isWebhookEvent(v: unknown): v is WebhookEvent {
  return typeof v === "string" && (WEBHOOK_EVENTS as readonly string[]).includes(v);
}
