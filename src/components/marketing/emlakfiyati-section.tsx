import Link from "next/link";
import { ArrowRight, Coins, FileText, Gauge } from "lucide-react";
import type { PublicPricing } from "@/lib/billing/public-pricing";
import { activePacks, quoteCreditPack } from "@/lib/billing/credit-pack-purchase-core";
import { efUnitsFor, type EfPack, type EfTariff } from "@/lib/ef-credits/config";
import { monthlyUnitsOf } from "@/lib/ef-credits/plan-credits";
import { trialCtaLabel } from "@/lib/marketing-copy";
import { formatNumberTr } from "@/lib/format";
import { Em, SectionHeading } from "./section-heading";

/** Uygulamadaki Kontör sekmesi (ofis paneli); girişsiz ziyaretçi önce giriş yapar, sonra buraya döner. */
const PACKS_LOGIN_HREF = `/giris?next=${encodeURIComponent("/app/abonelik?sekme=kontor#paketler")}`;

/**
 * Ana sayfa EmlakFiyati bölümü. Her sayı tek kaynaktan gelir: paket hakları admin plan tanımından
 * (`efCreditsMonthly`, `efCreditsPerExtraSeat`), işlem bedelleri kontör tarifesinden, ek paketler admin
 * kontör kataloğundan (yalnız AKTİF paket görünür; paket yoksa yalnız "panelde satılır" notu çıkar).
 * Tutarlar KDV HARİÇ net gösterilir; sahte skor/boş vaat yok, her kart tıklanabilir bir hedefe gider.
 */
