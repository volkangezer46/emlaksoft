/** İş yükü devri (denetim B5): seçenekler, gerekçe ve kimlik doğrulama saf yardımcıları. */

export const HANDOFF_SCOPES = ["customers", "properties", "deals", "tasks", "appointments"] as const;
export type HandoffScope = (typeof HANDOFF_SCOPES)[number];

export const HANDOFF_SCOPE_LABELS: Record<HandoffScope, string> = {
  customers: "müşteri",
  properties: "portföy",
  deals: "açık anlaşma",
  tasks: "açık görev",
  appointments: "yaklaşan randevu",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const HANDOFF_REASON_MIN = 5;
export const HANDOFF_REASON_MAX = 300;
/** Eski form (gerekçe/seçenek alanı göndermeyen istemci) için varsayılan gerekçe. */
export const LEGACY_HANDOFF_REASON = "Gerekçe belirtilmedi (eski devir formu)";

export type HandoffInput = { from: string; to: string; scopes: HandoffScope[]; reason: string };

type Getter = { get(name: string): FormDataEntryValue | null };

/**
 * Form alanları: from, to (uuid), reason (zorunlu, 5-300 karakter), her kapsam için
 * `scope_<ad>` = "1" | "0". Hiçbir `scope_*` alanı yoksa (eski form) tüm kapsamlar seçili sayılır;
 * en az bir kapsam seçili olmalıdır. Açık talepler müşteri sahipliğiyle birlikte taşınır
 * (`customer_demands`te ayrı sahip kolonu yoktur).
 */
export function parseHandoffInput(form: Getter): { ok: true; input: HandoffInput } | { ok: false; error: string } {
  const from = String(form.get("from") ?? "").trim();
  const to = String(form.get("to") ?? "").trim();
  if (!from || !to) return { ok: false, error: "Devreden ve devralan danışman seçilmelidir." };
  if (!UUID_RE.test(from) || !UUID_RE.test(to)) return { ok: false, error: "Danışman kimliği geçersiz." };
  if (from === to) return { ok: false, error: "İş yükü aynı danışmana devredilemez." };

  const reasonRaw = form.get("reason");
  let reason: string;
  if (reasonRaw === null) {
    reason = LEGACY_HANDOFF_REASON;
  } else {
    reason = String(reasonRaw).trim();
    if (reason.length < HANDOFF_REASON_MIN) return { ok: false, error: `Devir gerekçesi zorunludur (en az ${HANDOFF_REASON_MIN} karakter).` };
    if (reason.length > HANDOFF_REASON_MAX) return { ok: false, error: `Devir gerekçesi en fazla ${HANDOFF_REASON_MAX} karakter olabilir.` };
  }

  const present = HANDOFF_SCOPES.filter((s) => form.get(`scope_${s}`) !== null);
  const scopes = present.length
    ? present.filter((s) => form.get(`scope_${s}`) === "1")
    : [...HANDOFF_SCOPES];
  if (!scopes.length) return { ok: false, error: "Devredilecek en az bir kapsam seçin." };
  return { ok: true, input: { from, to, scopes, reason } };
}
