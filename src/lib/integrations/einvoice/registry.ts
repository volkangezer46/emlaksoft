/** Sağlayıcı adaptör fabrikası (sunucu). Yeni sağlayıcı = providers.ts + burada tek satır + adaptör dosyası. */
import type { EInvoiceCredentials } from "./credentials";
import { createNilveraAdapter } from "./nilvera";
import { createParasutAdapter, type ParasutHooks } from "./parasut";
import type { EInvoiceAdapter, EInvoiceMode } from "./types";

export function createEInvoiceAdapter(creds: EInvoiceCredentials, mode: EInvoiceMode, hooks: ParasutHooks = {}): EInvoiceAdapter {
  if (creds.provider === "nilvera") return createNilveraAdapter({ apiKey: creds.apiKey }, mode);
  return createParasutAdapter(
    { clientId: creds.clientId, clientSecret: creds.clientSecret, companyId: creds.companyId, refreshToken: creds.refreshToken },
    hooks,
  );
}