export function EmlakFiyatiSection({
  pricing,
  tariff,
  packs,
}: {
  pricing: PublicPricing;
  tariff: EfTariff;
  packs: EfPack[];
}) {
  const { plans, trialDays } = pricing;
  const entitled = plans.filter((p) => monthlyUnitsOf(p.efCreditsMonthly) > 0);
  if (entitled.length === 0) return null;
  const sellablePacks = activePacks(packs);
  const valuation = efUnitsFor("valuation_arsa", tariff);
  const pdfFirst = efUnitsFor("pdf_first", tariff);
  const cols = entitled.length >= 4 ? "lg:grid-cols-4" : entitled.length === 3 ? "lg:grid-cols-3" : "lg:grid-cols-2";

  return (
    <section id="emlakfiyati" className="mk-section" aria-labelledby="emlakfiyati-baslik">
      <div className="mk-wrap">
        <SectionHeading
          center
          eyebrow="EmlakFiyati"
          title={<span id="emlakfiyati-baslik">Her pakette <Em>aylık değerleme hakkı</Em></span>}
          text="Ada/parsel bazlı EmlakFiyati değerleme ve PDF rapor sorguları için kontör, paketinizle birlikte her ay otomatik yüklenir. Yetmezse ek rapor paketi satın alırsınız."
        />

        <div className={`mt-9 grid gap-4 sm:grid-cols-2 ${cols}`}>
          {entitled.map((plan) => {
            const units = monthlyUnitsOf(plan.efCreditsMonthly);
            const approx = valuation > 0 ? Math.floor(units / valuation) : 0;
            const perSeat = monthlyUnitsOf(plan.efCreditsPerExtraSeat);
            return (
              <Link
                key={plan.id}
                href={`/kayit?plan=${plan.id}`}
                className="pricing-card card-hover group flex flex-col rounded-[var(--radius-panel)] border border-line bg-surface p-6 transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
              >
                <span className="text-xs font-extrabold tracking-[0.08em] text-text-muted">{plan.eyebrow}</span>
                <h3 className="font-display text-lg font-bold text-ink-950">{plan.name}</h3>
                <p className="mt-4 font-display text-4xl font-bold tabular-nums text-ink-950">{formatNumberTr(units)}</p>
                <p className="text-sm text-text-muted">kontör / ay</p>
                {approx > 0 ? (
                  <p className="mt-2 text-sm font-semibold text-mint-700">Yaklaşık {formatNumberTr(approx)} değerleme</p>
                ) : null}
                {perSeat > 0 ? (
                  <p className="mt-2 text-xs text-text-muted">
                    Her ek kullanıcı için aylık +{formatNumberTr(perSeat)} kontör (kullanıcı sayınızla büyür).
                  </p>
                ) : null}
                <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700">
                  {plan.name} paketini incele <ArrowRight aria-hidden className="h-4 w-4 transition group-hover:translate-x-0.5" />
                </span>
              </Link>
            );
          })}
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <Link
            href="/fiyatlar#karsilastirma"
            className="card-hover flex items-start gap-3 rounded-[var(--radius-panel)] border border-line bg-surface p-5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-card)] bg-brand-600/10 text-brand-700">
              <Gauge aria-hidden className="h-5 w-5" />
            </span>
            <span>
              <span className="block font-display font-bold text-ink-950">Hangi işlem kaç kontör?</span>
              <span className="mt-1 block text-sm text-text-muted">
                {valuation > 0 ? `Ada/parsel değerleme ${formatNumberTr(valuation)} kontör` : "Ada/parsel değerleme ücretsiz"}
                {pdfFirst > 0 ? `, raporun ilk PDF indirmesi ${formatNumberTr(pdfFirst)} kontör` : ", raporun PDF indirmesi ücretsiz"}
                . Aynı raporun PDF&apos;ini tekrar indirmek ücretsizdir; sonuç üretilemezse kontör düşmez. Paket karşılaştırmasında
                ayrıntıları görün.
              </span>
            </span>
          </Link>

          <div className="rounded-[var(--radius-panel)] border border-line bg-surface p-5">
            <p className="flex items-center gap-3 font-display font-bold text-ink-950">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-card)] bg-brand-600/10 text-brand-700">
                <Coins aria-hidden className="h-5 w-5" />
              </span>
              Ek rapor paketi
            </p>
            <p className="mt-2 text-sm text-text-muted">
              Aylık hakkınız bittiğinde ofis panelinde Abonelik &gt; Kontör sekmesinden ek kontör paketi satın alırsınız; kullanılmayan kontör süresiz
              devreder.
              {sellablePacks.length === 0 ? " Paket fiyatları panelde, giriş yaptıktan sonra görünür." : ""}
            </p>
            {sellablePacks.length > 0 ? (
              <ul className="mt-3 flex flex-wrap gap-2" aria-label="Ek kontör paketleri">
                {sellablePacks.map((pack) => {
                  const q = quoteCreditPack(pack);
                  const m = valuation > 0 ? Math.floor(pack.units / valuation) : 0;
                  return (
                    <li key={pack.id}>
                      <Link
                        href={PACKS_LOGIN_HREF}
                        className="inline-flex flex-col rounded-[var(--radius-card)] border border-line bg-surface-2 px-3 py-2 text-xs transition hover:border-brand-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
                      >
                        <span className="font-semibold text-ink-950">
                          {pack.name} · {formatNumberTr(pack.units)} kontör
                        </span>
                        <span className="tabular-nums text-text-muted">
                          {formatNumberTr(q.netTry)} ₺ + KDV{m > 0 ? ` · yaklaşık ${formatNumberTr(m)} değerleme` : ""}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        </div>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/kayit"
            className="btn-shine inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-control)] bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
          >
            <FileText aria-hidden className="h-4 w-4" /> {trialCtaLabel(trialDays)}
          </Link>
          <Link href="/fiyatlar" className="text-sm font-semibold text-brand-700 hover:underline">
            Tüm paket fiyatları
          </Link>
        </div>
        <p className="mk-fine">
          Paket fiyatları ve ek paket tutarları KDV hariçtir. Değerleme sonuçları ilan fiyatlarına dayanır; kesin satış değeri değildir.
        </p>
      </div>
    </section>
  );
}
