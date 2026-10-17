import type { AppModule } from "@/lib/permissions";
import { NAV_PAGE_LABELS, NAV_SECTIONS, PALETTE_ONLY_PAGES } from "@/lib/nav-config";
import { APP_ACTIONS, PALETTE_INTENTS } from "@/lib/palette-core";
import { FAQ, FAQ_PRICE_PATTERN, type FaqItem } from "@/lib/help-faq";
import { GLOSSARY, GUIDES, type GlossaryEntry, type Guide } from "@/lib/help-content";
import { PLAIN_LABELS, TERMS } from "@/lib/terms";
import { stripEidsPenaltyAmounts } from "@/lib/eids/legal-text";
import type { ZekaSurface } from "../types";

/**
 * Zeka BİLGİ KATMANI — kod içindeki TEK kaynaklardan parçalar (chunk) üretir; elle tutulan kopya YOKTUR:
 *  - rota/özellik grafiği: `nav-config.ts` (bölüm/öğe/sekme + eş anlamlılar) ve paletin menü dışı sayfaları,
 *  - oluşturma eylemleri: `palette-core.ts` APP_ACTIONS (+ ön dolgu parametreleri `prefill-params.ts` sözleşmesi),
 *  - niyet sözcükleri: `palette-core.ts` PALETTE_INTENTS,
 *  - yardım: `help-faq.ts` SSS, `help-content.ts` rehber ve sözlük (DB'deki yayınlanmış makaleler `getHelpContent` ile birleşir),
 *  - terminoloji: `terms.ts`,
 *  - paket/fiyat (yalnız public yüzey; canlı katalog `getPublicPricing`), ayar açıklamaları (registry),
 *  - yöneticinin onayladığı soru-cevap çiftleri (öğrenme döngüsü, `zeka_qa` tablosu).
 *
 * Parçalar sürümlüdür (`knowledgeVersion` = içerik özeti): içerik değişince sürüm değişir, gömme dizini yeniden kurulur.
 */

export type KnowledgeSource = "nav" | "action" | "intent" | "faq" | "guide" | "glossary" | "term" | "plan" | "site" | "setting" | "qa";

export type KnowledgeChunk = {
  id: string;
  source: KnowledgeSource;
  title: string;
  body: string;
  href?: string;
  /** Görmek için gereken izin modülleri (hepsi). Boş = herkese açık içerik. */
  modules: readonly AppModule[];
  /** true: oluşturma yetkisi gerekir (create). */
  needsCreate?: boolean;
  /** Arama ağırlığı için ek eş anlamlılar. */
  keywords?: readonly string[];
  surfaces: readonly ZekaSurface[];
};

const APP: readonly ZekaSurface[] = ["app"];
const APP_PUBLIC: readonly ZekaSurface[] = ["app", "public"];

/** Rota/özellik grafiği: menü kataloğundaki her öğe ve sekme + menü dışı aranabilir sayfalar. */
export function navChunks(): KnowledgeChunk[] {
  const out: KnowledgeChunk[] = [];
  const seen = new Set<string>();
  for (const section of NAV_SECTIONS) {
    for (const item of section.items) {
      const tabs = item.tabs && item.tabs.length > 0 ? item.tabs : [{ href: item.href, label: item.label, module: item.module, description: item.description, keywords: item.keywords }];
      for (const tab of tabs) {
        if (seen.has(tab.href)) continue;
        seen.add(tab.href);
        const own = tab.href === item.href;
        const label = NAV_PAGE_LABELS.get(tab.href) ?? (own ? item.label : `${item.label} · ${tab.label}`);
        const modules = item.needsItemModule && item.module !== tab.module ? [tab.module, item.module] : [tab.module];
        out.push({
          id: `nav:${tab.href}`,
          source: "nav",
          title: label,
          body: [tab.description ?? item.description, `${section.title} bölümünde.`].filter(Boolean).join(" "),
          href: tab.href,
          modules,
          keywords: [...(tab.keywords ?? []), ...(own ? (item.keywords ?? []) : []), section.title],
          surfaces: APP,
        });
      }
    }
  }
  for (const p of PALETTE_ONLY_PAGES) {
    if (seen.has(p.href)) continue;
    seen.add(p.href);
    out.push({
      id: `nav:${p.href}`,
      source: "nav",
      title: NAV_PAGE_LABELS.get(p.href) ?? p.label,
      body: p.description,
      href: p.href,
      modules: [p.module],
      keywords: p.keywords ?? [],
      surfaces: APP,
    });
  }
  return out;
}

