import Link from "next/link";
import { ArrowUpRight, Coins, History, Info } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableEmptyRow, TableFrame, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ListPager } from "@/components/ui/list-kit/list-pager";
import { pageWindow } from "@/components/ui/list-kit/list-logic";
import { getEfCatalog, getEfCreditReady, readEfBalance, readEfHistory } from "@/lib/ef-credits/credit-reader";
import {
  EF_CATEGORY_LABEL,
  EF_HISTORY_PAGE_SIZE,
  categoryOf,
  filterAndPage,
  type EfMovementCategory,
} from "@/lib/ef-credits/credit-view";
import { efUnitsFor } from "@/lib/ef-credits/config";
import {
  activePacks,
  lowBalanceState,
  quoteCreditPack,
  suggestPack,
} from "@/lib/billing/credit-pack-purchase-core";
import { KontorPanel, type KontorPackCard } from "./kontor-panel";

const fmt = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 });
const dt = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Istanbul" });
const BASE = "/app/abonelik";

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
  /** Ödeme sonrası dönüş durumu (son kontör faturası). */
  latestInvoice: { status: string; paidAt: string | null; units: number | null } | null;
  /** Son kontör faturasının ödemesi yeni mi (sunucuda clock ile hesaplanır). */
  invoiceIsRecent: boolean;
  /** Planın otomatik aylık kontör hakkı (ek kullanıcı hakkı dahil); units 0 = pakette aylık hak yok. */
  allowance?: { planName: string; units: number; perExtraSeat: number; extraSeats: number };
};

