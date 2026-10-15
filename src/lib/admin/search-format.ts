/**
 * Admin komut paleti (Ctrl+K, `/api/admin/search`) sonuç biçimleri — SAF (testli). B120/B192: ham kod
 * ("professional · active", "in_progress · high", "owner") gösterilmez; talep numarası doğrudan aranır.
 */
import { planLabel } from "@/lib/billing/plans";
import { roleLabel } from "@/lib/role-labels";
import { TENANT_STATUS_LABEL, TICKET_PRIORITY_LABEL, TICKET_STATUS_LABEL, labelOf } from "@/lib/admin/labels";

/** Talep numarası deseni: ES-YYYY-NNNNNN (büyük/küçük harf ve boşluk serbest). */
const TICKET_NO_RE = /^\s*es\s*-\s*(\d{4})\s*-\s*(\d{1,6})\s*$/i;

/** Sorgu bir talep numarasıysa kanonik biçimi (ES-2026-000004), değilse null. Sıfır dolgu tamamlanır ("ES-2026-4"). */
export function ticketNoQuery(q: string): string | null {
  const m = TICKET_NO_RE.exec(q);
  if (!m) return null;
  return `ES-${m[1]}-${m[2]!.padStart(6, "0")}`;
}

const join = (parts: readonly (string | null | undefined)[]) => parts.filter((p): p is string => Boolean(p && p.trim())).join(" · ");

export function tenantSubtitle(t: { plan?: string | null; status?: string | null }): string {
  return join([t.plan ? planLabel(t.plan) : null, labelOf(TENANT_STATUS_LABEL, t.status)]) || "Ofis";
}

export function memberSubtitle(m: { email?: string | null; role?: string | null; tenant_name?: string | null; is_active?: boolean | null }): string {
  return join([m.email, roleLabel(m.role), m.tenant_name, m.is_active === false ? "Pasif" : null]) || "Ofis kullanıcısı";
}

export function ticketSubtitle(t: { ticket_no?: string | null; status?: string | null; priority?: string | null }): string {
  return join([t.ticket_no, labelOf(TICKET_STATUS_LABEL, t.status), labelOf(TICKET_PRIORITY_LABEL, t.priority)]) || "Destek talebi";
}
