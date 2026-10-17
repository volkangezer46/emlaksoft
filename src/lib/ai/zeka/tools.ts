import { earningsPath, financePath } from "@/lib/finance/routes";
import { prefillHref } from "@/lib/prefill-params";
import type { NlGeo } from "@/lib/nl-search/parse";
import type { KnowledgeBase, KnowledgeHit } from "./knowledge/base";
import { ENTITY_BY_ID, ENTITY_DEFS } from "./lexicon";
import { METRICS, METRIC_IDS, formatTry, metricHref, metricPeriod, pickMetric, type MetricId, type MetricValue } from "./metrics";
import { foldQuery, stemTr } from "./normalize";
import { canCreate, canView, earningsAll, hrefBlocked, officeWide, type ZekaAppScope } from "./scope";
import { extractSlots, periodFor } from "./slots";
import type { ZekaAction, ZekaCard, ZekaEntity, ZekaPeriod, ZekaPeriodKey, ZekaRecordKind, ZekaSlots } from "./types";

/**
 * Zeka ARAÇ SETİ (uygulama yüzeyi) — yerel motor ve GPT motoru AYNI araçları kullanır (GPT'ye `function` olarak verilir).
 *
 * GÜVENLİK SÖZLEŞMESİ:
 *  - Araçlar YALNIZ OKUR. Veri kapısı (`ZekaDataPort`) yalnız okuma yöntemleri taşır; "oluştur" aracı yalnız ön
 *    doldurulmuş form BAĞLANTISI döner (kayıt, kullanıcı formu kaydedince mevcut kapılı action'la oluşur).
 *  - Yetki kapısı veriye gitmeden ÖNCE uygulanır (izin modülü + kapalı modül + earnings_all + ofis kapsamı); satır kapsamı
 *    ayrıca RLS + liste kapsamıyla (`getListScope`) veri kapısında uygulanır.
 *  - Para tam TL (₺12.500.000), kısaltma yok. Bilinmeyen uydurulmaz: araç bulamazsa `answered: false` döner.
 */

export type ZekaRecordHit = { id: string; kind: ZekaRecordKind; title: string; subtitle: string; href: string };

export type MetricQuery = { slots: ZekaSlots; period: ZekaPeriod | null; officeWide: boolean; earnings: boolean };

/** Salt-okunur veri kapısı (sunucu: RLS'li kullanıcı istemcisi, `port-supabase.ts`; test: sahte). */
export interface ZekaDataPort {
  search(text: string, limit: number): Promise<ZekaRecordHit[]>;
  metric(id: MetricId, q: MetricQuery): Promise<MetricValue | null>;
}

export type ToolEnv = {
  scope: ZekaAppScope;
  port: ZekaDataPort;
  kb: KnowledgeBase;
  nowMs: number;
  geo?: NlGeo;
  /** Gömme ile melez arama için sorgu vektörü (GPT kurulumu; yoksa BM25). */
  queryVector?: readonly number[] | null;
};

export type ToolOutput = {
  answer: string;
  cards: ZekaCard[];
  actions: ZekaAction[];
  followUps: string[];
  answered: boolean;
  confidence: number;
  /** GPT'ye dönen kısa, yapılandırılmış özet (kişisel veri `openai-client` içinde maskelenir). */
  summary: Record<string, unknown>;
};

const empty = (answer: string, summary: Record<string, unknown> = {}): ToolOutput => ({
  answer,
  cards: [],
  actions: [],
  followUps: [],
  answered: false,
  confidence: 0.3,
  summary: { durum: "bulunamadi", ...summary },
});

const filterOf = (env: ToolEnv) => ({
  surface: "app" as const,
  canView: (m: Parameters<typeof canView>[1]) => canView(env.scope, m),
  canCreate: (m: Parameters<typeof canCreate>[1]) => canCreate(env.scope, m),
  hrefBlocked: (h: string) => hrefBlocked(env.scope, h),
});