export async function KontorSection(props: KontorSectionProps & { tenantId: string }) {
  const { tenantId, canBuy, iyzicoConfigured, latestInvoice, invoiceIsRecent, allowance } = props;
  const [ready, catalog] = await Promise.all([getEfCreditReady(), getEfCatalog()]);
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
      netTry: q.netTry,
      taxTry: q.taxTry,
      totalTry: q.totalTry,
      unitNetTry: q.unitNetTry,
      unitGrossTry: q.unitGrossTry,
      popular: Boolean(p.popular),
      suggested: suggested?.id === p.id,
    };
  });
  const blockReason = !ready
    ? "Kontör satın alma henüz etkin değil: yönetici hazırlığı tamamlanıyor. Paketleri şimdiden inceleyebilirsiniz."
    : !iyzicoConfigured
      ? "Ödeme altyapısı yapılandırılmamış; lütfen yönetici ile iletişime geçin."
      : null;

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
    { label: "Arsa değerlemesi", units: efUnitsFor("valuation_arsa", tariff), kalem: "degerleme" },
    { label: "Konut değerlemesi", units: efUnitsFor("valuation_konut", tariff), kalem: "degerleme" },
    { label: "PDF rapor (ilk indirme)", units: efUnitsFor("pdf_first", tariff), kalem: "pdf" },
  ];

  return (
    <div className="space-y-6">
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
        <Alert tone="info" title="Kontör cüzdanı henüz etkin değil">
          Kontör bakiyesi, satın alma ve kullanım geçmişi yönetici hazırlığı tamamlanınca açılır. Tarife ve paketleri şimdiden
          inceleyebilirsiniz.
        </Alert>
      ) : null}

      {low && low.state !== "ok" ? (
        <Alert
          tone={low.state === "empty" ? "danger" : "warning"}
          title={low.state === "empty" ? "Kontörünüz bitti" : "Kontörünüz azalıyor"}
          action={
            suggested && sellable.length > 0 ? (
              <Link href={`${BASE}?sekme=kontor#paketler`} className="text-xs font-bold underline">
                Önerilen paket: {suggested.name}
              </Link>
            ) : undefined
          }
        >
          {low.state === "empty"
            ? "Değerleme ve PDF rapor için kontör gerekir."
            : `Kalan ${fmt.format(balance!.available)} kontör, en ucuz işlemin iki katı (${fmt.format(low.threshold)}) ve altında.`}
        </Alert>
      ) : null}

      <section id="bakiye" className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
        <p className="flex items-center gap-2 text-xs font-semibold text-brand-600"><Coins className="h-4 w-4" /> EmlakFiyati kontörü</p>
        <h2 className="mt-1 font-display font-bold text-ink-950">Kontör bakiyeniz</h2>
        {balance ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Link href={hrefOf({})} className="focus-ring rounded-[var(--radius-card)] border border-line bg-canvas/50 p-4 transition hover:border-brand-300">
              <p className="text-xs font-semibold text-text-muted">Kullanılabilir</p>
              <p className="numeric font-display text-2xl font-extrabold text-ink-950">{fmt.format(balance.available)}</p>
            </Link>
            <Link href={hrefOf({})} className="focus-ring rounded-[var(--radius-card)] border border-line bg-canvas/50 p-4 transition hover:border-brand-300">
              <p className="text-xs font-semibold text-text-muted">İşlemde (rezerve)</p>
              <p className="numeric font-display text-2xl font-extrabold text-ink-950">{fmt.format(balance.reserved)}</p>
            </Link>
            <Link href={hrefOf({ kalem: "satin-alma" })} className="focus-ring rounded-[var(--radius-card)] border border-line bg-canvas/50 p-4 transition hover:border-brand-300">
              <p className="text-xs font-semibold text-text-muted">Toplam yüklenen</p>
              <p className="numeric font-display text-2xl font-extrabold text-ink-950">{fmt.format(balance.granted_total)}</p>
            </Link>
            <Link href={hrefOf({ kalem: "degerleme" })} className="focus-ring rounded-[var(--radius-card)] border border-line bg-canvas/50 p-4 transition hover:border-brand-300">
              <p className="text-xs font-semibold text-text-muted">Toplam harcanan</p>
              <p className="numeric font-display text-2xl font-extrabold text-ink-950">{fmt.format(balance.committed_total)}</p>
            </Link>
          </div>
        ) : (
          <p className="mt-3 text-sm text-text-muted">{ready ? "Bakiye şu an okunamadı; sayfayı yenileyin." : "Cüzdan etkinleşince bakiyeniz burada görünür."}</p>
        )}
        {allowance && allowance.units > 0 ? (
          <Link
            href={hrefOf({ kalem: "satin-alma" })}
            className="focus-ring mt-4 block rounded-[var(--radius-card)] border border-mint-500/30 bg-mint-500/10 p-4 transition hover:border-mint-500/60"
          >
            <p className="text-xs font-semibold text-mint-700">{allowance.planName} paketinin aylık kontör hakkı</p>
            <p className="numeric font-display text-xl font-extrabold text-ink-950">
              Her ay {fmt.format(allowance.units)} kontör
              {efUnitsFor("valuation_arsa", tariff) > 0 ? ` (yaklaşık ${fmt.format(Math.floor(allowance.units / efUnitsFor("valuation_arsa", tariff)))} değerleme)` : ""}
            </p>
            <p className="mt-1 text-xs text-text-muted">
              Otomatik yüklenir, kullanılmayan kontör devreder.
              {allowance.perExtraSeat > 0
                ? ` Hak, her ek kullanıcı için ${fmt.format(allowance.perExtraSeat)} kontör artar (şu an ${fmt.format(allowance.extraSeats)} ek kullanıcı).`
                : ""}
              {" "}Yetmezse aşağıdan ek paket alabilirsiniz.
            </p>
          </Link>
        ) : null}
      </section>

      <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
        <p className="flex items-center gap-2 text-xs font-semibold text-brand-600"><Info className="h-4 w-4" /> Tarife</p>
        <h2 className="mt-1 font-display font-bold text-ink-950">Hangi işlem kaç kontör?</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {tariffItems.map((t) => (
            <Link
              key={t.label}
              href={hrefOf({ kalem: t.kalem })}
              className="focus-ring group rounded-[var(--radius-card)] border border-line bg-canvas/50 p-4 transition hover:border-brand-300"
            >
              <div className="flex items-start justify-between">
                <p className="text-xs font-semibold text-text-muted">{t.label}</p>
                <ArrowUpRight className="h-4 w-4 text-text-faint transition group-hover:text-brand-600" />
              </div>
              <p className="numeric mt-1 font-display text-xl font-extrabold text-ink-950">
                {t.units > 0 ? `${fmt.format(t.units)} kontör` : "Ücretsiz"}
              </p>
            </Link>
          ))}
        </div>
        <p className="mt-3 text-xs text-text-muted">
          Aynı raporun PDF&apos;ini tekrar indirmek ücretsizdir. Sonuç üretilemezse (yetersiz veri veya hata) kontör düşmez.
          Değerler ilan fiyatlarına dayanır; kesin satış değeri değildir.
        </p>
      </section>

      <section id="paketler" className="scroll-mt-24 rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
        <p className="flex items-center gap-2 text-xs font-semibold text-brand-600"><Coins className="h-4 w-4" /> Paketler</p>
        <h2 className="mt-1 font-display font-bold text-ink-950">Kontör paketi satın alın</h2>
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
            <KontorPanel packs={cards} canBuy={canBuy} blockReason={blockReason} />
          )}
        </div>
        <p className="mt-3 text-xs text-text-muted">Kupon kodları kontör paketlerinde geçerli değildir. Fiyatlara %20 KDV eklenir.</p>
      </section>

      <section id="gecmis" className="scroll-mt-24 rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="flex items-center gap-2 text-xs font-semibold text-brand-600"><History className="h-4 w-4" /> Geçmiş</p>
            <h2 className="mt-1 font-display font-bold text-ink-950">Kontör kullanım geçmişi</h2>
          </div>
          <nav aria-label="Kalem süzgeci" className="flex flex-wrap gap-1.5">
            {([null, "degerleme", "pdf", "satin-alma", "iade"] as const).map((k) => (
              <Link
                key={k ?? "hepsi"}
                href={hrefOf({ kalem: k ?? undefined, kullanici: props.kullanici })}
                aria-current={(category ?? null) === k ? "true" : undefined}
                className={`focus-ring rounded-full px-2.5 py-1 text-xs font-bold ${
                  (category ?? null) === k ? "bg-ink-950 text-white" : "bg-brand-600/10 text-brand-600 hover:bg-brand-600/15"
                }`}
              >
                {k ? EF_CATEGORY_LABEL[k] : "Hepsi"}
              </Link>
            ))}
            {props.kullanici ? (
              <Link href={hrefOf({ kalem: category ?? undefined })} className="focus-ring rounded-full bg-amber-400/15 px-2.5 py-1 text-xs font-bold text-amber-700">
                Kullanıcı süzgeci: kaldır
              </Link>
            ) : null}
          </nav>
        </div>
        {!history ? (
          <p className="mt-4 rounded-[var(--radius-card)] border border-dashed border-line-strong px-4 py-6 text-center text-sm text-text-muted">
            Kullanım geçmişi, kontör cüzdanı etkinleşince burada listelenir.
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
                          <Link href={hrefOf({ kalem: r.category, kullanici: props.kullanici })} className="font-semibold text-ink-950 hover:text-brand-600 hover:underline">
                            {r.label}
                          </Link>
                        </TD>
                        <TD className="text-text-muted">
                          {r.userId ? (
                            <Link href={hrefOf({ kalem: category ?? undefined, kullanici: r.userId })} className="hover:text-brand-600 hover:underline">
                              {history.userNames[r.userId] ?? "Kullanıcı"}
                            </Link>
                          ) : (
                            "Sistem"
                          )}
                        </TD>
                        <TD align="right" className={`numeric font-bold ${r.units < 0 ? "text-ink-950" : "text-mint-700"}`}>
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
