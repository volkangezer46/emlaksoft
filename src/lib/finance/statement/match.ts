/**
 * Ekstre satırı -> öneri eşleştirme (SAF; DB/saat yok). Sıra:
 *  1) "Zaten kayıtlı": aynı yön + aynı tutar + tarih ±3 gün, açıklama benzerliği puanı yükseltir (her hareket en çok bir satıra).
 *  2) Tahsilat: komisyon / kira / aidat tahsilatıyla tutar (+ tarih) eşleşmesi (yalnız ofis hesabı, giriş).
 *  3) Düzenli ödeme kuralı: aynı yön + tutar, ödeme gününe ±5 gün yakın.
 *  4) Kategori tahmini: açıklamadaki anahtar sözcükler (kira, SGK, sahibinden, elektrik ...).
 * Hiçbir öneri kendiliğinden kaydedilmez; kullanıcı tek ekranda onaylar/düzeltir.
 */
import { isCashCategory, SALARY_CATEGORY, type CashDirection } from "@/lib/finance/cash/categories";
import { foldHeader } from "./parse";

export type MatchLine = { id: string; date: string; dir: CashDirection; amount: number; description: string };
export type EntryCandidate = { id: string; date: string; dir: CashDirection; amount: number; title: string; counterparty: string | null };
export type CollectionCandidate = {
  source: "commission" | "rent" | "building";
  id: string;
  /** Tahsilat tarihi; komisyonda yok (null) -> yalnız tutar eşleşir. */
  date: string | null;
  /** Eşleşebilecek tutarlar (komisyon: brüt ve KDV'li). */
  amounts: readonly number[];
  label: string;
};
export type RuleCandidate = { id: string; dir: CashDirection; amount: number; payDay: number; title: string; category: string };

export type Suggestion =
  | { kind: "existing"; entryId: string; label: string; confidence: "high" | "medium" }
  | { kind: "collection"; source: "commission" | "rent" | "building"; sourceId: string; category: string; label: string }
  | { kind: "recurring"; ruleId: string; category: string; title: string; label: string }
  | { kind: "rule"; ruleId: string; category: string; partyId: string | null; mode: "suggest" | "auto"; label: string }
  | { kind: "category"; category: string; label: string }
  | { kind: "none" };

/** Ofisin kaydettiği otomatik kategori kuralı (finance_rules satırının eşleştirmede kullanılan kısmı). */
export type FinanceRuleLike = {
  id: string;
  direction: CashDirection | null;
  matchText: string | null;
  ibanLast4: string | null;
  amountMin: number | null;
  amountMax: number | null;
  category: string;
  partyId: string | null;
  mode: "suggest" | "auto";
};

export type MatchContext = {
  entries: readonly EntryCandidate[];
  collections: readonly CollectionCandidate[];
  rules: readonly RuleCandidate[];
  /** Ofisin kategori kuralları (finance_rules); düzenli ödemeden sonra, anahtar sözcük tahmininden önce denenir. */
  financeRules?: readonly FinanceRuleLike[];
  /** Maaş kategorisini önerebilir mi (yalnız ofis sahibi / GM). */
  canSalary: boolean;
};

/** Onay ekranından RPC'ye giden karar (saf). Düzenli ödeme önerisi `recurring` eylemidir ve ruleId taşır; `create` olarak GİTMEZ
 *  (yoksa cron'un yazdığı dönem + ekstre satırı iki gider üretirdi). */
export type ApplyDecision = {
  lineId: string;
  action: "create" | "match" | "skip" | "recurring";
  category?: string | null;
  title?: string | null;
  entryId?: string | null;
  ruleId?: string | null;
  sourceType?: "commission" | "rent" | "building" | null;
  sourceId?: string | null;
};
export type ReviewChoice = { action: "create" | "match" | "skip"; category: string };

