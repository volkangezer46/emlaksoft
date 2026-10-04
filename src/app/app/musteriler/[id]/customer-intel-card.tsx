import Link from "next/link";
import { ArrowUpRight, Gauge } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { now } from "@/lib/clock";
import { heatTitle, HEAT_SEGMENTS } from "@/lib/customer-heat";
import { formatMinutes } from "@/lib/response-time/core";
import { buildCustomerIntel, type CustomerIntelInput, type IntelTouch } from "@/lib/customer-intelligence/summary";

type CommRow = { channel: string; direction: string; created_at: string };
type CallRow = { direction: string; started_at: string };

const FIRST_RESPONSE_LABEL = {
  hizli: "Süresinde yanıtlandı",
  gecikti: "Geç yanıtlandı",
  bekliyor: "Yanıt bekliyor",
  bekliyor_gec: "Yanıtsız, gecikti",
} as const;

/**
 * Müşteri zekâsı kartı (Müşteri 360 sağ sütun): ısı + formül nedenleri, son 30 gün etkileşim sayıları,
 * ilk yanıt süresi ve gerekçeli ek öneriler. Hesap `lib/customer-intelligence/summary.ts` (saf);
 * burada yalnız tek RPC okuması (`customer_heat_signals`, aynı liste kaynağı) ve sunum vardır.
 * Mevcut "Sonraki en iyi eylem" kartını DEĞİŞTİRMEZ; onun kapsamadığı durumları ekler.
 */
export async function CustomerIntelCard({
  customerId,
  tenantId,
  createdAt,
  blacklist,
  comms,
  calls,
  openDemands,
  hasOpenOfferOrDeal,
}: {
  customerId: string;
  tenantId: string | null;
  createdAt: string;
  blacklist: boolean;
  comms: readonly CommRow[];
  calls: readonly CallRow[];
  openDemands: number;
  hasOpenOfferOrDeal: boolean;
}) {
  let heatSignals: CustomerIntelInput["heatSignals"] = null;
  if (tenantId) {
    const supabase = await createClient();
    const res = await supabase.rpc("customer_heat_signals", { p_tenant_id: tenantId, p_customer_ids: [customerId] });
    const row = Array.isArray(res.data) ? (res.data[0] as Record<string, unknown> | undefined) : undefined;
    if (!res.error && row) {
      heatSignals = {
        last_contact: (row.last_contact as string | null) ?? null,
        open_demands: Number(row.open_demands) || 0,
        urgent_demands: Number(row.urgent_demands) || 0,
        portal_likes_30d: Number(row.portal_likes_30d) || 0,
        open_offers: Number(row.open_offers) || 0,
        open_deals: Number(row.open_deals) || 0,
      };
    }
  }

  const touches: IntelTouch[] = [
    ...comms.map((c): IntelTouch => ({
      at: c.created_at,
      direction: c.direction === "inbound" ? "inbound" : c.direction === "outbound" ? "outbound" : "internal",
      channel: c.channel,
    })),
    ...calls.map((c): IntelTouch => ({
      at: c.started_at,
      direction: c.direction === "inbound" || c.direction === "missed" ? "inbound" : "outbound",
      channel: "call",
      missed: c.direction === "missed",
    })),
  ];

  const intel = buildCustomerIntel(
    { customerId, createdAt, blacklist, touches, openDemands, hasOpenOfferOrDeal, heatSignals },
    now(),
  );
  const seg = HEAT_SEGMENTS[intel.heat.segment];
  const fr = intel.firstResponse;

  return (
    <section
      aria-label="Müşteri zekâsı"
      className="rounded-[var(--radius-panel)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)]"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.08em] text-brand-600">
          <Gauge className="h-3.5 w-3.5" /> Müşteri ısısı
        </p>
        <span
          title={heatTitle(intel.heat)}
          className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold ring-1 ${seg.badgeCls}`}
        >
          {intel.heat.label} · {intel.heat.score}/100
        </span>
      </div>

      <ul className="mt-3 space-y-1">
        {intel.heat.factors
          .filter((f) => f.points !== 0 || intel.heat.factors.length === 1)
          .map((f) => (
            <li key={f.label} className="flex justify-between gap-2 text-xs text-text-muted">
              <span>{f.label}</span>
              <span className="font-semibold text-ink-950">{f.points > 0 ? `+${f.points}` : f.points}</span>
            </li>
          ))}
      </ul>
      <p className="mt-2 text-xs text-text-faint">
        Isı, bu kalemlerin toplamıdır (üst sınır 100).{intel.heatApproximate ? " Portal beğenisi/acil talep verisi okunamadı; ısı alt sınırdır." : ""}
      </p>

      <dl className="mt-3 grid grid-cols-2 gap-2 border-t border-line pt-3 text-xs">
        <div>
          <dt className="text-text-faint">Son 30 gün gelen</dt>
          <dd className="font-semibold text-ink-950">
            <Link href={`/app/musteriler/${customerId}?sekme=zaman`} className="focus-ring rounded hover:text-brand-600">
              {intel.last30.inbound}
            </Link>
          </dd>
        </div>
        <div>
          <dt className="text-text-faint">Son 30 gün giden</dt>
          <dd className="font-semibold text-ink-950">
            <Link href={`/app/musteriler/${customerId}?sekme=zaman`} className="focus-ring rounded hover:text-brand-600">
              {intel.last30.outbound}
            </Link>
          </dd>
        </div>
        <div className="col-span-2">
          <dt className="text-text-faint">İlk yanıt süresi (çalışma saati)</dt>
          <dd className="font-semibold text-ink-950">
            {fr ? (
              <>
                {formatMinutes(fr.minutes)}{" "}
                <span className="font-normal text-text-muted">· {FIRST_RESPONSE_LABEL[fr.status]}</span>
              </>
            ) : (
              "Veri yok"
            )}
          </dd>
        </div>
      </dl>

      {intel.suggestions.length > 0 ? (
        <ul className="mt-3 space-y-2 border-t border-line pt-3">
          {intel.suggestions.map((s) => (
            <li key={s.key} className="rounded-[var(--radius-control)] bg-canvas px-3 py-2.5">
              <p className="text-sm font-semibold text-ink-950">{s.title}</p>
              <p className="mt-0.5 text-xs text-text-muted">{s.reason}</p>
              <Link
                href={s.href}
                className="focus-ring mt-1.5 inline-flex items-center gap-1 rounded text-xs font-semibold text-brand-600 hover:text-brand-700"
              >
                {s.cta} <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