const RECORD_MODULE: Record<ZekaRecordKind, Parameters<typeof canView>[1]> = {
  customer: "customers",
  property: "properties",
  demand: "demands",
  deal: "commissions",
  task: "tasks",
  ticket: "support",
  listing: "properties",
};

/* --------------------------------- search_records --------------------------------- */

export async function toolSearchRecords(env: ToolEnv, args: { query: string; entity?: ZekaEntity | null }): Promise<ToolOutput> {
  const slots = extractSlots(args.query, { nowMs: env.nowMs, geo: env.geo });
  const entity = args.entity ?? slots.entity;
  const cards: ZekaCard[] = [];
  const actions: ZekaAction[] = [];

  // Portföy süzgeci (oda/fiyat/konum): listenin filtreli bağlantısı + sayı.
  const propertyFilters = Object.keys(slots.propertyParams).length > 0 && (entity === null || entity === "property");
  if (propertyFilters && canView(env.scope, "properties")) {
    const period = null;
    const value = await env.port.metric("properties", { slots, period, officeWide: officeWide(env.scope), earnings: earningsAll(env.scope) });
    const href = metricHref("properties", slots, period);
    const label = describePropertyFilters(slots);
    if (value && value.kind === "count") {
      cards.push({ kind: "metric", label: `${label} portföy`, value: String(value.count), href });
    }
    actions.push({ kind: "navigate", label: "Filtreli portföy listesini aç", href });
    if (canView(env.scope, "demands")) actions.push({ kind: "navigate", label: "Bu kriterde talep arayanlar", href: "/app/talepler?sekme=eslesme" });
  }

  const text = slots.phone ?? slots.listingCode ?? slots.personName ?? (slots.freeText || args.query);
  const hits = text.trim().length >= 2 ? await env.port.search(text, 8) : [];
  const visible = hits.filter((h) => canView(env.scope, RECORD_MODULE[h.kind]) && (!entity || entityMatchesKind(entity, h.kind)));
  for (const h of visible.slice(0, 6)) cards.push({ kind: "record", entity: h.kind, id: h.id, title: h.title, subtitle: h.subtitle, href: h.href });
  if (visible.length > 0) actions.push({ kind: "navigate", label: "Tüm sonuçları gör", href: `/app/arama-sonuclari?q=${encodeURIComponent(text.slice(0, 80))}` });

  const count = cards.filter((c) => c.kind === "record").length;
  const metric = cards.find((c) => c.kind === "metric");
  if (count === 0 && !metric) {
    const out = empty(`"${args.query.slice(0, 60)}" için kayıt bulamadım.`, { aranan: text.slice(0, 60) });
    out.followUps = ["Yeni müşteri ekle", "Portföylerde ara"];
    if (canCreate(env.scope, "customers") && slots.personName) {
      out.actions.push({ kind: "create", label: `"${slots.personName}" adıyla yeni müşteri`, href: prefillHref("/app/musteriler/yeni", {}, { phone: slots.phone }), confirm: "Form açılır; bilgileri kontrol edip siz kaydedersiniz." });
    }
    return out;
  }
  const parts: string[] = [];
  if (metric && metric.kind === "metric") parts.push(`${metric.label}: ${metric.value} kayıt.`);
  if (count > 0) parts.push(`${count} eşleşen kayıt buldum${visible.length > count ? ` (ilk ${count})` : ""}.`);
  return {
    answer: parts.join(" "),
    cards,
    actions,
    followUps: metric ? ["Bunlardan kaçı satılık?", "Bu bölgede talep var mı?"] : [],
    answered: true,
    confidence: 0.8,
    summary: {
      durum: "bulundu",
      kayitlar: visible.slice(0, 6).map((h) => ({ tur: h.kind, baslik: h.title, alt: h.subtitle })),
      sayi: metric && metric.kind === "metric" ? metric.value : undefined,
    },
  };
}

