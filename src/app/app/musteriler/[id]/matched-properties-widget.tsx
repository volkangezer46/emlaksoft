import type { ScoredMatch } from "@/lib/match-candidates";
import { moneyTry } from "@/lib/leak-shield";
import { MatchStateBadge } from "../../talepler/match-state-badge";
import { matchFitLabel } from "./match-send-message";
import { MatchSendCard, type MatchSendRow } from "./match-send-card";

type Props = {
  /** Skorlanan açık talep sayısı. */
  demandCount: number;
  /** TEK okuyucudan (loadDemandMatches) gelen, skor sırasına dizili ve gizlenenleri ayıklanmış çiftler. */
  pairs: ScoredMatch[];
  /** Açılmış paylaşım bağlantıları ("açıldı" rozeti). */
  openedTokens: ReadonlySet<string>;
  /** Müşteri beğenmedi + "uygun değil" ile gizlenen çift sayısı. */
  hiddenCount: number;
  truncated: boolean;
  customerId?: string | null;
  nowMs: number;
  /** Gönderim iletisi için: müşteri adı ve numarası, danışman ve ofis imzası. */
  send: { customerName: string; phone: string | null; advisorName: string | null; officeName: string | null };
  simple: boolean;
};

/** Yayındaki ilan müşteriye gönderilebilir (paylaşım sayfası yalnız yayındakini gösterir). */
const SENDABLE_STATUSES = new Set(["live", "Yayında"]);

/**
 * Müşteri 360 "Uygun ilanlar (n)" (C14): talep detayı ve Eşleşme sekmesiyle AYNI kural (CRM-G3). Aynı ilan birden çok
 * talebe uyuyorsa en iyi skorlu çift gösterilir (ilan tekrar etmez). Seçim ve WhatsApp gönderimi istemci kartında.
 */
export function MatchedPropertiesWidget({ demandCount, pairs, openedTokens, hiddenCount, truncated, customerId = null, nowMs, send, simple }: Props) {
  if (demandCount === 0) return null;

  const seen = new Set<string>();
  const unique = pairs.filter((p) => {
    if (seen.has(p.property.id)) return false;
    seen.add(p.property.id);
    return true;
  });
  if (unique.length === 0 && hiddenCount === 0) return null;

  const allHref = customerId ? `/app/talepler?sekme=eslesme&customer=${customerId}` : "/app/talepler?sekme=eslesme";
  const rows: MatchSendRow[] = unique.map((pair) => {
    const opened = Boolean(pair.state?.share_token && openedTokens.has(pair.state.share_token));
    const price = pair.property.list_price != null ? moneyTry(pair.property.list_price) : null;
    const title = pair.property.title ?? pair.property.property_code ?? "İlan";
    return {
      key: `${pair.demand.id}-${pair.property.id}`,
      demandId: pair.demand.id,
      propertyId: pair.property.id,
      title,
      // İç kod öne çıkmaz: önce fiyat, kod yalnız tam görünümde ve en sonda.
      meta: [price, simple ? null : pair.property.property_code].filter(Boolean).join(" · "),
      listPrice: pair.property.list_price ?? null,
      fit: matchFitLabel(pair.tier),
      score: pair.score,
      sendable: SENDABLE_STATUSES.has(String(pair.property.status ?? "")),
      badges:
        pair.state || pair.likedByCustomer ? (
          <>
            {pair.likedByCustomer ? (
              <span className="rounded-full bg-mint-500/12 px-2 py-0.5 text-xs font-bold text-mint-600">Müşteri beğendi</span>
            ) : null}
            <MatchStateBadge state={pair.state} nowMs={nowMs} opened={opened} />
          </>
        ) : undefined,
    };
  });

  return (
    <MatchSendCard
      rows={rows}
      total={unique.length}
      visible={simple ? 5 : 6}
      allHref={allHref}
      hidden={hiddenCount > 0 && customerId ? { href: `${allHref}&gizlenen=1`, count: hiddenCount } : null}
      truncated={truncated}
      customerName={send.customerName}
      phone={send.phone}
      advisorName={send.advisorName}
      officeName={send.officeName}
      simple={simple}
    />
  );
}
