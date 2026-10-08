import { isRecurrence, type Recurrence } from "@/lib/finance/recurring-expenses";
import { isPortalKey, type PortalKey } from "@/lib/finance/portal-roi";

/**
 * Gider formunun tekrar/portal alanları (SAF). `parseExpenseForm` (expense-input.ts) değişmez; bu alanlar ayrı okunur ki
 * şema (20261008000700) yokken eski gider akışı aynen çalışsın. Boş değer = "tekrarlamıyor" / "portala bağlı değil".
 */

export type ExpenseFinanceFields = {
  /** Formda alan var mıydı (güncellemede yoksa mevcut değer korunur). */
  hasRecurrence: boolean;
  hasPortal: boolean;
  recurrence: Recurrence | null;
  portalKey: PortalKey | null;
};

export type ExpenseFinanceResult = { ok: true; value: ExpenseFinanceFields } | { ok: false; error: string };

export function parseExpenseFinanceFields(formData: FormData): ExpenseFinanceResult {
  const hasRecurrence = formData.has("recurrence");
  const hasPortal = formData.has("portal_key");
  const rawRecurrence = String(formData.get("recurrence") ?? "").trim();
  const rawPortal = String(formData.get("portal_key") ?? "").trim();
  if (rawRecurrence && !isRecurrence(rawRecurrence)) return { ok: false, error: "Geçerli bir tekrar dönemi seçin." };
  if (rawPortal && !isPortalKey(rawPortal)) return { ok: false, error: "Geçerli bir portal seçin." };
  return {
    ok: true,
    value: {
      hasRecurrence,
      hasPortal,
      recurrence: rawRecurrence ? (rawRecurrence as Recurrence) : null,
      portalKey: rawPortal ? (rawPortal as PortalKey) : null,
    },
  };
}