function entityMatchesKind(entity: ZekaEntity, kind: ZekaRecordKind): boolean {
  const map: Partial<Record<ZekaEntity, ZekaRecordKind[]>> = {
    customer: ["customer"],
    property: ["property", "listing"],
    demand: ["demand"],
    deal: ["deal"],
    task: ["task"],
  };
  return map[entity]?.includes(kind) ?? true;
}

export function describePropertyFilters(slots: ZekaSlots): string {
  const parts: string[] = [];
  if (slots.placeLabel) parts.push(slots.placeLabel.replace(/\s*\(.*\)$/, ""));
  if (slots.rooms.length) parts.push(slots.rooms.join("/"));
  if (slots.transaction) parts.push(slots.transaction.toLocaleLowerCase("tr-TR"));
  if (slots.propertyType) parts.push(slots.propertyType.toLocaleLowerCase("tr-TR"));
  if (slots.priceMin != null && slots.priceMax != null) parts.push(`${formatTry(slots.priceMin)}–${formatTry(slots.priceMax)}`);
  else if (slots.priceMax != null) parts.push(`${formatTry(slots.priceMax)} altı`);
  else if (slots.priceMin != null) parts.push(`${formatTry(slots.priceMin)} üstü`);
  return parts.join(" ") || "Tüm";
}

/* ---------------------------------- count_metric ---------------------------------- */

const PERIOD_KEYS: readonly ZekaPeriodKey[] = ["today", "tomorrow", "yesterday", "this_week", "next_week", "last_week", "this_month", "last_month", "this_year", "last_year"];

export async function toolCountMetric(env: ToolEnv, args: { query: string; metric?: MetricId | null; period?: ZekaPeriodKey | null }): Promise<ToolOutput> {
  const slots = extractSlots(args.query, { nowMs: env.nowMs, geo: env.geo });
  if (args.period && PERIOD_KEYS.includes(args.period)) slots.period = periodFor(args.period, env.nowMs);
  const id = args.metric && METRIC_IDS.includes(args.metric) ? args.metric : pickMetric(foldQuery(args.query), slots);
  if (!id) {
    const out = empty("Hangi sayıyı istediğinizden emin değilim.");
    out.followUps = ["Bu ay kaç satış yaptık?", "Geciken görevler kaç?", "Bugün kaç randevum var?"];
    return out;
  }
  const def = METRICS[id];
  const deny = metricDenial(env.scope, id);
  if (deny) return deny;

  const period = metricPeriod(id, slots, env.nowMs);
  const href = metricHref(id, slots, period);
  const value = await env.port.metric(id, { slots, period, officeWide: officeWide(env.scope), earnings: earningsAll(env.scope) });
  if (!value) return empty(`${def.label} sayısını şu an okuyamadım. Listeyi açıp kontrol edebilirsiniz.`, { metrik: id });

  const when = period ? ` (${period.label})` : "";
  const scopeNote = officeWide(env.scope) ? "" : " Sayı yalnız sizin kapsamınızdaki kayıtlardır.";
  const filterNote = id === "properties" ? describePropertyFilters(slots) : "";
  const label = id === "properties" && filterNote !== "Tüm" ? `${filterNote} portföy` : def.label;

  if (value.kind === "ranking") {
    if (value.rows.length === 0) {
      return { ...empty(`${period?.label ?? "Bu dönem"} kazanılan anlaşma yok; sıralama çıkmadı.`, { metrik: id }), answered: true, confidence: 0.75, actions: [{ kind: "navigate", label: "Ligi aç", href }] };
    }
    const top = value.rows[0]!;
    const cards: ZekaCard[] = value.rows.slice(0, 5).map((r, i) => ({
      kind: "metric",
      label: `${i + 1}. ${r.name}`,
      value: `${r.count} satış`,
      hint: r.amount != null ? formatTry(r.amount) : undefined,
      href,
    }));
    return {
      answer: `${period?.label ? `${capitalize(period.label)} ` : ""}en çok satış yapan danışman ${top.name}: ${top.count} kazanılan anlaşma${top.amount != null ? `, toplam ${formatTry(top.amount)}` : ""}.`,
      cards,
      actions: [{ kind: "navigate", label: "Ligi aç", href }],
      followUps: ["Bu ay kaç satış yaptık?", "Geçen ay en çok satan kim?"],
      answered: true,
      confidence: 0.86,
      summary: { durum: "hesaplandi", metrik: id, donem: period?.label, siralama: value.rows.slice(0, 5) },
    };
  }
  const shown = value.kind === "money" ? formatTry(value.amount) : String(value.count);
  const extra = value.kind === "money" ? ` (${value.count} anlaşma)` : "";
  return {
    answer: `${label}${when}: ${shown}${extra}.${scopeNote}`,
    cards: [{ kind: "metric", label: `${label}${when}`, value: shown, hint: value.kind === "money" ? `${value.count} anlaşma` : undefined, href }],
    actions: [{ kind: "navigate", label: "Listeyi aç", href }],
    followUps: followUpsFor(id),
    answered: true,
    confidence: 0.88,
    summary: { durum: "hesaplandi", metrik: id, etiket: label, donem: period?.label, deger: shown },
  };
}

