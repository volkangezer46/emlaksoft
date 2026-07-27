import Link from "next/link";
import { now as nowMs, daysAgoIso } from "@/lib/clock";
import {
  AlarmClock, AlertTriangle, ArrowUpRight, BadgeDollarSign, ClipboardPlus, Compass, Lightbulb,
  MessageCircle, Phone, PhoneCall, PieChart, Timer, TrendingDown, TrendingUp, Zap,
} from "lucide-react";
import { requireModulePage } from "@/lib/require-module-page";
import { createClient } from "@/lib/supabase/server";
import { detectLostSaleRisks, estimateLostRevenue } from "@/lib/lost-sale-detector";
import { formatTurkishPhone, toTelHref, toWhatsAppLink } from "@/lib/phone";
import { EmptyState } from "@/components/app/empty-state";
import { dismissLostSaleRisk } from "./actions";

function money(n: number) {
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(n);
}

const DAY = 86_400_000;

type DealRow = {
  id: string;
  stage: string;
  deal_type: string | null;
  deal_value: number | null;
  loss_reason: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * "Kaçan fırsat radarı" — kapanan (won/lost) anlaşmalardan desen çıkarır.
 * Migration yok: yalnız mevcut deals kolonları (loss_reason, deal_value,
 * created_at → updated_at döngü süresi) okunur. Yetersiz veri → içgörü üretmez.
 */
function buildLossInsights(deals: DealRow[], now: number) {
  const lost = deals.filter((d) => d.stage === "lost");
  const won = deals.filter((d) => d.stage === "won");
  const insights: Array<{
    icon: typeof Lightbulb;
    tone: "danger" | "amber" | "brand" | "mint";
    title: string;
    body: string;
    href: string;
    hrefLabel: string;
  }> = [];

  // 1) Baskın kayıp nedeni (min 3 kayıp, pay ≥ %30)
  if (lost.length >= 3) {
    const byReason = new Map<string, number>();
    for (const d of lost) {
      const r = (d.loss_reason ?? "").trim() || "Belirtilmemiş";
      byReason.set(r, (byReason.get(r) ?? 0) + 1);
    }
    const [topReason, topCount] = [...byReason.entries()].sort((a, b) => b[1] - a[1])[0];
    const share = Math.round((topCount / lost.length) * 100);
    if (share >= 30) {
      insights.push({
        icon: Compass,
        tone: "danger",
        title: `Kayıpların %${share}'i tek nedene bağlı`,
        body: `Son 12 ayda kaybedilen ${lost.length} anlaşmanın ${topCount} tanesi "${topReason}" nedeniyle kapandı. Bu nedeni süreçte erken yakalayan bir kontrol adımı ekleyin.`,
        href: "/app/anlasmalar",
        hrefLabel: "Anlaşmalara git",
      });
    }
  }

  // 2) Döngü süresi: kaybedilen anlaşmalar kazanılanlardan belirgin yavaşsa
  const cycleDays = (d: DealRow) =>
    Math.max(0, Math.round((new Date(d.updated_at).getTime() - new Date(d.created_at).getTime()) / DAY));
  if (lost.length >= 3 && won.length >= 3) {
    const avg = (arr: DealRow[]) => arr.reduce((s, d) => s + cycleDays(d), 0) / arr.length;
    const lostAvg = Math.round(avg(lost));
    const wonAvg = Math.round(avg(won));
    if (lostAvg >= wonAvg + 7) {
      insights.push({
        icon: Timer,
        tone: "amber",
        title: "Uzayan anlaşma kaybettiriyor",
        body: `Kaybedilen anlaşmalar ortalama ${lostAvg} günde sonuçlanırken kazanılanlar ${wonAvg} günde kapanıyor. ${wonAvg + 7}. günü geçen anlaşmalara erken müdahale planlayın.`,
        href: "/app/anlasmalar",
        hrefLabel: "Açık anlaşmaları incele",
      });
    }
  }

  // 3) Son 90 gün vs önceki 90 gün kayıp ciro momentumu
  const in90 = (d: DealRow, fromDaysAgo: number, toDaysAgo: number) => {
    const t = new Date(d.updated_at).getTime();
    return t >= now - fromDaysAgo * DAY && t < now - toDaysAgo * DAY;
  };
  const recentLost = lost.filter((d) => in90(d, 90, 0)).reduce((s, d) => s + Number(d.deal_value || 0), 0);
  const priorLost = lost.filter((d) => in90(d, 180, 90)).reduce((s, d) => s + Number(d.deal_value || 0), 0);
  if (recentLost > 0 || priorLost > 0) {
    const rising = recentLost > priorLost;
    insights.push({
      icon: rising ? TrendingDown : TrendingUp,
      tone: rising ? "danger" : "mint",
      title: rising ? "Kayıp ciro ivmeleniyor" : "Kayıp ciro geriliyor",
      body: rising
        ? `Son 90 günde ${money(recentLost)} tutarında anlaşma kaybedildi; önceki 90 günde bu ${money(priorLost)} idi. Kayıp nedenlerini haftalık ekip toplantısına taşıyın.`
        : `Son 90 günde kaybedilen ciro ${money(recentLost)} — önceki 90 güne (${money(priorLost)}) göre azaldı. Mevcut takip disiplinini koruyun.`,
      href: "/app/anlasmalar",
      hrefLabel: "Anlaşma panosu",
    });
  }

  // 4) En kırılgan anlaşma türü (tür başına min 4 kapanış, kayıp oranı ≥ %50)
  const byType = new Map<string, { lost: number; won: number }>();
  for (const d of deals) {
    const t = (d.deal_type ?? "").trim() || "Diğer";
    const rec = byType.get(t) ?? { lost: 0, won: 0 };
    if (d.stage === "lost") rec.lost += 1;
    else rec.won += 1;
    byType.set(t, rec);
  }
  const fragile = [...byType.entries()]
    .filter(([, v]) => v.lost + v.won >= 4 && v.lost / (v.lost + v.won) >= 0.5)
    .sort((a, b) => b[1].lost / (b[1].lost + b[1].won) - a[1].lost / (a[1].lost + a[1].won))[0];
  if (fragile) {
    const [type, v] = fragile;
    insights.push({
      icon: PieChart,
      tone: "brand",
      title: `"${type}" işlemlerinde kayıp oranı yüksek`,
      body: `${type} türündeki ${v.lost + v.won} kapanışın ${v.lost} tanesi kaybedildi (%${Math.round((v.lost / (v.lost + v.won)) * 100)}). Bu segment için sunum ve fiyatlama şablonlarını gözden geçirin.`,
      href: "/app/anlasmalar",
      hrefLabel: "Anlaşmalara git",
    });
  }

  return { insights, lost, won };
}

export default async function KayipSatisPage() {
  const ctx = await requireModulePage("customers");
  const detected = await detectLostSaleRisks(50);

  // Snooze/arandı filtresi: dismissed_until gelecekte olanlar ve son 30 günde
  // "called" işaretlenenler listeden düşer (bkz. lost_sale_dismissals).
  const supabase = await createClient();
  const [{ data: dismissals }, { data: closedDeals }] = await Promise.all([
    supabase
      .from("lost_sale_dismissals")
      .select("customer_id, dismissed_until, reason, created_at")
      .eq("tenant_id", ctx.tenantId),
    // Kaçan fırsat radarı: son 12 ayın kapanan anlaşmaları (won + lost).
    // RLS tenant kapsamını uygular; dar select, migration yok.
    supabase
      .from("deals")
      .select("id, stage, deal_type, deal_value, loss_reason, created_at, updated_at")
      .in("stage", ["won", "lost"])
      .gte("updated_at", daysAgoIso(365))
      .limit(1000),
  ]);

  const now = nowMs();
  const dismissedIds = new Set(
    (dismissals ?? [])
      .filter((d) =>
        (d.dismissed_until != null && new Date(d.dismissed_until).getTime() > now) ||
        (d.reason === "called" && now - new Date(d.created_at).getTime() < 30 * DAY),
      )
      .map((d) => d.customer_id),
  );

  const risks = detected.filter((r) => !dismissedIds.has(r.id));
  const hiddenCount = detected.length - risks.length;
  const estLost = estimateLostRevenue(risks);

  const critical = risks.filter((r) => r.urgency === "critical");
  const warning  = risks.filter((r) => r.urgency === "warning");

  // ── Kaçan fırsat radarı: kapanan anlaşmalardan gerçek desenler ────────────
  const deals = (closedDeals ?? []) as DealRow[];
  const { insights, lost, won } = buildLossInsights(deals, now);
  const lostRevenue = lost.reduce((s, d) => s + Number(d.deal_value || 0), 0);
  const closedTotal = lost.length + won.length;
  const winRate = closedTotal > 0 ? Math.round((won.length / closedTotal) * 100) : null;

  // Neden dağılımı: adet + kaybedilen tutar birlikte
  const reasonAgg = new Map<string, { count: number; value: number }>();
  for (const d of lost) {
    const r = (d.loss_reason ?? "").trim() || "Belirtilmemiş";
    const rec = reasonAgg.get(r) ?? { count: 0, value: 0 };
    rec.count += 1;
    rec.value += Number(d.deal_value || 0);
    reasonAgg.set(r, rec);
  }
  const reasonBars = [...reasonAgg.entries()]
    .map(([label, v]) => ({ label, ...v }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
  const maxReasonCount = Math.max(1, ...reasonBars.map((r) => r.count));

  return (
    <div className="space-y-6">
      {/* Hero */}
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-30" />
        <div className="pointer-events-none absolute -right-14 -top-14 h-52 w-52 rounded-full bg-red-500/25 blur-[90px]" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="flex items-center gap-2 text-xs font-semibold text-red-300">
              <TrendingDown className="h-4 w-4" /> Kayıp satış dedektörü
            </span>
            <h1 className="mt-2 font-display text-2xl font-extrabold text-white md:text-3xl">
              Risk Altındaki Müşteriler
            </h1>
            <p className="mt-1 max-w-lg text-sm text-white/75">
              Uzun süredir iletişim kurulmamış, portföy gönderilmemiş veya
              hareketsiz kalan müşteriler. Hemen arayın, kayıp önleyin.
            </p>
          </div>
          {/* KPI'lar ilgili bölüm çapalarına iner */}
          <div className="flex gap-3">
            <Link
              href="#kritik"
              className="focus-ring press lift block rounded-[14px] border border-white/12 bg-white/8 p-3 text-center hover:border-white/30"
            >
              <p className="font-display text-2xl font-extrabold text-red-400">{critical.length}</p>
              <p className="text-[11px] text-white/70">Kritik</p>
            </Link>
            <Link
              href="#uyari"
              className="focus-ring press lift block rounded-[14px] border border-white/12 bg-white/8 p-3 text-center hover:border-white/30"
            >
              <p className="font-display text-2xl font-extrabold text-amber-400">{warning.length}</p>
              <p className="text-[11px] text-white/70">Uyarı</p>
            </Link>
            <Link
              href="#kritik"
              className="focus-ring press lift block rounded-[14px] border border-white/12 bg-white/8 p-3 text-center hover:border-white/30"
            >
              <p className="font-display text-lg font-extrabold text-white">{money(estLost)}</p>
              <p className="text-[11px] text-white/70">Tahmini kayıp</p>
            </Link>
            {/* Kaybedilen ciro: son 12 ayın lost anlaşmalarının gerçek toplamı */}
            <Link
              href="#radar"
              className="focus-ring press lift block rounded-[14px] border border-danger-500/30 bg-danger-500/15 p-3 text-center hover:border-danger-400/60"
            >
              <p className="font-display text-lg font-extrabold text-danger-300">{money(lostRevenue)}</p>
              <p className="text-[11px] text-white/70">Kaybedilen ciro · 12 ay</p>
            </Link>
          </div>
        </div>
      </section>

      {hiddenCount > 0 ? (
        <p className="rounded-[12px] border border-line bg-surface px-4 py-2.5 text-xs text-text-muted">
          {hiddenCount} müşteri &quot;arandı&quot; veya ertelendiği için gizlendi.
        </p>
      ) : null}

      {risks.length === 0 ? (
        <EmptyState
          icon={Zap}
          tone="mint"
          title="Mükemmel! Risk yok"
          description="Tüm aktif müşterileriniz düzenli takip altında. Yeni riskler oluştuğunda burada listelenir."
          action={{ href: "/app/musteriler", label: "Müşterilere git" }}
        />
      ) : (
        <div className="space-y-4">
          {/* Kritik */}
          {critical.length > 0 && (
            <section id="kritik" className="scroll-mt-24">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-red-600">
                <AlertTriangle className="h-4 w-4" /> Kritik — Hemen ara
              </h2>
              <div className="space-y-2">
                {critical.map((r) => (
                  <RiskCard key={r.id} risk={r} />
                ))}
              </div>
            </section>
          )}

          {/* Uyarı */}
          {warning.length > 0 && (
            <section id="uyari" className="scroll-mt-24">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-amber-600">
                <AlertTriangle className="h-4 w-4" /> Uyarı — Bu hafta ara
              </h2>
              <div className="space-y-2">
                {warning.map((r) => (
                  <RiskCard key={r.id} risk={r} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {/* ── Kaçan fırsat radarı: kapanan anlaşmalardan ders çıkarma ────────── */}
      <section id="radar" className="scroll-mt-24 space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="flex items-center gap-2 text-xs font-semibold text-danger-500">
              <Compass className="h-4 w-4" /> Kaçan fırsat radarı
            </p>
            <h2 className="mt-1 font-display text-lg font-bold text-ink-950">Kapanan işlemlerden ders çıkar</h2>
          </div>
          <Link href="/app/anlasmalar" className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline">
            Anlaşma panosu <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        {lost.length === 0 ? (
          <EmptyState
            icon={Compass}
            tone="brand"
            title="Henüz kaybedilen anlaşma kaydı yok"
            description="Bir anlaşma 'kaybedildi' aşamasına taşındığında radar; kayıp nedenlerini, kaybedilen ciroyu ve tekrarlayan desenleri burada analiz eder."
            action={{ href: "/app/anlasmalar", label: "Anlaşma panosunu aç" }}
          />
        ) : (
          <>
            <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
              {/* Kaybedilen ciro paneli */}
              <div className="dashboard-panel rounded-[20px] border border-line bg-surface p-5">
                <p className="flex items-center gap-2 text-xs font-semibold text-danger-500">
                  <BadgeDollarSign className="h-4 w-4" /> Kaybedilen ciro · 12 ay
                </p>
                <Link href="/app/anlasmalar" className="focus-ring group mt-2 block rounded-[10px]">
                  <p className="numeric flex items-center gap-1 font-display text-3xl font-extrabold text-danger-500">
                    −{money(lostRevenue)}
                    <ArrowUpRight className="h-4 w-4 text-text-faint opacity-0 transition group-hover:text-danger-500 group-hover:opacity-100" />
                  </p>
                </Link>
                <p className="mt-1 text-xs text-text-muted">
                  {lost.length} kaybedilen anlaşmanın toplam değeri
                </p>
                <div className="mt-4 space-y-2 border-t border-line pt-4 text-xs text-text-muted">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-mint-500" /> Kazanılan</span>
                    <span className="tabular-nums font-semibold text-ink-950">{won.length}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-danger-500" /> Kaybedilen</span>
                    <span className="tabular-nums font-semibold text-ink-950">{lost.length}</span>
                  </div>
                  {winRate !== null ? (
                    <>
                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-danger-500/15">
                        <div className="bar-live h-full rounded-full bg-mint-500" style={{ width: `${winRate}%` }} />
                      </div>
                      <p className="text-[11px] text-text-faint">Kazanma oranı %{winRate}</p>
                    </>
                  ) : null}
                </div>
              </div>

              {/* Kayıp nedenleri dağılımı */}
              <div className="dashboard-panel rounded-[20px] border border-line bg-surface p-5">
                <p className="flex items-center gap-2 text-xs font-semibold text-amber-600">
                  <PieChart className="h-4 w-4" /> Kayıp nedenleri dağılımı
                </p>
                <h3 className="mt-1 font-display font-bold text-ink-950">Neden kaybediyoruz?</h3>
                <div className="mt-5 space-y-3">
                  {reasonBars.map((r, i) => (
                    <Link key={r.label} href="/app/anlasmalar" className="focus-ring group -m-1 block rounded-[10px] p-1">
                      <div className="mb-1 flex justify-between gap-3 text-xs">
                        <span className="flex min-w-0 items-center gap-1 font-semibold text-ink-950">
                          <span className="truncate">{r.label}</span>
                          <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-text-faint opacity-0 transition group-hover:text-brand-600 group-hover:opacity-100" />
                        </span>
                        <span className="shrink-0 tabular-nums text-text-muted">
                          {r.count} anlaşma{r.value > 0 ? ` · ${money(r.value)}` : ""}
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-canvas">
                        <div
                          className="bar-live h-full rounded-full bg-danger-500/70"
                          style={{ width: `${(r.count / maxReasonCount) * 100}%`, animationDelay: `${i * 0.08}s` }}
                        />
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            </div>

            {/* İçgörü kartları */}
            {insights.length > 0 ? (
              <div className="grid gap-3 md:grid-cols-2">
                {insights.map((ins) => {
                  const toneCls = {
                    danger: "bg-danger-500/10 text-danger-500",
                    amber: "bg-amber-400/15 text-amber-600",
                    brand: "bg-brand-600/10 text-brand-600",
                    mint: "bg-mint-500/12 text-mint-600",
                  }[ins.tone];
                  return (
                    <article key={ins.title} className="lift flex gap-3 rounded-[18px] border border-line bg-surface p-5">
                      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-[12px] ${toneCls}`}>
                        <ins.icon className="h-5 w-5" />
                      </span>
                      <div className="min-w-0">
                        <h3 className="font-display text-sm font-bold text-ink-950">{ins.title}</h3>
                        <p className="mt-1 text-xs leading-relaxed text-text-muted">{ins.body}</p>
                        <Link href={ins.href} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline">
                          {ins.hrefLabel} <ArrowUpRight className="h-3.5 w-3.5" />
                        </Link>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <p className="flex items-start gap-2 rounded-[14px] border border-line bg-canvas px-4 py-3 text-xs text-text-muted">
                <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                Desen çıkarmak için henüz yeterli kapanış verisi yok — anlaşmaları kapatırken kayıp nedeni girmek radarın isabetini artırır.
              </p>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function RiskCard({ risk }: { risk: Awaited<ReturnType<typeof detectLostSaleRisks>>[0] }) {
  const initials = risk.full_name
    .split(" ")
    .map((p) => p[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const isCritical = risk.urgency === "critical";

  return (
    <div className={`flex flex-wrap items-center gap-3 rounded-[16px] border px-4 py-3 transition hover:bg-canvas/60 ${
      isCritical ? "border-red-200 bg-red-50/50" : "border-amber-200 bg-amber-50/40"
    }`}>
      {/* Avatar */}
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-bold text-white ${
        isCritical ? "bg-red-500" : "bg-amber-500"
      }`}>
        {initials}
      </span>

      {/* Bilgi */}
      <div className="min-w-0 flex-1">
        <Link
          href={`/app/musteriler/${risk.id}`}
          className="font-semibold text-ink-950 hover:text-brand-600 hover:underline"
        >
          {risk.full_name}
        </Link>
        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-text-muted">
          <AlertTriangle className={`h-3 w-3 ${isCritical ? "text-red-500" : "text-amber-500"}`} />
          {risk.reasonLabel}
        </p>
        {risk.phone && (
          <p className="mt-0.5 text-[11px] text-text-faint">{formatTurkishPhone(risk.phone)}</p>
        )}
      </div>

      {/* Aksiyonlar — mobilde tam satıra sarar, geniş ekranda sağda tek satır */}
      <div className="flex w-full flex-wrap items-center gap-1.5 sm:w-auto sm:shrink-0">
        {risk.phone && (
          <>
            <a
              href={toTelHref(risk.phone) ?? "#"}
              className="grid h-8 w-8 place-items-center rounded-[8px] border border-line bg-surface text-brand-600 transition hover:bg-brand-600/5"
              title="Ara"
              aria-label="Ara"
            >
              <Phone className="h-3.5 w-3.5" />
            </a>
            <a
              href={toWhatsAppLink(risk.phone) ?? "#"}
              target="_blank"
              rel="noreferrer"
              className="grid h-8 w-8 place-items-center rounded-[8px] border border-line bg-surface text-emerald-600 transition hover:bg-emerald-50"
              title="WhatsApp"
              aria-label="WhatsApp"
            >
              <MessageCircle className="h-3.5 w-3.5" />
            </a>
          </>
        )}
        {/* Arandı: 30 gün listeden düşer. Kutu işaretliyse (varsayılan) calls
            tablosuna outbound + "Ulaşıldı" kaydı da atılır — müşteri zaman
            tüneline düşer. Telefonu olmayan müşteride kutu gösterilmez. */}
        <form action={dismissLostSaleRisk} className="flex items-center gap-1.5">
          <input type="hidden" name="customer_id" value={risk.id} />
          <input type="hidden" name="reason" value="called" />
          {risk.phone ? (
            <>
              <input type="hidden" name="phone" value={risk.phone} />
              <label
                className="flex cursor-pointer items-center gap-1 text-[11px] text-text-muted"
                title="İşaretliyse görüşme, çağrı geçmişine ve müşteri zaman tüneline de yazılır"
              >
                <input
                  type="checkbox"
                  name="log_call"
                  value="1"
                  defaultChecked
                  className="h-3.5 w-3.5 rounded border-line accent-brand-600"
                />
                Çağrı olarak da kaydet
              </label>
            </>
          ) : null}
          <button
            type="submit"
            className="focus-ring press inline-flex items-center gap-1 rounded-[8px] border border-line bg-surface px-2.5 py-1.5 text-[11px] font-semibold text-mint-600 transition hover:bg-mint-500/10"
            title="Arandı olarak işaretle (30 gün listeden düşer)"
          >
            <PhoneCall className="h-3.5 w-3.5" /> Arandı ✓
          </button>
        </form>
        {/* Ertele: 7 gün sonra tekrar listeye döner */}
        <form action={dismissLostSaleRisk}>
          <input type="hidden" name="customer_id" value={risk.id} />
          <input type="hidden" name="reason" value="snoozed" />
          <button
            type="submit"
            className="focus-ring press inline-flex items-center gap-1 rounded-[8px] border border-line bg-surface px-2.5 py-1.5 text-[11px] font-semibold text-amber-600 transition hover:bg-amber-50"
            title="1 hafta sonra tekrar hatırlat"
          >
            <AlarmClock className="h-3.5 w-3.5" /> 1 hafta ertele
          </button>
        </form>
        {/* Takip görevini görevler ekranında aç */}
        <Link
          href="/app/gorevler"
          className="focus-ring press inline-flex items-center gap-1 rounded-[8px] border border-line bg-surface px-2.5 py-1.5 text-[11px] font-semibold text-text-muted transition hover:bg-canvas hover:text-ink-950"
          title="Takip görevi oluştur"
        >
          <ClipboardPlus className="h-3.5 w-3.5" /> Görev oluştur
        </Link>
        <Link
          href={`/app/musteriler/${risk.id}`}
          className="inline-flex items-center gap-1 rounded-[8px] border border-line bg-surface px-2.5 py-1.5 text-[11px] font-semibold text-brand-600 transition hover:bg-brand-600/5"
        >
          Kart
        </Link>
      </div>
    </div>
  );
}
