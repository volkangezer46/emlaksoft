import Link from "next/link";
import { ArrowRight, ArrowUpRight, Banknote, CalendarRange, CheckCircle2, Percent, Tag, Timer } from "lucide-react";
import { now } from "@/lib/clock";
import { requireModulePage } from "@/lib/require-module-page";
import { StatCard } from "@/components/app/stat-card";
import { createClient } from "@/lib/supabase/server";
import { exportOffersCsv } from "@/app/actions/export";
import { ExportCsvButton } from "@/components/app/export-csv-button";
import { NewOfferDialog } from "./new-offer-dialog";
import { EmptyState } from "@/components/app/empty-state";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Table, TableFrame, TBody, TD, TH, THead, TR } from "@/components/ui/table";

const STATUS_LABELS: Record<string, string> = {
  draft:     "Taslak",
  submitted: "Sunuldu",
  countered: "Karşı teklif",
  accepted:  "Kabul edildi",
  rejected:  "Reddedildi",
  withdrawn: "Geri çekildi",
};

/** Durum → tasarım sistemi rozet tonu (ham emerald/red/zinc yerine). */
const STATUS_VARIANTS: Record<string, BadgeVariant> = {
  draft:     "default",
  submitted: "info",
  countered: "warning",
  accepted:  "success",
  rejected:  "danger",
  withdrawn: "outline",
};

function money(n: number | null) {
  if (n == null) return "—";
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(n);
}

function tarih(iso: string) {
  return new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(iso));
}