const capitalize = (s: string) => s.charAt(0).toLocaleUpperCase("tr-TR") + s.slice(1);

function followUpsFor(id: MetricId): string[] {
  switch (id) {
    case "deals_won":
      return ["Geçen ay kaç satış yaptık?", "En çok satış yapan danışman kim?"];
    case "tasks_overdue":
      return ["Bugünkü görevlerim", "Yeni görev oluştur"];
    case "appointments":
      return ["Yarın kaç randevu var?", "Yeni randevu oluştur"];
    case "properties":
      return ["Bunlardan kaçı kiralık?", "Bu kriterde talep var mı?"];
    case "rent_overdue":
      return ["Aktif kira sayısı", "Bekleyen tahsilatlar"];
    default:
      return [];
  }
}

/** Yetki reddi (veri sorgusu HİÇ çalışmaz). Rolün göremeyeceği veri için sayı da ipucu da verilmez. */
export function metricDenial(scope: ZekaAppScope, id: MetricId): ToolOutput | null {
  const def = METRICS[id];
  if (!canView(scope, def.module)) {
    return { ...empty("Bu bilgi rolünüzün ya da ofisinizin açık modüllerinin kapsamında değil."), confidence: 0.9, summary: { durum: "yetki_yok", metrik: id } };
  }
  if (def.needsEarnings && !earningsAll(scope)) {
    const out = empty("Ofis geneli tutarları (ciro, komisyon toplamı) yalnız tüm kazançları görme izni olan kullanıcılar görür. Kendi kazancınızı Kazancım sayfasında görebilirsiniz.");
    out.confidence = 0.9;
    out.summary = { durum: "yetki_yok", metrik: id, neden: "earnings_all" };
    out.actions = [{ kind: "navigate", label: "Kazancım", href: earningsPath() }];
    return out;
  }
  if (def.needsOfficeWide && !officeWide(scope)) {
    const out = empty("Diğer danışmanların performansı yalnız yönetici rollerine açıktır. Kendi karnenizi Performansım sayfasında görebilirsiniz.");
    out.confidence = 0.9;
    out.summary = { durum: "yetki_yok", metrik: id, neden: "ofis_kapsami" };
    out.actions = [{ kind: "navigate", label: "Performansım", href: "/app/performansim" }];
    return out;
  }
  return null;
}

/* --------------------------------- prepare_create --------------------------------- */

const CREATE_ENTITIES = ENTITY_DEFS.filter((e) => e.createHref).map((e) => e.id);

