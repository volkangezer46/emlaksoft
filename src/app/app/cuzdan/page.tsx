import {
  CalendarDays,
  CheckCircle2,
  Clock3,
  HandCoins,
  Info,
  ReceiptText,
  TrendingUp,
} from "lucide-react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { now as nowMs } from "@/lib/clock";
import { requireModulePage } from "@/lib/require-module-page";
import { StatCard } from "@/components/app/stat-card";
import { EmptyState } from "@/components/app/empty-state";
import { ListLimitNotice } from "@/components/app/list-limit-notice";
import { Table, TableFrame, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { PrintButton } from "./print-button";

type SplitEntry = { label?: string; amount?: number; rate?: number };

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

function dealOf(value: CommissionRow["deal"]) {
  return Array.isArray(value) ? value[0] : value;
}

function isPaid(status: string) {
  return status === "paid" || status === "collected";
}

/**
 * Danışman payı hesabı — şema kararı:
 *
 * `commissions.splits` jsonb `[{label, rate}]` taşır; satırlarda danışman
 * PROFİL ID'Sİ YOK, taraflar serbest metin etiket (split editörü böyle
 * kaydediyor). Bu yüzden pay üç kademede belirlenir:
 *
 * 1. Etiketi kullanıcının tam adıyla birebir eşleşen split satır(lar)ı varsa
 *    pay = brüt × oran (adına yazılmış paylaşım en güvenilir kaynak).
 * 2. Ad eşleşmesi yoksa ama bağlı anlaşma kullanıcıya atanmışsa
 *    (`deals.assigned_to`), jenerik "Danışman" etiketli satırın oranı kullanılır
 *    (editörün varsayılan şablonu bu etiketi üretir).
 * 3. Paylaşım hiç tanımlanmamışsa ve anlaşma kullanıcıya atanmışsa brüt tutarın
 *    tamamı "paylaşım bekliyor" notuyla gösterilir.
 *
 * Bunların hiçbiri tutmayan kayıtlar bu cüzdana girmez.
 */
function advisorShare(
  row: CommissionRow,
  fullName: string | null,
  userId: string,
): { amount: number; note: string } | null {
  const gross = Number(row.gross_amount) || 0;
  const assignedToMe = dealOf(row.deal)?.assigned_to === userId;
  const splits = Array.isArray(row.splits) ? row.splits : [];

  if (splits.length > 0) {
    const named = fullName ? splits.filter((s) => s.label === fullName) : [];
    if (named.length > 0) {
      const rate = named.reduce((sum, s) => sum + (Number(s.rate) || 0), 0);
      return { amount: Math.round(gross * (rate / 100)), note: `%${rate} pay` };
    }
    if (assignedToMe) {
      const generic = splits.find((s) => s.label === "Danışman");
      if (generic) {
        const rate = Number(generic.rate) || 0;
        return { amount: Math.round(gross * (rate / 100)), note: `%${rate} pay (Danışman)` };
      }
    }
    return null;
  }

  if (assignedToMe) return { amount: gross, note: "Paylaşım tanımsız · brüt" };
  return null;
}

const MONTH_LABELS = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
const LIST_LIMIT = 100;

export default async function CuzdanPage() {
  const { userId, tenantId } = await requireModulePage("commissions");
  const supabase = await createClient();

  const [{ data: profile }, { data: office }, { data: commissionData }] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", userId).maybeSingle(),
    // Bordro çıktısının başlık bandı: ofis adı belgeye kimlik verir.
    tenantId
      ? supabase.from("tenants").select("name").eq("id", tenantId).maybeSingle()
      : Promise.resolve({ data: null }),
    // Pay hesabı jsonb split etiketi üzerinden yapıldığından filtre sunucuda
    // kurulamıyor; komisyon KPI'larındaki gibi geniş çekilip bellekte süzülür.
    supabase
      .from("commissions")
      .select(
        "id, gross_amount, status, splits, created_at, deal_id, deal:deals(id,assigned_to,property:properties(id,property_code,title))",
      )
      .order("created_at", { ascending: false })
      .limit(1000),
  ]);

  const fullName = (profile?.full_name as string | undefined) ?? null;
  const rows = (commissionData ?? []) as CommissionRow[];

  // Cüzdan satırları: yalnızca oturum açan kullanıcının payına düşenler
  const mine = rows
    .map((row) => {
      const share = advisorShare(row, fullName, userId);
      return share ? { row, share } : null;
    })
    .filter((x): x is { row: CommissionRow; share: { amount: number; note: string } } => x !== null);

  const now = new Date(nowMs());
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const yearStart = new Date(now.getFullYear(), 0, 1);

  const thisMonth = mine
    .filter(({ row }) => new Date(row.created_at) >= monthStart)
    .reduce((sum, { share }) => sum + share.amount, 0);
  const pending = mine
    .filter(({ row }) => !isPaid(row.status))
    .reduce((sum, { share }) => sum + share.amount, 0);
  const paidThisYear = mine
    .filter(({ row }) => isPaid(row.status) && new Date(row.created_at) >= yearStart)
    .reduce((sum, { share }) => sum + share.amount, 0);

  // Dönem bordrosu (içinde bulunulan ay) — yalnızca çıktıda görünen resmi döküm.
  const donem = new Intl.DateTimeFormat("tr-TR", { month: "long", year: "numeric" }).format(monthStart);
  const bordroItems = mine.filter(({ row }) => new Date(row.created_at) >= monthStart);
  const bordroBrut = bordroItems.reduce((sum, { row }) => sum + (Number(row.gross_amount) || 0), 0);
  const bordroTahsil = bordroItems
    .filter(({ row }) => isPaid(row.status))
    .reduce((sum, { share }) => sum + share.amount, 0);
  const bordroBekleyen = thisMonth - bordroTahsil;

  // Son 6 ay hakediş serisi (raporlardaki trend deseni)
  const trendMonths = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(monthStart);
    d.setMonth(d.getMonth() - (5 - i));
    return {
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label: MONTH_LABELS[d.getMonth()],
      amount: 0,
    };
  });
  const trendIndex = new Map(trendMonths.map((m, i) => [m.key, i]));
  for (const { row, share } of mine) {
    const idx = trendIndex.get(String(row.created_at).slice(0, 7));
    if (idx !== undefined) trendMonths[idx].amount += share.amount;
  }
  const trendMax = Math.max(1, ...trendMonths.map((m) => m.amount));
  const hasTrendData = trendMonths.some((m) => m.amount > 0);

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
      <section className="no-print theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="pointer-events-none absolute -right-14 -top-16 h-60 w-60 rounded-full bg-mint-400/20 blur-[80px]" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="flex items-center gap-2 text-xs font-semibold text-mint-400"><HandCoins className="h-4 w-4" /> Kişisel hakediş</span>
            <h1 className="mt-2 font-display text-2xl font-extrabold text-white md:text-3xl">Cüzdanım{fullName ? ` · ${fullName}` : ""}</h1>
            <p className="mt-1 text-sm text-white/60">Kapanan anlaşmalardan payına düşen hakediş, tahsilat ve bekleyen tutarlar tek ekranda.</p>
          </div>
          <PrintButton />
        </div>
        {/* Bakiye hero'su — bekleyen bakiye büyük, yanında dönem metrikleri.
            Kartlar komisyon defterinin okuduğu ?durum= filtresine gider. */}
        <div className="relative mt-6 grid gap-3 sm:grid-cols-[1.4fr_1fr_1fr]">
          <Link
            href="/app/komisyon?durum=bekleyen"
            className="focus-ring press lift group block rounded-[16px] border border-mint-400/25 bg-white/8 p-4 backdrop-blur transition hover:border-mint-400/50"
          >
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-mint-300">
              Bekleyen bakiye
              <ArrowUpRight className="hover-action h-3.5 w-3.5 text-white/30 opacity-0 transition group-hover:text-white group-hover:opacity-100" />
            </p>
            <p className="numeric mt-1.5 font-display text-3xl font-extrabold text-white md:text-4xl">{money(pending)}</p>
            <p className="mt-1 text-[11px] text-white/50">Tahsil edilmemiş hakediş toplamın</p>
          </Link>
          <Link
            href="/app/komisyon"
            className="focus-ring press lift group block rounded-[16px] border border-white/12 bg-white/8 p-4 backdrop-blur transition hover:border-white/30"
          >
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-white/50">
              Bu ay hakediş
              <ArrowUpRight className="hover-action h-3.5 w-3.5 text-white/30 opacity-0 transition group-hover:text-white group-hover:opacity-100" />
            </p>
            <p className="numeric mt-1.5 font-display text-2xl font-extrabold text-white">{money(thisMonth)}</p>
            <p className="mt-1 text-[11px] text-white/50">{donem} dönemi</p>
          </Link>
          <Link
            href="/app/komisyon?durum=tahsil"
            className="focus-ring press lift group block rounded-[16px] border border-white/12 bg-white/8 p-4 backdrop-blur transition hover:border-white/30"
          >
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-white/50">
              Bu yıl tahsil
              <ArrowUpRight className="hover-action h-3.5 w-3.5 text-white/30 opacity-0 transition group-hover:text-white group-hover:opacity-100" />
            </p>
            <p className="numeric mt-1.5 font-display text-2xl font-extrabold text-white">{money(paidThisYear)}</p>
            <p className="mt-1 text-[11px] text-white/50">Ödemesi tamamlanan pay</p>
          </Link>
        </div>
      </section>

      {/* Dönem bordrosu — yalnızca çıktıda: değerleme raporundaki print deseni
          (başlık bandı + print-sheet tablo + imza alanları). */}
      <article className="print-only print-sheet">
        <header className="hairline-b flex flex-wrap items-start justify-between gap-4 pb-5">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-brand-600">
              {office?.name ?? "Emlak ofisi"}
            </p>
            <h1 className="mt-1 font-display text-2xl font-extrabold tracking-[-0.02em] text-ink-950">
              Dönem bordrosu
            </h1>
            <p className="mt-1 text-sm text-text-muted">{fullName ?? "Danışman"}</p>
          </div>
          <dl className="text-right text-xs text-text-muted">
            <div className="flex justify-end gap-2">
              <dt>Dönem</dt>
              <dd className="font-semibold text-ink-950">{donem}</dd>
            </div>
            <div className="mt-1 flex justify-end gap-2">
              <dt>Düzenlenme tarihi</dt>
              <dd className="font-semibold text-ink-950">
                {new Intl.DateTimeFormat("tr-TR", { dateStyle: "long" }).format(now)}
              </dd>
            </div>
            <div className="mt-1 flex justify-end gap-2">
              <dt>Kayıt sayısı</dt>
              <dd className="numeric font-semibold text-ink-950">{bordroItems.length}</dd>
            </div>
          </dl>
        </header>

        {bordroItems.length === 0 ? (
          <p className="mt-6 rounded-[12px] border border-dashed border-line-strong px-4 py-6 text-center text-sm text-text-muted">
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
                      <TD className="font-semibold text-ink-950">
                        {property?.title ?? "Komisyon kaydı"}
                        {property?.property_code ? (
                          <span className="block text-[11px] font-normal text-text-faint">{property.property_code}</span>
                        ) : null}
                      </TD>
                      <TD align="right">{money(Number(row.gross_amount))}</TD>
                      <TD className="text-text-muted">{share.note}</TD>
                      <TD align="right" className="font-bold text-ink-950">{money(share.amount)}</TD>
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
            <div key={k} className="rounded-[12px] border border-line bg-canvas px-4 py-2.5">
              <dt className="text-[11px] text-text-faint">{k}</dt>
              <dd className="numeric text-sm font-bold text-ink-950">{v}</dd>
            </div>
          ))}
        </dl>

        <p className="mt-4 text-[11px] leading-relaxed text-text-muted">
          Pay hesabı komisyon defterindeki paylaşım oranlarından üretilmiştir; bu belge bilgilendirme
          amaçlıdır, resmî ücret bordrosu yerine geçmez.
        </p>

        {/* Islak imza alanları */}
        <div className="mt-10 grid grid-cols-2 gap-12">
          <div>
            <div className="hairline-t pt-1.5 text-[11px] text-text-muted">Danışman · {fullName ?? "ad, soyad"}</div>
          </div>
          <div>
            <div className="hairline-t pt-1.5 text-[11px] text-text-muted">Ofis yetkilisi · ad, soyad, imza</div>
          </div>
        </div>
      </article>

      <div className="no-print grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Bu ay hakediş" value={money(thisMonth)} icon={CalendarDays} href="/app/komisyon" />
        <StatCard label="Bekleyen (tahsil edilmemiş)" value={money(pending)} icon={Clock3} tone="warning" href="/app/komisyon?durum=bekleyen" />
        <StatCard label="Tahsil edilen (bu yıl)" value={money(paidThisYear)} icon={CheckCircle2} tone="success" href="/app/komisyon?durum=tahsil" />
        <StatCard label="Toplam kayıt" value={mine.length} icon={ReceiptText} href="/app/komisyon" />
      </div>

      {hasTrendData ? (
        <section className="no-print rounded-[20px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
          <div>
            <p className="flex items-center gap-2 text-xs font-semibold text-brand-600"><TrendingUp className="h-4 w-4" /> Trend</p>
            <h2 className="mt-1 font-display font-bold text-ink-950">Son 6 ay hakediş</h2>
          </div>
          <div className="mt-5 grid grid-cols-6 gap-2 sm:gap-4">
            {trendMonths.map((m, i) => (
              <div key={m.key} className="flex flex-col items-center">
                <div className="flex h-32 w-full items-end justify-center rounded-[12px] bg-canvas px-2 pb-2 pt-4">
                  <div
                    className="bar-live w-full max-w-[26px] rounded-t-[6px] bg-mint-500"
                    style={{ height: `${Math.max(m.amount > 0 ? 6 : 0, (m.amount / trendMax) * 100)}%`, animationDelay: `${i * 70}ms` }}
                    title={`Hakediş: ${money(m.amount)}`}
                  />
                </div>
                <p className="mt-2 text-center text-xs font-semibold text-ink-950">{m.label}</p>
                <p className="text-center text-[10px] font-bold tabular-nums text-mint-600">
                  {new Intl.NumberFormat("tr-TR", { notation: "compact", maximumFractionDigits: 1 }).format(m.amount)}
                </p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {mine.length === 0 ? (
        <div className="no-print">
          <EmptyState
            icon={HandCoins}
            title="Cüzdanın henüz boş"
            description="İlk anlaşman kapanınca hakedişin burada birikecek."
            action={{ href: "/app/anlasmalar", label: "Anlaşmalara git" }}
            tone="mint"
          />
        </div>
      ) : (
        <section className="no-print overflow-hidden rounded-[20px] border border-line bg-surface shadow-[var(--shadow-xs)]">
          <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
            <div><p className="flex items-center gap-2 text-xs font-semibold text-brand-600"><ReceiptText className="h-4 w-4" /> Hakediş kayıtları</p><h2 className="mt-1 font-display font-bold text-ink-950">Hareket zaman çizelgesi</h2></div>
            <span className="rounded-full bg-brand-600/10 px-2.5 py-1 text-[11px] font-bold text-brand-600">{listed.length} kayıt</span>
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
                  <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.1em] text-text-faint">
                    <CalendarDays className="h-3.5 w-3.5 text-brand-600" /> {group.label}
                  </p>
                  <span className="numeric rounded-full bg-mint-500/10 px-2.5 py-0.5 text-[11px] font-bold text-mint-700">
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
                        className="group relative grid gap-2 rounded-[12px] py-3 pl-5 pr-2 transition hover:bg-brand-600/[0.02] md:grid-cols-[1.4fr_.7fr_.7fr_auto] md:items-center"
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
                          <p className="text-sm font-semibold text-ink-950">{property?.title ?? "Komisyon kaydı"}</p>
                          <p className="mt-0.5 text-xs text-text-muted">{property?.property_code ?? (row.deal_id ? "Portföysüz anlaşma" : "Genel işlem")} · {new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" }).format(new Date(row.created_at))}</p>
                        </div>
                        <div>
                          <p className="text-[11px] text-text-faint">Brüt komisyon</p>
                          <p className="font-display text-sm font-bold text-ink-950">{money(Number(row.gross_amount))}</p>
                        </div>
                        <div>
                          <p className="text-[11px] text-text-faint">Danışman payı</p>
                          <p className="font-display text-sm font-bold text-mint-700">{money(share.amount)}</p>
                          <p className="mt-0.5 text-[11px] text-text-muted">{share.note}</p>
                        </div>
                        <div>
                          <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold ${paid ? "bg-mint-500/10 text-mint-600" : "bg-amber-400/15 text-amber-500"}`}>
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
          <div className="flex items-start gap-2 border-t border-line bg-canvas/60 px-5 py-3 text-[11px] text-text-muted">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-600" />
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