/** Ön dolgu sözleşmesi (`prefill-params.ts` + sayfaların kendi parametreleri): Zeka bağlantı kurarken bunları kullanır. */
export const CREATE_PREFILL: Readonly<Record<string, readonly string[]>> = {
  "/app/randevular/yeni": ["customer", "property", "deal", "demand", "tarih", "saat", "tur"],
  "/app/gorevler/yeni": ["customer", "property", "deal", "demand"],
  "/app/anlasmalar/yeni": ["customer", "property", "deal", "demand"],
  "/app/teklifler/yeni": ["customer", "property", "deal", "demand"],
  "/app/talepler/yeni": ["customer", "property"],
  "/app/portfoyler/yeni": ["customer", "property"],
  "/app/sozlesmeler/yeni": ["customer", "property"],
  "/app/kiralama/yeni": ["customer", "property", "tutar"],
  "/app/acik-ev/yeni": ["customer", "property"],
  "/app/portfoyler/sunumlar/yeni": ["customer", "property"],
  "/app/musteriler/yeni": ["phone"],
};

export function actionChunks(): KnowledgeChunk[] {
  return APP_ACTIONS.map((a) => ({
    id: `action:${a.href}`,
    source: "action" as const,
    title: a.label,
    body: `${a.label} formunu açar.${CREATE_PREFILL[a.href.split("?")[0]!] ? ` Ön doldurulabilen alanlar: ${CREATE_PREFILL[a.href.split("?")[0]!]!.join(", ")}.` : ""}`,
    href: a.href,
    modules: [a.module],
    needsCreate: true,
    surfaces: APP,
  }));
}

export function intentChunks(): KnowledgeChunk[] {
  return PALETTE_INTENTS.map((i) => ({
    id: `intent:${i.id}`,
    source: "intent" as const,
    title: i.label,
    body: i.description,
    href: i.href,
    modules: [i.module],
    needsCreate: i.needs === "create",
    keywords: i.triggers.map((t) => t.join(" ")),
    surfaces: APP,
  }));
}

/** SSS: fiyat/tutar içeren kayıt beslenmez (güncel fiyat sayfada); EİDS ceza tutarı ürün fiyatı değildir. */
export function faqChunks(faq: readonly FaqItem[] = FAQ): KnowledgeChunk[] {
  return faq
    .filter((f) => !FAQ_PRICE_PATTERN.test(f.q) && !FAQ_PRICE_PATTERN.test(stripEidsPenaltyAmounts(f.a)))
    .map((f) => ({
      id: `faq:${f.id}`,
      source: "faq" as const,
      title: f.q,
      body: f.a,
      href: f.href,
      modules: [],
      surfaces: APP_PUBLIC,
    }));
}

export function guideChunks(guides: readonly Guide[] = GUIDES): KnowledgeChunk[] {
  return guides.map((g) => ({
    id: `guide:${g.slug}`,
    source: "guide" as const,
    title: g.title,
    body: `${g.intro} ${g.steps.map((s, i) => `${i + 1}) ${s}`).join(" ")}`,
    href: g.href,
    modules: [],
    surfaces: APP_PUBLIC,
  }));
}

export function glossaryChunks(glossary: readonly GlossaryEntry[] = GLOSSARY): KnowledgeChunk[] {
  return glossary.map((g) => ({
    id: `glossary:${g.slug}`,
    source: "glossary" as const,
    title: `${g.term} nedir?`,
    body: [g.short, g.detail].filter(Boolean).join(" "),
    href: g.href,
    modules: [],
    keywords: g.aka ? [g.aka] : [],
    surfaces: APP_PUBLIC,
  }));
}

