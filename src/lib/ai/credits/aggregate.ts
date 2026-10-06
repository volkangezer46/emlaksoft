import { quotaState, type QuotaState } from "@/lib/ai/credits/cost";

/** Defterden okunan bir kullanım (spend) satırı; tutar POZİTİF kredi olarak verilir. */
export type UsageRow = {
  tenantId?: string;
  userId: string | null;
  feature: string | null;
  credits: number;
  tokensIn: number;
  tokensOut: number;
};

export type UsageBucket = { key: string; credits: number; calls: number; tokens: number };

export type UsageSummary = {
  used: number;
  calls: number;
  tokens: number;
  byFeature: UsageBucket[];
  byUser: UsageBucket[];
};

const round2 = (n: number) => Math.round(n * 100) / 100;

function addTo(map: Map<string, UsageBucket>, key: string, row: UsageRow) {
  const b = map.get(key) ?? { key, credits: 0, calls: 0, tokens: 0 };
  b.credits += row.credits;
  b.calls += 1;
  b.tokens += row.tokensIn + row.tokensOut;
  map.set(key, b);
}

const sorted = (m: Map<string, UsageBucket>): UsageBucket[] =>
  [...m.values()].map((b) => ({ ...b, credits: round2(b.credits) })).sort((a, b) => b.credits - a.credits);

/** Kullanım satırlarını özellik ve kullanıcı kırılımına toplar (saf). */
export function summarizeUsage(rows: readonly UsageRow[]): UsageSummary {
  const byFeature = new Map<string, UsageBucket>();
  const byUser = new Map<string, UsageBucket>();
  let used = 0;
  let tokens = 0;
  for (const r of rows) {
    used += r.credits;
    tokens += r.tokensIn + r.tokensOut;
    addTo(byFeature, r.feature || "diger", r);
    addTo(byUser, r.userId || "sistem", r);
  }
  return { used: round2(used), calls: rows.length, tokens, byFeature: sorted(byFeature), byUser: sorted(byUser) };
}

export type QuotaView = {
  quota: number | null;
  used: number;
  remaining: number | null;
  percent: number | null;
  state: QuotaState;
};

/** Kota görünümü: kota boşsa sınırsız (kalan/yüzde null). */
export function quotaView(used: number, quota: number | null | undefined): QuotaView {
  const q = quota ?? null;
  const u = round2(used);
  if (q === null) return { quota: null, used: u, remaining: null, percent: null, state: "unlimited" };
  return {
    quota: q,
    used: u,
    remaining: round2(q - u),
    percent: q > 0 ? Math.round((u / q) * 100) : u > 0 ? 100 : 0,
    state: quotaState(u, q),
  };
}

/** Özellik anahtarının Türkçe etiketi (bilinmeyen anahtar olduğu gibi okunaklı döner). */
const FEATURE_LABELS: Record<string, string> = {
  tenant_chat: "AI asistan sohbeti",
  tenant_advisor: "AI asistan sohbeti",
  property_content: "İlan metni üretimi",
  property_translate: "İlan metni çevirisi",
  briefing_summary: "Günlük özet",
  call_summary: "Görüşme özeti",
  ocr: "Belge okuma (OCR)",
  document_ocr: "Belge okuma (OCR)",
  valuation_report: "Değerleme raporu",
  diger: "Diğer",
};

export function featureLabel(key: string): string {
  return FEATURE_LABELS[key] ?? key.replace(/[_-]+/g, " ");
}