export async function toolPrepareCreate(env: ToolEnv, args: { query: string; entity?: ZekaEntity | null; customer_name?: string | null; date?: string | null; time?: string | null }): Promise<ToolOutput> {
  const slots = extractSlots(args.query, { nowMs: env.nowMs, geo: env.geo });
  const entity = args.entity ?? slots.entity;
  if (entity === "finance" || entity === "dues") {
    if (!canCreate(env.scope, "expenses")) return { ...empty("Gelir/gider kaydı açma yetkiniz yok."), confidence: 0.9, summary: { durum: "yetki_yok" } };
    const href = financePath("kayit");
    return createResult(`Gelir/gider kaydı formunu hazırladım${slots.amount ? ` (tutar: ${formatTry(slots.amount)})` : ""}.`, [{ kind: "create", label: "Gelir/Gider kaydını aç", href, confirm: "Form açılır; tutarı ve hesabı kontrol edip siz kaydedersiniz." }], { varlik: entity });
  }
  const def = entity ? ENTITY_BY_ID.get(entity) : undefined;
  if (!def || !def.createHref || !CREATE_ENTITIES.includes(def.id)) {
    const out = empty("Neyi oluşturmak istediğinizi anlayamadım.");
    out.followUps = ["Yeni müşteri ekle", "Yarın 10:00 randevu", "Yeni görev oluştur"];
    return out;
  }
  const mod = def.createModule ?? def.module;
  if (!canCreate(env.scope, mod) || hrefBlocked(env.scope, def.createHref)) {
    return { ...empty(`${def.label} oluşturma yetkiniz yok ya da bu modül ofisinizde kapalı.`), confidence: 0.9, summary: { durum: "yetki_yok", varlik: def.id } };
  }

  const extra: Record<string, string | null> = {};
  const date = args.date && /^\d{4}-\d{2}-\d{2}$/.test(args.date) ? args.date : slots.date;
  const time = args.time && /^([01]\d|2[0-3]):[0-5]\d$/.test(args.time) ? args.time : slots.time;
  if (def.id === "appointment") {
    if (date) extra.tarih = date;
    if (time) extra.saat = time;
  }
  if (def.id === "customer" && slots.phone) extra.phone = slots.phone;

  const when = [date ? formatDay(date) : null, time].filter(Boolean).join(" ");
  const name = (args.customer_name ?? slots.personName ?? "").trim();
  const needsCustomer = def.id !== "customer" && def.id !== "campaign" && def.id !== "team";

  if (name && needsCustomer && canView(env.scope, "customers")) {
    const hits = (await env.port.search(name, 6)).filter((h) => h.kind === "customer");
    if (hits.length === 1) {
      const c = hits[0]!;
      const href = prefillHref(def.createHref, { customerId: c.id }, extra);
      return createResult(
        `${c.title} için ${when ? `${when} ` : ""}${def.label.toLocaleLowerCase("tr-TR")} formunu hazırladım. Kaydetmeden önce kontrol edin.`,
        [{ kind: "create", label: `${def.label} formunu aç`, href, confirm: "Form ön doldurulmuş açılır; hiçbir şey siz kaydedene kadar yazılmaz.", prefill: { musteri: c.title, ...(date ? { tarih: date } : {}), ...(time ? { saat: time } : {}) } }],
        { varlik: def.id, musteri: c.title, tarih: date, saat: time },
        [{ kind: "record", entity: "customer", id: c.id, title: c.title, subtitle: c.subtitle, href: c.href }],
      );
    }
    if (hits.length > 1) {
      const actions: ZekaAction[] = hits.slice(0, 3).map((c) => ({
        kind: "create",
        label: `${c.title} için aç`,
        href: prefillHref(def.createHref!, { customerId: c.id }, extra),
        confirm: "Form ön doldurulmuş açılır; siz kaydedersiniz.",
        prefill: { musteri: c.title },
      }));
      return createResult(`"${name}" adıyla ${hits.length} müşteri var; hangisi için ${def.label.toLocaleLowerCase("tr-TR")} açılsın?`, actions, { varlik: def.id, aday: hits.length }, hits.slice(0, 3).map((c) => ({ kind: "record", entity: "customer", id: c.id, title: c.title, subtitle: c.subtitle, href: c.href })), 0.7);
    }
    const actions: ZekaAction[] = [{ kind: "create", label: `${def.label} formunu aç`, href: prefillHref(def.createHref, {}, extra), confirm: "Müşteriyi formda seçersiniz." }];
    if (canCreate(env.scope, "customers")) actions.push({ kind: "create", label: `"${name}" yeni müşteri olarak ekle`, href: "/app/musteriler/yeni", confirm: "Form açılır; siz kaydedersiniz." });
    return createResult(`"${name}" adlı müşteri bulamadım. Formu açıp müşteriyi seçebilir ya da yeni müşteri ekleyebilirsiniz.`, actions, { varlik: def.id, musteri_bulunamadi: true }, [], 0.6);
  }

  const href = prefillHref(def.createHref, {}, extra);
  return createResult(`${def.label} formunu ${when ? `${when} için ` : ""}hazırladım.`, [{ kind: "create", label: `${def.label} formunu aç`, href, confirm: "Form açılır; siz kaydedersiniz." }], { varlik: def.id, tarih: date, saat: time });
}

