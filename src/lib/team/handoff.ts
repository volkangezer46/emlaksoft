/** İş yükü devri (denetim B5): seçenekler, gerekçe ve kimlik doğrulama saf yardımcıları. */
import type { AppModule } from "@/lib/permissions";

export const HANDOFF_SCOPES = ["customers", "properties", "deals", "tasks", "appointments"] as const;
export type HandoffScope = (typeof HANDOFF_SCOPES)[number];

export const HANDOFF_SCOPE_LABELS: Record<HandoffScope, string> = {
  customers: "müşteri",
  properties: "portföy",
  deals: "açık anlaşma",
  tasks: "açık görev",
  appointments: "yaklaşan randevu",
};

/** Kapsam başına gereken modül (devri yapan o modülde `edit` iznine sahip olmalı). */
export const HANDOFF_PERMISSION: Record<HandoffScope, AppModule> = {
  customers: "customers",
  properties: "properties",
  deals: "commissions",
  tasks: "tasks",
  appointments: "appointments",
};

/** Devri yapanın düzenleme izni olan kapsamlar (arayüz: izni olmayan kapsam devre dışı; sunucu yine doğrular). */
export function handoffEditableScopes(perms: Partial<Record<string, readonly string[]>>): HandoffScope[] {
  return HANDOFF_SCOPES.filter((s) => (perms[HANDOFF_PERMISSION[s]] ?? []).includes("edit"));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const HANDOFF_REASON_MIN = 5;
export const HANDOFF_REASON_MAX = 300;

export type HandoffInput = { from: string; to: string; scopes: HandoffScope[]; reason: string };

type Getter = { get(name: string): FormDataEntryValue | null };

/**
 * Form alanları: from, to (uuid), reason (ZORUNLU, 5-300 karakter), her kapsam için `scope_<ad>` = "1" | "0".
 * Eski form toleransı yoktur: gerekçe veya kapsam alanları hiç gönderilmezse istek reddedilir; en az bir kapsam
 * "1" olmalıdır. Açık talepler müşteri sahipliğiyle birlikte taşınır (`customer_demands`te ayrı sahip kolonu yoktur).
 */
export function parseHandoffInput(form: Getter): { ok: true; input: HandoffInput } | { ok: false; error: string } {
  const from = String(form.get("from") ?? "").trim();
  const to = String(form.get("to") ?? "").trim();
  if (!from || !to) return { ok: false, error: "Devreden ve devralan danışman seçilmelidir." };
  if (!UUID_RE.test(from) || !UUID_RE.test(to)) return { ok: false, error: "Danışman kimliği geçersiz." };
  if (from === to) return { ok: false, error: "İş yükü aynı danışmana devredilemez." };

  const reason = String(form.get("reason") ?? "").trim();
  if (reason.length < HANDOFF_REASON_MIN) return { ok: false, error: `Devir gerekçesi zorunludur (en az ${HANDOFF_REASON_MIN} karakter).` };
  if (reason.length > HANDOFF_REASON_MAX) return { ok: false, error: `Devir gerekçesi en fazla ${HANDOFF_REASON_MAX} karakter olabilir.` };

  const scopes = HANDOFF_SCOPES.filter((s) => form.get(`scope_${s}`) === "1");
  if (!scopes.length) return { ok: false, error: "Devredilecek en az bir kapsam seçin." };
  return { ok: true, input: { from, to, scopes, reason } };
}
