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

  const p = provider ?? process.env.EFATURA_PROVIDER ?? "";
  const u = apiUrl   ?? process.env.EFATURA_API_URL  ?? "";
  const k = apiKey   ?? process.env.EFATURA_API_KEY  ?? "";
  const v = companyVkn ?? process.env.EFATURA_COMPANY_VKN ?? "";

  if (!p || !u || !k) return null;
  return { provider: p, apiUrl: u, apiKey: k, companyVkn: v };
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
    const totalAmount = input.lines.reduce(
      (s, l) => s + l.quantity * l.unitPrice * (1 + l.vatRate / 100),
      0,
    );

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

    const res = await fetch(`${cfg.apiUrl}/invoices`, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        Authorization:   `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      return { ok: false, error: `Parasüt hatası: ${res.status} ${err.slice(0, 100)}` };
    }

    const data = await res.json() as { id?: string; pdf_url?: string };
    return { ok: true, invoiceId: String(data.id ?? ""), pdfUrl: data.pdf_url };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Bağlantı hatası." };
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
    const res = await fetch(`${cfg.apiUrl}/api/efatura/create`, {
      method:  "POST",
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
    });

    if (!res.ok) return { ok: false, error: `Logo hatası: ${res.status}` };
    const data = await res.json() as { INVOICE_ID?: string };
    return { ok: true, invoiceId: String(data.INVOICE_ID ?? "") };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Bağlantı hatası." };
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
    const res = await fetch(cfg.apiUrl, {
      method:  "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization:  `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({ ...input, companyVkn: cfg.companyVkn }),
    });

    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = await res.json() as { id?: string; pdfUrl?: string };
    return { ok: true, invoiceId: String(data.id ?? ""), pdfUrl: data.pdfUrl };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Bağlantı hatası." };
  }
}
