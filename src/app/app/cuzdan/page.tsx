import {
  CalendarDays,
  CheckCircle2,
  Clock3,
  HandCoins,
  Info,
  ReceiptText,
  Users,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { now as nowMs, trParts } from "@/lib/clock";
import { requireModulePage } from "@/lib/require-module-page";
import { PageHeader } from "@/components/ui/page-header";
import { KpiGrid } from "@/components/ui/dashboard-grid";
import { StatCard } from "@/components/app/stat-card";
import { EmptyState } from "@/components/ui/empty-state";
import { ListLimitNotice } from "@/components/app/list-limit-notice";
import { Table, TableFrame, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { PrintButton } from "@/components/ui/print-button";
import { advisorShare, dealOf, isPaid, type SplitEntry } from "@/lib/team/advisor-share";
import { redirect } from "next/navigation";
import { lockedGate } from "@/lib/billing/page-gates";
import { getTenantGateContext } from "@/lib/cache/request";
import { DetailTabs, resolveTab, type DetailTabDef } from "@/components/app/detail-tabs";
import { canSeeAllEarnings } from "@/lib/team/earnings-scope";
import { currentMonthPeriod, earningInRange, fetchCommissionRows, trYearPeriod } from "@/lib/team/advisor-metrics";
import { OfficeEarnings } from "./office-earnings";
import { ChartFrame, BarCompare } from "@/app/app/_ui/lazy-chart";
import { Celebration } from "@/components/ui/illustrations";
import { isFirstCollectionMoment } from "@/lib/celebration-conditions";

type CommissionRow = {
  id: string;
  gross_amount: number;
  status: string;
  splits: SplitEntry[] | null;
  created_at: string;
  deal_id: string | null;
  deal: {
    id: string;
    assigned_to: string | null;
    property: { id: string; property_code: string; title: string | null } | { id: string; property_code: string; title: string | null }[] | null;
  } | {
    id: string;
    assigned_to: string | null;
    property: { id: string; property_code: string; title: string | null } | { id: string; property_code: string; title: string | null }[] | null;
  }[] | null;
};

function money(value: number) {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    maximumFractionDigits: 0,
  }).format(value);
}

const MONTH_LABELS = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
const LIST_LIMIT = 100;

