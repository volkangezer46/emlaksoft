import type { AdvisorContext } from "@/lib/ai-advisor";
import type { KnowledgeBase } from "../knowledge/base";
import { anyPhrase, cleanQuery, foldQuery, tokens } from "../normalize";
import { formatTry } from "../metrics";
import { clip, confidenceFrom, helpFromHits, type ToolOutput } from "../tools";
import type { ZekaCard, ZekaResult } from "../types";

/**
 * YÖNETİM (platform personeli) yüzeyi — SAF, SALT OKUNUR. Sayılar mevcut platform danışmanı bağlamından
 * (`buildAdvisorContext`: ofis sayıları, MRR, deneme hunisi, destek talepleri); bağlam yalnız `advisor` modülü görünen
 * personele okunur. Sayfa önerileri personelin GÖREBİLDİĞİ yönetim menüsünden (`adminPaletteFor`). Yazma yok.
 */

export type AdminLink = { href: string; label: string; description: string };
export type AdminEnv = { kb: KnowledgeBase; links: readonly AdminLink[]; context: (() => Promise<AdvisorContext | null>) | null; queryVector?: readonly number[] | null };

type AdminMetric = { id: string; words: readonly string[]; label: string; value: (c: AdvisorContext) => string; href: string };

export const ADMIN_METRICS: readonly AdminMetric[] = [
  { id: "mrr", words: ["mrr", "aylik gelir", "aylik tekrarlayan", "abonelik geliri", "ciro"], label: "Aylık tekrarlayan gelir (MRR)", value: (c) => formatTry(c.mrr), href: "/admin/billing" },
  { id: "arpa", words: ["arpa", "ofis basina gelir", "ortalama gelir"], label: "Ofis başına ortalama gelir", value: (c) => formatTry(c.arpa), href: "/admin/billing" },
  { id: "trial_ending", words: ["deneme biten", "denemesi biten", "biten deneme", "deneme bitiyor", "denemesi bitiyor", "bitmek uzere"], label: "Denemesi 7 gün içinde biten ofis", value: (c) => String(c.trialsEndingSoon), href: "/admin/tenants?deneme=bitiyor" },
  { id: "trial", words: ["deneme", "denemede"], label: "Denemedeki ofis", value: (c) => String(c.tenantsTrial), href: "/admin/tenants?durum=trial" },
  { id: "past_due", words: ["gecikmis odeme", "odemesi gecik", "askida", "askiya", "borclu"], label: "Ödemesi gecikmiş / askıdaki ofis", value: (c) => String(c.tenantsPastDue), href: "/admin/tenants" },
  { id: "new", words: ["yeni ofis", "son 30 gun", "bu ay acilan", "yeni kayit"], label: "Son 30 günde açılan ofis", value: (c) => String(c.newTenants30), href: "/admin/tenants" },
  { id: "urgent", words: ["acil talep", "acil destek", "acil"], label: "Acil destek talebi", value: (c) => String(c.urgentTickets), href: "/admin/tickets" },
  { id: "tickets", words: ["destek talebi", "acik talep", "ticket", "destek"], label: "Açık destek talebi", value: (c) => String(c.openTickets), href: "/admin/tickets" },
  { id: "active", words: ["aktif ofis", "odeyen ofis"], label: "Aktif ofis", value: (c) => String(c.tenantsActive), href: "/admin/tenants" },
  { id: "members", words: ["kullanici sayisi", "kac kullanici", "toplam kullanici", "uye"], label: "Toplam kullanıcı", value: (c) => String(c.members), href: "/admin/tenants" },
  { id: "tenants", words: ["ofis", "musteri ofis", "kac ofis", "toplam ofis"], label: "Toplam ofis", value: (c) => String(c.tenantsTotal), href: "/admin/tenants" },
];

export function pickAdminMetric(query: string): AdminMetric | null {
  const toks = tokens(query);
  return ADMIN_METRICS.find((m) => anyPhrase(toks, m.words)) ?? null;
}

const DATA_RE = /\b(kac|ne kadar|toplam|sayisi|mrr|arpa|durum|ozet)\b/;

