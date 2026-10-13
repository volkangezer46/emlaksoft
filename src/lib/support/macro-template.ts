import { isTicketPriority, isTicketStatus, isUuid, type TicketPriority, type TicketStatus } from "@/lib/support/ticket-contract";

/**
 * Destek makroları (SAF): değişkenli metin + eylemler (durum, öncelik, atama, etiket).
 * Değişkenler `{{ofis.ad}}` biçimindedir; bilinmeyen değişken olduğu gibi kalır (sessizce silinmez ki yazan görsün).
 * Eylemler `ticket_macros.actions_json` içinde saklanır; uygulama sunucuda yetki kapısından geçer.
 */

export const MACRO_VARIABLES = [
  { key: "ofis.ad", label: "Ofis adı" },
  { key: "kullanici.ad", label: "Talebi açan kişinin adı" },
  { key: "bilet.no", label: "Talep numarası" },
  { key: "bilet.konu", label: "Talep konusu" },
  { key: "temsilci.ad", label: "Yanıtlayan temsilcinin adı" },
] as const;
export type MacroVariableKey = (typeof MACRO_VARIABLES)[number]["key"];
export type MacroVariables = Partial<Record<MacroVariableKey, string | null | undefined>>;

/** `{{ ofis.ad }}` boşluklu yazımı da kabul eder. Değer yoksa makul bir yedek kullanılır. */
export function renderMacroBody(body: string, vars: MacroVariables): string {
  const fallback: Record<MacroVariableKey, string> = {
    "ofis.ad": "ofisiniz",
    "kullanici.ad": "Merhaba",
    "bilet.no": "talebiniz",
    "bilet.konu": "talebiniz",
    "temsilci.ad": "EmlakSoft Destek",
  };
  return body.replace(/\{\{\s*([a-z]+\.[a-z]+)\s*\}\}/gi, (match, rawKey: string) => {
    const key = rawKey.toLowerCase() as MacroVariableKey;
    if (!(key in fallback)) return match;
    const value = vars[key]?.trim();
    return value ? value : fallback[key];
  });
}

export const MACRO_TAG_MAX = 10;
const TAG_RE = /^[\p{L}\p{N}][\p{L}\p{N} _-]{0,31}$/u;

/** Etiket: küçük harf, kırpılmış, harf/rakam ile başlar, en çok 32 karakter (DB kuralıyla aynı). */
export function normalizeTag(raw: string): string | null {
  const tag = raw.trim().toLocaleLowerCase("tr-TR").replace(/\s+/g, " ");
  return TAG_RE.test(tag) ? tag : null;
}

/** "fatura, iade  ,  acil" → ["fatura","iade","acil"] (tekrarsız, geçersizler atılır). */
export function parseTagList(raw: string): string[] {
  const out: string[] = [];
  for (const part of raw.split(/[,;\n]/)) {
    const tag = normalizeTag(part);
    if (tag && !out.includes(tag)) out.push(tag);
  }
  return out.slice(0, MACRO_TAG_MAX);
}

export type MacroActions = {
  status?: TicketStatus;
  priority?: TicketPriority;
  /** "me" = makroyu uygulayan kişi; uuid = belirli personel; "none" = atamayı kaldır. */
  assign?: "me" | "none" | string;
  addTags?: string[];
};

/** DB'den gelen jsonb'yi güvenli biçimde okur (bozuk alan atılır). */
export function parseMacroActions(raw: unknown): MacroActions {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const row = raw as Record<string, unknown>;
  const out: MacroActions = {};
  // Çözüm/kapatma çözüm özeti ister; makro yalnız aktif durumlara geçirir.
  if (typeof row.status === "string" && isTicketStatus(row.status) && ["open", "in_progress", "waiting"].includes(row.status)) {
    out.status = row.status;
  }
  if (typeof row.priority === "string" && isTicketPriority(row.priority)) out.priority = row.priority;
  if (typeof row.assign === "string" && (row.assign === "me" || row.assign === "none" || isUuid(row.assign))) out.assign = row.assign;
  if (Array.isArray(row.addTags)) {
    const tags = row.addTags.filter((t): t is string => typeof t === "string").map(normalizeTag).filter((t): t is string => Boolean(t));
    if (tags.length) out.addTags = [...new Set(tags)].slice(0, MACRO_TAG_MAX);
  }
  return out;
}

/** Form alanlarından eylem nesnesi (macro editor): action_status, action_priority, action_assign, action_tags. */
export function macroActionsFromForm(get: (name: string) => string): { actions: MacroActions; error?: string } {
  const status = get("action_status").trim();
  const priority = get("action_priority").trim();
  const assign = get("action_assign").trim();
  const tagsRaw = get("action_tags");
  const actions: MacroActions = {};
  if (status) {
    if (!isTicketStatus(status) || !["open", "in_progress", "waiting"].includes(status)) {
      return { actions: {}, error: "Makro yalnız açık, işleniyor veya yanıt bekliyor durumuna geçirebilir." };
    }
    actions.status = status;
  }
  if (priority) {
    if (!isTicketPriority(priority)) return { actions: {}, error: "Geçersiz öncelik." };
    actions.priority = priority;
  }
  if (assign) {
    if (assign !== "me" && assign !== "none" && !isUuid(assign)) return { actions: {}, error: "Geçersiz atama." };
    actions.assign = assign;
  }
  const tags = parseTagList(tagsRaw);
  if (tags.length) actions.addTags = tags;
  return { actions };
}

export function describeMacroActions(actions: MacroActions, staffName: (id: string) => string | undefined): string[] {
  const statusLabel: Record<string, string> = { open: "Açık", in_progress: "İşleniyor", waiting: "Yanıt bekliyor" };
  const priorityLabel: Record<string, string> = { low: "Düşük", normal: "Normal", high: "Yüksek", urgent: "Acil" };
  const out: string[] = [];
  if (actions.status) out.push(`Durum → ${statusLabel[actions.status] ?? actions.status}`);
  if (actions.priority) out.push(`Öncelik → ${priorityLabel[actions.priority]}`);
  if (actions.assign === "me") out.push("Atama → uygulayan kişi");
  else if (actions.assign === "none") out.push("Atama kaldırılır");
  else if (actions.assign) out.push(`Atama → ${staffName(actions.assign) ?? "personel"}`);
  if (actions.addTags?.length) out.push(`Etiket + ${actions.addTags.join(", ")}`);
  return out;
}

/** Makro düzenleme yetkisi: süper admin, operasyon ve müşteri temsilcisi (AD9). */
export const MACRO_EDITOR_ROLES = ["super_admin", "ops", "support"] as const;
export function canEditMacros(role: string): boolean {
  return (MACRO_EDITOR_ROLES as readonly string[]).includes(role);
}