export function buildDecision(lineId: string, s: Suggestion, choice: ReviewChoice): ApplyDecision {
  if (choice.action === "skip") return { lineId, action: "skip" };
  if (choice.action === "match" && s.kind === "existing") return { lineId, action: "match", entryId: s.entryId };
  // Kullanıcı kategoriyi önerilenden değiştirdiyse düzenli ödeme değil, sıradan hareket oluşturur.
  if (s.kind === "recurring" && s.category === choice.category) return { lineId, action: "recurring", ruleId: s.ruleId };
  const collection = s.kind === "collection" && s.category === choice.category ? { sourceType: s.source, sourceId: s.sourceId } : {};
  return { lineId, action: "create", category: choice.category, title: s.kind === "recurring" ? s.title : null, ...collection };
}

const DAY_MS = 86_400_000;
export function dayNumber(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.round(Date.UTC(y!, m! - 1, d!) / DAY_MS);
}
/** 1970-01-01'den gün sayısı -> "YYYY-MM-DD" (Date nesnesi kullanmadan; Hinnant civil_from_days). */
export function isoFromDayNumber(days: number): string {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function shiftIso(iso: string, days: number): string {
  return isoFromDayNumber(dayNumber(iso) + days);
}

const cents = (n: number) => Math.round(n * 100);

function tokens(text: string): Set<string> {
  return new Set(foldHeader(text).split(" ").filter((t) => t.length >= 3));
}

/** 0..1 sözcük örtüşmesi (Jaccard). */
export function descriptionSimilarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  return inter / (ta.size + tb.size - inter);
}

// ---------------------------------------------------------------------------
// Kategori tahmini
// ---------------------------------------------------------------------------
type KeywordRule = { category: string; words: readonly string[] };

const OUT_KEYWORDS: readonly KeywordRule[] = [
  { category: "maas", words: ["maas", "ucret odemesi", "personel"] },
  { category: "sgk", words: ["sgk", "sosyal guvenlik", "bagkur", "vergi", "kdv", "muhtasar", "gelir idaresi", "damga"] },
  { category: "portal", words: ["sahibinden", "hepsiemlak", "zingat", "emlakjet", "emlak jet"] },
  { category: "reklam", words: ["google ads", "meta ads", "facebook", "instagram", "reklam", "tanitim"] },
  { category: "muhasebe", words: ["muhasebe", "mali musavir", "smmm"] },
  { category: "aidat", words: ["aidat", "site yonetim", "apartman yonetim"] },
  { category: "kira", words: ["kira", "kirasi"] },
  { category: "ulasim", words: ["akaryakit", "benzin", "opet", "shell", "petrol ofisi", "hgs", "ogs", "otopark", "taksi", "uber"] },
  { category: "ofis", words: ["elektrik", "dogalgaz", "dogal gaz", "su faturasi", "igdas", "iski", "enerjisa", "internet", "turkcell", "vodafone", "turk telekom", "kirtasiye", "temizlik"] },
];

const IN_KEYWORDS: readonly KeywordRule[] = [
  { category: "komisyon", words: ["komisyon", "hizmet komisyon"] },
  { category: "aidat_tahsilat", words: ["aidat"] },
  { category: "kira_tahsilat", words: ["kira", "kirasi"] },
  { category: "hizmet_bedeli", words: ["hizmet bedeli", "danismanlik", "ekspertiz"] },
];

/** Açıklamaya göre kategori tahmini; bulunamazsa genel "diger_*". Maaş yalnız yetkiliye önerilir. */
export function guessCategory(description: string, dir: CashDirection, canSalary: boolean): { category: string; matched: boolean } {
  const folded = ` ${foldHeader(description)} `;
  const table = dir === "out" ? OUT_KEYWORDS : IN_KEYWORDS;
  for (const rule of table) {
    if (rule.category === SALARY_CATEGORY && !canSalary) continue;
    // Sözcük BAŞI eşleşmesi: "kira" -> "kirasi/kira bedeli"; "ogs" -> "xogs" değil.
    if (rule.words.some((w) => folded.includes(` ${w}`))) {
      if (isCashCategory(rule.category, dir)) return { category: rule.category, matched: true };
    }
  }
  return { category: dir === "out" ? "diger_gider" : "diger_gelir", matched: false };
}

