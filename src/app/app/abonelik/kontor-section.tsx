import Link from "@/components/ui/smart-link";
import { ArrowUpRight, Coins, History, Info } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableEmptyRow, TableFrame, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ListPager } from "@/components/ui/list-kit/list-pager";
import { pageWindow } from "@/components/ui/list-kit/list-logic";
import { getEfCatalog, getEfCreditReady, getEfLotsReady, readEfBalance, readEfHistory } from "@/lib/ef-credits/credit-reader";
import {
  EF_CATEGORY_LABEL,
  EF_HISTORY_PAGE_SIZE,
  categoryOf,
  filterAndPage,
  type EfMovementCategory,
} from "@/lib/ef-credits/credit-view";
import { EF_WELCOME_VALID_DAYS, efEntryValuationUnits, efUnitsFor } from "@/lib/ef-credits/config";
import { DAY_MS, now, trNextMonthStartMs } from "@/lib/clock";
import { monthlyAllowanceView } from "@/lib/ef-credits/visibility";
import { EF_PURCHASE_CLOSED_MESSAGE, getEfPublicState } from "@/lib/ef-credits/public-state";
import {
  activePacks,
  lowBalanceState,
  quoteCreditPack,
  suggestPack,
} from "@/lib/billing/credit-pack-purchase-core";
import { AreaChart, RadialGauge } from "@/components/ui/viz";
import {
  FORECAST_MIN_SPAN_DAYS,
  FORECAST_MIN_SPEND_ROWS,
  balanceSeries,
  forecastDepletion,
  stackedBalance,
  thresholdTopPct,
} from "@/lib/ef-credits/balance-viz";
import { Celebration } from "@/components/ui/illustrations";
import { isCreditPurchaseMoment } from "@/lib/celebration-conditions";
import { StackedBalance } from "./stacked-balance";
import { KontorPanel, type KontorPackCard } from "./kontor-panel";
import type { WalletCheckoutInfo } from "@/components/app/wallet-credit-toggle";

const fmt = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 });
const dt = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Istanbul" });
const shortDay = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short", timeZone: "Europe/Istanbul" });
const renewalFmt = new Intl.DateTimeFormat("tr-TR", { dateStyle: "long", timeZone: "Europe/Istanbul" });
const BASE = "/app/abonelik";

const LOT_KIND_LABEL: Record<string, string> = {
  purchase: "Satın alınan paket",
  plan_monthly: "Aylık plan hakkı",
  bonus: "Bonus / hoş geldin",
  admin: "Yönetici yüklemesi",
  refund: "İade",
  legacy: "Önceki bakiye",
};
const lotKindLabel = (k: string) => LOT_KIND_LABEL[k] ?? "Kontör";

function hrefOf(params: Record<string, string | undefined>, hash = "gecmis"): string {
  const sp = new URLSearchParams({ sekme: "kontor" });
  for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
  return `${BASE}?${sp.toString()}#${hash}`;
}

export type KontorSectionProps = {
  canBuy: boolean;
  iyzicoConfigured: boolean;
  /** URL süzgeçleri (filtre kontratı). */
  kalem?: string;
  kullanici?: string;
  sayfa?: string;
  /** "Önerilen paketi tek tıkla al": önerilen paketin onay paneli açık gelir. */
  onerilen?: boolean;
  /** Ödeme sonrası dönüş durumu (son kontör faturası). */
  latestInvoice: { status: string; paidAt: string | null; units: number | null } | null;
  /** Son kontör faturasının ödemesi yeni mi (sunucuda clock ile hesaplanır). */
  invoiceIsRecent: boolean;
  /** Planın otomatik aylık kontör hakkı (ek kullanıcı hakkı dahil); units 0 = pakette aylık hak yok. */
  allowance?: { planName: string; units: number; perExtraSeat: number; extraSeats: number };
  /** TL hesap kredisi cüzdanı (null: etkin değil → "kredimi kullan" kutusu gösterilmez). */
  wallet?: WalletCheckoutInfo | null;
};