export function termChunks(): KnowledgeChunk[] {
  const plain = Object.entries(PLAIN_LABELS as Record<string, { old: readonly string[]; use: string; note?: string }>).map(([k, v]) => ({
    id: `term:${k}`,
    source: "term" as const,
    title: v.use,
    body: `${v.old.join(", ")} yerine "${v.use}" denir.${v.note ? ` ${v.note}` : ""}`,
    modules: [] as AppModule[],
    keywords: [...v.old],
    surfaces: APP_PUBLIC,
  }));
  return [
    {
      id: "term:core",
      source: "term",
      title: "Temel terimler",
      body: `Ofisin kendi kaydı "${TERMS.property}" (kodu "${TERMS.propertyCode}"), portaldaki karşılığı "${TERMS.listing}". Satış süreci "${TERMS.deal}", kişi "${TERMS.customer}", aradığı ev "${TERMS.demand}".`,
      modules: [],
      keywords: ["portföy", "ilan", "anlaşma", "müşteri", "talep", "lead", "fırsat"],
      surfaces: APP_PUBLIC,
    },
    ...plain,
  ];
}

/** Paket parçaları (public yüzey; tam TL, kısaltma yok). */
export type PlanInfo = { id: string; name: string; monthlyTry: number; blurb: string; features: readonly string[] };

export function planChunks(plans: readonly PlanInfo[], trialDays: number | null): KnowledgeChunk[] {
  const money = (n: number) => `₺${Math.round(n).toLocaleString("tr-TR")}`;
  const chunks: KnowledgeChunk[] = plans.map((p) => ({
    id: `plan:${p.id}`,
    source: "plan" as const,
    title: `${p.name} paketi`,
    body: `${p.name} (${p.blurb}): aylık ${money(p.monthlyTry)} + KDV. ${p.features.join(" · ")}.`,
    href: "/fiyatlar",
    modules: [],
    keywords: ["fiyat", "ucret", "paket", "abonelik", p.name],
    surfaces: ["public"],
  }));
  if (trialDays) {
    chunks.push({
      id: "plan:trial",
      source: "plan",
      title: "Ücretsiz deneme",
      body: `EmlakSoft ${trialDays} gün ücretsiz denenir, kredi kartı gerekmez. Kayıt sayfasından ofisinizi birkaç dakikada açarsınız.`,
      href: "/kayit",
      modules: [],
      keywords: ["deneme", "ucretsiz", "kayit", "demo"],
      surfaces: ["public"],
    });
  }
  return chunks;
}

export type SitePageInfo = { path: string; label: string; description: string | null };

export function siteChunks(pages: readonly SitePageInfo[], homeFaq: readonly { q: string; a: string }[]): KnowledgeChunk[] {
  return [
    ...pages
      .filter((p) => p.description)
      .map((p) => ({
        id: `site:${p.path}`,
        source: "site" as const,
        title: p.label,
        body: p.description!,
        href: p.path,
        modules: [] as AppModule[],
        surfaces: ["public"] as const,
      })),
    ...homeFaq.map((f, i) => ({
      id: `site:faq:${i}`,
      source: "site" as const,
      title: f.q,
      body: f.a,
      href: "/#sss",
      modules: [] as AppModule[],
      surfaces: ["public"] as const,
    })),
  ];
}

/** Onaylı soru-cevap çiftleri (yönetici "Zeka eğitimi" ekranında ekler; iki motor da kullanır). */
export type ApprovedQa = { id: string; surface: ZekaSurface | "all"; question: string; answer: string; href: string | null };

export function qaChunks(rows: readonly ApprovedQa[]): KnowledgeChunk[] {
  return rows.map((r) => ({
    id: `qa:${r.id}`,
    source: "qa" as const,
    title: r.question,
    body: r.answer,
    href: r.href ?? undefined,
    modules: [],
    surfaces: r.surface === "all" ? (["app", "public", "vitrin", "admin"] as const) : [r.surface],
  }));
}

/** Koddan üretilen (DB'siz) uygulama bilgisi: her istekte aynı, modül düzeyinde bir kez kurulur. */
export function staticAppChunks(): KnowledgeChunk[] {
  return [...navChunks(), ...actionChunks(), ...intentChunks(), ...faqChunks(), ...guideChunks(), ...glossaryChunks(), ...termChunks()];
}

/** İçerik özeti (FNV-1a 32 bit, onaltılık): parçalar değişince sürüm değişir. */
export function knowledgeVersion(chunks: readonly KnowledgeChunk[]): string {
  let h = 0x811c9dc5;
  const text = chunks.map((c) => `${c.id}|${c.title}|${c.body}|${c.href ?? ""}`).sort().join("\n");
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