export async function adminMetricTool(env: AdminEnv, query: string): Promise<ToolOutput | null> {
  const m = pickAdminMetric(query);
  if (!m) return null;
  if (!env.context) return { answer: "Platform özetini görme yetkiniz yok (Danışman modülü).", cards: [], actions: [], followUps: [], answered: false, confidence: 0.9, summary: { durum: "yetki_yok" } };
  const c = await env.context();
  if (!c) return { answer: "Platform özeti şu an okunamadı.", cards: [], actions: [{ kind: "navigate", label: "Genel bakış", href: "/admin" }], followUps: [], answered: false, confidence: 0.4, summary: { durum: "okunamadi" } };
  const value = m.value(c);
  const cards: ZekaCard[] = [{ kind: "metric", label: m.label, value, href: m.href }];
  return { answer: `${m.label}: ${value}.`, cards, actions: [{ kind: "navigate", label: "Listeyi aç", href: m.href }], followUps: ["MRR ne kadar?", "Denemesi biten ofisler", "Acil destek talebi var mı?"], answered: true, confidence: 0.88, summary: { durum: "hesaplandi", metrik: m.id, etiket: m.label, deger: value } };
}

export function adminNavTool(env: AdminEnv, query: string): ToolOutput {
  const core = foldQuery(query);
  const scored = env.links
    .map((l) => {
      const t = foldQuery(`${l.label} ${l.description}`);
      const words = core.split(" ").filter((w) => w.length >= 3);
      const hit = words.filter((w) => t.includes(w.slice(0, Math.max(4, w.length - 2)))).length;
      return { l, score: (foldQuery(l.label) === core ? 10 : 0) + hit };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  if (scored.length > 0) {
    const top = scored[0]!.l;
    return {
      answer: `${top.label}: ${top.description}`,
      cards: scored.slice(0, 4).map(({ l }) => ({ kind: "nav", label: l.label, description: l.description, href: l.href })),
      actions: [{ kind: "navigate", label: `${top.label} aç`, href: top.href }],
      followUps: [],
      answered: true,
      confidence: scored[0]!.score >= 10 ? 0.9 : 0.65,
      summary: { durum: "bulundu", sayfalar: scored.slice(0, 4).map(({ l }) => ({ ad: l.label, yol: l.href })) },
    };
  }
  const hits = env.kb.search(query, { surface: "admin" }, { limit: 4, queryVector: env.queryVector });
  const out = helpFromHits(hits, query);
  out.confidence = confidenceFrom(hits);
  out.actions = out.actions.filter((a) => !a.href.startsWith("/app"));
  return out;
}

export async function answerLocalAdmin(raw: string, env: AdminEnv): Promise<ZekaResult> {
  const q = cleanQuery(raw);
  const isData = DATA_RE.test(foldQuery(q));
  const metric = isData || pickAdminMetric(q) ? await adminMetricTool(env, q) : null;
  const out = metric ?? adminNavTool(env, q);
  return {
    surface: "admin",
    engine: "local",
    intent: metric ? "data" : out.answered ? "navigate" : "unknown",
    answer: out.answered || out.cards.length ? out.answer : `${out.answer} Ofis sayıları, MRR, deneme ve destek taleplerini sorabilirsiniz.`,
    cards: out.cards,
    actions: out.actions,
    followUps: out.followUps.length ? out.followUps : ["Kaç aktif ofis var?", "MRR ne kadar?", "Açık destek talebi kaç?"],
    confidence: out.confidence,
    answered: out.answered,
  };
}

export const ZEKA_ADMIN_TOOL_DEFS = [
  {
    type: "function" as const,
    function: {
      name: "platform_summary",
      description: "Platform sayıları (toplam/aktif/deneme/gecikmiş ofis, MRR, ARPA, son 30 gün yeni ofis, biten denemeler, açık/acil destek talebi, kullanıcı). Yalnız okur.",
      parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "navigate",
      description: "Personelin görebildiği yönetim sayfaları ve ayarlar arasında en uygununu bulur.",
      parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    },
  },
];

export const ADMIN_RULES = [
  "Sen EmlakSoft yönetim panelinin salt okunur asistanısın (platform personeli için). Türkçe, kısa yanıt ver.",
  "Sayıları YALNIZ araç sonuçlarından al; uydurma. Hiçbir şeyi değiştiremezsin; işlem için ilgili sayfaya yönlendir.",
  "Para tutarlarını tam yaz (₺12.500.000); kısaltma kullanma.",
].join("\n");

export { clip };
