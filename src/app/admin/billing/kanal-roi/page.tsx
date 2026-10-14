import Link from "@/components/ui/smart-link";
import { AlertTriangle, CircleDollarSign, Megaphone, Target, UserPlus, Users, Wallet } from "lucide-react";
import { requirePlatformModule } from "@/lib/platform";
import { now as clockNow } from "@/lib/clock";
import { formatDateTr, formatTry } from "@/lib/format";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { AdminPanel, AdminScrollArea } from "@/components/admin/admin-table";
import { StatRow } from "@/components/ui/stat-row";
import { FilterChip } from "@/components/ui/filter-chip";
import { EmptyState } from "@/components/ui/empty-state";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { CHANNEL_LABEL, isChannel } from "@/lib/measure/channel";
import { loadChannelRoi } from "@/lib/channel-roi/read";
import { monthLabel, parseRoiPeriod, ROI_PERIODS, roiChannelLabel, SPEND_CHANNELS, type ChannelRoiRow, type RoiChannel, type RoiPeriod } from "@/lib/channel-roi/model";
import { BillingNav } from "../billing-nav";
import { SpendDeleteButton, SpendForm } from "./spend-controls";

export const metadata = { title: "Kanal ROI" };

const BASE = "/admin/billing/kanal-roi";
const ADS_HREF = "/admin/site/reklam/google";
const LIST_LIMIT = 200;

type Q = { donem?: RoiPeriod; kanal?: RoiChannel; odeyen?: boolean };

function href(q: Q, anchor?: string): string {
  const sp = new URLSearchParams();
  if (q.donem && q.donem !== 6) sp.set("donem", String(q.donem));
  if (q.kanal) sp.set("kanal", q.kanal);
  if (q.odeyen) sp.set("odeyen", "1");
  const s = sp.toString();
  return `${BASE}${s ? `?${s}` : ""}${anchor ? `#${anchor}` : ""}`;
}

const parseChannel = (raw: string | undefined): RoiChannel | undefined => (raw === "bilinmiyor" ? "bilinmiyor" : isChannel(raw) ? raw : undefined);
const pct = (n: number | null) => (n === null ? "—" : `%${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 }).format(n * 100)}`);
const ratio = (n: number | null) => (n === null ? "—" : `${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 }).format(n)}×`);
const months = (n: number | null) => (n === null ? "—" : `${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 }).format(n)} ay`);
const money = (n: number | null) => (n === null ? "—" : formatTry(n));

/** Sayı hücresi: her değer kaynağına gider (sıfır çıkmaz metrik). */
function NumLink({ to, children, title }: { to: string; children: React.ReactNode; title?: string }) {
  return (
    <Link href={to} title={title} className="focus-ring numeric rounded-[var(--radius-control)] font-semibold text-ink-950 hover:text-brand-600 hover:underline">
      {children}
    </Link>
  );
}

/**
 * Abonelikler > Kanal ROI (gelir analitiği sekmesi): pazarlama harcaması → kayıt → ödeyen → gelir hunisi kanal bazında,
 * CAC ve geri ödeme süresi. Tanımlar ve hesap `src/lib/channel-roi/model.ts`; okuma `read.ts`. Süzgeçler URL'de
 * (`donem`, `kanal`, `odeyen`); harcama satırları ve dönem ofisleri aynı sayfada süzülür (her sayı kaynağına gider).
 */
