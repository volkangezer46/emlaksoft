import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getHelpContent } from "@/lib/help-center/store";
import { now } from "@/lib/clock";
import type { ZekaSurface } from "../types";
import { KnowledgeBase } from "./base";
import {
  actionChunks,
  faqChunks,
  glossaryChunks,
  guideChunks,
  intentChunks,
  navChunks,
  planChunks,
  qaChunks,
  siteChunks,
  termChunks,
  type ApprovedQa,
  type KnowledgeChunk,
  type PlanInfo,
  type SitePageInfo,
} from "./chunks";

/**
 * Bilgi tabanı yükleyicisi (sunucu). Kod parçaları + yardım merkezinin yayınlanmış DB içeriği (`getHelpContent`, etiketli
 * önbellek) + onaylı soru-cevaplar (`zeka_qa`, RLS: yalnız etkin çiftler) + varsa gömme vektörleri (`zeka_knowledge_vectors_read`).
 * Süreç içi önbellek 5 dk (yüzey başına); yardım içeriği / soru-cevap değişince en geç 5 dk sonra yansır, sürüm değişir.
 * Tablo/RPC yoksa (migration uygulanmadı) ilgili katman boş geçilir; motorlar kod bilgisiyle çalışmayı sürdürür.
 */

const TTL_MS = 5 * 60_000;
const MISSING = new Set(["42P01", "PGRST205", "PGRST202", "42883"]);

type Cached = { at: number; kb: KnowledgeBase };
const cache = new Map<string, Cached>();
let vectorCache: { at: number; map: Map<string, number[]> } | null = null;

export async function loadApprovedQa(surface: ZekaSurface): Promise<ApprovedQa[]> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("zeka_qa")
      .select("id, surface, question, answer, href")
      .eq("status", "active")
      .in("surface", ["all", surface])
      .limit(500);
    if (error) return [];
    return ((data ?? []) as ApprovedQa[]).filter((r) => r.question && r.answer);
  } catch {
    return [];
  }
}

/** Gömme vektörleri (kurulu değilse boş harita). */
export async function loadVectors(): Promise<Map<string, number[]>> {
  const t = now();
  if (vectorCache && t - vectorCache.at < TTL_MS) return vectorCache.map;
  const map = new Map<string, number[]>();
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("zeka_knowledge_vectors_read");
    if (!error) {
      for (const r of (data ?? []) as { chunk_id: string; embedding: number[] | null }[]) {
        if (Array.isArray(r.embedding) && r.embedding.length > 0) map.set(r.chunk_id, r.embedding.map(Number));
      }
    } else if (!MISSING.has(String(error.code ?? ""))) {
      // Okuma hatası: sözcüksel aramaya düşülür (sessiz; kişisel veri yok).
    }
  } catch {
    // ağ/oturum hatası: boş harita
  }
  vectorCache = { at: t, map };
  return map;
}

async function helpChunks(): Promise<KnowledgeChunk[]> {
  try {
    const help = await getHelpContent();
    return [...faqChunks(help.faq), ...guideChunks(help.guides), ...glossaryChunks(help.glossary)];
  } catch {
    return [...faqChunks(), ...guideChunks(), ...glossaryChunks()];
  }
}

async function publicChunks(): Promise<KnowledgeChunk[]> {
  const [{ getPublicPricing }, { seoPages }, { buildHomeFaqs }, { getLiveSiteContent }] = await Promise.all([
    import("@/lib/billing/public-pricing"),
    import("@/lib/seo/registry"),
    import("@/components/marketing/faq"),
    import("@/lib/site-content/store"),
  ]);
  const [pricing, content] = await Promise.all([getPublicPricing().catch(() => null), getLiveSiteContent().catch(() => null)]);
  const plans: PlanInfo[] = (pricing?.plans ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    monthlyTry: pricing?.offers[p.id]?.monthlyTry ?? p.monthlyTry,
    blurb: p.blurb,
    features: p.features,
  }));
  const pages: SitePageInfo[] = seoPages().map((p) => ({ path: p.path, label: p.label, description: p.description }));
  const homeFaq = buildHomeFaqs({ trialDays: pricing?.trialDays, plans: pricing?.plans ?? [], content: content?.faq });
  return [...planChunks(plans, pricing?.trialDays ?? null), ...siteChunks(pages, homeFaq)];
}

async function adminChunks(): Promise<KnowledgeChunk[]> {
  const [{ ADMIN_NAV }, { listSettingDefs }] = await Promise.all([import("@/lib/admin/nav"), import("@/lib/settings/registry")]);
  const out: KnowledgeChunk[] = [];
  const seen = new Set<string>();
  for (const section of ADMIN_NAV) {
    for (const item of section.items) {
      for (const link of [item, ...(item.tabs ?? []), ...(item.palette ?? [])]) {
        if (seen.has(link.href)) continue;
        seen.add(link.href);
        out.push({ id: `admin:${link.href}`, source: "nav", title: link.label, body: `${link.description} (${section.title})`, href: link.href, modules: [], surfaces: ["admin"] });
      }
    }
  }
  for (const d of listSettingDefs({ scope: "platform" })) {
    out.push({ id: `setting:${d.key}`, source: "setting", title: d.label, body: `${d.description} Etkisi: ${d.impact}`, href: d.editHref ?? "/admin/ayarlar", modules: [], surfaces: ["admin"] });
  }
  return out;
}

/** Yüzeyin bilgi tabanı (süreç içi önbellekli). */
export async function getKnowledgeBase(surface: ZekaSurface): Promise<KnowledgeBase> {
  const t = now();
  const hit = cache.get(surface);
  if (hit && t - hit.at < TTL_MS) return hit.kb;
  const [help, qa, vectors, extra] = await Promise.all([
    surface === "app" || surface === "public" ? helpChunks() : Promise.resolve([] as KnowledgeChunk[]),
    loadApprovedQa(surface),
    loadVectors(),
    surface === "public" ? publicChunks().catch(() => [] as KnowledgeChunk[]) : surface === "admin" ? adminChunks().catch(() => [] as KnowledgeChunk[]) : Promise.resolve([] as KnowledgeChunk[]),
  ]);
  const base: KnowledgeChunk[] =
    surface === "app" ? [...navChunks(), ...actionChunks(), ...intentChunks(), ...termChunks()] : surface === "public" ? termChunks() : [];
  const kb = new KnowledgeBase([...base, ...help, ...extra, ...qaChunks(qa)], vectors);
  cache.set(surface, { at: t, kb });
  return kb;
}

/** Yönetici "yeniden kur" / soru-cevap değişince süreç içi önbelleği boşaltır. */
export function invalidateKnowledgeCache(): void {
  cache.clear();
  vectorCache = null;
}

/** Gömme dizini için TÜM yüzeylerin parçaları (gece bakımı; QA dahil). */
export async function allChunksForIndex(qa: readonly ApprovedQa[]): Promise<KnowledgeChunk[]> {
  const [help, pub, admin] = await Promise.all([helpChunks(), publicChunks().catch(() => []), adminChunks().catch(() => [])]);
  const seen = new Set<string>();
  return [...navChunks(), ...actionChunks(), ...intentChunks(), ...termChunks(), ...help, ...pub, ...admin, ...qaChunks(qa)].filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
}
