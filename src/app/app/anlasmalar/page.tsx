import Link from "next/link";
import { AlarmClock, ArrowUpRight, Filter, Handshake, Target, TrendingUp, Trophy, Wallet } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { DAY_MS, msSince } from "@/lib/clock";
import { DealBoard, type BoardDeal } from "./deal-board";
import { NewDealDialog } from "./new-deal-dialog";
import { ListLimitNotice } from "@/components/app/list-limit-notice";
import { ExportCsvButton } from "@/components/app/export-csv-button";
import { exportDealsCsv } from "@/app/actions/export";

function money(n: number) {
  return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(n) + " ₺";
}

/**
 * Satış hunisi görselleştirmesi — aşama sırası deal-board ile aynı; renkler de
 * sütun tonlarını izler (renk varlığı takip eder). Her satır ilgili sütuna iner.
 */
const FUNNEL_STAGES: { key: string; label: string; bar: string; text: string }[] = [
  { key: "new", label: "Yeni", bar: "bg-cyan-500", text: "text-cyan-600" },
  { key: "qualified", label: "Nitelikli", bar: "bg-brand-600", text: "text-brand-600" },
  { key: "negotiation", label: "Müzakere", bar: "bg-amber-400", text: "text-amber-600" },
  { key: "won", label: "Kazanıldı", bar: "bg-mint-500", text: "text-mint-600" },
];

