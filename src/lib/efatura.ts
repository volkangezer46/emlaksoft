/**
 * E-Fatura / E-Arşiv Entegrasyon İskeleti
 *
 * Desteklenen provider'lar (platform_settings ile yapılandırılır):
 *   - logo        Logo Tiger/Go (REST API)
 *   - mikro       Mikro Yazılım
 *   - parasutu    Parasüt
 *   - luca        Luca
 *   - netsis      Netsis
 *   - custom      Özel API endpoint
 *
 * Ortam / platform_settings anahtarları:
 *   efatura_provider    — provider adı
 *   efatura_api_url     — API endpoint
 *   efatura_api_key     — API anahtarı / token
 *   efatura_company_vkn — Vergi kimlik numarası
 */

import { getPlatformSetting } from "@/lib/platform-settings";
import {
  normalizeProviderBaseUrl,
  providerAllowedHosts,
  PROVIDER_REQUEST_TIMEOUT_MS,
} from "@/lib/integrations/provider-url";
import {
  discardExternalResponse,
  externalErrorMetadata,
  fetchExternal,
  readExternalJson,
} from "@/lib/external-fetch";

// ---------------------------------------------------------------------------
// Tipler
// ---------------------------------------------------------------------------

export type EFaturaConfig = {
  provider:   string;
  apiUrl:     string;
  apiKey:     string;
  companyVkn: string;
};

export type InvoiceLine = {
  description: string;
  quantity:    number;
  unitPrice:   number;
  vatRate:     number; // 0, 10, 20
};

export type InvoiceInput = {
  invoiceNo:    string;
  date:         string;             // YYYY-MM-DD
  customerName: string;
  customerVkn?: string;
  customerTckn?: string;
  lines:        InvoiceLine[];
  currency?:    string;             // varsayılan TRY
  notes?:       string;
};

export type InvoiceResult = {
  ok:         boolean;
  invoiceId?: string;
  pdfUrl?:    string;
  error?:     string;
};

const IMPLEMENTED_EFATURA_PROVIDERS = new Set(["parasutu", "logo", "custom"]);
const EFATURA_MAX_RESPONSE_BYTES = 512 * 1024;

function efaturaTransportFailure(provider: string, error: unknown): InvoiceResult {
  console.error("e-fatura provider request failed", {
    provider,
    ...externalErrorMetadata(error),
  });
  return { ok: false, error: "E-fatura sağlayıcısına erişilemedi." };
}

