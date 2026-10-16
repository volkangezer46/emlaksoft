/**
 * Kategori, cari ve mükerrer önerileri (SAF; DB okuması çağırana aittir).
 *
 *  - Kategori: (1) ofisin kendi kuralı (finance_rule_suggest) → (2) aynı carinin geçmişte en sık kullandığı kategori →
 *    (3) satıcı adı + kalemler + belge türünden anahtar sözcük (akaryakıt → Ulaşım, sahibinden/hepsiemlak → Portal,
 *    kırtasiye → Ofis ...). Kesin değildir; kullanıcı formda değiştirir.
 *  - Cari: önce VKN/TCKN birebir, sonra ad benzerliği (unvan ekleri — LTD, ŞTİ, A.Ş. — atılarak).
 *  - Mükerrer: aynı ETTN → aynı satıcı VKN + belge no → aynı tutar + tarih (±1 gün) + benzer satıcı.
 */
import { guessCategory } from "@/lib/finance/statement/match";
import { cashCategoryLabel } from "@/lib/finance/cash/categories";
import { entryEditHref, ENTRY_BASE } from "@/lib/finance/entry-workspace";
import { dayDiff, foldTr } from "./numbers";
import { nameSimilarity } from "./merge";
import type { CategorySuggestion, DuplicateHit, PartySuggestion, ReceiptFields } from "./types";

/** Fiş/faturaya özgü ek anahtar sözcükler (banka ekstresi listesine ek olarak; katlanmış biçimde). */
const RECEIPT_KEYWORDS: readonly { category: string; words: readonly string[]; confidence: number }[] = [
  {
    category: "ulasim",
    words: ["akaryakit", "petrol", "kursunsuz", "motorin", "benzin", "dizel", "diesel", "lpg", "otogaz", "opet", "shell", "aytemiz", "bp", "total", "po", "petrol ofisi", "lukoil", "moil", "oto yikama", "otopark", "hgs", "ogs", "taksi", "otobus", "pegasus", "thy", "turk hava yollari", "ajet", "anadolujet", "bilet", "istanbulkart", "kopru", "otoyol"],
    confidence: 0.82,
  },
  { category: "ofis", words: ["kirtasiye", "toner", "kartus", "fotokopi", "a4", "kagit", "zimba", "dosya", "klasor", "temizlik", "deterjan", "su faturasi", "elektrik", "dogalgaz", "internet", "superonline", "turknet", "ttnet", "turkcell", "vodafone", "turk telekom", "enerjisa", "ck enerji", "igdas", "iski", "aski", "izsu"], confidence: 0.78 },
  { category: "reklam", words: ["matbaa", "brosur", "kartvizit", "tabela", "afis", "reklam", "google", "meta platforms", "facebook", "instagram", "yandex", "branda", "baski"], confidence: 0.78 },
  { category: "muhasebe", words: ["mali musavir", "muhasebe", "smmm", "serbest muhasebeci"], confidence: 0.85 },
  { category: "aidat", words: ["aidat", "site yonetim", "apartman yonetim"], confidence: 0.8 },
  { category: "kira", words: ["kira", "kirasi", "isyeri kira"], confidence: 0.8 },
  { category: "ofis", words: ["market", "migros", "carrefour", "bim", "a101", "sok market", "file market", "gida", "kahve", "ikram"], confidence: 0.5 },
];

export function receiptCategoryText(f: ReceiptFields): string {
  return [f.sellerName?.value, ...(f.items?.value.map((i) => i.name) ?? [])].filter(Boolean).join(" ").slice(0, 500);
}

export function suggestCategory(input: {
  fields: ReceiptFields;
  rule?: { category: string } | null;
  /** Eşleşen carinin geçmiş kategorileri (en sık önce). */
  history?: readonly { category: string; count: number }[];
  labelOf?: (value: string) => string;
}): CategorySuggestion | undefined {
  const label = input.labelOf ?? cashCategoryLabel;
  if (input.rule?.category) return { value: input.rule.category, label: label(input.rule.category), confidence: 0.9, reason: "kural" };
  const top = input.history?.[0];
  if (top && top.count >= 2) return { value: top.category, label: label(top.category), confidence: Math.min(0.9, 0.7 + top.count * 0.03), reason: "gecmis" };

  const text = receiptCategoryText(input.fields);
  const folded = ` ${foldTr(text)} `;
  if (input.fields.docType?.value === "smm" && /\b(kira|kirasi)\b/.test(folded)) return { value: "kira", label: label("kira"), confidence: 0.85, reason: "anahtar" };
  for (const rule of RECEIPT_KEYWORDS) {
    if (rule.words.some((w) => folded.includes(w.length <= 3 ? ` ${w} ` : ` ${w}`))) {
      return { value: rule.category, label: label(rule.category), confidence: rule.confidence, reason: "anahtar" };
    }
  }
  const g = guessCategory(text, "out", false);
  if (g.matched) return { value: g.category, label: label(g.category), confidence: 0.75, reason: "anahtar" };
  if (top) return { value: top.category, label: label(top.category), confidence: 0.6, reason: "gecmis" };
  return undefined;
}

export type PartyLite = { id: string; name: string; taxId: string | null };