export default async function DealsPage() {
  const { perms } = await requireModulePage("commissions");
  const canCreate = (perms.commissions ?? []).includes("create");
  const canEdit = (perms.commissions ?? []).includes("edit");
  const supabase = await createClient();

  const [{ data: dealsRaw, count: dealTotal }, { data: properties }, { data: customers }, { data: members }] = await Promise.all([
    supabase
      .from("deals")
      // Pipeline 200 anlaşmayla sınırlı; gerçek toplam olmadan kullanıcı
      // eksik bir kanban görüp bunu tam sanır.
      // deal_notes(count): Supabase gömülü sayım — ayrı N+1 sorgu yerine tek
      // istekte not sayısı gelir (PostgREST tarafında aggregate). 200 kartlık
      // limitte maliyet ihmal edilebilir; idx_deal_notes_tenant_deal indeksi
      // (tenant_id, deal_id, created_at desc) sayımı da karşılar.
      .select(
        "id, stage, deal_type, deal_value, probability, assigned_to, updated_at, property_id, customer_id, property:properties(id, title, property_code), customer:customers(id, full_name, phone), deal_notes(count)",
        { count: "exact" },
      )
      .order("updated_at", { ascending: false })
      .limit(200),
    supabase
      .from("properties")
      .select("id, property_code, title, list_price, transaction_type")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("customers")
      .select("id, full_name")
      .is("deleted_at", null)
      .order("full_name")
      .limit(200),
    supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name"),
  ]);

  // Kazanma sihirbazının tebrik SMS'i için İYS onayları (bkz. gelen-kutusu deseni)
  const dealCustomerIds = [
    ...new Set((dealsRaw ?? []).map((d) => d.customer_id).filter((v): v is string => Boolean(v))),
  ];
  const { data: smsConsents } = dealCustomerIds.length
    ? await supabase
        .from("iys_consents")
        .select("customer_id, status")
        .eq("channel", "sms")
        .in("customer_id", dealCustomerIds)
    : { data: [] as { customer_id: string; status: string }[] };
  const smsGranted = new Set(
    (smsConsents ?? []).filter((c) => c.status === "granted").map((c) => c.customer_id),
  );

  // Evrak durumu rozeti: tüm kartlar için TEK toplu sorgu (N+1 yok) —
  // deal_id in-list, zorunlu maddeler client'ta gruplanır (200 kart × ~9 madde).
  const dealIds = (dealsRaw ?? []).map((d) => d.id);
  const { data: checklistRows } = dealIds.length
    ? await supabase
        .from("deal_checklist_items")
        .select("deal_id, is_required, is_done")
        .in("deal_id", dealIds)
        .eq("is_required", true)
    : { data: [] as { deal_id: string; is_required: boolean; is_done: boolean }[] };
  const checklistByDeal = new Map<string, { done: number; total: number }>();
  for (const r of checklistRows ?? []) {
    const agg = checklistByDeal.get(r.deal_id) ?? { done: 0, total: 0 };
    agg.total += 1;
    if (r.is_done) agg.done += 1;
    checklistByDeal.set(r.deal_id, agg);
  }

  const deals: BoardDeal[] = (dealsRaw ?? []).map((d) => {
    const prop = d.property as
      | { id?: string; title?: string; property_code?: string }
      | { id?: string; title?: string; property_code?: string }[]
      | null;
    const cust = d.customer as
      | { id?: string; full_name?: string; phone?: string | null }
      | { id?: string; full_name?: string; phone?: string | null }[]
      | null;
    const p = Array.isArray(prop) ? prop[0] : prop;
    const c = Array.isArray(cust) ? cust[0] : cust;
    // deal_notes(count) → [{ count: N }] biçiminde döner
    const noteAgg = d.deal_notes as { count?: number }[] | null;
    return {
      id: d.id,
      stage: d.stage,
      deal_type: d.deal_type,
      deal_value: d.deal_value != null ? Number(d.deal_value) : null,
      probability: d.probability != null ? Number(d.probability) : null,
      assigned_to: d.assigned_to ?? null,
      updated_at: d.updated_at,
      property_title: p?.title ?? null,
      property_code: p?.property_code ?? null,
      property_id: p?.id ?? d.property_id,
      customer_name: c?.full_name ?? null,
      customer_id: c?.id ?? d.customer_id,
      customer_phone: c?.phone ?? null,
      sms_consent: smsGranted.has(c?.id ?? d.customer_id ?? ""),
      note_count: Number(noteAgg?.[0]?.count ?? 0),
      checklist_done: checklistByDeal.get(d.id)?.done ?? 0,
      checklist_total: checklistByDeal.get(d.id)?.total ?? 0,
    };
  });

  const open = deals.filter((d) => !["won", "lost"].includes(d.stage));
  const won = deals.filter((d) => d.stage === "won");
  const lost = deals.filter((d) => d.stage === "lost");
  const pipelineValue = open.reduce((s, d) => s + (d.deal_value || 0), 0);
  const wonValue = won.reduce((s, d) => s + (d.deal_value || 0), 0);
  const winRate = deals.length ? Math.round((won.length / deals.length) * 100) : 0;

  // Kapanma tahmini: şemada tarih alanı yok — açık kartların değeri olasılıkla
  // ağırlıklandırılır (probability boşsa varsayılan %20, tahta ile aynı kabul).
  const weightedForecast = open.reduce(
    (s, d) => s + (d.deal_value || 0) * (Math.min(100, d.probability ?? 20) / 100),
    0,
  );
  // Bayat açık anlaşma: 14+ gündür güncellenmemiş — hareket bekleyen kartlar.
  const staleOpen = open.filter((d) => msSince(d.updated_at) > 14 * DAY_MS).length;

  // Huni satırları: aşamaya ULAŞAN kart sayısı kümülatif okunmaz (aşamalar
  // arası geri dönüş yok); mevcut dağılım + bir sonraki aşamaya oran gösterilir.
  const funnel = FUNNEL_STAGES.map((s) => {
    const rows = s.key === "won" ? won : open.filter((d) => d.stage === s.key);
    return { ...s, count: rows.length, value: rows.reduce((t, d) => t + (d.deal_value || 0), 0) };
  });
  const funnelMax = Math.max(1, ...funnel.map((f) => f.count));
  const lostValue = lost.reduce((s, d) => s + (d.deal_value || 0), 0);

  return (
    <div className="space-y-6">
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-mint-500/20 blur-[90px]" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-mint-400">
              <Handshake className="h-3.5 w-3.5" /> Anlaşma hattı
            </p>
            <h1 className="mt-2 font-display text-3xl font-extrabold md:text-4xl">Anlaşma tahtası</h1>
            <p className="mt-2 max-w-lg text-sm text-white/60">
              Yeni → nitelikli → müzakere → kazan/kayıp. Kazanıldığında komisyon otomatik üretilir.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ExportCsvButton
              label="Dışa aktar"
              action={exportDealsCsv}
              className="focus-ring press inline-flex items-center gap-1.5 rounded-[11px] border border-white/12 bg-white/8 px-3.5 py-2.5 text-sm font-semibold text-white/80 backdrop-blur transition hover:border-white/30 hover:text-white disabled:opacity-50"
            />
            {canCreate ? <NewDealDialog properties={properties ?? []} customers={customers ?? []} /> : null}
          </div>
        </div>
        <div className="relative mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {/* KPI'lar tahtaya çapa: açık metrikler tahtanın başına, kazanılanlar
              doğrudan "Kazanıldı" sütununa götürür. */}
          {[
            { label: "Açık hat", value: money(pipelineValue), icon: TrendingUp, tone: "text-cyan-300", href: "#tahta" },
            { label: "Ağırlıklı tahmin", value: money(Math.round(weightedForecast)), icon: Target, tone: "text-brand-300", href: "#huni" },
            { label: "Kazanılan", value: money(wonValue), icon: Trophy, tone: "text-mint-300", href: "#sutun-won" },
            { label: "Açık kart", value: String(open.length), icon: Handshake, tone: "text-amber-300", href: "#tahta" },
            { label: "Kazanma oranı", value: `%${winRate}`, icon: Wallet, tone: "text-white", href: "#sutun-won" },
          ].map((k) => (
            <Link
              key={k.label}
              href={k.href}
              className="focus-ring press lift group block rounded-[14px] border border-white/10 bg-white/5 p-4 backdrop-blur transition hover:border-brand-300"
            >
              <div className="flex items-start justify-between">
                <k.icon className={`h-4 w-4 ${k.tone}`} />
                <ArrowUpRight className="hover-action h-4 w-4 text-text-faint opacity-0 transition group-hover:text-brand-600 group-hover:opacity-100" />
              </div>
              <p className="mt-2 truncate font-display text-xl font-extrabold">{k.value}</p>
              <p className="text-[11px] text-white/45">{k.label}</p>
            </Link>
          ))}
        </div>
      </section>

      {deals.length === 0 ? (
        <div className="grid place-items-center rounded-[20px] border border-dashed border-line-strong bg-surface px-6 py-16 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-[16px] bg-mint-500/12 text-mint-600">
            <Handshake className="h-7 w-7" />
          </span>
          <h2 className="mt-4 font-display text-lg font-bold text-ink-950">Satış hattı boş</h2>
          <p className="mt-1 max-w-md text-sm text-text-muted">
            İlk anlaşmayı ekleyin veya portföyden “Anlaşma + komisyon” ile kazanan işlem açın.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {canCreate ? <NewDealDialog properties={properties ?? []} customers={customers ?? []} /> : null}
            <Link href="/app/portfoyler" className="rounded-[10px] border border-line px-4 py-2.5 text-sm font-semibold text-brand-600">
              Portföye git
            </Link>
          </div>
        </div>
      ) : (
        <>
          {/* Satış hunisi — mevcut dağılım + aşamalar arası oran; satırlar sütuna iner */}
          <section id="huni" className="scroll-mt-24 grid gap-4 lg:grid-cols-[1.6fr_1fr]">
            <div className="rounded-[20px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-display text-sm font-extrabold uppercase tracking-[0.08em] text-ink-950">
                  Satış hunisi
                </h2>
                <span className="text-[11px] text-text-faint">Aşamadaki kart sayısına göre</span>
              </div>
              <div className="mt-4 space-y-3">
                {funnel.map((f, i) => {
                  const nextF = funnel[i + 1];
                  const conv = nextF && f.count > 0 ? Math.round((nextF.count / f.count) * 100) : null;
                  return (
                    <div key={f.key}>
                      <Link
                        href={`#sutun-${f.key}`}
                        className="focus-ring group block rounded-[12px] px-1 py-0.5 transition hover:bg-canvas"
                      >
                        <div className="flex items-center justify-between gap-3 text-xs">
                          <span className={`font-bold ${f.text}`}>{f.label}</span>
                          <span className="numeric text-text-muted">
                            <span className="font-extrabold text-ink-950">{f.count}</span> kart · {money(f.value)}
                            <ArrowUpRight className="ml-1 inline h-3.5 w-3.5 text-text-faint opacity-0 transition group-hover:text-brand-600 group-hover:opacity-100" />
                          </span>
                        </div>
                        <div className="mt-1.5 h-3 overflow-hidden rounded-[6px] bg-canvas">
                          <div
                            className={`h-full rounded-[6px] ${f.bar} transition-all`}
                            style={{ width: `${Math.max(f.count > 0 ? 4 : 0, Math.round((f.count / funnelMax) * 100))}%` }}
                          />
                        </div>
                      </Link>
                      {conv != null && f.key !== "won" ? (
                        <p className="mt-0.5 pl-1 text-[10px] text-text-faint">↓ sonraki aşamaya oran %{conv}</p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              {lost.length > 0 ? (
                <Link
                  href="#sutun-lost"
                  className="focus-ring mt-4 flex items-center justify-between rounded-[12px] border border-danger-500/15 bg-danger-500/5 px-3 py-2 text-xs transition hover:border-danger-500/30"
                >
                  <span className="font-semibold text-danger-500">Kaybedilen</span>
                  <span className="numeric text-text-muted">
                    <span className="font-extrabold text-ink-950">{lost.length}</span> kart · {money(lostValue)}
                  </span>
                </Link>
              ) : null}
            </div>

            {/* Aşama bazlı toplam değer şeridi + hat sağlığı */}
            <div className="flex flex-col gap-4">
              <div className="rounded-[20px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
                <h2 className="font-display text-sm font-extrabold uppercase tracking-[0.08em] text-ink-950">
                  Aşama bazlı değer
                </h2>
                {pipelineValue + wonValue > 0 ? (
                  <>
                    {/* Yığılmış şerit — 2px yüzey boşluklu segmentler, her biri sütuna iner */}
                    <div className="mt-4 flex h-4 gap-0.5 overflow-hidden rounded-[8px]">
                      {funnel
                        .filter((f) => f.value > 0)
                        .map((f) => (
                          <Link
                            key={f.key}
                            href={`#sutun-${f.key}`}
                            title={`${f.label}: ${money(f.value)}`}
                            className={`${f.bar} focus-ring block h-full transition hover:opacity-80`}
                            style={{ width: `${Math.max(3, Math.round((f.value / (pipelineValue + wonValue)) * 100))}%` }}
                            aria-label={`${f.label} sütununa git — ${money(f.value)}`}
                          />
                        ))}
                    </div>
                    <ul className="mt-3 space-y-1.5">
                      {funnel.map((f) => (
                        <li key={f.key} className="flex items-center gap-2 text-xs">
                          <span className={`h-2.5 w-2.5 shrink-0 rounded-[3px] ${f.bar}`} aria-hidden />
                          <span className="text-text-muted">{f.label}</span>
                          <Link href={`#sutun-${f.key}`} className="numeric focus-ring ml-auto rounded-[6px] font-bold text-ink-950 hover:text-brand-600 hover:underline">
                            {money(f.value)}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="mt-3 text-xs text-text-muted">Kartlara anlaşma değeri girildiğinde dağılım burada görünür.</p>
                )}
              </div>

              {staleOpen > 0 ? (
                <Link
                  href="#tahta"
                  className="focus-ring press flex items-start gap-3 rounded-[16px] border border-amber-400/40 bg-amber-400/10 p-4 transition hover:border-amber-400/70"
                >
                  <AlarmClock className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  <span className="text-xs text-text-muted">
                    <span className="font-bold text-amber-600">{staleOpen} açık anlaşma</span> 14+ gündür güncellenmedi —
                    tahtada bayat kartları öne alın.
                  </span>
                </Link>
              ) : null}
            </div>
          </section>

          <div className="flex items-center gap-2 text-xs font-semibold text-text-muted">
            <Filter className="h-3.5 w-3.5" /> Tahta — sürükleyerek veya aşama butonlarıyla taşıyın
          </div>
          <ListLimitNotice
            shown={deals.length}
            total={dealTotal}
            hint="Kapanan anlaşmaları raporlardan inceleyin."
            href="/app/raporlar"
            hrefLabel="Raporlar"
          />
          <DealBoard deals={deals} canEdit={canEdit} members={members ?? []} />
        </>
      )}
    </div>
  );
}