export default async function CuzdanPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Tek "Kazanç" sayfası. Kapı: yalnız Komisyon modülü (paket kilidi YOK: Danışman paketinde de kendi kazancı açık).
  // "Ofis geneli" sekmesi: earnings_all izni + Ofis paketi (eski Ekip Merkezi / Kazanç kapısı) gerekir.
  const { userId, tenantId, role, perms } = await requireModulePage("commissions");
  const sp = (await searchParams) ?? {};
  const seeAll = canSeeAllEarnings(perms);
  const officeGate = seeAll && tenantId ? lockedGate("/app/ekip", await getTenantGateContext(tenantId)) : null;
  const officeTabAvailable = seeAll && !officeGate;
  if (officeGate && (Array.isArray(sp.sekme) ? sp.sekme[0] : sp.sekme) === "ofis") {
    redirect(`/app/paket?ozellik=${encodeURIComponent(officeGate.href)}`);
  }
  const tabs: DetailTabDef[] = [
    { id: "benim", label: "Benim kazancım", icon: Wallet },
    { id: "ofis", label: "Ofis geneli", icon: Users, hidden: !officeTabAvailable },
  ];
  const activeTab = resolveTab(sp, tabs.filter((t) => !t.hidden).map((t) => t.id), "benim");

  if (activeTab === "ofis") {
    return (
      <div className="space-y-5">
        <DetailTabs basePath="/app/cuzdan" tabs={tabs} active={activeTab} label="Kazanç sekmeleri" />
        <OfficeEarnings viewer={{ userId, role, perms }} tenantId={tenantId} />
      </div>
    );
  }

  const supabase = await createClient();

  const [{ data: profile }, { data: office }, commissionRes] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", userId).maybeSingle(),
    // Bordro çıktısının başlık bandı: ofis adı belgeye kimlik verir.
    tenantId
      ? supabase.from("tenants").select("name").eq("id", tenantId).maybeSingle()
      : Promise.resolve({ data: null }),
    // Pay hesabı jsonb split etiketi üzerinden yapıldığından filtre sunucuda kurulamıyor; geniş çekilip bellekte süzülür.
    // Okuma yolu Danışman KPI / Kıyas / Hedefler ile ORTAK (fetchCommissionRows): earnings_all yoksa başkasının
    // satırı sunucudan hiç çekilmez.
    fetchCommissionRows<CommissionRow>(supabase, {
      tenantId,
      viewerId: userId,
      seeAll,
      limit: 1000,
      extraColumns: "deal_id",
      dealSelect: "id, assigned_to, property:properties!deals_property_id_fkey(id, property_code, title)",
    }),
  ]);

  const fullName = (profile?.full_name as string | undefined) ?? null;
  const rows = commissionRes.rows;

  // Cüzdan satırları: yalnızca oturum açan kullanıcının payına düşenler
  const mine = rows
    .map((row) => {
      const share = advisorShare(row, fullName, userId);
      return share ? { row, share } : null;
    })
    .filter((x): x is { row: CommissionRow; share: { amount: number; note: string } } => x !== null);

  // Dönem sınırları Türkiye takvimine göre ve metriklerle AYNI aralık tanımı (advisor-metrics).
  const nowTs = nowMs();
  const monthPeriod = currentMonthPeriod(nowTs);
  const yearPeriod = trYearPeriod(trParts(nowTs).year);
  const monthStart = new Date(monthPeriod.startIso);
  const inMonth = (iso: string) => iso >= monthPeriod.startIso && iso < monthPeriod.endIso;
  const now = new Date(nowTs);

  const thisMonth = mine.filter(({ row }) => inMonth(row.created_at)).reduce((sum, { share }) => sum + share.amount, 0);
  const pending = mine
    .filter(({ row }) => !isPaid(row.status))
    .reduce((sum, { share }) => sum + share.amount, 0);
  // Tahsil edilen pay (bu ay / bu yıl): Danışman KPI "Gelir", Kıyas, Hedefler ve Performansım ile aynı hesap.
  const collectedThisMonth = earningInRange(rows, monthPeriod, fullName, userId).collected;
  const paidThisYear = earningInRange(rows, yearPeriod, fullName, userId).collected;

  // Dönem bordrosu (içinde bulunulan ay) — yalnızca çıktıda görünen resmi döküm.
  const donem = new Intl.DateTimeFormat("tr-TR", { month: "long", year: "numeric", timeZone: "Europe/Istanbul" }).format(monthStart);
  const bordroItems = mine.filter(({ row }) => inMonth(row.created_at));
  const bordroBrut = bordroItems.reduce((sum, { row }) => sum + (Number(row.gross_amount) || 0), 0);
  const bordroTahsil = bordroItems
    .filter(({ row }) => isPaid(row.status))
    .reduce((sum, { share }) => sum + share.amount, 0);
  const bordroBekleyen = thisMonth - bordroTahsil;

  // Son 6 ay hakediş serisi (raporlardaki trend deseni), TR ay sınırlarıyla
  const trNow = trParts(nowTs);
  const trendMonths = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(Date.UTC(trNow.year, trNow.month - (5 - i), 1));
    return {
      key: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`,
      label: MONTH_LABELS[d.getUTCMonth()],
      amount: 0,
    };
  });
  const trendIndex = new Map(trendMonths.map((m, i) => [m.key, i]));
  for (const { row, share } of mine) {
    const p = trParts(row.created_at);
    const idx = trendIndex.get(`${p.year}-${String(p.month + 1).padStart(2, "0")}`);
    if (idx !== undefined) trendMonths[idx].amount += share.amount;
  }
  const hasTrendData = trendMonths.some((m) => m.amount > 0);

  const firstCollection = isFirstCollectionMoment(
    mine.filter(({ row }) => isPaid(row.status)).map(({ row }) => row.created_at),
    nowTs,
  );

  const listed = mine.slice(0, LIST_LIMIT);

  // Hareket zaman çizelgesi — kayıtlar (created_at desc) ay bazında gruplanır
  const ayBaslikFmt = new Intl.DateTimeFormat("tr-TR", { month: "long", year: "numeric" });
  const timelineGroups: { key: string; label: string; items: typeof listed; toplam: number }[] = [];
  for (const item of listed) {
    const key = String(item.row.created_at).slice(0, 7);
    let g = timelineGroups[timelineGroups.length - 1];
    if (!g || g.key !== key) {
      g = { key, label: ayBaslikFmt.format(new Date(item.row.created_at)), items: [], toplam: 0 };
      timelineGroups.push(g);
    }
    g.items.push(item);
    g.toplam += item.share.amount;
  }

  return (
    <div className="space-y-6">
      {officeTabAvailable ? (
        <div className="no-print">
          <DetailTabs basePath="/app/cuzdan" tabs={tabs} active={activeTab} label="Kazanç sekmeleri" />
        </div>
      ) : null}
      <PageHeader
        className="no-print mb-0"
        eyebrow="Kişisel hakediş"
        title={`Kazanç${fullName ? ` · ${fullName}` : ""}`}
        description="Kapanan anlaşmalardan payına düşen hakediş, tahsilat ve bekleyen tutarlar tek ekranda."
        actions={<PrintButton tone="light" label="Dönem bordrosu yazdır" />}
      />

      {/* Dönem bordrosu — yalnızca çıktıda: değerleme raporundaki print deseni
          (başlık bandı + print-sheet tablo + imza alanları). */}
      <article className="print-only print-sheet">
        <header className="hairline-b flex flex-wrap items-start justify-between gap-4 pb-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-accent-text">
              {office?.name ?? "Emlak ofisi"}
            </p>
            <h1 className="mt-1 font-display text-2xl font-extrabold tracking-[-0.02em] text-text">
              Dönem bordrosu
            </h1>
            <p className="mt-1 text-sm text-text-muted">{fullName ?? "Danışman"}</p>
          </div>
          <dl className="text-right text-xs text-text-muted">
            <div className="flex justify-end gap-2">
              <dt>Dönem</dt>
              <dd className="font-semibold text-text">{donem}</dd>
            </div>
            <div className="mt-1 flex justify-end gap-2">
              <dt>Düzenlenme tarihi</dt>
              <dd className="font-semibold text-text">
                {new Intl.DateTimeFormat("tr-TR", { dateStyle: "long", timeZone: "Europe/Istanbul" }).format(now)}
              </dd>
            </div>
            <div className="mt-1 flex justify-end gap-2">
              <dt>Kayıt sayısı</dt>
              <dd className="numeric font-semibold text-text">{bordroItems.length}</dd>
            </div>
          </dl>
        </header>

        {bordroItems.length === 0 ? (
          <p className="mt-6 rounded-[var(--radius-card)] border border-dashed border-line-strong px-4 py-6 text-center text-sm text-text-muted">
            Bu dönemde hakediş kaydı bulunmuyor.
          </p>
        ) : (
          <TableFrame className="mt-6">
            <Table>
              <THead>
                <TR>
                  <TH>Tarih</TH>
                  <TH>Hakediş kalemi</TH>
                  <TH align="right">Brüt komisyon</TH>
                  <TH>Pay esası</TH>
                  <TH align="right">Danışman payı</TH>
                  <TH>Durum</TH>
                </TR>
              </THead>
              <TBody>
                {bordroItems.map(({ row, share }) => {
                  const deal = dealOf(row.deal);
                  const property = deal ? (Array.isArray(deal.property) ? deal.property[0] : deal.property) : null;
                  return (
                    <TR key={row.id}>
                      <TD className="text-text-muted">
                        {new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" }).format(new Date(row.created_at))}
                      </TD>
                      <TD className="font-semibold text-text">
                        {property?.title ?? "Komisyon kaydı"}
                        {property?.property_code ? (
                          <span className="block text-xs font-normal text-text-faint">{property.property_code}</span>
                        ) : null}
                      </TD>
                      <TD align="right">{money(Number(row.gross_amount))}</TD>
                      <TD className="text-text-muted">{share.note}</TD>
                      <TD align="right" className="font-bold text-text">{money(share.amount)}</TD>
                      <TD className="text-text-muted">{isPaid(row.status) ? "Tahsil edildi" : "Bekliyor"}</TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </TableFrame>
        )}

        {/* Toplamlar */}
        <dl className="print-avoid-break mt-6 grid grid-cols-2 gap-3">
          {[
            ["Brüt komisyon toplamı", money(bordroBrut)],
            ["Dönem hakedişi", money(thisMonth)],
            ["Tahsil edilen", money(bordroTahsil)],
            ["Bekleyen", money(bordroBekleyen)],
          ].map(([k, v]) => (
            <div key={k} className="rounded-[var(--radius-card)] border border-line bg-canvas px-4 py-2.5">
              <dt className="text-xs text-text-faint">{k}</dt>
              <dd className="numeric text-sm font-bold text-text">{v}</dd>
            </div>
          ))}
        </dl>

        <p className="mt-4 text-xs leading-relaxed text-text-muted">
          Pay hesabı komisyon defterindeki paylaşım oranlarından üretilmiştir; bu belge bilgilendirme
          amaçlıdır, resmî ücret bordrosu yerine geçmez.
        </p>

        {/* Islak imza alanları */}
        <div className="mt-10 grid grid-cols-2 gap-12">
          <div>
            <div className="hairline-t pt-1.5 text-xs text-text-muted">Danışman · {fullName ?? "ad, soyad"}</div>
          </div>
          <div>
            <div className="hairline-t pt-1.5 text-xs text-text-muted">Ofis yetkilisi · ad, soyad, imza</div>
          </div>
        </div>
      </article>

      <KpiGrid count={4} className="no-print">
        <StatCard label="Bekleyen bakiye (tahsil edilmemiş)" value={money(pending)} icon={Clock3} tone="warning" href="/app/komisyon?durum=bekleyen" />
        <StatCard label={`Bu ay tahsil edilen pay · ${donem}`} value={money(collectedThisMonth)} icon={CalendarDays} href="/app/komisyon?durum=tahsil" />
        <StatCard label="Tahsil edilen (bu yıl)" value={money(paidThisYear)} icon={CheckCircle2} tone="success" href="/app/komisyon?durum=tahsil" />
        <StatCard label="Toplam kayıt" value={mine.length} icon={ReceiptText} href="/app/komisyon" />
      </KpiGrid>

      {firstCollection ? (
        <div className="no-print relative flex items-center gap-3 overflow-hidden rounded-[var(--radius-panel)] bg-success-soft px-5 py-3" role="status">
          <Celebration tick label="İlk tahsilat" />
          <p className="text-sm font-semibold text-success-strong">İlk tahsilatınız gerçekleşti: tahsil edilen payınız aşağıda kayıtlıdır.</p>
        </div>
      ) : null}

      {hasTrendData ? (
        <div className="no-print">
          <ChartFrame
            title="Son 6 ay hakediş"
            subtitle="Aylık hakediş"
            href="/app/komisyon?durum=tahsil"
            hrefLabel="Komisyon defteri"
            height={208}
            className="shadow-[var(--elev-1)]"
          >
            <BarCompare
              data={trendMonths.map((m) => ({ ay: m.label, hakedis: m.amount }))}
              xKey="ay"
              series={[{ key: "hakedis", label: "Hakediş", color: "var(--viz-1)" }]}
              format="money"
            />
          </ChartFrame>
        </div>
      ) : null}

      {mine.length === 0 ? (
        <div className="no-print">
          <EmptyState illustration="komisyon"
            icon={HandCoins}
            title="Henüz kazancınız yok"
            description="İlk anlaşman kapanınca hakedişin burada birikecek."
            action={{ href: "/app/anlasmalar", label: "Anlaşmalara git" }}
            tone="mint"
          />
        </div>
      ) : (
        <section className="no-print overflow-hidden rounded-[var(--radius-panel)] bg-surface shadow-[var(--elev-1)]">
          <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
            <div><p className="flex items-center gap-2 text-xs font-semibold text-accent-text"><ReceiptText className="h-4 w-4" /> Hakediş kayıtları</p><h2 className="mt-1 font-display font-bold text-text">Hareket zaman çizelgesi</h2></div>
            <span className="rounded-full bg-surface-accent-soft px-2.5 py-1 text-xs font-bold text-accent-text">{listed.length} kayıt</span>
          </div>
          <div className="px-5 pt-3">
            <ListLimitNotice
              shown={listed.length}
              total={mine.length}
              hint="Tam döküm için komisyon defterinden dışa aktarım kullanın."
              href="/app/komisyon"
              hrefLabel="Komisyon defteri"
            />
          </div>
          {/* Hareket zaman çizelgesi — ay başlıkları + sol ray üzerinde durum noktaları */}
          <div className="px-5 pb-2">
            {timelineGroups.map((group) => (
              <div key={group.key}>
                <div className="flex items-center justify-between gap-3 pb-2 pt-4">
                  <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.1em] text-text-faint">
                    <CalendarDays className="h-3.5 w-3.5 text-accent-text" /> {group.label}
                  </p>
                  <span className="numeric rounded-full bg-success-soft px-2.5 py-0.5 text-xs font-bold text-success-strong">
                    {money(group.toplam)}
                  </span>
                </div>
                <div className="relative ml-1.5 space-y-1 border-l-2 border-line pb-2">
                  {group.items.map(({ row, share }) => {
                    const deal = dealOf(row.deal);
                    const property = deal ? (Array.isArray(deal.property) ? deal.property[0] : deal.property) : null;
                    const paid = isPaid(row.status);
                    return (
                      <article
                        key={row.id}
                        className="group relative grid gap-2 rounded-[var(--radius-card)] py-3 pl-5 pr-2 transition hover:bg-surface-hover md:grid-cols-[1.4fr_.7fr_.7fr_auto] md:items-center"
                      >
                        {/* Zaman çizelgesi noktası — durum rengi */}
                        <span
                          aria-hidden
                          className={`absolute -left-[7px] top-[22px] h-3 w-3 rounded-full border-2 border-surface ${
                            paid ? "bg-mint-500" : "bg-amber-400"
                          }`}
                        />
                        {/* Örtü link: portföylü kayıt portföye, portföysüz kayıt bağlı anlaşmaya gider */}
                        {property?.id ? (
                          <Link href={`/app/portfoyler/${property.id}`} className="absolute inset-0" aria-label={`${property.title ?? property.property_code ?? "Hakediş"} portföyü`} />
                        ) : row.deal_id ? (
                          <Link href={`/app/anlasmalar/${row.deal_id}`} className="absolute inset-0" aria-label="Bağlı anlaşmayı aç" />
                        ) : null}
                        <div>
                          <p className="text-sm font-semibold text-text">{property?.title ?? "Komisyon kaydı"}</p>
                          <p className="mt-0.5 text-xs text-text-muted">{property?.property_code ?? (row.deal_id ? "Portföysüz anlaşma" : "Genel işlem")} · {new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" }).format(new Date(row.created_at))}</p>
                        </div>
                        <div>
                          <p className="text-xs text-text-faint">Brüt komisyon</p>
                          <p className="font-display text-sm font-bold text-text">{money(Number(row.gross_amount))}</p>
                        </div>
                        <div>
                          <p className="text-xs text-text-faint">Danışman payı</p>
                          <p className="font-display text-sm font-bold text-success-strong">{money(share.amount)}</p>
                          <p className="mt-0.5 text-xs text-text-muted">{share.note}</p>
                        </div>
                        <div>
                          <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${paid ? "bg-success-soft text-success-strong" : "bg-amber-400/15 text-warning-strong"}`}>
                            {paid ? "Tahsil edildi" : "Bekliyor"}
                          </span>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          {/* Metodoloji notu — pay hangi kaynaktan hesaplanıyor? */}
          <div className="flex items-start gap-2 border-t border-line bg-[var(--surface-sunken)] px-5 py-3 text-xs text-text-muted">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-text" />
            <span>
              Pay hesabı: paylaşım satırında <strong>adınla birebir eşleşen</strong> etiketin oranı; adın yoksa ve anlaşma
              sana atanmışsa jenerik <strong>&quot;Danışman&quot;</strong> satırının oranı; paylaşım hiç tanımlanmamışsa brüt tutarın
              tamamı gösterilir. Oranlar komisyon defterindeki paylaşım editöründen yönetilir.
            </span>
          </div>
        </section>
      )}
    </div>
  );
}