export function matchParty(f: ReceiptFields, parties: readonly PartyLite[]): PartySuggestion | undefined {
  const tax = f.sellerTaxId?.value;
  if (tax) {
    const exact = parties.find((p) => p.taxId === tax);
    if (exact) return { id: exact.id, name: exact.name, confidence: 0.99, reason: "vkn" };
  }
  const name = f.sellerName?.value;
  if (!name) return undefined;
  let bestP: PartyLite | null = null;
  let bestS = 0;
  for (const p of parties) {
    if (tax && p.taxId && p.taxId !== tax) continue; // farklı VKN'li cari aynı firma olamaz
    const s = nameSimilarity(name, p.name);
    if (s > bestS) {
      bestS = s;
      bestP = p;
    }
  }
  if (!bestP || bestS < 0.6) return undefined;
  return { id: bestP.id, name: bestP.name, confidence: Math.round(Math.min(0.9, bestS) * 100) / 100, reason: "ad" };
}

export type AttachmentLite = {
  id: string;
  entryId: string | null;
  extraction: { ettn?: string | null; sellerTaxId?: string | null; documentNo?: string | null; total?: number | null; date?: string | null; sellerName?: string | null } | null;
};
export type EntryLite = { id: string; amount: number; date: string; counterparty: string | null; title: string };

const INBOX_HREF = `${ENTRY_BASE.replace(/\/kayit$/, "")}?sekme=belgeler`;

/** Saklanan çıkarımdan (attachment.extraction jsonb) mükerrer anahtarlarını okur. */
export function duplicateKeysOf(json: unknown): AttachmentLite["extraction"] {
  if (!json || typeof json !== "object") return null;
  const fields = (json as { fields?: Record<string, { value?: unknown } | undefined> }).fields;
  if (!fields || typeof fields !== "object") return null;
  const str = (k: string) => (typeof fields[k]?.value === "string" ? (fields[k]!.value as string) : null);
  const num = (k: string) => (typeof fields[k]?.value === "number" ? (fields[k]!.value as number) : null);
  return { ettn: str("ettn"), sellerTaxId: str("sellerTaxId"), documentNo: str("documentNo"), total: num("total"), date: str("date"), sellerName: str("sellerName") };
}

export function findDuplicates(f: ReceiptFields, ctx: { selfId?: string | null; attachments: readonly AttachmentLite[]; entries: readonly EntryLite[] }): DuplicateHit[] {
  const hits: DuplicateHit[] = [];
  const seen = new Set<string>();
  const add = (h: DuplicateHit) => {
    const k = h.entryId ?? h.attachmentId ?? h.label;
    if (seen.has(k) || hits.length >= 5) return;
    seen.add(k);
    hits.push(h);
  };
  const href = (a: AttachmentLite) => (a.entryId ? entryEditHref(a.entryId) : INBOX_HREF);
  const docNo = f.documentNo?.value?.toUpperCase();
  const zKey = f.zNo?.value ? `${f.zNo.value}/${docNo ?? ""}` : null;
  for (const a of ctx.attachments) {
    if (a.id === ctx.selfId || !a.extraction) continue;
    const x = a.extraction;
    if (f.ettn && x.ettn && x.ettn.toLowerCase() === f.ettn.value.toLowerCase()) {
      add({ kind: "ettn", attachmentId: a.id, entryId: a.entryId ?? undefined, label: a.entryId ? "Aynı ETTN'li belge bir kayda bağlı" : "Aynı ETTN'li belge fiş kutusunda", href: href(a) });
      continue;
    }
    if (docNo && x.documentNo && x.documentNo.toUpperCase() === docNo && (!f.sellerTaxId || !x.sellerTaxId || x.sellerTaxId === f.sellerTaxId.value) && (f.sellerTaxId || zKey || x.total === f.total?.value)) {
      add({ kind: "belge_no", attachmentId: a.id, entryId: a.entryId ?? undefined, label: "Aynı satıcıdan aynı belge numarası daha önce yüklendi", href: href(a) });
      continue;
    }
    if (f.total && f.date && x.total != null && x.date && Math.abs(x.total - f.total.value) < 0.01 && Math.abs(dayDiff(x.date, f.date.value)) <= 1) {
      const sameSeller = (f.sellerTaxId && x.sellerTaxId === f.sellerTaxId.value) || (f.sellerName && x.sellerName && nameSimilarity(f.sellerName.value, x.sellerName) >= 0.6);
      if (sameSeller) add({ kind: "tutar_tarih", attachmentId: a.id, entryId: a.entryId ?? undefined, label: "Aynı satıcı, tutar ve tarihte belge var", href: href(a) });
    }
  }
  if (f.total && f.date) {
    for (const e of ctx.entries) {
      if (Math.abs(e.amount - f.total.value) >= 0.01 || Math.abs(dayDiff(e.date, f.date.value)) > 1) continue;
      const seller = f.sellerName?.value;
      const similar = !seller || nameSimilarity(seller, `${e.counterparty ?? ""} ${e.title}`) >= 0.4;
      if (similar) add({ kind: "tutar_tarih", entryId: e.id, label: `Aynı tutar ve tarihte kayıt: ${e.title.slice(0, 60)}`, href: entryEditHref(e.id) });
    }
  }
  return hits;
}
