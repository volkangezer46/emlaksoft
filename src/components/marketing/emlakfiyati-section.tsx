import Link from "next/link";
import { ArrowRight, Coins, FileText } from "lucide-react";
import type { PublicPricing } from "@/lib/billing/public-pricing";
import { activePacks, quoteCreditPack } from "@/lib/billing/credit-pack-purchase-core";
import { efEntryValuationUnits, type EfPack, type EfTariff } from "@/lib/ef-credits/config";
import { monthlyUnitsOf } from "@/lib/ef-credits/plan-credits";
import { efPlannedLine, type EfPublicState } from "@/lib/ef-credits/public-state-core";
import { trialCtaLabel } from "@/lib/marketing-copy";
import { formatNumberTr } from "@/lib/format";
import { SectionHeading } from "./section-heading";
import { ContentLink, RichTitle } from "./content-link";
import { defaultSiteContent } from "@/lib/site-content/defaults";
import type { SiteContent } from "@/lib/site-content/schema";
import { tx } from "@/lib/site-content/tokens";

/** Ofis panelindeki Kontör sekmesi; yalnız durum "live" iken bağlantı verilir. Hesabı olmayan /kayit'tan başlar. */
export const EF_PACKS_APP_HREF = "/app/abonelik?sekme=kontor#paketler";

const TH = "px-3 py-2 text-left text-xs font-bold uppercase tracking-[0.06em] text-text-muted";
const TD = "px-3 py-2.5 text-sm tabular-nums text-ink-950";

