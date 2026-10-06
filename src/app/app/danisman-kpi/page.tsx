import Link from "next/link";
import {
  CalendarCheck2, ChevronLeft, ChevronRight, Crown, FileSignature,
  Handshake, PhoneCall, Trophy, Users, Wallet,
} from "lucide-react";
import { StatCard } from "@/components/app/stat-card";
import { PageHeader } from "@/components/ui/page-header";
import { KpiGrid, kpiColumns, podiumColumns } from "@/components/ui/dashboard-grid";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { ChartFrame } from "@/app/app/_ui/lazy-chart";
import { Table, TableFrame, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { canSeeAllEarnings } from "@/lib/team/earnings-scope";
import { loadAdvisorMetrics, trMonthPeriod } from "@/lib/team/advisor-metrics";
import { now, TR_OFFSET_MS, trParts } from "@/lib/clock";
import { buildCoachActions, type CoachAction } from "@/lib/advisor-coach";
import { RevenueChart } from "./revenue-chart-lazy";
import { CoachPanel, type CoachActionWithLink } from "./coach-panel";
import { PrintButton } from "./print-button";
import { PaceCard } from "./pace-card";
import { CoachInsightSlot } from "./coach-insight-slot";
import { monthElapsedPct } from "./month-progress";
import { Progress } from "@/components/ui/progress";

export const metadata = { title: "Danışman performansı" };

// Recharts (~400 KB) revenue-chart-lazy (istemci kapısı) ile ayrı parçaya taşınır.

/**
 * Koç önerisini ilgili ekrana bağlar. `advisor-coach` paylaşılan bir lib
 * olduğundan href üretimi burada, başlık anahtar kelimeleri üzerinden yapılır
 * (sıra önemli: özgül kalıplar önce).
 */
function coachLink(a: CoachAction): { href: string; hrefLabel: string } | undefined {
  const t = a.title.toLocaleLowerCase("tr");
  if (t.includes("yetki")) return { href: "/app/portfoyler", hrefLabel: "Portföyler" };
  if (t.includes("görev")) return { href: "/app/gorevler?filter=overdue", hrefLabel: "Gecikmiş görevler" };
  if (t.includes("çağrı") && t.includes("dönüşüm")) return { href: "/app/arama", hrefLabel: "Çağrı kayıtları" };
  if (t.includes("görüşme") && t.includes("dönüşüm")) return { href: "/app/eslestirme", hrefLabel: "Eşleştirme" };
  if (t.includes("teklif") && t.includes("dönüşüm")) return { href: "/app/teklifler", hrefLabel: "Teklifler" };
  if (t.includes("sıcak")) return { href: "/app/musteriler?sort=hot", hrefLabel: "Sıcak müşteriler" };
  if (t.includes("dokunulmadı")) return { href: "/app/musteriler", hrefLabel: "Müşteriler" };
  if (t.includes("piyasa üstü")) return { href: "/app/portfoyler", hrefLabel: "Portföyler" };
  if (t.includes("anlaşma")) return { href: "/app/anlasmalar", hrefLabel: "Anlaşmalar" };
  if (t.includes("teklif")) return { href: "/app/teklifler", hrefLabel: "Teklifler" };
  if (t.includes("randevu")) return { href: "/app/randevular", hrefLabel: "Randevular" };
  if (t.includes("çağrı") || t.includes("huni")) return { href: "/app/arama", hrefLabel: "Çağrı kayıtları" };
  if (t.includes("müşteri")) return { href: "/app/musteriler", hrefLabel: "Müşteriler" };
  return undefined;
}

function money(n: number) {
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(n);
}

/**
 * Skor formülü tek yerde — tablo, rozetler ve geçen-ay kıyası aynı formülü
 * kullanır: çağrı×1 + randevu×2 + teklif×3 + satış×10 + gelir/10000.
 */
function scoreOf(k: { callCount: number; appointCount: number; offerCount: number; dealCount: number; revenue: number | null }) {
  return Math.round(
    k.callCount * 1 + k.appointCount * 2 + k.offerCount * 3 + k.dealCount * 10 + (k.revenue ?? 0) / 10_000,
  );
}

type AdvisorKpi = {
  id:             string;
  full_name:      string;
  role:           string;
  customerCount:  number;
  callCount:      number;
  appointCount:   number;
  offerCount:     number;
  dealCount:      number;
  /** Tahsil edilmiş danışman payı (tek kaynak: loadAdvisorMetrics). Görünmüyorsa 0. */
  revenue:        number;
  conversionRate: string;
  score:          number;
};

export default async function DanismanKpiPage({
  searchParams,
}: {
  searchParams?: Promise<{ ay?: string }>;
}) {
  const { tenantId, userId, perms, role } = await requireModulePage("reports", "/app/danisman-kpi");
  // Kazanç gizliliği: başkasının geliri yalnız `earnings_all` izniyle görünür (kendi geliri her zaman).
  const seeAllEarnings = canSeeAllEarnings(perms);
  const showRevenue = (id: string) => seeAllEarnings || id === userId;
  const supabase = await createClient();

  // ?ay=YYYY-MM — dönem seçici. Geçersiz/gelecek değer bu aya düşer;
  // gezinme linkleri sunucuda hesaplanır (randevular hafta görünümü deseni).
  const sp = (await searchParams) ?? {};
  // B8: ay sınırları Türkiye takvimine göre (sunucu UTC; ayın ilk 3 saati önceki aya yazılmasın).
  const trMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 1) - TR_OFFSET_MS);
  const trNow = trParts(now());
  const thisMonthStart = trMonth(trNow.year, trNow.month);

  let monthStart = thisMonthStart;
  const ayMatch = /^(\d{4})-(\d{2})$/.exec(sp.ay ?? "");
  if (ayMatch) {
    const requested = trMonth(Number(ayMatch[1]), Number(ayMatch[2]) - 1);
    if (!Number.isNaN(requested.getTime()) && requested.getTime() < thisMonthStart.getTime()) {
      monthStart = requested;
    }
  }
  const isCurrentMonth = monthStart.getTime() === thisMonthStart.getTime();
  const mp = trParts(monthStart);

  const ayParam = (d: Date) => {
    const p = trParts(d);
    return `${p.year}-${String(p.month + 1).padStart(2, "0")}`;
  };
  const prevMonth = trMonth(mp.year, mp.month - 1);
  const prevMonthParts = trParts(prevMonth);
  const prevHref = `/app/danisman-kpi?ay=${ayParam(prevMonth)}`;
  const nextMonth = trMonth(mp.year, mp.month + 1);
  // Gelecek aya gezinme yok: sonraki ay linki yalnız geçmiş ay görüntülenirken.
  const nextHref = isCurrentMonth ? null : `/app/danisman-kpi?ay=${ayParam(nextMonth)}`;

  // Profiller + tek round-trip aggregate RPC (5 tablo, Postgres tarafında toplanır)
  /*
   * Koc icin ek sinyaller. Hepsi `head: true` + `count` ile geliyor: satir
   * cekilmiyor, yalnizca sayilar. Bunlari HER danisman icin ayri sormak
   * N+1 olurdu; koc kisisel bir arac oldugu icin yalnizca OTURUM ACAN
   * kullanici icin hesaplaniyor.
   */
  const bugun = new Date(now());
  const onbesGunSonra = new Date(bugun.getTime() + 15 * 86_400_000).toISOString().slice(0, 10);
  const bugunISO = bugun.toISOString();
  const otuzGunOnce = new Date(bugun.getTime() - 30 * 86_400_000).toISOString();

  // KPI toplamları: TEK KAYNAK loadAdvisorMetrics (RPC kullanılmaz; gerekçe advisor-metrics.ts başlığında).
  // Seçili ay ve önceki ay (kıyas) aynı kapalı aralıklı tanımla gelir.
  const nowMs = now();
  const period = trMonthPeriod(mp.year, mp.month);
  const prevPeriod = trMonthPeriod(prevMonthParts.year, prevMonthParts.month);
  const viewer = { userId, role, perms };

  const [
    metrics,
    prevMetrics,
    { count: yetkiBiten },
    { count: gecikmisGorev },
    { count: pahaliPortfoy },
    { count: soguyanMusteri },
    { data: office },
  ] = await Promise.all([
    loadAdvisorMetrics(supabase, { viewer, tenantId, period, nowMs }),
    loadAdvisorMetrics(supabase, { viewer, tenantId, period: prevPeriod, nowMs }),
    supabase
      .from("properties")
      .select("id", { count: "exact", head: true })
      .eq("assigned_to", userId)
      .is("deleted_at", null)
      .gte("authorization_end", bugunISO.slice(0, 10))
      .lte("authorization_end", onbesGunSonra),
    supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("assigned_to", userId)
      .eq("status", "open")
      .lt("due_at", bugunISO),
    supabase
      .from("properties")
      .select("id", { count: "exact", head: true })
      .eq("assigned_to", userId)
      .is("deleted_at", null)
      .eq("price_health", "red"),
    /*
     * "Soguyan musteri": 30 gunden eski `created_at` ve hic guncellenmemis.
     * Gercek "son temas" bilgisi communications/calls tablolarinda; onu
     * saymak burada iki ek JOIN demek. `updated_at` yaklasik ama ucuz bir
     * vekil ve panelde "uzun sure dokunulmadi" olarak etiketleniyor.
     */
    supabase
      .from("customers")
      .select("id", { count: "exact", head: true })
      .eq("assigned_to", userId)
      .is("deleted_at", null)
      .lt("updated_at", otuzGunOnce),
    // Karne çıktısının başlık bandı: ofis adı belgeye kimlik verir.
    supabase.from("tenants").select("name").eq("id", tenantId).maybeSingle(),
  ]);

  // Çıktı başlığındaki dönem etiketi ("Temmuz 2026" gibi).
  const donem = new Intl.DateTimeFormat("tr-TR", { month: "long", year: "numeric", timeZone: "Europe/Istanbul" }).format(monthStart);

  // Danışman bazlı hesapla
  const advisorMap = new Map<string, AdvisorKpi>();

  for (const m of metrics.rows) {
    advisorMap.set(m.id, {
      id:             m.id,
      full_name:      m.fullName,
      role:           m.role,
      customerCount:  m.customerCount,
      callCount:      m.callCount,
      appointCount:   m.appointCount,
      offerCount:     m.offerCount,
      dealCount:      m.dealCount,
      revenue:        m.revenue ?? 0,
      conversionRate: m.conversionPct === null ? "—" : `%${m.conversionPct}`,
      score:          0,
    });
  }

  // Skor: ağırlıklı formül — scoreOf (tablo/rozet/kıyas aynı formül)
  for (const [, adv] of advisorMap) adv.score = scoreOf(adv);

  const advisors = [...advisorMap.values()]
    .sort((a, b) => b.score - a.score);

  const topScore = Math.max(1, ...advisors.map((a) => a.score));

  // ── Geçen ay kıyası: skorlar + geçen ayın lideri ──────────────────────────
  // Lider araması mevcut profillerle sınırlı — adı gösterilecek kişi zaten
  // aktif ekip listesinde olmalı.
  const prevScoreByUid = new Map<string, number>();
  for (const a of advisors) {
    const pk = prevMetrics.rows.find((r) => r.id === a.id);
    prevScoreByUid.set(a.id, pk ? scoreOf(pk) : 0);
  }
  const prevTop = advisors
    .map((a) => ({ a, s: prevScoreByUid.get(a.id) ?? 0 }))
    .sort((x, y) => y.s - x.s)[0];
  const prevLeader = prevTop && prevTop.s > 0 ? prevTop.a : null;

  // ── Rozetler: seçili ayın verisinden türetilir; veri yoksa şerit gizli ────
  // Kurallar: Ayın Lideri = skor 1. (skor>0) · Arama Şampiyonu = en çok çağrı
  // (>0) · Dönüşüm Ustası = en yüksek teklif→satış oranı (min 5 çağrı ve en az
  // 1 satış şartı) · Ciro Lideri = en yüksek gelir (>0). Aynı kişi birden çok
  // rozet alabilir; eşitlikte skor sıralamasındaki önce gelen kazanır.
  type Rozet = { emoji: string; ad: string; sahip: AdvisorKpi; aciklama: string };
  const rozetler: Rozet[] = [];
  const lider = advisors[0] && advisors[0].score > 0 ? advisors[0] : null;
  if (lider) rozetler.push({ emoji: "🏆", ad: "Ayın Lideri", sahip: lider, aciklama: `Skor ${lider.score}` });
  const aramaSampiyonu = [...advisors].sort((x, y) => y.callCount - x.callCount)[0];
  if (aramaSampiyonu && aramaSampiyonu.callCount > 0) {
    rozetler.push({ emoji: "📞", ad: "Arama Şampiyonu", sahip: aramaSampiyonu, aciklama: `${aramaSampiyonu.callCount} çağrı` });
  }
  const donusumUstasi = advisors
    .filter((a) => a.callCount >= 5 && a.offerCount > 0 && a.dealCount > 0)
    .sort((x, y) => y.dealCount / y.offerCount - x.dealCount / x.offerCount)[0];
  if (donusumUstasi) {
    rozetler.push({ emoji: "🎯", ad: "Dönüşüm Ustası", sahip: donusumUstasi, aciklama: `${donusumUstasi.conversionRate} dönüşüm` });
  }
  const ciroLideri = [...advisors].sort((x, y) => y.revenue - x.revenue)[0];
  if (seeAllEarnings && ciroLideri && ciroLideri.revenue > 0) {
    rozetler.push({ emoji: "💰", ad: "Ciro Lideri", sahip: ciroLideri, aciklama: money(ciroLideri.revenue) });
  }
  const rozetByUid = new Map<string, Rozet[]>();
  for (const r of rozetler) rozetByUid.set(r.sahip.id, [...(rozetByUid.get(r.sahip.id) ?? []), r]);
  const yeniLider = Boolean(prevLeader && lider && prevLeader.id !== lider.id);

  // Bu ay vs geçen ay: ekip skoru toplamları + ay ilerlemesi (yalnız içinde bulunulan ayda).
  const scoreNowTotal = advisors.reduce((s, a) => s + a.score, 0);
  const scorePrevTotal = advisors.reduce((s, a) => s + (prevScoreByUid.get(a.id) ?? 0), 0);
  const elapsedPct = isCurrentMonth ? monthElapsedPct(nowMs, monthStart.getTime(), nextMonth.getTime()) : null;
  const prevMonthLabel = new Intl.DateTimeFormat("tr-TR", { month: "long", timeZone: "Europe/Istanbul" }).format(prevMonth);

  // ── Liderlik podyumu: skor > 0 olan ilk üç danışman ───────────────────────
  const podium = advisors.filter((a) => a.score > 0).slice(0, 3);

  // ── Dönem kıyası metrik kartları: ekip toplamları, önceki aya karşı ───────
  // Önceki ay aynı kaynaktan (loadAdvisorMetrics) gelir.
  const teamNow = { call: 0, appoint: 0, offer: 0, deal: 0 };
  const teamPrev = { call: 0, appoint: 0, offer: 0, deal: 0 };
  for (const a of advisors) {
    teamNow.call += a.callCount;
    teamNow.appoint += a.appointCount;
    teamNow.offer += a.offerCount;
    teamNow.deal += a.dealCount;
    const pk = prevMetrics.rows.find((r) => r.id === a.id);
    if (pk) {
      teamPrev.call += pk.callCount;
      teamPrev.appoint += pk.appointCount;
      teamPrev.offer += pk.offerCount;
      teamPrev.deal += pk.dealCount;
    }
  }
  /** Önceki aya göre değişim → StatCard trend props'u. */
  const trendOf = (cur: number, prev: number): { trend: "up" | "down" | "neutral"; trendLabel: string } => {
    const diff = cur - prev;
    if (diff === 0) return { trend: "neutral", trendLabel: "±0" };
    return diff > 0 ? { trend: "up", trendLabel: `+${diff}` } : { trend: "down", trendLabel: `−${Math.abs(diff)}` };
  };
  const convNow = teamNow.offer > 0 ? Math.round((teamNow.deal / teamNow.offer) * 100) : null;
  const convPrev = teamPrev.offer > 0 ? Math.round((teamPrev.deal / teamPrev.offer) * 100) : null;

  // Koc: oturum acan kullanicinin kendi satiri + ekip ortalamasi.
  const ben = advisorMap.get(userId) ?? null;
  const ekipOrtalamaAnlasma =
    advisors.length > 0 ? advisors.reduce((t, a) => t + a.dealCount, 0) / advisors.length : null;

  // Koç yalnız içinde bulunulan ay için üretilir: öneriler "şimdi ne
  // yapmalıyım" sinyalleri üzerine kurulu, geçmiş bir karneye uygulanamaz.
  const coachActions: CoachActionWithLink[] = (ben && isCurrentMonth
    ? buildCoachActions({
        customerCount: ben.customerCount,
        callCount: ben.callCount,
        appointmentCount: ben.appointCount,
        offerCount: ben.offerCount,
        dealCount: ben.dealCount,
        revenue: ben.revenue,
        staleCustomerCount: soguyanMusteri ?? 0,
        // Sicak musteri sayisi lead skoru gerektiriyor; bu sayfada o veri
        // yok ve yalnizca bunun icin `customer_lead_signals` RPC cagirmak
        // pahali. Ilgili oneri sicak musteri OLMADIGINDA hic uretilmiyor,
        // yani 0 gecmek sessiz bir yanlis sonuc uretmiyor.
        hotCustomerCount: 0,
        overpricedCount: pahaliPortfoy ?? 0,
        expiringAuthCount: yetkiBiten ?? 0,
        overdueTaskCount: gecikmisGorev ?? 0,
        teamAvgDeals: ekipOrtalamaAnlasma,
      })
    : []
  ).map((a) => ({ ...a, ...coachLink(a) }));

  // Grafik verisi: geliri olan ilk 8 danışman (düz, serileştirilebilir dizi;
  // id → çubuğa tıklayınca /app/ekip/{id})
  const revenueChart = advisors
    .filter((a) => seeAllEarnings && a.revenue > 0)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 8)
    .map((a) => ({ id: a.id, name: a.full_name, revenue: a.revenue }));

  return (
    <div className="space-y-6">
      {/* Hero — çıktıda yok; kâğıttaki başlık aşağıdaki print-only bant. */}
      <PageHeader
        className="no-print mb-0"
        eyebrow={isCurrentMonth ? "Bu ay sıralaması" : "Dönem sıralaması"}
        title="Danışman KPI Paneli"
        description={`${isCurrentMonth ? "Bu ayki" : `${donem} dönemi`} aktivite, teklif ve gelir performansı.`}
        actions={
          <>
            {/* Dönem gezinme — ?ay=YYYY-MM, sunucuda hesaplanan Link'ler. Gelecek aya gidilmez. */}
            <div className="flex items-center gap-1">
              <Link href={prevHref} className="focus-ring grid h-9 w-9 place-items-center rounded-[var(--radius-control)] border border-line bg-surface text-text-muted transition hover:bg-surface-2 hover:text-text" aria-label="Önceki ay">
                <ChevronLeft className="h-4 w-4" />
              </Link>
              <span className="min-w-[120px] px-2 text-center text-sm font-bold text-text first-letter:uppercase">{donem}</span>
              {nextHref ? (
                <Link href={nextHref} className="focus-ring grid h-9 w-9 place-items-center rounded-[var(--radius-control)] border border-line bg-surface text-text-muted transition hover:bg-surface-2 hover:text-text" aria-label="Sonraki ay">
                  <ChevronRight className="h-4 w-4" />
                </Link>
              ) : (
                <span className="grid h-9 w-9 cursor-not-allowed place-items-center rounded-[var(--radius-control)] border border-line text-text-faint opacity-60" aria-hidden="true">
                  <ChevronRight className="h-4 w-4" />
                </span>
              )}
              {!isCurrentMonth ? (
                <Link href="/app/danisman-kpi" className="focus-ring ml-1 rounded-[var(--radius-control)] border border-line px-2.5 py-2 text-xs font-semibold text-text-muted transition hover:bg-surface-2 hover:text-text">
                  Bu ay
                </Link>
              ) : null}
            </div>
            <PrintButton />
            {/* Karne parayı ölçer, lig davranışı — puan/rozet/seri için /app/lig */}
            <Link href={`/app/lig?donem=${ayParam(monthStart)}`} className="focus-ring inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2 text-sm font-semibold text-text transition hover:bg-surface-2"><Trophy className="h-4 w-4" /> Lig tablosu</Link>
          </>
        }
      />

      <KpiGrid count={seeAllEarnings ? 4 : 3} className="no-print" label="Dönem özeti">
        <StatCard label="Danışman" value={advisors.length} icon={Users} href="/app/ekip" />
        {seeAllEarnings ? (
          <>
            <StatCard label="Danışman gelirleri (komisyon payı)" value={money(advisors.reduce((s, a) => s + a.revenue, 0))} icon={Wallet} tone="success" href="/app/cuzdan?sekme=ofis" />
            <StatCard label="Ofis komisyonu (brüt)" value={money(metrics.office.commissionGrossCollected ?? 0)} icon={Wallet} href="/app/komisyon?durum=tahsil" />
          </>
        ) : (
          <StatCard label="Gelirim (komisyon payım)" value={money(advisors.find((a) => a.id === userId)?.revenue ?? 0)} icon={Wallet} tone="success" href="/app/cuzdan" />
        )}
        <StatCard label="Toplam satış" value={advisors.reduce((s, a) => s + a.dealCount, 0)} icon={Handshake} href="/app/teklifler?durum=accepted" />
      </KpiGrid>

      {/* ── Liderlik podyumu: skoru olan ilk üç danışman (ekran, çıktı dışı) ── */}
      {podium.length > 0 ? (
        <section className={`no-print dashboard-panel relative overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface p-6 ${podium.length === 1 ? "mx-auto w-full max-w-md text-center" : ""}`}>
          <div className="pointer-events-none absolute -left-10 -top-16 h-48 w-48 rounded-full bg-[color-mix(in_srgb,var(--viz-gold)_18%,transparent)] blur-[70px]" />
          <div className="relative">
            <p className={`flex items-center gap-2 text-xs font-semibold text-[color:var(--pm-gold-text)] ${podium.length === 1 ? "justify-center" : ""}`}>
              <Crown className="h-4 w-4" /> Liderlik podyumu
            </p>
            <h2 className="mt-1 font-display text-lg font-bold text-text">
              {isCurrentMonth ? "Bu ayın" : `${donem} döneminin`} ilk üçü
            </h2>
            <div className={`mt-6 grid gap-3 sm:items-end ${podiumColumns(podium.length)}`}>
              {podium.map((a, i) => {
                const sira = i + 1;
                const stil = [
                  { order: "sm:order-2", bar: "h-24 bg-[image:var(--grad-brand)]", ring: "bg-amber-400 text-ink-950", medal: "🥇" },
                  { order: "sm:order-1", bar: "h-16 bg-accent-subtle", ring: "bg-canvas text-text-muted border border-line", medal: "🥈" },
                  { order: "sm:order-3", bar: "h-12 bg-[color-mix(in_srgb,var(--viz-gold)_16%,transparent)]", ring: "bg-[color-mix(in_srgb,var(--viz-gold)_16%,transparent)] text-[color:var(--pm-gold-text)]", medal: "🥉" },
                ][i];
                const initials = a.full_name.split(" ").map((p) => p[0] ?? "").join("").slice(0, 2).toUpperCase();
                return (
                  <Link
                    key={a.id}
                    href={`/app/ekip/${a.id}`}
                    className={`focus-ring press lift group flex flex-col rounded-[var(--radius-panel)] border border-line bg-canvas/40 p-4 text-center transition hover:border-border-interactive ${stil.order}`}
                    aria-label={`${sira}. sıra: ${a.full_name} — skor ${a.score}`}
                  >
                    <span className={`mx-auto grid h-12 w-12 place-items-center rounded-full font-display text-sm font-extrabold ${stil.ring}`}>
                      {initials}
                    </span>
                    <p className="mt-2 flex items-center justify-center gap-1 truncate font-display text-sm font-bold text-text group-hover:text-accent-text">
                      <span aria-hidden="true">{stil.medal}</span> {a.full_name}
                    </p>
                    <p className="text-xs text-text-muted">
                      Skor <span className="numeric font-bold text-text">{a.score}</span>
                      {a.revenue > 0 && showRevenue(a.id) ? ` · ${money(a.revenue)}` : ""} · {a.dealCount} satış
                    </p>
                    <div className={`mt-3 w-full rounded-t-[var(--radius-control)] ${stil.bar}`} aria-hidden="true" />
                  </Link>
                );
              })}
            </div>
          </div>
        </section>
      ) : null}

      <div className="no-print">
        <PaceCard
          scoreNow={scoreNowTotal}
          scorePrev={scorePrevTotal}
          elapsedPct={elapsedPct}
          prevHref={prevHref}
          monthLabel={isCurrentMonth ? "Bu ay" : donem}
          prevLabel={prevMonthLabel}
        />
      </div>

      {/* ── Ekip metrik kartları — önceki döneme kıyasla (ekran, çıktı dışı) ── */}
      <KpiGrid count={4} className="no-print" label="Ekip aktivitesi">
        <StatCard
          label="Ekip çağrısı"
          value={teamNow.call}
          icon={PhoneCall}
          href="/app/arama"
          {...trendOf(teamNow.call, teamPrev.call)}
        />
        <StatCard
          label="Ekip randevusu"
          value={teamNow.appoint}
          icon={CalendarCheck2}
          tone="success"
          href="/app/randevular"
          {...trendOf(teamNow.appoint, teamPrev.appoint)}
        />
        <StatCard
          label="Ekip teklifi"
          value={teamNow.offer}
          icon={FileSignature}
          tone="warning"
          href="/app/teklifler"
          {...trendOf(teamNow.offer, teamPrev.offer)}
        />
        <StatCard
          label="Teklif → satış dönüşümü"
          value={convNow !== null ? `%${convNow}` : "—"}
          icon={Handshake}
          tone={convNow !== null && convPrev !== null && convNow < convPrev ? "danger" : "success"}
          href="/app/anlasmalar"
          {...(convNow !== null && convPrev !== null
            ? trendOf(convNow, convPrev)
            : { trend: "neutral" as const, trendLabel: "önceki ay verisi yok" })}
        />
      </KpiGrid>

      {/* Rozet şeridi — seçili ayın verisinden türetilir, veri yoksa gizli.
          Bilinçli olarak sade: tablodaki madalya renk diliyle uyumlu amber
          vurgu, animasyon/konfeti yok. Resmi karne çıktısına girmez. */}
      {rozetler.length > 0 ? (
        <section className="no-print space-y-2">
          <div className={`grid gap-3 ${kpiColumns(rozetler.length)}`}>
            {rozetler.map((r) => (
              <Link
                key={r.ad}
                href={`/app/ekip/${r.sahip.id}`}
                className="focus-ring press lift surface-card flex items-center gap-3 rounded-[var(--radius-card)] px-4 py-3"
                aria-label={`${r.ad}: ${r.sahip.full_name}`}
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[color-mix(in_srgb,var(--viz-gold)_18%,transparent)] text-base" aria-hidden="true">
                  {r.emoji}
                </span>
                <span className="min-w-0">
                  <span className="block text-xs font-bold uppercase tracking-[0.1em] text-text-faint">{r.ad}</span>
                  <span className="block truncate text-sm font-bold text-text">{r.sahip.full_name}</span>
                  <span className="block text-xs text-text-muted">{r.aciklama}</span>
                </span>
              </Link>
            ))}
          </div>
          {prevLeader ? (
            <p className="flex flex-wrap items-center gap-2 px-1 text-xs text-text-muted">
              Geçen ayın lideri: <span className="font-semibold text-text">{prevLeader.full_name}</span>
              {yeniLider ? (
                <span className="rounded-full bg-accent-subtle px-2 py-0.5 text-xs font-bold text-accent-text">
                  Yeni lider!
                </span>
              ) : null}
            </p>
          ) : null}
        </section>
      ) : null}

      {/* Kisisel koc: sayfa dogru sayilari gosteriyordu ama "bu hafta ne
          yapmaliyim" sorusunu cevaplamak danismanin isi olarak kaliyordu.
          Koc kisisel bir arac; resmi karne cikisina girmez (no-print sarici —
          CoachPanel paylasilan bir bilesen, kendisine dokunulmuyor). */}
      {/* Koçluk içgörüsü için yer: içgörü okuyucusu bağlanana dek hiçbir şey çizilmez (sahte içgörü yok). */}
      <CoachInsightSlot />
      {isCurrentMonth ? (
        <div className="no-print">
          <CoachPanel actions={coachActions} adSoyad={ben?.full_name ?? null} />
        </div>
      ) : (
        <p className="no-print rounded-[var(--radius-card)] border border-line bg-canvas px-4 py-3 text-xs text-text-muted">
          Koç önerileri yalnız içinde bulunulan ay için gösterilir — geçmiş dönem karnesinde gizlenir.
        </p>
      )}

      {/* Karne başlığı — yalnızca çıktıda: ofis adı + dönem (değerleme
          raporundaki başlık bandı deseni). */}
      <header className="print-only hairline-b pb-5">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-accent-text">
          {office?.name ?? "Emlak ofisi"}
        </p>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-4">
          <h1 className="font-display text-2xl font-extrabold tracking-[-0.02em] text-text">Danışman karnesi</h1>
          <dl className="text-right text-xs text-text-muted">
            <div className="flex justify-end gap-2">
              <dt>Dönem</dt>
              <dd className="font-semibold text-text">{donem}</dd>
            </div>
            <div className="mt-1 flex justify-end gap-2">
              <dt>Danışman sayısı</dt>
              <dd className="numeric font-semibold text-text">{advisors.length}</dd>
            </div>
          </dl>
        </div>
      </header>

      {/* Gelir kırılımı — tabloyu okumadan önce tek bakışta sıralama.
          Bilinçli olarak tek seri: gelir (₺) ile satış adedi aynı eksende
          gösterilse ölçek farkı yüzünden yanıltıcı olurdu. */}
      {revenueChart.length > 0 ? (
        <div className="no-print">
          <ChartFrame
            title="Danışman bazlı gelir"
            subtitle={`${isCurrentMonth ? "Bu ay" : donem} · en yüksek 8 danışman · çubuğa tıklayın`}
            height={Math.max(200, revenueChart.length * 38)}
          >
            <RevenueChart data={revenueChart} />
          </ChartFrame>
          <table className="sr-only">
            <caption>Danışman bazlı gelir (komisyon payı)</caption>
            <thead>
              <tr>
                <th scope="col">Danışman</th>
                <th scope="col">Gelir</th>
              </tr>
            </thead>
            <tbody>
              {revenueChart.map((r) => (
                <tr key={r.id}>
                  <th scope="row">
                    <Link href={`/app/ekip/${r.id}`}>{r.name}</Link>
                  </th>
                  <td>{money(r.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {advisors.length === 0 ? (
        <p className="py-12 text-center text-sm text-text-muted">Danışman kaydı bulunamadı.</p>
      ) : (
        <TableFrame className="print-sheet" minWidth={760}>
          <Table>
            <THead>
              <TR>
                <TH>#</TH>
                <TH>Danışman</TH>
                <TH align="right">Müşteri</TH>
                <TH align="right">Çağrı</TH>
                <TH align="right">Randevu</TH>
                <TH align="right">Teklif</TH>
                <TH align="right">Satış</TH>
                <TH align="right">Dönüşüm</TH>
                <TH align="right">Gelir (komisyon payı)</TH>
                <TH>Skor</TH>
              </TR>
            </THead>
            <TBody>
              {advisors.map((a, i) => {
                // İlerleme oku: seçili ay skoru vs önceki ay skoru.
                const oncekiSkor = prevScoreByUid.get(a.id) ?? 0;
                const fark = a.score - oncekiSkor;
                return (
                <TR key={a.id} interactive>
                  <TD>
                    {/* İlk üç sıra madalya rengi; zinc palet dışıydı, ink'e çekildi */}
                    <span
                      className={`numeric font-display font-bold ${
                        i === 0
                          ? "text-[color:var(--pm-gold-text)]"
                          : i === 1
                            ? "text-text-muted"
                            : i === 2
                              ? "text-[color:var(--pm-gold-text)]"
                              : "text-text-faint"
                      }`}
                    >
                      {i + 1}
                    </span>
                  </TD>
                  <TD>
                    <Link href={`/app/ekip/${a.id}`} className="absolute inset-0" aria-label={`${a.full_name} danışman detayı`} />
                    <p className="font-semibold text-text group-hover:text-accent-text">
                      {a.full_name}
                      {(rozetByUid.get(a.id) ?? []).map((r) => (
                        <span key={r.ad} className="no-print ml-1 text-xs" title={r.ad} aria-label={r.ad}>
                          {r.emoji}
                        </span>
                      ))}
                    </p>
                    <p className="text-xs text-text-faint capitalize">{a.role}</p>
                  </TD>
                  {/* Hücre drill-down'ları: relative z-10 ile satır overlay linkinin üstünde */}
                  <TD align="right" className="text-text-muted">
                    <Link
                      href={`/app/musteriler?assigned=${a.id}`}
                      className="focus-ring relative z-10 rounded-[var(--radius-control)] hover:text-accent-text hover:underline"
                      aria-label={`${a.full_name} müşterileri`}
                    >
                      {a.customerCount}
                    </Link>
                  </TD>
                  <TD align="right" className="text-text-muted">
                    <Link
                      href={`/app/arama?danisman=${a.id}`}
                      className="focus-ring relative z-10 rounded-[var(--radius-control)] hover:text-accent-text hover:underline"
                      aria-label={`${a.full_name} çağrıları`}
                    >
                      {a.callCount}
                    </Link>
                  </TD>
                  <TD align="right" className="text-text-muted">
                    <Link
                      href="/app/randevular"
                      className="focus-ring relative z-10 rounded-[var(--radius-control)] hover:text-accent-text hover:underline"
                      aria-label={`${a.full_name} randevuları`}
                    >
                      {a.appointCount}
                    </Link>
                  </TD>
                  <TD align="right" className="text-text-muted">{a.offerCount}</TD>
                  <TD align="right" className="font-semibold text-text">{a.dealCount}</TD>
                  <TD align="right" className="text-text-muted">{a.conversionRate}</TD>
                  {/* gelir: başarı tonu (viz-pos) */}
                  <TD align="right" className="font-bold text-[color:var(--viz-pos)]">{a.revenue > 0 && showRevenue(a.id) ? money(a.revenue) : "—"}</TD>
                  <TD>
                    <div className="flex items-center gap-2">
                      <Progress className="w-16" value={(a.score / topScore) * 100} label={`${a.full_name} skoru`} />
                      <span className="numeric text-xs font-bold text-text">{a.score}</span>
                      {/* Önceki aya göre ilerleme — ayrıntı title'da (ekran okuyucu için aria-label) */}
                      <span
                        className={`text-xs font-bold ${fark > 0 ? "text-[color:var(--viz-pos)]" : fark < 0 ? "text-[color:var(--viz-neg)]" : "text-text-faint"}`}
                        title={`Önceki ay: ${oncekiSkor} · fark: ${fark > 0 ? `+${fark}` : fark}`}
                        aria-label={`Önceki ay skoru ${oncekiSkor}, fark ${fark > 0 ? `+${fark}` : fark}`}
                      >
                        {fark > 0 ? "↑" : fark < 0 ? "↓" : "→"}
                      </span>
                    </div>
                  </TD>
                </TR>
                );
              })}
            </TBody>
          </Table>
        </TableFrame>
      )}

      {/* Islak imza alanı yalnızca çıktıda — değerleme raporundaki desen. */}
      <footer className="print-only mt-10 grid grid-cols-2 gap-12">
        <div>
          <div className="hairline-t pt-1.5 text-xs text-text-muted">Hazırlayan · ad, soyad, tarih</div>
        </div>
        <div>
          <div className="hairline-t pt-1.5 text-xs text-text-muted">Ofis yetkilisi · ad, soyad, imza</div>
        </div>
      </footer>
    </div>
  );
}