const DAY_FMT = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", weekday: "long", timeZone: "UTC" });
function formatDay(key: string): string {
  return DAY_FMT.format(new Date(`${key}T00:00:00Z`));
}

function createResult(answer: string, actions: ZekaAction[], summary: Record<string, unknown>, cards: ZekaCard[] = [], confidence = 0.86): ToolOutput {
  return { answer, cards, actions, followUps: [], answered: true, confidence, summary: { durum: "form_hazir", yazilmadi: true, ...summary } };
}

/* ------------------------------ navigate / help_lookup ----------------------------- */

/** Gezinme sorgusunun çekirdeği: "portföyler sayfasını aç" → "portfoyler". */
export function navCore(query: string): string {
  const drop = new Set(["git", "sayfa", "sayfasi", "sayfasini", "ekran", "ekrani", "ekranini", "menu", "menusu", "goster", "ac", "acar", "misin", "nerede", "nereden", "bolum", "bolumu", "lutfen", "bana", "beni", "götür", "gotur"]);
  return foldQuery(query)
    .split(" ")
    .filter((t) => t && !drop.has(t))
    .join(" ");
}

export function toolNavigate(env: ToolEnv, args: { query: string }): ToolOutput {
  const core = navCore(args.query) || foldQuery(args.query);
  const sources = ["nav", "action", "intent"] as const;
  const lexical = env.kb.search(core, filterOf(env), { limit: 12, sources: [...sources], queryVector: env.queryVector });
  // Başlık eşleşmesi BM25'ten önce gelir: "ayarlar" → Ayarlar, "takvim" → Takvim sekmesi.
  const coreStem = core.split(" ").map((w) => stemTr(w)).join(" ");
  const titleScore = (title: string): number => {
    const t = foldQuery(title);
    const tStem = t.split(" ").map((w) => stemTr(w)).join(" ");
    if (t === core || tStem === coreStem) return 12;
    if (tStem.startsWith(coreStem) || t.split(" · ").some((p) => p === core)) return 6;
    if (coreStem.length >= 4 && tStem.split(" ").some((w) => w === coreStem)) return 4;
    return 0;
  };
  const pool = new Map<string, KnowledgeHit>();
  for (const h of lexical) pool.set(h.chunk.id, { chunk: h.chunk, score: h.score + titleScore(h.chunk.title) });
  for (const c of env.kb.allowedChunks(filterOf(env), [...sources])) {
    const bonus = titleScore(c.title);
    if (bonus > 0 && !pool.has(c.id)) pool.set(c.id, { chunk: c, score: bonus });
  }
  const hits = [...pool.values()].sort((a, b) => b.score - a.score || (a.chunk.source === "nav" ? -1 : 1));
  if (hits.length === 0) {
    const out = empty("Bu adla bir sayfa bulamadım.");
    out.followUps = ["Ayarlar", "Raporlar", "Yardım"];
    return out;
  }
  const seen = new Set<string>();
  const unique = hits.filter((h) => h.chunk.href && !seen.has(h.chunk.href) && seen.add(h.chunk.href));
  const top = unique[0]!;
  const firstSentence = top.chunk.body.split(/(?<=\.)\s/)[0] ?? top.chunk.body;
  return {
    answer: `${top.chunk.title}: ${firstSentence}`,
    cards: unique.slice(0, 4).map((h) => ({ kind: "nav", label: h.chunk.title, description: h.chunk.body, href: h.chunk.href! })),
    actions: [{ kind: top.chunk.needsCreate ? "create" : "navigate", label: `${top.chunk.title} aç`, href: top.chunk.href!, confirm: top.chunk.needsCreate ? "Form açılır; siz kaydedersiniz." : undefined }],
    followUps: [],
    answered: true,
    confidence: confidenceFrom(unique),
    summary: { durum: "bulundu", sayfalar: unique.slice(0, 4).map((h) => ({ ad: h.chunk.title, yol: h.chunk.href })) },
  };
}