/** Paket bazlı aylık kontör tablosu. Sayılar plan kataloğundan gelir; durum live değilse "(planlanan)" eklenir. */
export function EfPlanCreditsTable({ plans, tariff, live }: { plans: PublicPricing["plans"]; tariff: EfTariff; live: boolean }) {
  const entitled = plans.filter((p) => monthlyUnitsOf(p.efCreditsMonthly) > 0);
  if (entitled.length === 0) return null;
  const valuation = efEntryValuationUnits(tariff);
  return (
    <div className="overflow-x-auto rounded-[var(--radius-panel)] border border-line bg-surface">
      <table className="w-full min-w-[34rem] border-collapse">
        <caption className="sr-only">Pakete göre aylık EmlakFiyati kontörü</caption>
        <thead className="border-b border-line bg-surface-2">
          <tr>
            <th scope="col" className={TH}>Paket</th>
            <th scope="col" className={TH}>Aylık kontör</th>
            <th scope="col" className={TH}>Yaklaşık değerleme</th>
            <th scope="col" className={TH}>Ek kullanıcı başına</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {entitled.map((plan) => {
            const units = monthlyUnitsOf(plan.efCreditsMonthly);
            const per = monthlyUnitsOf(plan.efCreditsPerExtraSeat);
            const approx = valuation > 0 ? Math.floor(units / valuation) : 0;
            return (
              <tr key={plan.id}>
                <th scope="row" className="px-3 py-2.5 text-left text-sm font-semibold text-ink-950">
                  <Link href={`/kayit?plan=${plan.id}`} className="hover:underline focus-visible:outline-2 focus-visible:outline-brand-600">
                    {plan.name}
                  </Link>
                </th>
                <td className={TD}>{efPlannedLine(`${formatNumberTr(units)} kontör`, live)}</td>
                <td className={TD}>{approx > 0 ? efPlannedLine(`yaklaşık ${formatNumberTr(approx)}`, live) : "-"}</td>
                <td className={TD}>{per > 0 ? efPlannedLine(`+${formatNumberTr(per)} kontör`, live) : "-"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Ek kontör paketleri kademe tablosu (admin kataloğu, yalnız aktif paketler). Satın al bağlantısı yalnız live'da. */
export function EfPackTiersTable({ packs, tariff, live }: { packs: EfPack[]; tariff: EfTariff; live: boolean }) {
  const sellable = activePacks(packs);
  if (sellable.length === 0) return null;
  const valuation = efEntryValuationUnits(tariff);
  return (
    <div className="overflow-x-auto rounded-[var(--radius-panel)] border border-line bg-surface">
      <table className="w-full min-w-[34rem] border-collapse">
        <caption className="sr-only">Süreli ek kontör paketleri ve kontör başı net fiyat</caption>
        <thead className="border-b border-line bg-surface-2">
          <tr>
            <th scope="col" className={TH}>Paket</th>
            <th scope="col" className={TH}>Kontör</th>
            <th scope="col" className={TH}>Süre</th>
            <th scope="col" className={TH}>Net fiyat</th>
            <th scope="col" className={TH}>Kontör başı net</th>
            <th scope="col" className={TH}>Yaklaşık değerleme</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {sellable.map((pack) => {
            const q = quoteCreditPack(pack);
            const m = valuation > 0 ? Math.floor(pack.units / valuation) : 0;
            return (
              <tr key={pack.id}>
                <th scope="row" className="px-3 py-2.5 text-left text-sm font-semibold text-ink-950">{pack.name}</th>
                <td className={TD}>{formatNumberTr(pack.units)}</td>
                <td className={TD}>{pack.months} ay</td>
                <td className={TD}>{formatNumberTr(q.netTry)} ₺ + KDV</td>
                <td className={TD}>{formatNumberTr(q.unitNetTry)} ₺</td>
                <td className={TD}>{m > 0 ? `yaklaşık ${formatNumberTr(m)}` : "-"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {live ? null : (
        <p className="border-t border-line px-3 py-2 text-xs text-text-muted">Planlanan fiyatlardır; satın alma değerleme etkinleşince açılır.</p>
      )}
    </div>
  );
}

/**
 * Ana sayfa EmlakFiyati bölümü (#emlakfiyati), değerleme bölümünün hemen ardından gelir: nasıl çalışır, paket kontörleri,
 * ek paketler. Her sayı tek kaynaktan (plan kataloğu, kontör tarifesi, ek paket kataloğu); sabit sayı yoktur.
 * Metinler site içeriğinden (efSection); sayılar ve durum koddan. DÜRÜST DURUM: yalnız `state === "live"` iken "Canlı" ve satın alma bağlantısı; diğer durumlarda "Yakında"/"Bakımda".
 */
export function EmlakFiyatiSection({
  pricing,
  tariff,
  packs,
  content = defaultSiteContent().efSection,
}: {
  pricing: PublicPricing;
  tariff: EfTariff;
  packs: EfPack[];
  content?: SiteContent["efSection"];
}) {
  const { plans, trialDays, efState } = pricing;
  const ctx = { trialDays, plans, efLive: efState === "live" };
  const steps = content.steps.filter((s) => !s.hidden);
  const state: EfPublicState = efState;
  const live = state === "live";
  if (!plans.some((p) => monthlyUnitsOf(p.efCreditsMonthly) > 0)) return null;
  const hasPacks = activePacks(packs).length > 0;
  const valuation = efEntryValuationUnits(tariff);
  const badge = live ? "Canlı" : state === "maintenance" || state === "stale" ? "Bakımda" : "Yakında";

  return (
    <section id="emlakfiyati" className="mk-section" aria-labelledby="emlakfiyati-baslik">
      <div className="mk-wrap">
        <SectionHeading
          center
          eyebrow={content.eyebrow}
          title={<span id="emlakfiyati-baslik"><RichTitle title={content.title} em={content.em} tail={content.tail} /></span>}
          text={tx(live ? content.liveText : content.soonText, ctx) || undefined}
        />
        <p className="mt-4 flex justify-center">
          <span className={`mk-tag ${live ? "mk-tag-plan" : "mk-example"}`} data-ef-status={state}>{badge}</span>
        </p>

        {steps.length ? (
        <ol className="mt-9 grid gap-4 md:grid-cols-3" aria-label="Nasıl çalışır">
          {steps.map((s, i) => (
            <li key={s.id} className="rounded-[var(--radius-panel)] border border-line bg-surface p-5">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-brand-600/10 text-sm font-bold text-brand-700">{i + 1}</span>
              <h3 className="mt-3 font-display text-base font-bold text-ink-950">{tx(s.title, ctx)}</h3>
              <p className="mt-1 text-sm text-text-muted">
                {tx(s.text, ctx)}
                {s.id === "onay" && valuation > 0 ? ` Ada/parsel değerleme raporu ${formatNumberTr(valuation)} kontörden başlar.` : ""}
              </p>
            </li>
          ))}
        </ol>
        ) : null}

        <h3 className="mt-10 font-display text-lg font-bold text-ink-950">{content.plansTitle}</h3>
        <div className="mt-3">
          <EfPlanCreditsTable plans={plans} tariff={tariff} live={live} />
        </div>
        {content.plansNote ? <p className="mt-2 text-xs text-text-muted">{tx(content.plansNote, ctx)}</p> : null}

        <h3 className="mt-10 flex items-center gap-2 font-display text-lg font-bold text-ink-950">
          <Coins aria-hidden className="h-5 w-5 text-brand-700" /> {content.packsTitle}
        </h3>
        {content.packsText ? <p className="mt-1 text-sm text-text-muted">{tx(content.packsText, ctx)}</p> : null}
        <div className="mt-3">
          {hasPacks ? (
            <EfPackTiersTable packs={packs} tariff={tariff} live={live} />
          ) : (
            <p className="text-sm text-text-muted">{tx(content.packsEmpty, ctx)}</p>
          )}
        </div>
        {live ? (
          <p className="mt-3 text-sm">
            <Link href={EF_PACKS_APP_HREF} className="font-semibold text-brand-700 hover:underline">
              Ofis panelinde kontör satın al <ArrowRight aria-hidden className="inline h-4 w-4" />
            </Link>
            <span className="text-text-muted"> · Hesabınız yoksa önce deneme başlatın.</span>
          </p>
        ) : null}

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/kayit"
            className="btn-shine inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-control)] bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
          >
            <FileText aria-hidden className="h-4 w-4" /> {trialCtaLabel(trialDays)}
          </Link>
          {content.detailLink.label ? <ContentLink href={content.detailLink.href} className="text-sm font-semibold text-brand-700 hover:underline">{tx(content.detailLink.label, ctx)}</ContentLink> : null}
        </div>
        {content.note ? <p className="mk-fine">{tx(content.note, ctx)}</p> : null}
      </div>
    </section>
  );
}