function safeArtifactUrl(raw: unknown, apiUrl: string): string | undefined {
  if (typeof raw !== "string" || raw.length > 2_048) return undefined;
  try {
    const candidate = new URL(raw);
    const provider = new URL(apiUrl);
    if (
      candidate.protocol !== "https:" ||
      candidate.origin !== provider.origin ||
      candidate.username ||
      candidate.password
    ) return undefined;
    return candidate.toString();
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export async function getEFaturaConfig(): Promise<EFaturaConfig | null> {
  const [provider, apiUrl, apiKey, companyVkn] = await Promise.all([
    getPlatformSetting("efatura_provider"),
    getPlatformSetting("efatura_api_url"),
    getPlatformSetting("efatura_api_key"),
    getPlatformSetting("efatura_company_vkn"),
  ]);

  const p = (provider ?? process.env.EFATURA_PROVIDER ?? "").trim().toLowerCase();
  const u = apiUrl   ?? process.env.EFATURA_API_URL  ?? "";
  const k = apiKey   ?? process.env.EFATURA_API_KEY  ?? "";
  const v = companyVkn ?? process.env.EFATURA_COMPANY_VKN ?? "";

  if (!IMPLEMENTED_EFATURA_PROVIDERS.has(p) || !u || !k) return null;
  const defaults = p === "parasutu" ? ["api.parasut.com"] : [];
  const safeApiUrl = normalizeProviderBaseUrl(
    u,
    providerAllowedHosts(defaults, process.env.EFATURA_ALLOWED_HOSTS),
  );
  if (!safeApiUrl) return null;
  return { provider: p, apiUrl: safeApiUrl, apiKey: k, companyVkn: v };
}

export async function isEFaturaConfigured(): Promise<boolean> {
  return (await getEFaturaConfig()) !== null;
}

// ---------------------------------------------------------------------------
// Fatura oluştur (provider'a göre yönlendir)
// ---------------------------------------------------------------------------

export async function createInvoice(input: InvoiceInput): Promise<InvoiceResult> {
  const cfg = await getEFaturaConfig();
  if (!cfg) return { ok: false, error: "E-fatura entegrasyonu yapılandırılmamış." };

  switch (cfg.provider) {
    case "parasutu": return parasutuCreateInvoice(input, cfg);
    case "logo":     return logoCreateInvoice(input, cfg);
    default:
      return customCreateInvoice(input, cfg);
  }
}

// ---------------------------------------------------------------------------
// Parasüt adaptörü (iskelet)
// ---------------------------------------------------------------------------

async function parasutuCreateInvoice(
  input: InvoiceInput,
  cfg: EFaturaConfig,
): Promise<InvoiceResult> {
  try {
    const body = {
      description:   input.notes ?? input.lines[0]?.description ?? "Komisyon",
      issue_date:    input.date,
      due_date:      input.date,
      currency:      input.currency ?? "TRY",
      billing_address: {
        name: input.customerName,
        tax_number: input.customerVkn ?? input.customerTckn ?? "",
      },
      items: input.lines.map((l) => ({
        description: l.description,
        quantity:    l.quantity,
        unit_price:  l.unitPrice,
        vat_rate:    l.vatRate,
      })),
    };

    const res = await fetchExternal(`${cfg.apiUrl}/invoices`, {
      method:  "POST",
      redirect: "error",
      headers: {
        "Content-Type":  "application/json",
        Authorization:   `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify(body),
    }, { timeoutMs: PROVIDER_REQUEST_TIMEOUT_MS });

    if (!res.ok) {
      await discardExternalResponse(res);
      return { ok: false, error: `Parasüt hatası: ${res.status}` };
    }

    const data = await readExternalJson<{ id?: string; pdf_url?: string }>(
      res,
      EFATURA_MAX_RESPONSE_BYTES,
    );
    return { ok: true, invoiceId: String(data.id ?? ""), pdfUrl: safeArtifactUrl(data.pdf_url, cfg.apiUrl) };
  } catch (e) {
    return efaturaTransportFailure("parasutu", e);
  }
}

// ---------------------------------------------------------------------------
// Logo adaptörü (iskelet)
// ---------------------------------------------------------------------------

async function logoCreateInvoice(
  input: InvoiceInput,
  cfg: EFaturaConfig,
): Promise<InvoiceResult> {
  try {
    const res = await fetchExternal(`${cfg.apiUrl}/api/efatura/create`, {
      method:  "POST",
      redirect: "error",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key":    cfg.apiKey,
      },
      body: JSON.stringify({
        CUST_NAME:   input.customerName,
        TAX_ID:      input.customerVkn ?? "",
        DATE:        input.date,
        LINES:       input.lines.map((l) => ({
          DESCRIPTION: l.description,
          QTY:         l.quantity,
          PRICE:       l.unitPrice,
          VAT:         l.vatRate,
        })),
      }),
    }, { timeoutMs: PROVIDER_REQUEST_TIMEOUT_MS });

    if (!res.ok) {
      await discardExternalResponse(res);
      return { ok: false, error: `Logo hatası: ${res.status}` };
    }
    const data = await readExternalJson<{ INVOICE_ID?: string }>(
      res,
      EFATURA_MAX_RESPONSE_BYTES,
    );
    return { ok: true, invoiceId: String(data.INVOICE_ID ?? "") };
  } catch (e) {
    return efaturaTransportFailure("logo", e);
  }
}

// ---------------------------------------------------------------------------
// Özel API adaptörü (custom)
// ---------------------------------------------------------------------------

async function customCreateInvoice(
  input: InvoiceInput,
  cfg: EFaturaConfig,
): Promise<InvoiceResult> {
  try {
    const res = await fetchExternal(cfg.apiUrl, {
      method:  "POST",
      redirect: "error",
      headers: {
        "Content-Type": "application/json",
        Authorization:  `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({ ...input, companyVkn: cfg.companyVkn }),
    }, { timeoutMs: PROVIDER_REQUEST_TIMEOUT_MS });

    if (!res.ok) {
      await discardExternalResponse(res);
      return { ok: false, error: `HTTP ${res.status}` };
    }
    const data = await readExternalJson<{ id?: string; pdfUrl?: string }>(
      res,
      EFATURA_MAX_RESPONSE_BYTES,
    );
    return { ok: true, invoiceId: String(data.id ?? ""), pdfUrl: safeArtifactUrl(data.pdfUrl, cfg.apiUrl) };
  } catch (e) {
    return efaturaTransportFailure("custom", e);
  }
}