export function toolHelpLookup(env: ToolEnv, args: { question: string }): ToolOutput {
  const hits = env.kb.search(args.question, filterOf(env), { limit: 4, sources: ["qa", "faq", "guide", "glossary", "term", "nav"], queryVector: env.queryVector });
  return helpFromHits(hits, args.question);
}

export function helpFromHits(hits: readonly KnowledgeHit[], question: string): ToolOutput {
  if (hits.length === 0) {
    const out = empty("Bu konuda kayıtlı bir yardım içeriği bulamadım. Yardım Merkezi'nde arayabilir ya da destek talebi açabilirsiniz.");
    out.actions = [{ kind: "navigate", label: "Yardım Merkezi'nde ara", href: `/app/yardim?q=${encodeURIComponent(question.slice(0, 80))}` }];
    return out;
  }
  const top = hits[0]!.chunk;
  const conf = confidenceFrom(hits);
  const body = clip(top.body, 420);
  const cards: ZekaCard[] = hits.slice(0, 3).map((h) => ({ kind: "help", title: h.chunk.title, body: clip(h.chunk.body, 220), href: h.chunk.href, source: h.chunk.source }));
  const actions: ZekaAction[] = top.href ? [{ kind: "navigate", label: "İlgili sayfayı aç", href: top.href }] : [];
  return {
    answer: conf < 0.5 ? `Emin değilim; en yakın içerik "${top.title}": ${body}` : body,
    cards,
    actions,
    followUps: hits.slice(1, 3).map((h) => h.chunk.title),
    answered: conf >= 0.5,
    confidence: conf,
    summary: { durum: "bulundu", icerik: hits.slice(0, 3).map((h) => ({ baslik: h.chunk.title, metin: clip(h.chunk.body, 500), yol: h.chunk.href })) },
  };
}

/** BM25 puanını kaba güvene çevirir (ilk sonucun ikinciden ayrışması da hesaba katılır). */
export function confidenceFrom(hits: readonly KnowledgeHit[]): number {
  if (hits.length === 0) return 0;
  const top = hits[0]!.score;
  const second = hits[1]?.score ?? 0;
  const base = top >= 6 ? 0.85 : top >= 3.5 ? 0.72 : top >= 2 ? 0.55 : top >= 0.5 && top <= 1 ? 0.55 : 0.4;
  const margin = top > 0 ? Math.min(0.1, ((top - second) / top) * 0.15) : 0;
  return Math.min(0.95, base + margin);
}

