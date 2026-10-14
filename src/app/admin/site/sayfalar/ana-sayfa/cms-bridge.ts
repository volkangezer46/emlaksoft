import { isCmsPath } from "@/lib/site-content/schema-core";

/**
 * Yerinde düzenleme: önizleme iframe'inden gelen `cms-select` mesajını süzer ve yolu editör sekmesine eşler (saf).
 * Mesaj YALNIZ şu durumda işlenir: kaynağı bizim iframe'imizin penceresi (`event.source === iframe.contentWindow`;
 * iframe opak kökende olduğundan köken karşılaştırması yerine kaynak kimliği esastır) VE yol şema izin listesinde.
 * Başka her mesaj yok sayılır. İframe içinde düzenleme yoktur; alan yan panelde açılır ve odaklanır.
 */
export type CmsMessageEvent = { source: unknown; data: unknown };

export function acceptCmsMessage(event: CmsMessageEvent, frameWindow: unknown): string | null {
  if (!frameWindow || event.source !== frameWindow) return null;
  const d = event.data as { type?: unknown; path?: unknown } | null;
  if (!d || typeof d !== "object" || d.type !== "cms-select") return null;
  return isCmsPath(d.path) ? d.path : null;
}

export type EditorTab = "layout" | "hero" | "sections" | "lists" | "tour" | "bento" | "why" | "valuation" | "ef" | "faq" | "testimonials" | "final" | "pages" | "versions";

const TAB_BY_ROOT: Record<string, EditorTab> = {
  hero: "hero",
  sections: "sections",
  valueCards: "lists",
  trust: "lists",
  highlights: "lists",
  steps: "lists",
  security: "lists",
  tour: "tour",
  bento: "bento",
  why: "why",
  valuation: "valuation",
  efSection: "ef",
  faq: "faq",
  testimonials: "testimonials",
  finalCta: "final",
};

/** İzinli yolun açılacağı sekme (izin listesi dışı yol için null). */
export function cmsTabFor(path: string): EditorTab | null {
  if (!isCmsPath(path)) return null;
  return TAB_BY_ROOT[path.split(".")[0]!] ?? null;
}

/** Odaklanacak alan seçicisi: önce tam yol, yoksa yolun altındaki ilk alan (liste yolları için). */
export function cmsFieldSelectors(path: string): [string, string] {
  const q = path.replace(/["\\]/g, "");
  return [`[data-cms-field="${q}"]`, `[data-cms-field^="${q}."]`];
}