// ---------------------------------------------------------------------------
// Ana eşleştirme
// ---------------------------------------------------------------------------
export function suggestAll(lines: readonly MatchLine[], ctx: MatchContext): Map<string, Suggestion> {
  const out = new Map<string, Suggestion>();

  // 1) Mevcut hareketler: tüm (satır, hareket) çiftleri puanlanır, en yüksek puandan açgözlü atanır.
  type Pair = { lineId: string; entryId: string; score: number; days: number; entry: EntryCandidate };
  const pairs: Pair[] = [];
  const entriesByAmount = new Map<string, EntryCandidate[]>();
  for (const e of ctx.entries) {
    const k = `${e.dir}|${cents(e.amount)}`;
    const list = entriesByAmount.get(k);
    if (list) list.push(e);
    else entriesByAmount.set(k, [e]);
  }
  for (const l of lines) {
    const ld = dayNumber(l.date);
    for (const e of entriesByAmount.get(`${l.dir}|${cents(l.amount)}`) ?? []) {
      const days = Math.abs(dayNumber(e.date) - ld);
      if (days > 3) continue;
      const sim = Math.max(descriptionSimilarity(l.description, e.title), e.counterparty ? descriptionSimilarity(l.description, e.counterparty) : 0);
      pairs.push({ lineId: l.id, entryId: e.id, score: 100 - days * 10 + sim * 20, days, entry: e });
    }
  }
  pairs.sort((a, b) => b.score - a.score);
  const usedEntries = new Set<string>();
  for (const p of pairs) {
    if (out.has(p.lineId) || usedEntries.has(p.entryId)) continue;
    usedEntries.add(p.entryId);
    out.set(p.lineId, {
      kind: "existing",
      entryId: p.entryId,
      label: `Zaten kayıtlı: ${p.entry.title}`,
      confidence: p.days === 0 || p.score >= 95 ? "high" : "medium",
    });
  }

  // 2) Tahsilatlar (yalnız giriş satırı), 3) düzenli ödeme kuralları, 4) kategori
  const usedCollections = new Set<string>();
  const usedRules = new Set<string>();
  for (const l of lines) {
    if (out.has(l.id)) continue;
    const ld = dayNumber(l.date);
    const lc = cents(l.amount);

    if (l.dir === "in") {
      let best: { c: CollectionCandidate; score: number } | null = null;
      for (const c of ctx.collections) {
        if (usedCollections.has(`${c.source}:${c.id}`)) continue;
        if (!c.amounts.some((a) => cents(a) === lc)) continue;
        let score = 10 + descriptionSimilarity(l.description, c.label) * 10;
        if (c.date) {
          const days = Math.abs(dayNumber(c.date) - ld);
          if (days > 3) continue;
          score += 50 - days * 10;
        }
        if (!best || score > best.score) best = { c, score };
      }
      if (best) {
        usedCollections.add(`${best.c.source}:${best.c.id}`);
        const category = best.c.source === "commission" ? "komisyon" : best.c.source === "rent" ? "kira_tahsilat" : "aidat_tahsilat";
        out.set(l.id, { kind: "collection", source: best.c.source, sourceId: best.c.id, category, label: best.c.label });
        continue;
      }
    }

    const day = Number(l.date.slice(8, 10));
    const rule = ctx.rules.find((r) => !usedRules.has(r.id) && r.dir === l.dir && cents(r.amount) === lc && Math.abs(r.payDay - day) <= 5);
    if (rule && (rule.category !== SALARY_CATEGORY || ctx.canSalary)) {
      usedRules.add(rule.id);
      out.set(l.id, { kind: "recurring", ruleId: rule.id, category: rule.category, title: rule.title, label: `Düzenli ödeme: ${rule.title}` });
      continue;
    }

    const byRule = ctx.financeRules?.length ? suggestFromRules(l, ctx.financeRules, ctx.canSalary) : null;
    if (byRule) {
      out.set(l.id, byRule);
      continue;
    }

    const guess = guessCategory(l.description, l.dir, ctx.canSalary);
    out.set(l.id, guess.matched ? { kind: "category", category: guess.category, label: "Açıklamaya göre tahmin" } : { kind: "none" });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Ofis kuralları (finance_rules): "kural olarak kaydet" -> sonraki benzer satırda öneri
// ---------------------------------------------------------------------------

/** Banka açıklamalarında her satırda geçen, kuralı ayırt etmeyen sözcükler. */
const RULE_NOISE = new Set([
  "eft", "havale", "fast", "swift", "odeme", "odemesi", "islem", "islemi", "ref", "referans", "aciklama", "tl", "try", "trl",
  "gelen", "giden", "hesap", "hesaptan", "hesaba", "musteri", "no", "nolu", "tarih", "pos", "kart", "kredi", "banka", "sube", "virman",
]);

/** Ekstre açıklamasından kural metni: ilk 3 anlamlı sözcük (rakam, kısa ve banka gürültüsü sözcükleri atılır). Boşsa "". */
export function ruleTextFromDescription(description: string): string {
  const words = foldHeader(description)
    .split(" ")
    .filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !RULE_NOISE.has(w));
  return words.slice(0, 3).join(" ");
}

/** Kural satıra uyar mı: yön, IBAN son 4, tutar aralığı ve kural metninin TÜM sözcükleri açıklamada (sözcük başı) geçmeli. */
export function ruleMatchesLine(rule: FinanceRuleLike, line: { dir: CashDirection; amount: number; description: string; ibanLast4?: string | null }): boolean {
  if (rule.direction && rule.direction !== line.dir) return false;
  if (rule.amountMin !== null && line.amount < rule.amountMin) return false;
  if (rule.amountMax !== null && line.amount > rule.amountMax) return false;
  if (rule.ibanLast4 && rule.ibanLast4 !== (line.ibanLast4 ?? null)) return false;
  const words = rule.matchText ? foldHeader(rule.matchText).split(" ").filter(Boolean) : [];
  // Hiçbir koşulu olmayan kural her satıra uymasın (yalnız yön/tutar aralığıyla eşleşme yeterli değildir).
  if (words.length === 0 && !rule.ibanLast4) return false;
  const folded = ` ${foldHeader(line.description)} `;
  return words.every((w) => folded.includes(` ${w}`));
}

/** İlk uyan kuraldan öneri; daha uzun metinli (daha özel) kural önce denenir. Maaş yalnız yetkiliye, kategori yönle uyumlu olmalı. */
export function suggestFromRules(
  line: { dir: CashDirection; amount: number; description: string; ibanLast4?: string | null },
  rules: readonly FinanceRuleLike[],
  canSalary: boolean,
): Extract<Suggestion, { kind: "rule" }> | null {
  const ordered = [...rules].sort((a, b) => (b.matchText?.length ?? 0) - (a.matchText?.length ?? 0));
  for (const r of ordered) {
    if (!ruleMatchesLine(r, line)) continue;
    if (r.category === SALARY_CATEGORY && !canSalary) continue;
    // Ekstre onayı yalnız sistem kategorisiyle hareket üretir (finance_statement_apply); ofis kategorili kural burada önerilmez.
    if (!isCashCategory(r.category, line.dir)) continue;
    return { kind: "rule", ruleId: r.id, category: r.category, partyId: r.partyId, mode: r.mode, label: r.matchText ? `Kural: "${r.matchText}"` : "Ofis kuralı" };
  }
  return null;
}