export default async function ChannelRoiPage({ searchParams }: { searchParams?: Promise<{ donem?: string; kanal?: string; odeyen?: string }> }) {
  await requirePlatformModule("billing");
  const sp = (await searchParams) ?? {};
  const donem = parseRoiPeriod(sp.donem);
  const kanal = parseChannel(sp.kanal);
  const odeyen = sp.odeyen === "1";
  const nowMs = clockNow();
  const data = await loadChannelRoi(nowMs, donem);
  const { result, months: window } = data;
  const total = result.total;
  const q: Q = { donem };
  const periodText = `${monthLabel(window[0]!)} – ${monthLabel(window[window.length - 1]!)}`;

  const tenants = data.tenants.filter((t) => (!kanal || t.channel === kanal) && (!odeyen || t.payer));
  const spendEntries = data.spendEntries.filter((e) => !kanal || e.channel === kanal);
  const adsRows = !kanal || kanal === "paid_search" ? data.adsByMonth.filter((a) => a.amount > 0) : [];
  const channelOptions = SPEND_CHANNELS.map((c) => ({ value: c, label: CHANNEL_LABEL[c] }));
  const empty = result.rows.length === 0;

  const rowCells = (r: ChannelRoiRow, isTotal = false) => {
    const k: Q = { ...q, kanal: isTotal ? undefined : r.channel };
    return (
      <>
        <TD className="text-right">
          {r.spend > 0 ? (
            <span className="inline-flex flex-col items-end">
              <NumLink to={href(k, "harcama")}>{formatTry(r.spend)}</NumLink>
              {r.spendAds > 0 ? (
                <Link href={ADS_HREF} className="focus-ring text-xs text-text-faint hover:text-brand-600 hover:underline">
                  Google Ads {formatTry(r.spendAds)}
                </Link>
              ) : null}
            </span>
          ) : (
            <NumLink to={href(k, "harcama")} title="Harcama gir">—</NumLink>
          )}
        </TD>
        <TD className="text-right"><NumLink to={href(k, "ofisler")}>{r.signups}</NumLink></TD>
        <TD className="text-right"><NumLink to={href({ ...k, odeyen: true }, "ofisler")}>{r.payers}</NumLink></TD>
        <TD className="text-right"><NumLink to={href({ ...k, odeyen: true }, "ofisler")}>{pct(r.conversion)}</NumLink></TD>
        <TD className="text-right"><NumLink to={href({ ...k, odeyen: true }, "ofisler")}>{formatTry(r.revenue)}</NumLink></TD>
        <TD className="text-right"><NumLink to={href({ ...k, odeyen: true }, "ofisler")} title="Harcama ÷ ödeyen">{money(r.cac)}</NumLink></TD>
        <TD className="text-right"><NumLink to={href(k, "ofisler")} title="Harcama ÷ kayıt">{money(r.costPerSignup)}</NumLink></TD>
        <TD className="text-right"><NumLink to={href({ ...k, odeyen: true }, "ofisler")} title="CAC ÷ ödeyen başına aylık gelir">{months(r.paybackMonths)}</NumLink></TD>
        <TD className="text-right"><NumLink to={href({ ...k, odeyen: true }, "ofisler")} title="Gelir ÷ harcama">{ratio(r.roas)}</NumLink></TD>
      </>
    );
  };

  return (
    <div className="space-y-6">
      <AdminPageHeader
        art="coins"
        icon={Target}
        eyebrow="Gelir analitiği · kanal"
        title="Kanal ROI"
        description={`Pazarlama harcamasından kayda, ödeyen ofise ve gelire kanal bazında huni (${periodText}). CAC, kayıt başı maliyet ve geri ödeme süresi gerçekleşen veriden hesaplanır; tahmin yoktur.`}
      />
      <BillingNav active="kanal-roi" />

      <nav aria-label="Dönem" className="flex flex-wrap items-center gap-2">
        {ROI_PERIODS.map((p) => (
          <FilterChip key={p} href={href({ donem: p, kanal, odeyen })} active={donem === p}>
            Son {p} ay
          </FilterChip>
        ))}
        {kanal ? (
          <FilterChip href={href({ donem, odeyen })} active className="ml-auto">
            Kanal: {roiChannelLabel(kanal)} ✕
          </FilterChip>
        ) : null}
      </nav>

      {data.partial.length ? (
        <p role="alert" className="flex items-start gap-2 rounded-[var(--radius-card)] border border-amber-300 bg-amber-400/10 px-4 py-3 text-sm text-amber-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          Şu kaynaklar okunamadı, sayılar eksik olabilir: {data.partial.join(", ")}. Sayfayı yenileyin; sürerse Sistem &gt; Hata kayıtları&apos;na bakın.
        </p>
      ) : null}

      <StatRow
        label="Kanal ROI özeti"
        items={[
          { label: "Pazarlama harcaması", value: formatTry(total.spend), href: href(q, "harcama"), hint: total.spendAds > 0 ? `Google Ads ${formatTry(total.spendAds)} dahil` : "elle girilen + Google Ads", icon: <Wallet className="h-4 w-4" /> },
          { label: "Yeni kayıt", value: total.signups, href: href(q, "ofisler"), hint: `ödeyen ${total.payers}`, icon: <UserPlus className="h-4 w-4" /> },
          { label: "Gelir (KDV hariç)", value: formatTry(total.revenue), href: href({ ...q, odeyen: true }, "ofisler"), hint: "dönem kayıtlarının ödemesi − iade", icon: <CircleDollarSign className="h-4 w-4" /> },
          { label: "CAC", value: money(total.cac), href: href({ ...q, odeyen: true }, "ofisler"), hint: total.paybackMonths !== null ? `geri ödeme ${months(total.paybackMonths)}` : "harcama ÷ ödeyen", icon: <Users className="h-4 w-4" /> },
        ]}
      />

      <AdminPanel
        title="Kanal hunisi"
        icon={Megaphone}
        description="Harcama, kayıt, ödeyen ve gelir aynı dönemdeki kayıt kohortundan. Satırdaki her sayı kaynağını açar."
        className="scroll-mt-24"
      >
        {empty ? (
          <EmptyState
            variant="compact"
            bare
            icon={Megaphone}
            title="Bu dönemde harcama ya da kayıt yok"
            description="Pazarlama harcamasını aşağıdan girin; Google Ads bağlıysa maliyet otomatik gelir. Kayıt oldukça kanal satırları burada oluşur."
          />
        ) : (
          <div id="roi-tablosu">
            <AdminScrollArea minWidth={980}>
              <Table>
                <THead>
                  <TR>
                    <TH>Kanal</TH>
                    <TH className="text-right">Harcama</TH>
                    <TH className="text-right">Kayıt</TH>
                    <TH className="text-right">Ödeyen</TH>
                    <TH className="text-right">Dönüşüm</TH>
                    <TH className="text-right">Gelir</TH>
                    <TH className="text-right">CAC</TH>
                    <TH className="text-right">Kayıt başı</TH>
                    <TH className="text-right">Geri ödeme</TH>
                    <TH className="text-right">ROAS</TH>
                  </TR>
                </THead>
                <TBody>
                  {result.rows.map((r) => (
                    <TR key={r.channel} className={kanal === r.channel ? "bg-brand-600/5" : undefined}>
                      <TD>
                        <Link href={href({ ...q, kanal: kanal === r.channel ? undefined : r.channel })} className="focus-ring font-semibold text-ink-950 hover:text-brand-600 hover:underline">
                          {r.label}
                        </Link>
                      </TD>
                      {rowCells(r)}
                    </TR>
                  ))}
                  <TR className="border-t-2 border-line">
                    <TD className="font-bold text-ink-950">Toplam</TD>
                    {rowCells(total, true)}
                  </TR>
                </TBody>
              </Table>
            </AdminScrollArea>
          </div>
        )}
        <p className="border-t border-line px-5 py-3 text-xs text-text-muted">
          Kanal, kayıt anındaki atıftır (ziyaret sayacıyla aynı kural). Ödeyen: dönemde kayıt olup en az bir faturası ödenmiş ofis. Gelir: bu ofislerin
          bugüne kadar ödenen faturalarının KDV hariç tutarı − alacak dekontları. CAC = harcama ÷ ödeyen; geri ödeme = CAC ÷ ödeyen başına gerçekleşen
          aylık gelir. ROAS = gelir ÷ harcama. Atıfsız kayıt: atıf satırı olmayan ofis (atıf taşıma kapalıyken ya da elle açılan ofis).
        </p>
      </AdminPanel>

      <AdminPanel
        title={`Dönem ofisleri${kanal ? ` · ${roiChannelLabel(kanal)}` : ""}${odeyen ? " · ödeyen" : ""}`}
        icon={Users}
        description={`${periodText} arasında kayıt olan ofisler (kaynak: ofis kaydı + kayıt atfı + ödenmiş faturalar).`}
        actions={
          <>
            <FilterChip href={href({ donem, kanal }, "ofisler")} active={!odeyen}>
              Tümü
            </FilterChip>
            <FilterChip href={href({ donem, kanal, odeyen: true }, "ofisler")} active={odeyen}>
              Yalnız ödeyen
            </FilterChip>
          </>
        }
        className="scroll-mt-24"
      >
        <div id="ofisler" />
        {tenants.length === 0 ? (
          <EmptyState variant="compact" bare icon={Users} title="Bu süzgeçte ofis yok" description="Dönemi genişletin ya da kanal/ödeyen süzgecini kaldırın." />
        ) : (
          <ul className="divide-y divide-line">
            {tenants.slice(0, LIST_LIMIT).map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                <span className="min-w-0">
                  <Link href={`/admin/tenants/${t.id}`} className="focus-ring font-semibold text-ink-950 hover:text-brand-600 hover:underline">
                    {t.name}
                  </Link>
                  <Link href={href({ donem, kanal: t.channel, odeyen }, "ofisler")} className="focus-ring ml-2 text-xs text-text-muted hover:text-brand-600 hover:underline">
                    {roiChannelLabel(t.channel)}
                  </Link>
                </span>
                <span className="flex flex-wrap items-center gap-3 text-xs text-text-muted">
                  <span>Kayıt {formatDateTr(t.createdAt)}</span>
                  <Link href={`/admin/tenants/${t.id}?sekme=abonelik`} className={`focus-ring font-semibold hover:underline ${t.payer ? "text-ink-950" : "text-text-faint"}`}>
                    {t.payer ? formatTry(t.revenue) : "Henüz ödeme yok"}
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        )}
        {tenants.length > LIST_LIMIT ? <p className="border-t border-line px-5 py-3 text-xs text-text-muted">İlk {LIST_LIMIT} / {tenants.length} ofis gösteriliyor; kanal süzgeciyle daraltın.</p> : null}
      </AdminPanel>

      <AdminPanel
        title={`Pazarlama harcaması${kanal ? ` · ${roiChannelLabel(kanal)}` : ""}`}
        icon={Wallet}
        description="Ay + kanal başına tek tutar; aynı ay ve kanal yeniden girilirse güncellenir. Google Ads maliyeti otomatik okunur, burada tekrar girmeyin."
        className="scroll-mt-24"
      >
        <div id="harcama" className="space-y-4 p-5">
          {data.spendSetupPending ? (
            <p className="rounded-[var(--radius-card)] border border-dashed border-line-strong px-4 py-3 text-sm text-text-muted">
              Harcama tablosu henüz kurulmadı (migration <code>20261014005000_channel_roi_status_page.sql</code>). O zamana kadar yalnız Google Ads maliyeti sayılır.
            </p>
          ) : null}
          <SpendForm
            channels={channelOptions}
            defaultMonth={window[window.length - 1]!}
            defaultChannel={kanal && kanal !== "bilinmiyor" && SPEND_CHANNELS.includes(kanal) ? kanal : undefined}
            disabled={data.spendSetupPending}
          />
        </div>
        {spendEntries.length === 0 && adsRows.length === 0 ? (
          <EmptyState variant="compact" bare icon={Wallet} title="Bu dönemde harcama kaydı yok" description={kanal ? "Bu kanal için harcama girilmemiş." : "Yukarıdaki formla aylık harcamayı girin."} />
        ) : (
          <ul className="divide-y divide-line border-t border-line">
            {spendEntries.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                <span className="min-w-0">
                  <span className="font-semibold text-ink-950">{monthLabel(e.month)}</span>
                  <Link href={href({ donem, kanal: e.channel }, "harcama")} className="focus-ring ml-2 text-text-muted hover:text-brand-600 hover:underline">
                    {CHANNEL_LABEL[e.channel]}
                  </Link>
                  {e.note ? <span className="ml-2 text-xs text-text-faint">· {e.note}</span> : null}
                </span>
                <span className="flex items-center gap-3">
                  <span className="numeric font-semibold text-ink-950">{formatTry(e.amount)}</span>
                  <SpendDeleteButton id={e.id} label={`${monthLabel(e.month)} ${CHANNEL_LABEL[e.channel]}`} />
                </span>
              </li>
            ))}
            {adsRows.map((a) => (
              <li key={`ads-${a.month}`} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                <span className="min-w-0">
                  <span className="font-semibold text-ink-950">{monthLabel(a.month)}</span>
                  <span className="ml-2 text-text-muted">{CHANNEL_LABEL.paid_search} · Google Ads (otomatik)</span>
                </span>
                <Link href={ADS_HREF} className="focus-ring numeric font-semibold text-ink-950 hover:text-brand-600 hover:underline">
                  {formatTry(a.amount)}
                </Link>
              </li>
            ))}
          </ul>
        )}
        {!data.adsAvailable ? (
          <p className="border-t border-line px-5 py-3 text-xs text-text-muted">
            Google Ads verisi okunamadı ya da bağlantı yok; Ücretli arama harcaması yalnız elle girilen tutardır.{" "}
            <Link href="/admin/site/baglantilar" className="font-semibold text-brand-600 hover:underline">
              Bağlantılar
            </Link>
          </p>
        ) : null}
      </AdminPanel>
    </div>
  );
}
