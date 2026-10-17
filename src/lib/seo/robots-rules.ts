import { effectiveIndexable } from "./metadata";
import { ALWAYS_DISALLOW, seoPages } from "./registry";
import type { SeoGlobal, SeoPages, SeoRobotsSettings } from "./schema";
import { autoOptimizeRegistryPaths } from "./scope";

/** robots.txt kuralları (SAF). Crawl-delay BİLEREK yoktur (Google yok sayar, Bing'de gereksiz yavaşlatır). */

export type RobotsRuleOut = { userAgent: string | string[]; allow?: string | string[]; disallow?: string | string[] };
export type RobotsOut = { rules: RobotsRuleOut[]; sitemap: string };

export function buildRobots(base: string, settings: SeoRobotsSettings): RobotsOut {
  const disallow = [...new Set<string>([...ALWAYS_DISALLOW, ...settings.extraDisallow])];
  const rules: RobotsRuleOut[] = [{ userAgent: "*", allow: "/", disallow }];
  for (const bot of settings.blockedAiBots) rules.push({ userAgent: bot, disallow: "/" });
  return { rules, sitemap: `${base.replace(/\/+$/, "")}/sitemap.xml` };
}

const asList = (v: string | string[] | undefined): string[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

/** robots.txt metni (Next'in MetadataRoute.Robots çıktısıyla aynı biçim; önizleme ve test için). */
export function robotsToText(r: RobotsOut): string {
  const blocks = r.rules.map((rule) => {
    const lines: string[] = [];
    for (const ua of asList(rule.userAgent)) lines.push(`User-Agent: ${ua}`);
    for (const a of asList(rule.allow)) lines.push(`Allow: ${a}`);
    for (const d of asList(rule.disallow)) lines.push(`Disallow: ${d}`);
    return lines.join("\n");
  });
  return `${blocks.join("\n\n")}\n\nSitemap: ${r.sitemap}\n`;
}

/**
 * llms.txt: isteğe bağlı site özeti. Varsayılan KAPALI. İçerik admin metnidir (düz metin), yoksa OTOMATİK üretilir:
 * yalnız `canAutoOptimize` izin listesindeki ve (override dahil) indekslenebilir registry sayfaları listelenir.
 * Üyelik/oturum (/kayit, /giris), ofis vitrinleri ve token'lı yüzeyler ASLA girmez.
 */
export function buildLlmsTxt(global: SeoGlobal, settings: SeoRobotsSettings, base: string, pages: SeoPages = {}): string | null {
  if (!settings.llmsTxtEnabled) return null;
  if (settings.llmsTxt.trim()) return `${settings.llmsTxt.trim()}\n`;
  const b = base.replace(/\/+$/, "");
  const allowed = new Set(autoOptimizeRegistryPaths());
  const defs = seoPages().filter((d) => allowed.has(d.path) && effectiveIndexable(d, pages[d.path]));
  const line = (d: (typeof defs)[number]) => {
    const desc = (pages[d.path]?.description ?? d.description ?? "").trim();
    const label = d.path === "/" ? "Ana sayfa" : d.label.replace(/^Araç:\s*/, "");
    return `- [${label}](${d.path === "/" ? `${b}/` : `${b}${d.path}`})${desc ? `: ${desc}` : ""}`;
  };
  const section = (title: string, list: typeof defs) => (list.length > 0 ? [`## ${title}`, ...list.map(line), ""] : []);
  return [
    `# ${global.siteName}`,
    "",
    `> ${global.defaultDescription}`,
    "",
    ...section("Genel sayfalar", defs.filter((d) => d.group === "ana" || d.group === "hesap")),
    ...section("Ücretsiz hesaplama araçları", defs.filter((d) => d.group === "arac")),
    ...section("Yasal metinler", defs.filter((d) => d.group === "yasal")),
  ].join("\n");
}

export type LlmsFullGuide = { title: string; path: string; description: string; text: string };
export type LlmsFullHub = { title: string; path: string; count: number };

/** llms-full.txt üst sınırı (bayt). Aşılırsa son bölümler kesilir ve not düşülür. */
export const LLMS_FULL_MAX_BYTES = 400 * 1024;

/**
 * llms-full.txt: llms.txt ile AYNI anahtarla açılır (varsayılan KAPALI). llms.txt özetine ek olarak yayındaki
 * indekslenebilir rehber yazılarının TAM düz metni ve indekslenen bölge sayfaları listelenir. Ofis/ilan içeriği,
 * kişisel veri ve token'lı yüzeyler GİRMEZ; yazı metni yayındaki sürümdür (taslak değil).
 */
export function buildLlmsFullTxt(
  global: SeoGlobal,
  settings: SeoRobotsSettings,
  base: string,
  pages: SeoPages,
  extra: { guides: readonly LlmsFullGuide[]; hubs: readonly LlmsFullHub[] },
): string | null {
  const head = buildLlmsTxt(global, settings, base, pages);
  if (head === null) return null;
  const b = base.replace(/\/+$/, "");
  const parts: string[] = [head.trimEnd(), ""];
  if (extra.hubs.length > 0) {
    parts.push("## Bölgelere göre emlak ilanları", ...extra.hubs.map((h) => `- [${h.title}](${b}${h.path}): ${h.count} ilan`), "");
  }
  const enc = new TextEncoder();
  let size = enc.encode(parts.join("\n")).length;
  let cut = 0;
  for (const g of extra.guides) {
    const block = [`## ${g.title}`, "", `Adres: ${b}${g.path}`, g.description ? `Özet: ${g.description}` : "", "", g.text.trim(), ""].filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n");
    const n = enc.encode(block).length + 1;
    if (size + n > LLMS_FULL_MAX_BYTES) {
      cut += 1;
      continue;
    }
    parts.push(block);
    size += n;
  }
  if (cut > 0) parts.push(`(Boyut sınırı nedeniyle ${cut} yazı eklenmedi; tam liste: ${b}/rehber)`);
  return `${parts.join("\n").trimEnd()}\n`;
}
