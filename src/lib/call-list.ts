/**
 * Arama listesi (hafif "power dialer") — hangi müşterinin hangi sırayla aranacağı. SAF: veri okumaz, saat okumaz.
 *
 * Girdi: kapsamdaki müşteriler + tek okuyucudan (`lib/customer-state`) gelen durumları + kullanıcının açık
 * `call_priority` içgörülerinin müşteri sırası (ana ekrandaki "Bugün ara" kartıyla aynı kaynaklar).
 * Kural:
 *  - kara liste, telefonsuz ya da durumu hesaplanamayan müşteri listeye girmez;
 *  - bugün temas edilmiş müşteri (son temas 0 gün) listeden düşer — sonuç kaydedilince liste ilerler;
 *  - sıra: 1) arama önceliği içgörüsü (içgörü sırası), 2) yüksek kaybedilme riski, 3) sıcak müşteri,
 *    4) "dokun / teyit / randevu / kurtar" sonraki adımı olan diğerleri; kademe içinde ısı puanı, sonra temassız gün.
 */
import type { CustomerState, NextBestAction } from "@/lib/customer-state/core";

export const CALL_LIST_MAX = 40;

export type CallListTier = "oncelik" | "risk" | "sicak" | "takip";

export const CALL_LIST_TIER_LABELS: Readonly<Record<CallListTier, string>> = {
  oncelik: "Arama önceliği",
  risk: "Kaybedilme riski",
  sicak: "Sıcak müşteri",
  takip: "Takip zamanı",
};

const TIER_ORDER: readonly CallListTier[] = ["oncelik", "risk", "sicak", "takip"];
const FOLLOW_UP_ACTIONS: ReadonlySet<NextBestAction["key"]> = new Set(["kurtar", "dokun", "teyit", "randevu"]);

export type CallListState = Pick<
  CustomerState,
  "temperature" | "risk" | "nextBestAction" | "daysSinceContact" | "reasons"
> & { heatScore: number };

export type CallListCandidate = {
  id: string;
  name: string;
  phone: string | null;
  blacklist: boolean;
  state: CallListState | null | undefined;
};

export type CallListEntry = {
  customerId: string;
  name: string;
  phone: string;
  tier: CallListTier;
  reasons: string[];
  nextAction: { text: string; href: string } | null;
  daysSinceContact: number | null;
};

function tierOf(c: CallListCandidate, state: CallListState, priority: ReadonlyMap<string, number>): CallListTier | null {
  if (priority.has(c.id)) return "oncelik";
  if (state.risk === "yuksek") return "risk";
  if (state.temperature === "sicak") return "sicak";
  if (state.nextBestAction && FOLLOW_UP_ACTIONS.has(state.nextBestAction.key)) return "takip";
  return null;
}

export function buildCallList(
  candidates: readonly CallListCandidate[],
  priorityCustomerIds: readonly string[] = [],
  max = CALL_LIST_MAX,
): CallListEntry[] {
  const priority = new Map<string, number>();
  priorityCustomerIds.forEach((id, i) => {
    if (!priority.has(id)) priority.set(id, i);
  });
  const seen = new Set<string>();
  const picked: { entry: CallListEntry; rank: number; heat: number }[] = [];
  for (const c of candidates) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    const state = c.state;
    const phone = (c.phone ?? "").trim();
    if (!state || c.blacklist || !phone) continue;
    if (state.daysSinceContact === 0) continue;
    const tier = tierOf(c, state, priority);
    if (!tier) continue;
    const reasons = state.reasons.map((r) => r.label).filter(Boolean).slice(0, 3);
    picked.push({
      entry: {
        customerId: c.id,
        name: c.name || "Müşteri",
        phone,
        tier,
        reasons: reasons.length ? reasons : [CALL_LIST_TIER_LABELS[tier]],
        nextAction: state.nextBestAction ? { text: state.nextBestAction.text, href: state.nextBestAction.href } : null,
        daysSinceContact: state.daysSinceContact,
      },
      rank: tier === "oncelik" ? (priority.get(c.id) ?? 0) : 0,
      heat: Number.isFinite(state.heatScore) ? state.heatScore : 0,
    });
  }
  picked.sort((a, b) => {
    const t = TIER_ORDER.indexOf(a.entry.tier) - TIER_ORDER.indexOf(b.entry.tier);
    if (t !== 0) return t;
    if (a.rank !== b.rank) return a.rank - b.rank;
    if (a.heat !== b.heat) return b.heat - a.heat;
    return (b.entry.daysSinceContact ?? -1) - (a.entry.daysSinceContact ?? -1);
  });
  return picked.slice(0, Math.max(0, max)).map((p) => p.entry);
}

/** Bekleyen + bu oturumda kaydedilenler: kaydedilen müşteri listede "Arandı" olarak sona iner, sıradaki öne çıkar. */
export function splitCallQueue<T extends { customerId: string }>(
  entries: readonly T[],
  loggedIds: ReadonlySet<string>,
): { pending: T[]; done: T[] } {
  const pending: T[] = [];
  const done: T[] = [];
  for (const e of entries) (loggedIds.has(e.customerId) ? done : pending).push(e);
  return { pending, done };
}
