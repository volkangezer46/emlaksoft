/** İş yükü devri (denetim B5): seçenekler, gerekçe ve kimlik doğrulama saf yardımcıları. */
import type { AppModule } from "@/lib/permissions";
import { OPEN_STATUSES as FSBO_OPEN_STATUSES } from "@/lib/prospecting/types";

export const HANDOFF_SCOPES = ["customers", "properties", "deals", "tasks", "appointments", "fsbo_leads"] as const;
export type HandoffScope = (typeof HANDOFF_SCOPES)[number];

export const HANDOFF_SCOPE_LABELS: Record<HandoffScope, string> = {
  customers: "müşteri",
  properties: "portföy",
  deals: "açık anlaşma",
  tasks: "açık görev",
  appointments: "yaklaşan randevu",
  fsbo_leads: "sahibinden ilan adayı",
};

/** Kapsam başına gereken modül (devri yapan o modülde `edit` iznine sahip olmalı). */
export const HANDOFF_PERMISSION: Record<HandoffScope, AppModule> = {
  customers: "customers",
  properties: "properties",
  deals: "commissions",
  tasks: "tasks",
  appointments: "appointments",
  fsbo_leads: "prospecting",
};

/** Devredilen sahibinden adayı: açık (dönüşmemiş/kaybedilmemiş) durumlar — prospecting tek kaynağı. */
export const HANDOFF_FSBO_OPEN_STATUSES = FSBO_OPEN_STATUSES;

/** Devir RPC'si (migration 20261016120100). Yoksa eylem eski tablo tablo yola düşer. */
export const HANDOFF_RPC = "team_handoff_workload";

/**
 * Portföyle birlikte devralana geçen havuz ataması sayısı (seçilebilir kapsam değil; `properties` seçilince
 * RPC `listing_pool_entries` / `pool_assignments` atamalarını taşır ve bu anahtarla sayar).
 */
export const HANDOFF_POOL_COUNT_KEY = "listing_pool";

export type HandoffRpcResult = {
  counts: Partial<Record<HandoffScope, number>>;
  poolCount: number;
  ids: Partial<Record<HandoffScope, string[]>>;
};

/** RPC yanıtını doğrular (saf). Biçim bozuksa null; sahte sıfır üretilmez. */
export function parseHandoffRpcResult(raw: unknown): HandoffRpcResult | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as { counts?: unknown; ids?: unknown };
  if (!obj.counts || typeof obj.counts !== "object") return null;
  const c = obj.counts as Record<string, unknown>;
  const ids = (obj.ids && typeof obj.ids === "object" ? obj.ids : {}) as Record<string, unknown>;
  const counts: Partial<Record<HandoffScope, number>> = {};
  const outIds: Partial<Record<HandoffScope, string[]>> = {};
  for (const s of HANDOFF_SCOPES) {
    const n = Number(c[s]);
    if (!Number.isFinite(n) || n < 0) return null;
    counts[s] = n;
    const list = ids[s];
    outIds[s] = Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
  }
  const pool = Number(c[HANDOFF_POOL_COUNT_KEY] ?? 0);
  return { counts, poolCount: Number.isFinite(pool) && pool > 0 ? pool : 0, ids: outIds };
}

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