function one<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function fmtDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** `to` günü dahil olsun diye timestamptz karşılaştırmasında ertesi gün (hariç) kullanılır. */
function nextDay(iso: string) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Boş olmayan paramlardan query string üretir — mevcut filtreler korunur. */
function qs(params: Record<string, string | null | undefined>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export default async function TekliflerPage({
  searchParams,
}: {
  searchParams?: Promise<{ durum?: string; from?: string; to?: string; musteri?: string; portfoy?: string }>;
}) {
  const { perms } = await requireModulePage("offers");
  const canCreate = perms.offers?.includes("create") ?? perms.commissions?.includes("create") ?? false;
  const params = (await searchParams) ?? {};
  /*
   * Eşleştirme ekranındaki "Teklif al" kısayolu ?musteri=&portfoy= ile gelir:
   * diyalog müşteri/portföy ön dolgulu ve AÇIK gelir. Bu paramlar liste
   * filtresi DEĞİL — sayfa açılış niyetidir; listeyi daraltmazlar.
   */
  const prefillCustomerId = (params.musteri ?? "").trim() || null;
  const prefillPropertyId = (params.portfoy ?? "").trim() || null;
  // Filtre değerleri DB'deki gerçek durum enum'ları (draft/submitted/…)
  const durum = params.durum && STATUS_LABELS[params.durum] ? params.durum : null;
  const from = ISO_DATE.test(params.from ?? "") ? params.from! : null;
  const to = ISO_DATE.test(params.to ?? "") ? params.to! : null;

  // Mevcut filtreleri koruyan link üretici
  const href = (next: { durum?: string | null; from?: string | null; to?: string | null }) =>
    `/app/teklifler${qs({
      durum: next.durum === undefined ? durum : next.durum,
      from: next.from === undefined ? from : next.from,
      to: next.to === undefined ? to : next.to,
    })}`;

  // Hızlı tarih çipleri — zaman okuması clock.ts üzerinden (tek kaynak)
  const nowD = new Date(now());
  const presets = [
    { label: "Bu ay", from: fmtDate(new Date(nowD.getFullYear(), nowD.getMonth(), 1)), to: fmtDate(nowD) },
    { label: "Geçen ay", from: fmtDate(new Date(nowD.getFullYear(), nowD.getMonth() - 1, 1)), to: fmtDate(new Date(nowD.getFullYear(), nowD.getMonth(), 0)) },
    { label: "Son 3 ay", from: fmtDate(new Date(nowD.getFullYear(), nowD.getMonth() - 2, 1)), to: fmtDate(nowD) },
  ];

  const supabase = await createClient();

  // Hücre linkleri için ilişkili kayıtların ID'leri de çekiliyor;
  // listOffers ID döndürmediği için sorgu burada.
  let offerQuery = supabase
    .from("offers")
    .select(
      "id, amount, counter_amount, status, created_at, property_id, customer_id, property:properties(id, property_code, title), customer:customers(id, full_name)",
    )
    .order("created_at", { ascending: false })
    .limit(100);
  if (durum) offerQuery = offerQuery.eq("status", durum);
  // ?from=&to= sunucu filtresi — created_at aralığı, uç gün dahil
  if (from) offerQuery = offerQuery.gte("created_at", from);
  if (to) offerQuery = offerQuery.lt("created_at", nextDay(to));

  const [{ data: offerData }, { data: statusData }, { data: propData }, { data: custData }] = await Promise.all([
    offerQuery,
    // KPI sayıları/tutarları filtreden bağımsız: hero her zaman tüm kümeyi anlatır
    supabase.from("offers").select("status, amount, counter_amount").limit(1000),
    supabase
      .from("properties")
      .select("id, property_code, title, list_price")
      .is("deleted_at", null)
      .in("status", ["live", "draft", "reserved"])
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("customers")
      .select("id, full_name")
      .is("deleted_at", null)
      .order("full_name", { ascending: true })
      .limit(300),
  ]);

  const properties = (propData ?? []).map((p) => ({
    id: p.id,
    property_code: p.property_code as string,
    title: p.title as string | null,
    list_price: p.list_price as number | null,
  }));
  const customers = (custData ?? []).map((c) => ({
    id: c.id,
    full_name: c.full_name as string,
  }));

  /*
   * Seçici havuzları sınırlı (200 portföy / 300 müşteri). ?portfoy= ya da
   * ?musteri= havuzun dışında kalırsa ön dolgu sessizce düşerdi — eksik
   * kaydı tek sorguyla listeye ekliyoruz.
   */
  if (prefillPropertyId && !properties.some((p) => p.id === prefillPropertyId)) {
    const { data: extra } = await supabase
      .from("properties")
      .select("id, property_code, title, list_price")
      .eq("id", prefillPropertyId)
      .is("deleted_at", null)
      .maybeSingle();
    if (extra) {
      properties.unshift({
        id: extra.id,
        property_code: extra.property_code as string,
        title: extra.title as string | null,
        list_price: extra.list_price as number | null,
      });
    }
  }
  if (prefillCustomerId && !customers.some((c) => c.id === prefillCustomerId)) {
    const { data: extra } = await supabase
      .from("customers")
      .select("id, full_name")
      .eq("id", prefillCustomerId)
      .is("deleted_at", null)
      .maybeSingle();
    if (extra) customers.unshift({ id: extra.id, full_name: extra.full_name as string });
  }

  // Ön dolgu yalnız gerçekten seçilebilir kayıtlar için uygulanır.
  const openWithPrefill =
    canCreate &&
    ((prefillPropertyId != null && properties.some((p) => p.id === prefillPropertyId)) ||
      (prefillCustomerId != null && customers.some((c) => c.id === prefillCustomerId)));

  const offers = (offerData ?? []).map((o) => {
    const p = one(o.property as { id: string; property_code: string; title: string | null } | { id: string; property_code: string; title: string | null }[] | null);
    const c = one(o.customer as { id: string; full_name: string } | { id: string; full_name: string }[] | null);
    return {
      id: o.id as string,
      amount: o.amount != null ? Number(o.amount) : null,
      counter: o.counter_amount != null ? Number(o.counter_amount) : null,
      status: o.status as string,
      created_at: o.created_at as string,
      property_id: p?.id ?? (o.property_id as string | null),
      property_label: p?.title ?? p?.property_code ?? null,
      customer_id: c?.id ?? (o.customer_id as string | null),
      customer_name: c?.full_name ?? null,
    };
  });

  const allOffers = (statusData ?? []).map((r) => ({
    status: r.status as string,
    amount: r.amount != null ? Number(r.amount) : null,
    counter: r.counter_amount != null ? Number(r.counter_amount) : null,
  }));
  const totalCount = allOffers.length;
  const pending = allOffers.filter((o) => o.status === "submitted").length;
  const accepted = allOffers.filter((o) => o.status === "accepted").length;
  const rejected = allOffers.filter((o) => o.status === "rejected").length;

  // Tutar KPI'ları — karşı teklif geldiyse masadaki rakam odur
  const tableValue = (o: { amount: number | null; counter: number | null }) => o.counter ?? o.amount ?? 0;
  const openVolume = allOffers
    .filter((o) => o.status === "submitted" || o.status === "countered")
    .reduce((s, o) => s + tableValue(o), 0);
  const acceptedVolume = allOffers
    .filter((o) => o.status === "accepted")
    .reduce((s, o) => s + tableValue(o), 0);
  const resolved = accepted + rejected;
  const acceptRate = resolved ? Math.round((accepted / resolved) * 100) : null;
  const amounts = allOffers.map((o) => o.amount).filter((v): v is number => v != null && v > 0);
  const avgOffer = amounts.length ? amounts.reduce((s, v) => s + v, 0) / amounts.length : 0;

  // Durum akışı: taslak → sunuldu → karşı teklif → kabul; kırmızı/gri uçlar ayrı
  const FLOW: { key: string; icon: typeof Tag }[] = [
    { key: "draft", icon: Tag },
    { key: "submitted", icon: Timer },
    { key: "countered", icon: ArrowRight },
    { key: "accepted", icon: CheckCircle2 },
  ];
  const countOf = (s: string) => allOffers.filter((o) => o.status === s).length;

  return (
    <div className="space-y-6">
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-30" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="flex items-center gap-2 text-xs font-semibold text-brand-300">
              <Tag className="h-4 w-4" /> Teklif takibi
            </span>
            <h1 className="mt-2 font-display text-2xl font-extrabold text-white md:text-3xl">Teklifler</h1>
            <p className="mt-1 text-sm text-white/75">Portföylere gelen teklifleri ve durumlarını izleyin.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {/* KPI'lar filtreye bağlı: Bekliyor → submitted, Kabul → accepted (tarih aralığı korunur) */}
            {[
              { label: "Toplam", value: totalCount, href: href({ durum: null }), active: durum === null },
              { label: "Bekliyor", value: pending, href: href({ durum: "submitted" }), active: durum === "submitted" },
              { label: "Kabul edildi", value: accepted, href: href({ durum: "accepted" }), active: durum === "accepted" },
            ].map((k) => (
              <Link
                key={k.label}
                href={k.href}
                className={`focus-ring press lift group block rounded-[14px] border p-3 text-center transition hover:border-brand-300 ${
                  k.active ? "border-white/35 bg-white/15" : "border-white/12 bg-white/8"
                }`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="font-display text-2xl font-extrabold text-white">{k.value}</span>
                  <ArrowUpRight className="hover-action h-4 w-4 text-text-faint opacity-0 transition group-hover:text-brand-600 group-hover:opacity-100" />
                </span>
                <p className="text-left text-[11px] text-white/70">{k.label}</p>
              </Link>
            ))}
            <ExportCsvButton
              action={exportOffersCsv}
              label="Dışa aktar"
              className="focus-ring press inline-flex items-center gap-1.5 rounded-[11px] border border-white/12 bg-white/8 px-3.5 py-2.5 text-sm font-semibold text-white/80 backdrop-blur transition hover:border-white/30 hover:text-white disabled:opacity-50"
            />
            {canCreate ? (
              <NewOfferDialog
                properties={properties}
                customers={customers}
                defaultPropertyId={prefillPropertyId}
                defaultCustomerId={prefillCustomerId}
                autoOpen={openWithPrefill}
              />
            ) : null}
          </div>
        </div>
      </section>

      {totalCount > 0 ? (
        <>
          {/* Tutar KPI'ları — filtreden bağımsız, tıklayınca ilgili durum filtresine iner */}
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Masadaki hacim" value={money(openVolume)} icon={Banknote} tone="neutral" href={href({ durum: "submitted" })} />
            <StatCard label="Kabul edilen hacim" value={money(acceptedVolume)} icon={CheckCircle2} tone="success" href={href({ durum: "accepted" })} />
            <StatCard
              label="Kabul oranı (sonuçlanan)"
              value={acceptRate != null ? `%${acceptRate}` : "—"}
              icon={Percent}
              tone={acceptRate != null && acceptRate >= 50 ? "success" : "warning"}
              href={href({ durum: "accepted" })}
            />
            <StatCard label="Ortalama teklif" value={money(avgOffer)} icon={Tag} tone="neutral" href={href({ durum: null })} />
          </section>

          {/* Durum akışı — teklif yolculuğu; her adım o durumun filtresine gider */}
          <section className="rounded-[20px] border border-line bg-surface p-4 shadow-[var(--shadow-xs)]">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="mr-2 font-display text-sm font-extrabold uppercase tracking-[0.08em] text-ink-950">
                Durum akışı
              </h2>
              {FLOW.map((f, i) => (
                <span key={f.key} className="flex items-center gap-2">
                  {i > 0 ? <ArrowRight className="h-3.5 w-3.5 text-text-faint" aria-hidden /> : null}
                  <Link
                    href={href({ durum: f.key })}
                    className={`focus-ring press flex min-h-[40px] items-center gap-1.5 rounded-[11px] border px-3 py-2 text-xs font-semibold transition hover:border-brand-300 ${
                      durum === f.key ? "border-brand-400/50 bg-brand-600/10 text-brand-600" : "border-line bg-surface text-ink-950"
                    }`}
                  >
                    <f.icon className="h-3.5 w-3.5 text-text-muted" />
                    {STATUS_LABELS[f.key]}
                    <span className="numeric rounded-full bg-canvas px-1.5 py-0.5 text-[10px] font-extrabold text-ink-950">
                      {countOf(f.key)}
                    </span>
                  </Link>
                </span>
              ))}
              <span className="mx-1 hidden h-4 w-px bg-line sm:block" aria-hidden />
              {["rejected", "withdrawn"].map((k) => (
                <Link
                  key={k}
                  href={href({ durum: k })}
                  className={`focus-ring press flex min-h-[40px] items-center gap-1.5 rounded-[11px] border px-3 py-2 text-xs font-semibold transition ${
                    durum === k
                      ? "border-danger-500/40 bg-danger-500/10 text-danger-500"
                      : "border-line bg-surface text-text-muted hover:border-danger-500/30 hover:text-danger-500"
                  }`}
                >
                  {STATUS_LABELS[k]}
                  <span className="numeric rounded-full bg-canvas px-1.5 py-0.5 text-[10px] font-extrabold text-ink-950">{countOf(k)}</span>
                </Link>
              ))}
            </div>
            {/* Dağılım şeridi — 2px boşluklu segmentler; metin rozetler kimliği zaten taşıyor */}
            <div className="mt-3 flex h-2.5 gap-0.5 overflow-hidden rounded-[6px]" aria-hidden>
              {[
                { key: "draft", cls: "bg-line-strong" },
                { key: "submitted", cls: "bg-brand-600" },
                { key: "countered", cls: "bg-amber-400" },
                { key: "accepted", cls: "bg-mint-500" },
                { key: "rejected", cls: "bg-danger-500" },
                { key: "withdrawn", cls: "bg-line" },
              ]
                .filter((s) => countOf(s.key) > 0)
                .map((s) => (
                  <div key={s.key} className={`h-full ${s.cls}`} style={{ width: `${Math.max(2, (countOf(s.key) / totalCount) * 100)}%` }} />
                ))}
            </div>
          </section>
        </>
      ) : null}

      {totalCount === 0 ? (
        <EmptyState
          icon={Tag}
          title="Henüz teklif yok"
          description="Portföylere gelen teklifler burada listelenir. Portföy detayından veya “Yeni teklif” ile ilk teklifi ekleyin."
        />
      ) : (
        <>
          {/* Durum filtre çipleri — sunucu filtresi (?durum=), tarih aralığı korunur */}
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={href({ durum: null })}
              className={`rounded-[10px] border px-3.5 py-2 text-xs font-semibold transition ${
                durum === null
                  ? "border-brand-400/50 bg-brand-600/10 text-brand-600"
                  : "border-line bg-surface text-ink-950 hover:border-brand-300"
              }`}
            >
              Tümü
            </Link>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <Link
                key={value}
                href={href({ durum: value })}
                className={`rounded-[10px] border px-3.5 py-2 text-xs font-semibold transition ${
                  durum === value
                    ? "border-brand-400/50 bg-brand-600/10 text-brand-600"
                    : "border-line bg-surface text-ink-950 hover:border-brand-300"
                }`}
              >
                {label}
              </Link>
            ))}
            <span className="numeric ml-auto text-[11px] font-medium tracking-wide text-text-faint">
              {offers.length} kayıt
            </span>
          </div>

          {/* Tarih aralığı çipleri — sunucu filtresi (?from=&to=), durum korunur */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-text-muted"><CalendarRange className="h-3.5 w-3.5" /> Tarih:</span>
            <Link
              href={href({ from: null, to: null })}
              className={`rounded-full border px-3 py-1 text-[11px] font-semibold transition ${
                !from && !to
                  ? "border-brand-400/50 bg-brand-600/10 text-brand-600"
                  : "border-line bg-surface text-text-muted hover:border-brand-300 hover:text-brand-600"
              }`}
            >
              Tüm zamanlar
            </Link>
            {presets.map((p) => {
              const active = from === p.from && to === p.to;
              return (
                <Link
                  key={p.label}
                  href={href({ from: p.from, to: p.to })}
                  aria-current={active ? "page" : undefined}
                  className={`rounded-full border px-3 py-1 text-[11px] font-semibold transition ${
                    active
                      ? "border-brand-400/50 bg-brand-600/10 text-brand-600"
                      : "border-line bg-surface text-text-muted hover:border-brand-300 hover:text-brand-600"
                  }`}
                >
                  {p.label}
                </Link>
              );
            })}
          </div>

          {offers.length === 0 ? (
            <div className="grid place-items-center rounded-[18px] border border-dashed border-line-strong bg-surface px-6 py-14 text-center">
              <Tag className="h-8 w-8 text-text-faint" />
              <h2 className="mt-3 font-display text-lg font-bold text-ink-950">
                {durum ? `“${STATUS_LABELS[durum]}” durumunda teklif yok` : "Bu filtrelerle eşleşen teklif yok"}
              </h2>
              <Link href="/app/teklifler" className="mt-2 text-sm font-semibold text-brand-600 hover:underline">
                Filtreleri temizle
              </Link>
            </div>
          ) : (
            <TableFrame minWidth={720}>
              <Table>
                <THead>
                  <TR>
                    <TH>Portföy</TH>
                    <TH>Müşteri</TH>
                    <TH align="right">Teklif</TH>
                    <TH align="right" className="hidden md:table-cell">Karşı teklif</TH>
                    <TH>Durum</TH>
                    <TH align="right">Tarih</TH>
                  </TR>
                </THead>
                <TBody>
                  {offers.map((o) => (
                    <TR key={o.id} interactive>
                      <TD className="font-semibold text-ink-950">
                        {/* Satır → teklif detayı; portföy/müşteri adları z-10 ile
                            örtü linkin üstünde kendi hedeflerine gider */}
                        <Link
                          href={`/app/teklifler/${o.id}`}
                          className="absolute inset-0"
                          aria-label={`${o.property_label ?? "Teklif"} teklif detayı`}
                        />
                        {o.property_id ? (
                          <Link
                            href={`/app/portfoyler/${o.property_id}`}
                            className="focus-ring relative z-10 rounded-[6px] transition hover:text-brand-600 hover:underline"
                          >
                            {o.property_label ?? "Portföy"}
                          </Link>
                        ) : (
                          o.property_label ?? "—"
                        )}
                      </TD>
                      <TD>
                        {o.customer_id ? (
                          <Link
                            href={`/app/musteriler/${o.customer_id}`}
                            className="focus-ring relative z-10 rounded-[6px] font-medium text-ink-950 transition hover:text-brand-600 hover:underline"
                          >
                            {o.customer_name ?? "Müşteri"}
                          </Link>
                        ) : (
                          o.customer_name ?? "—"
                        )}
                      </TD>
                      <TD align="right">{money(o.amount)}</TD>
                      <TD align="right" className="hidden md:table-cell">{money(o.counter)}</TD>
                      <TD>
                        <Badge variant={STATUS_VARIANTS[o.status] ?? "default"} size="sm">
                          {STATUS_LABELS[o.status] ?? o.status}
                        </Badge>
                      </TD>
                      <TD align="right" className="text-text-muted">{tarih(o.created_at)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableFrame>
          )}
        </>
      )}
    </div>
  );
}