export async function KontorSection(props: KontorSectionProps & { tenantId: string }) {
  const { tenantId, canBuy, iyzicoConfigured, latestInvoice, invoiceIsRecent, allowance } = props;
  const [ready, lotsReady, catalog, efState] = await Promise.all([getEfCreditReady(), getEfLotsReady(), getEfCatalog(), getEfPublicState()]);
  const [balance, history] = ready
    ? await Promise.all([readEfBalance(tenantId), readEfHistory(tenantId)])
    : [null, null];

  const { tariff, packs } = catalog;
  const sellable = activePacks(packs);
  const suggested = suggestPack(packs, tariff);
  const low = balance ? lowBalanceState(balance.available, tariff) : null;
  const cards: KontorPackCard[] = sellable.map((p) => {
    const q = quoteCreditPack(p);
    return {
      id: p.id,
      name: p.name,
      units: p.units,
      months: p.months,
      netTry: q.netTry,
      taxTry: q.taxTry,
      totalTry: q.totalTry,
      unitNetTry: q.unitNetTry,
      unitGrossTry: q.unitGrossTry,
      popular: Boolean(p.popular),
      suggested: suggested?.id === p.id,
    };
  });
  const blockReason = !efState.purchasable
    ? `${EF_PURCHASE_CLOSED_MESSAGE} Paketleri şimdiden inceleyebilirsiniz.`
    : !ready
      ? "Kontör satın alma henüz etkin değil: yönetici hazırlığı tamamlanıyor. Paketleri şimdiden inceleyebilirsiniz."
      : !lotsReady
      ? "Süreli kontör paketleri hazırlanıyor; satın alma kısa süre içinde açılır. Paketleri şimdiden inceleyebilirsiniz."
      : !iyzicoConfigured
      ? "Ödeme altyapısı yapılandırılmamış; lütfen yönetici ile iletişime geçin."
      : null;

  // Aylık hak sayacı (saf hesap; zaman clock.ts üzerinden). Defter okunamıyorsa sayaç gösterilmez (sahte sayı yok).
  const monthly =
    allowance && allowance.units > 0 && history?.enabled
      ? monthlyAllowanceView({ entitlement: allowance.units, rows: history.rows, available: balance?.available ?? null, nowMs: now() })
      : null;
  const stacked = balance ? stackedBalance({ available: balance.available, reserved: balance.reserved, spent: balance.committed_total }) : null;
  // Süresi dolmamış partiler (clock.ts); süresi dolup henüz yanmamış kalan "kullanılabilir" sayılmaz, listelenmez.
  const nowMs = now();
  const liveLots = (balance?.lots ?? []).filter((l) => Date.parse(l.expiresAt) > nowMs);
  const expiredTotal = balance?.expired_total ?? 0;
  // Yakında yanacak kontör (7 gün): ofis sahibi/GM fark etsin diye uyarı bandı (sıfır çıkmaz: partiler listesine bağlanır).
  const nextExpiryMs = balance?.next_expiry_at ? Date.parse(balance.next_expiry_at) : Number.NaN;
  const expiringSoon =
    Number.isFinite(nextExpiryMs) && nextExpiryMs - nowMs <= 7 * DAY_MS && (balance?.next_expiry_units ?? 0) > 0
      ? { units: balance!.next_expiry_units as number, atMs: nextExpiryMs }
      : null;
  const stackedLabels = { available: "Kullanılabilir", reserved: "İşlemde (rezerve)", spent: "Toplam harcanan" } as const;
  const stackedColors = { available: "var(--viz-1)", reserved: "var(--viz-5)", spent: "var(--viz-neutral)" } as const;
  const stackedHrefs = { available: hrefOf({}), reserved: hrefOf({}), spent: hrefOf({ kalem: "degerleme" }) } as const;
  const series = history?.enabled ? balanceSeries(history.rows) : { values: [] as number[], atMs: [] as number[] };
  const thresholdTop =
    low && low.threshold > 0 && series.values.length >= 2 ? thresholdTopPct(low.threshold, Math.max(...series.values)) : null;
  const forecast = balance && history?.enabled ? forecastDepletion(history.rows, balance.available, now()) : null;
  const canOneClick = canBuy && efState.purchasable && ready && lotsReady && iyzicoConfigured && suggested !== null && sellable.length > 0;
  const oneClickHref = `${BASE}?sekme=kontor&onerilen=1#paketler`;

  const category: EfMovementCategory | null = categoryOf(props.kalem);
  const page = history
    ? filterAndPage(history.rows, {
        category,
        userId: props.kullanici || null,
        page: Number.parseInt(props.sayfa ?? "", 10) || 1,
      })
    : null;
  const pagerParams = { sekme: "kontor", kalem: category ?? undefined, kullanici: props.kullanici || undefined };

  const tariffItems = [
    { label: "Konut değerlemesi", units: efUnitsFor("valuation_konut", tariff), kalem: "degerleme" },
    { label: "Arsa değerlemesi", units: efUnitsFor("valuation_arsa", tariff), kalem: "degerleme" },
    { label: "Ticari değerleme", units: efUnitsFor("valuation_ticari", tariff), kalem: "degerleme" },
  ];

  return (
    <div className="space-y-6">
      {isCreditPurchaseMoment(latestInvoice, invoiceIsRecent) ? (
        <div className="relative flex justify-center">
          <Celebration tick label="Kontör paketi satın alındı" />
        </div>
      ) : null}

      {latestInvoice && invoiceIsRecent ? (
        latestInvoice.status === "paid" ? (
          <Alert tone="success" title="Kontör paketi ödemeniz alındı">
            {latestInvoice.units ? `${fmt.format(latestInvoice.units)} kontör ` : "Kontör "}
            bakiyenize eklenir; birkaç saniye içinde görünmezse sayfayı yenileyin.
          </Alert>
        ) : latestInvoice.status === "draft" || latestInvoice.status === "open" ? (
          <Alert tone="info" title="Kontör paketi ödemesi tamamlanmadı">
            Ödeme onaylanmadıysa kontör eklenmez; dilerseniz aşağıdan yeniden deneyebilirsiniz.
          </Alert>
        ) : null
      ) : null}

      {!ready ? (
        <Alert tone="info" title="Kontör bakiyesi henüz etkin değil">
          Kontör bakiyesi, satın alma ve kullanım geçmişi yönetici hazırlığı tamamlanınca açılır. Tarife ve paketleri şimdiden
          inceleyebilirsiniz.
        </Alert>
      ) : null}

      {expiringSoon ? (
        <Alert
          tone="warning"
          title="Kontörünüzün bir kısmı yakında yanacak"
          action={
            <Link href={`${BASE}?sekme=kontor#bakiye`} className="text-xs font-bold underline">
              Partileri gör
            </Link>
          }
        >
          {fmt.format(expiringSoon.units)} kontör {dt.format(expiringSoon.atMs)} tarihinde sona erer; kullanılmazsa yanar ve devretmez.
        </Alert>
      ) : null}

      {low && low.state !== "ok" ? (
        <Alert
          tone={low.state === "empty" ? "danger" : "warning"}
          title={low.state === "empty" ? "Kontörünüz bitti" : "Kontörünüz azalıyor"}
          action={
            suggested && sellable.length > 0 ? (
              <Link href={canOneClick ? oneClickHref : `${BASE}?sekme=kontor#paketler`} className="text-xs font-bold underline">
                {canOneClick ? `Önerilen paketi al: ${suggested.name}` : `Önerilen paket: ${suggested.name}`}
              </Link>
            ) : undefined
          }
        >
          {low.state === "empty"
            ? "Değerleme için kontör gerekir."
            : `Kalan ${fmt.format(balance!.available)} kontör, en ucuz işlemin iki katı (${fmt.format(low.threshold)}) ve altında.`}
        </Alert>
      ) : null}

      <section id="bakiye" className="rounded-[var(--radius-panel)] bg-surface p-5 shadow-[var(--elev-3)]">
        <p className="flex items-center gap-2 text-xs font-semibold text-accent-text"><Coins className="h-4 w-4" /> EmlakFiyati kontörü</p>
        <h2 className="mt-1 font-display font-bold text-text">Kontör bakiyeniz</h2>
        {balance ? (
          <div className="mt-4 space-y-5">
            <div className="grid gap-6 lg:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] lg:items-center">
              <Link href={hrefOf({})} className="focus-ring block rounded-[var(--radius-control)] p-2 hover:bg-surface-hover">
                <p className="text-xs font-semibold text-text-muted">Kullanılabilir kontör</p>
                <p className="numeric font-display text-4xl font-extrabold text-text">{fmt.format(balance.available)}</p>
                <p className="mt-1 text-xs text-text-muted">
                  Defter bakiyesi (yüklenen − harcanan − süresi dolan): <span className="numeric font-semibold">{fmt.format(balance.granted_total - balance.committed_total - expiredTotal)}</span>
                </p>
              </Link>
              {stacked ? (
                <StackedBalance
                  ariaLabel="Kontör dağılımı"
                  note="Çubuk: kullanılabilir, işlemde (rezerve) ve bugüne dek harcanan kontörün payları."
                  items={stacked.segments.map((seg) => ({
                    key: seg.key,
                    pct: seg.pct,
                    label: stackedLabels[seg.key],
                    valueText: fmt.format(seg.value),
                    href: stackedHrefs[seg.key],
                    color: stackedColors[seg.key],
                  }))}
                />
              ) : (
                <p className="text-sm text-text-muted">Henüz kontör hareketi yok: ilk yükleme veya değerlemeden sonra dağılım burada görünür.</p>
              )}
            </div>

            <div>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold text-text">Bakiye geçmişi</h3>
                <Link href={hrefOf({})} className="text-xs font-semibold text-accent-text hover:underline">Tüm hareketler</Link>
              </div>
              {series.values.length >= 2 ? (
                <div className="mt-2">
                  <div className="relative">
                    <AreaChart
                      series={[{ name: "Bakiye (kontör)", values: series.values }]}
                      pointLabels={series.atMs.map((t) => shortDay.format(t))}
                      height={176}
                      format="number"
                      ariaLabel={`Bakiye geçmişi: ${fmt.format(series.values[0]!)} kontörden ${fmt.format(series.values[series.values.length - 1]!)} kontöre`}
                    />
                    {thresholdTop !== null ? (
                      <div className="pointer-events-none absolute inset-x-0 top-0" style={{ height: 176 }} aria-hidden="true">
                        <div className="absolute inset-x-0 border-t border-dashed border-danger-strong" style={{ top: `${thresholdTop}%` }} />
                        <span className="absolute left-0 -translate-y-full rounded bg-surface px-1 text-xs font-semibold text-danger-strong" style={{ top: `${thresholdTop}%` }}>
                          Düşük bakiye eşiği: {fmt.format(low!.threshold)}
                        </span>
                      </div>
                    ) : null}
                  </div>
                  {forecast ? (
                    <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-text-muted">
                      <span className="rounded-full bg-warning-soft px-2 py-0.5 font-bold text-warning-strong">TAHMİN</span>
                      Son 60 günlük kullanım hızıyla (günde yaklaşık {fmt.format(Math.max(1, Math.round(forecast.burnPerDay)))} kontör) bakiye yaklaşık{" "}
                      {renewalFmt.format(forecast.dateMs)} tarihinde biter. Kesin değildir; kullanım değişirse kayar.
                    </p>
                  ) : (
                    <p className="mt-2 text-xs text-text-faint">Bitiş tahmini için en az {FORECAST_MIN_SPEND_ROWS} harcama hareketi ve {FORECAST_MIN_SPAN_DAYS} günlük geçmiş gerekir.</p>
                  )}
                </div>
              ) : (
                <p className="mt-2 text-sm text-text-muted">Çizgi için en az iki bakiyeli hareket gerekir: değerleme veya paket alımından sonra burada görünür.</p>
              )}
            </div>
          </div>
        ) : (
          <p className="mt-3 text-sm text-text-muted">{ready ? "Bakiye şu an okunamadı; sayfayı yenileyin." : "Kontör bakiyesi etkinleşince bakiyeniz burada görünür."}</p>
        )}
        {balance && balance.lots ? (
          <div className="mt-5 rounded-[var(--radius-control)] bg-[var(--surface-sunken)] p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold text-text">Kontör partileri ve son kullanma</h3>
              <Link href={hrefOf({ kalem: "sona-erme" })} className="text-xs font-semibold text-accent-text hover:underline">
                Süresi dolan kontör: {fmt.format(expiredTotal)}
              </Link>
            </div>
            {liveLots.length === 0 ? (
              <p className="mt-2 text-sm text-text-muted">Süresi dolmamış kontör partisi yok. Kontör paketleri süreli satılır; süre sonunda kullanılmayan kontör yanar.</p>
            ) : (
              <ul className="mt-2 divide-y divide-line text-sm">
                {liveLots.map((l) => (
                  <li key={l.id}>
                    <Link href={hrefOf({ kalem: "satin-alma" })} className="focus-ring flex flex-wrap items-center justify-between gap-2 py-2 hover:text-accent-text">
                      <span className="font-semibold text-text">{lotKindLabel(l.kind)}</span>
                      <span className="numeric text-text-muted">
                        {fmt.format(l.remaining)} / {fmt.format(l.units)} kontör · {dt.format(Date.parse(l.expiresAt))} tarihine kadar
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-xs text-text-muted">
              Harcama önce en yakın tarihte sona erecek partiden düşer. Hoş geldin kontörü {EF_WELCOME_VALID_DAYS} gün, aylık plan hakkı ay sonuna kadar,
              satın alınan paket seçtiğiniz süre kadar geçerlidir.
            </p>
          </div>
        ) : null}
        {allowance && allowance.units > 0 ? (
          <Link
            href={hrefOf({ kalem: "satin-alma" })}
            className="focus-ring @container mt-5 block rounded-[var(--radius-control)] bg-success-soft p-4 transition hover:bg-surface-hover"
          >
            <div className="flex flex-wrap items-center gap-4">
              {monthly ? (
                <RadialGauge
                  value={monthly.remainingOfMonthly}
                  max={monthly.entitlement}
                  size={88}
                  stroke={9}
                  tone="success"
                  ariaLabel="Aylık haktan kalan kontör"
                >
                  <span className="numeric font-display text-base font-extrabold text-text">{fmt.format(monthly.remainingOfMonthly)}</span>
                </RadialGauge>
              ) : null}
              <div className="min-w-0 flex-1 basis-60">
                <p className="text-xs font-semibold text-success-strong">{allowance.planName} paketinin aylık kontör hakkı</p>
                <p className="numeric font-display text-xl font-extrabold text-text [text-wrap:balance]">
                  Her ay {fmt.format(allowance.units)} kontör
                  {efEntryValuationUnits(tariff) > 0 ? ` (yaklaşık ${fmt.format(Math.floor(allowance.units / efEntryValuationUnits(tariff)))} değerleme)` : ""}
                </p>
                <p className="mt-1 text-xs text-text-muted">
                  Otomatik yüklenir; o ayın sonunda kullanılmayan kontör yanar, sonraki aya devretmez.
                  {allowance.perExtraSeat > 0
                    ? ` Hak, her ek kullanıcı için ${fmt.format(allowance.perExtraSeat)} kontör artar (şu an ${fmt.format(allowance.extraSeats)} ek kullanıcı).`
                    : ""}
                  {" "}Yetmezse aşağıdan ek paket alabilirsiniz.
                </p>
              </div>
            </div>
            {monthly ? (
              <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2 xl:grid-cols-4">
                <div>
                  <dt className="font-semibold text-text-muted">Bu ay verilen plan kontörü</dt>
                  <dd className="numeric font-display text-base font-extrabold text-text">
                    {fmt.format(monthly.grantedThisMonth)} / {fmt.format(monthly.entitlement)}
                  </dd>
                </div>
                <div>
                  <dt className="font-semibold text-text-muted">Bu ay harcanan</dt>
                  <dd className="numeric font-display text-base font-extrabold text-text">{fmt.format(monthly.spentThisMonth)}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-text-muted">Aylık haktan kalan</dt>
                  <dd className="numeric font-display text-base font-extrabold text-text">{fmt.format(monthly.remainingOfMonthly)}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-text-muted">Sonraki yenileme</dt>
                  <dd className="font-display text-base font-extrabold text-text">{renewalFmt.format(monthly.nextRenewalMs)}</dd>
                </div>
              </dl>
            ) : (
              <p className="mt-2 text-xs font-semibold text-text-muted">Sonraki yenileme: {renewalFmt.format(trNextMonthStartMs(now()))}</p>
            )}
          </Link>
        ) : null}
        {suggested && sellable.length > 0 && canBuy ? (
          <div className="mt-4">
            {canOneClick ? (
              <Link
                href={oneClickHref}
                className="focus-ring press inline-flex min-h-9 items-center gap-1.5 rounded-[var(--radius-control)] bg-brand-600 px-3.5 py-2 text-sm font-semibold text-white"
              >
                <Coins className="h-4 w-4" aria-hidden="true" /> Önerilen paketi tek tıkla al: {suggested.name} ({fmt.format(suggested.units)} kontör)
              </Link>
            ) : (
              <>
                <button
                  type="button"
                  disabled
                  className="inline-flex min-h-9 cursor-not-allowed items-center gap-1.5 rounded-[var(--radius-control)] bg-ink-950 px-3.5 py-2 text-sm font-semibold text-white opacity-50"
                >
                  <Coins className="h-4 w-4" aria-hidden="true" /> Önerilen paketi tek tıkla al: {suggested.name}
                </button>
                {blockReason ? <p className="mt-1.5 text-xs text-text-muted">{blockReason}</p> : null}
              </>
            )}
          </div>
        ) : null}
      </section>

      <section className="rounded-[var(--radius-panel)] bg-surface p-5 shadow-[var(--elev-1)]">
        <p className="flex items-center gap-2 text-xs font-semibold text-accent-text"><Info className="h-4 w-4" /> Tarife</p>
        <h2 className="mt-1 font-display font-bold text-text">Hangi işlem kaç kontör?</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {tariffItems.map((t) => (
            <Link
              key={t.label}
              href={hrefOf({ kalem: t.kalem })}
              className="focus-ring group rounded-[var(--radius-control)] bg-[var(--surface-sunken)] p-4 transition hover:bg-surface-hover"
            >
              <div className="flex items-start justify-between">
                <p className="text-xs font-semibold text-text-muted">{t.label}</p>
                <ArrowUpRight className="h-4 w-4 text-text-faint transition group-hover:text-accent-text" />
              </div>
              <p className="numeric mt-1 font-display text-xl font-extrabold text-text">
                {t.units > 0 ? `${fmt.format(t.units)} kontör` : "Ücretsiz"}
              </p>
            </Link>
          ))}
        </div>
        <p className="mt-3 text-xs text-text-muted">
          Kontör yalnız değerleme için harcanır; PDF indirme, rapor detayı ve ilan analizi kontör düşmez. Sonuç üretilemezse (yetersiz veri
          veya hata) kontör düşmez. Değerler ilan fiyatlarına dayanır; kesin satış değeri değildir.
        </p>
      </section>

      <section id="paketler" className="scroll-mt-24 rounded-[var(--radius-panel)] bg-surface p-5 shadow-[var(--elev-1)]">
        <p className="flex items-center gap-2 text-xs font-semibold text-accent-text"><Coins className="h-4 w-4" /> Paketler</p>
        <h2 className="mt-1 font-display font-bold text-text">Kontör paketi satın alın</h2>
        <div className="mt-4">
          {cards.length === 0 ? (
            <EmptyState
              variant="full"
              icon={Coins}
              title="Şu an satışta kontör paketi yok"
              description="Paketler yönetici tarafından tanımlandığında burada listelenir. Gerekirse destek ekibimize yazın."
              action={{ href: "/app/destek", label: "Destek talebi aç" }}
            />
          ) : (
            <KontorPanel packs={cards} canBuy={canBuy} blockReason={blockReason} wallet={props.wallet ?? null} autoOpenId={props.onerilen ? (suggested?.id ?? null) : null} />
          )}
        </div>
        <p className="mt-3 text-xs text-text-muted">Kupon kodları kontör paketlerinde geçerli değildir. Fiyatlara %20 KDV eklenir.</p>
      </section>

      <section id="gecmis" className="scroll-mt-24 rounded-[var(--radius-panel)] bg-surface p-5 shadow-[var(--elev-1)]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="flex items-center gap-2 text-xs font-semibold text-accent-text"><History className="h-4 w-4" /> Geçmiş</p>
            <h2 className="mt-1 font-display font-bold text-text">Kontör kullanım geçmişi</h2>
          </div>
          <nav aria-label="Kalem süzgeci" className="flex flex-wrap gap-1.5">
            {([null, "degerleme", "satin-alma", "sona-erme", "iade"] as const).map((k) => (
              <Link
                key={k ?? "hepsi"}
                href={hrefOf({ kalem: k ?? undefined, kullanici: props.kullanici })}
                aria-current={(category ?? null) === k ? "true" : undefined}
                className={`focus-ring rounded-full px-2.5 py-1 text-xs font-bold ${
                  (category ?? null) === k ? "bg-ink-950 text-white" : "bg-surface-accent-soft text-accent-text hover:bg-brand-600/15"
                }`}
              >
                {k ? EF_CATEGORY_LABEL[k] : "Hepsi"}
              </Link>
            ))}
            {props.kullanici ? (
              <Link href={hrefOf({ kalem: category ?? undefined })} className="focus-ring rounded-full bg-amber-400/15 px-2.5 py-1 text-xs font-bold text-warning-strong">
                Kullanıcı süzgeci: kaldır
              </Link>
            ) : null}
          </nav>
        </div>
        {!history ? (
          <p className="mt-4 rounded-[var(--radius-card)] border border-dashed border-line-strong px-4 py-6 text-center text-sm text-text-muted">
            Kullanım geçmişi, kontör bakiyesi etkinleşince burada listelenir.
          </p>
        ) : !history.enabled ? (
          <p className="mt-4 rounded-[var(--radius-card)] border border-dashed border-line-strong px-4 py-6 text-center text-sm text-text-muted">
            Kullanım geçmişi şu an okunamadı; birazdan tekrar deneyin.
          </p>
        ) : (
          <>
            <TableFrame className="mt-4" minWidth={620}>
              <Table>
                <THead>
                  <TR>
                    <TH>Tarih</TH>
                    <TH>Kalem</TH>
                    <TH>Kullanıcı</TH>
                    <TH align="right">Kontör</TH>
                    <TH align="right">Bakiye</TH>
                  </TR>
                </THead>
                <TBody>
                  {page!.rows.length === 0 ? (
                    <TableEmptyRow colSpan={5}>
                      {category || props.kullanici ? "Bu süzgece uyan hareket yok." : "Henüz kontör hareketi yok: ilk değerlemenizden veya paket alımından sonra burada listelenir."}
                    </TableEmptyRow>
                  ) : (
                    page!.rows.map((r) => (
                      <TR key={r.id}>
                        <TD className="text-text-muted">{r.at && Number.isFinite(Date.parse(r.at)) ? dt.format(Date.parse(r.at)) : "—"}</TD>
                        <TD>
                          <Link href={hrefOf({ kalem: r.category, kullanici: props.kullanici })} className="font-semibold text-text hover:text-accent-text hover:underline">
                            {r.label}
                          </Link>
                        </TD>
                        <TD className="text-text-muted">
                          {r.userId ? (
                            <Link href={hrefOf({ kalem: category ?? undefined, kullanici: r.userId })} className="hover:text-accent-text hover:underline">
                              {history.userNames[r.userId] ?? "Kullanıcı"}
                            </Link>
                          ) : (
                            "Sistem"
                          )}
                        </TD>
                        <TD align="right" className={`numeric font-bold ${r.units < 0 ? "text-text" : "text-success-strong"}`}>
                          {r.units > 0 ? "+" : ""}
                          {fmt.format(r.units)}
                        </TD>
                        <TD align="right" className="numeric text-text-muted">{r.balanceAfter === null ? "—" : fmt.format(r.balanceAfter)}</TD>
                      </TR>
                    ))
                  )}
                </TBody>
              </Table>
            </TableFrame>
            <div className="mt-3">
              <ListPager
                pathname={BASE}
                params={pagerParams}
                window={pageWindow(page!.page, page!.total, EF_HISTORY_PAGE_SIZE, page!.rows.length)}
                total={page!.total}
              />
            </div>
            {history.truncated ? <p className="mt-2 text-xs text-text-faint">Yalnız son 1.000 hareket listelenir.</p> : null}
          </>
        )}
      </section>
    </div>
  );
}
