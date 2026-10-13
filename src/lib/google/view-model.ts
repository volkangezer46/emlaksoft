import { ADS_DEFAULT_API_VERSION } from "./ads";
import { GOOGLE_SERVICES, GOOGLE_SERVICE_LABELS, type GoogleService } from "./keys";
import { SERVICE_STATUS_LABELS, computeServiceStatus, maskId, quotaReached, type ServiceStatus } from "./status";
import type { GoogleStoreSnapshot, QuotaRecord } from "./token-store";

/**
 * Ekran görünüm modeli (SAF): mühürlü kayıtlardan yalnız gösterilebilir alanlar çıkar (maskeli kimlik, durum, zaman).
 * Belirteç/sır ASLA modele girmez (istemciye gitmez).
 */

export type ServiceCard = {
  service: GoogleService;
  label: string;
  status: ServiceStatus;
  statusLabel: string;
  connectedAt: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  details: Array<{ label: string; value: string }>;
};

export type ConnectionView = {
  secretsEnabled: boolean;
  client: { configured: boolean; clientIdMasked: string | null };
  gscProperty: string | null;
  ads: { customerIdMasked: string | null; mccMasked: string | null; tokenConfigured: boolean; apiVersion: string } | null;
  services: ServiceCard[];
  problems: string[];
  /** Herhangi bir hizmet veri akıtıyor mu (performans/reklam ekranları için). */
  anyConnected: boolean;
};

export function formatCustomerId(id: string | null | undefined): string | null {
  if (!id || !/^\d{10}$/.test(id)) return id ?? null;
  return `${id.slice(0, 3)}-${id.slice(3, 6)}-${id.slice(6)}`;
}

function maskCustomerId(id: string | null | undefined): string | null {
  if (!id) return null;
  return `•••-•••-${id.slice(-4)}`;
}

export function buildConnectionView(input: {
  snapshot: GoogleStoreSnapshot;
  quotas: { inspection: QuotaRecord | null; ads: QuotaRecord | null };
  today: string;
  secretsEnabled: boolean;
}): ConnectionView {
  const s = input.snapshot;
  const services: ServiceCard[] = GOOGLE_SERVICES.map((service) => {
    const token = s.tokens[service];
    const unreadable = s.problems.includes(service === "gsc" ? "google.oauth.gsc" : "google.oauth.ads");
    const quota = service === "gsc" ? quotaReached("inspection", input.quotas.inspection, input.today) : quotaReached("ads", input.quotas.ads, input.today);
    let status = computeServiceStatus({ token, unreadable, quotaReached: quota });
    // Ön koşulu eksik bağlı hizmet veri akıtmaz: dürüstçe "bağlı değil" (kart ne eksik olduğunu yazar).
    const missing = service === "gsc" ? (status === "bagli" && !s.gscProperty ? "Mülk seçilmedi" : null) : status === "bagli" && !s.adsAccount ? "Ads hesabı girilmedi" : null;
    if (missing) status = "bagli_degil";
    const details: Array<{ label: string; value: string }> = [];
    if (service === "gsc" && s.gscProperty) details.push({ label: "Mülk", value: s.gscProperty.siteUrl });
    if (service === "ads" && s.adsAccount) details.push({ label: "Müşteri kimliği", value: maskCustomerId(s.adsAccount.customerId) ?? "—" });
    if (missing) details.push({ label: "Eksik", value: missing });
    return {
      service,
      label: GOOGLE_SERVICE_LABELS[service],
      status,
      statusLabel: SERVICE_STATUS_LABELS[status],
      connectedAt: token?.connectedAt ?? null,
      lastSyncAt: token?.lastSyncAt ?? null,
      lastError: token?.lastError ?? null,
      details,
    };
  });
  return {
    secretsEnabled: input.secretsEnabled,
    client: { configured: Boolean(s.client), clientIdMasked: maskId(s.client?.clientId) },
    gscProperty: s.gscProperty?.siteUrl ?? null,
    ads: s.adsAccount
      ? {
          customerIdMasked: maskCustomerId(s.adsAccount.customerId),
          mccMasked: maskCustomerId(s.adsAccount.loginCustomerId),
          tokenConfigured: Boolean(s.adsAccount.developerToken),
          apiVersion: s.adsAccount.apiVersion || ADS_DEFAULT_API_VERSION,
        }
      : null,
    services,
    problems: s.problems,
    anyConnected: services.some((c) => c.status === "bagli" || c.status === "kota"),
  };
}

export function serviceCard(view: ConnectionView, service: GoogleService): ServiceCard {
  return view.services.find((c) => c.service === service)!;
}

/** Hizmet veri akıtabilir durumda mı (bağlı ya da yalnız kota beklemede). */
export function isFlowing(card: ServiceCard): boolean {
  return card.status === "bagli" || card.status === "kota";
}