export function clip(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1).replace(/\s+\S*$/, "")}…` : s;
}

/* ------------------------------- GPT araç şeması ---------------------------------- */

/** GPT'ye verilen fonksiyon tanımları: yerel motorla AYNI araçlar. */
export const ZEKA_APP_TOOL_DEFS = [
  {
    type: "function" as const,
    function: {
      name: "search_records",
      description: "Ofisin kayıtlarında (müşteri, portföy, talep, anlaşma, görev) ad, telefon, portföy kodu ya da portföy süzgeciyle (ilçe, oda, fiyat) arar. Yalnız okur.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Kullanıcının aradığı metin ya da süzgeç (Türkçe, ör. 'Kadıköy 3+1 5 milyon altı')" },
          entity: { type: "string", enum: ["customer", "property", "demand", "deal", "task"], description: "İsteğe bağlı varlık türü" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "count_metric",
      description: "Gerçek sayı/toplam getirir ve filtreli listeye bağlantı verir (satış sayısı, geciken görev/kira, randevu, portföy sayısı, en çok satan danışman...). Yetki dışı veri reddedilir.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Sorunun kendisi (süzgeç ve dönem çıkarımı için)" },
          metric: { type: "string", enum: [...METRIC_IDS] },
          period: { type: "string", enum: [...PERIOD_KEYS] },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "prepare_create",
      description: "Yeni kayıt için ÖN DOLDURULMUŞ form bağlantısı hazırlar (randevu, görev, müşteri, talep, portföy, anlaşma, teklif...). HİÇBİR ŞEY YAZMAZ; kullanıcı formu açıp kendisi kaydeder.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          entity: { type: "string", enum: [...CREATE_ENTITIES, "finance"] },
          customer_name: { type: "string" },
          date: { type: "string", description: "YYYY-MM-DD" },
          time: { type: "string", description: "HH:MM" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "navigate",
      description: "Kullanıcının yetkili olduğu sayfalardan en uygununu bulur (menü, sekme, form).",
      parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "help_lookup",
      description: "EmlakSoft kullanım bilgisi (resmî SSS, rehber, sözlük, onaylı soru-cevap) içinde arar.",
      parameters: { type: "object", properties: { question: { type: "string" } }, required: ["question"] },
    },
  },
];

export type ZekaToolName = "search_records" | "count_metric" | "prepare_create" | "navigate" | "help_lookup";

/** GPT araç çağrısını doğrular ve çalıştırır (bilinmeyen araç/parametre = null). */
export async function runAppTool(env: ToolEnv, name: string, rawArgs: unknown): Promise<ToolOutput | null> {
  const a = (rawArgs && typeof rawArgs === "object" ? rawArgs : {}) as Record<string, unknown>;
  const str = (k: string, max = 300) => (typeof a[k] === "string" ? (a[k] as string).trim().slice(0, max) : "");
  const ent = (k: string) => {
    const v = str(k, 20);
    return (ENTITY_BY_ID.has(v as ZekaEntity) ? v : null) as ZekaEntity | null;
  };
  switch (name) {
    case "search_records":
      return str("query") ? toolSearchRecords(env, { query: str("query"), entity: ent("entity") }) : null;
    case "count_metric":
      return str("query")
        ? toolCountMetric(env, { query: str("query"), metric: (METRIC_IDS as readonly string[]).includes(str("metric", 40)) ? (str("metric", 40) as MetricId) : null, period: (PERIOD_KEYS as readonly string[]).includes(str("period", 20)) ? (str("period", 20) as ZekaPeriodKey) : null })
        : null;
    case "prepare_create":
      return str("query") ? toolPrepareCreate(env, { query: str("query"), entity: str("entity", 20) === "finance" ? "finance" : ent("entity"), customer_name: str("customer_name", 100) || null, date: str("date", 10) || null, time: str("time", 5) || null }) : null;
    case "navigate":
      return str("query") ? toolNavigate(env, { query: str("query") }) : null;
    case "help_lookup":
      return str("question") ? toolHelpLookup(env, { question: str("question") }) : null;
    default:
      return null;
  }
}
