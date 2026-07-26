import Link from "next/link";
import { ArrowUpRight, ChevronLeft, ChevronRight, Trophy } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { ChartFrame } from "@/components/ui/chart";
import { Table, TableFrame, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { buildCoachActions, type CoachAction } from "@/lib/advisor-coach";
import dynamic from "next/dynamic";
import { CoachPanel, type CoachActionWithLink } from "./coach-panel";
import { PrintButton } from "./print-button";

// Recharts ağır (~100 kB+ gzip) ve yalnız bu grafikte kullanılıyor — dynamic
// import ile sayfanın ilk JS yükünden çıkarılır; ChartFrame yüksekliğini
// dolduran iskelet gösterilir.
const RevenueChart = dynamic(() => import("./revenue-chart").then((m) => m.RevenueChart), {
  loading: () => <div className="h-full w-full animate-pulse rounded-[12px] bg-ink-950/8" />,
});

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

function pct(a: number, b: number) {
  if (!b) return "—";
  return `%${Math.round((a / b) * 100)}`;
}

type KpiAgg = {
  customer_count: number; call_count: number; appoint_count: number;
  offer_count: number; deal_count: number; revenue: number;
};

/**
 * Geçmiş ay agregasyonu — mevcut `advisor_kpis` RPC'si yalnız `p_month_start`
 * alıp açık uçlu (>=) topladığından geçmiş bir ay için sonraki ayların
 * aktivitesini de sayardı. RPC'ye dokunmadan aynı toplamları kapalı aralıkla
 * ([start, end)) burada kuruyoruz: her tablodan yalnız kimlik/tutar kolonu
 * çekilir (dar select), RLS tenant kapsamını uygular. Müşteri sayısı RPC ile
 * aynı semantikte kalır: toplam atanmış müşteri, aya bağlı değil.
 */
async function loadKpisForRange(
  supabase: Awaited<ReturnType<typeof createClient>>,
  startIso: string,
  endIso: string,
  opts: { scoreOnly?: boolean } = {},
): Promise<Map<string, KpiAgg>> {
  const [cust, { data: cal }, { data: appt }, { data: off }, { data: comm }] = await Promise.all([
    // scoreOnly: geçen-ay kıyası yalnız skor bileşenlerini kullanır; skor
    // formülünde müşteri sayısı yok — bu sorgu kıyas çağrısında atlanır.
    opts.scoreOnly
      ? Promise.resolve<Array<{ assigned_to: string | null }> | null>(null)
      : supabase
          .from("customers")
          .select("assigned_to")
          .is("deleted_at", null)
          .not("assigned_to", "is", null)
          .limit(5000)
          .then((r) => r.data),
    supabase.from("calls").select("handled_by").gte("started_at", startIso).lt("started_at", endIso).not("handled_by", "is", null).limit(5000),
    supabase.from("appointments").select("assigned_to").gte("scheduled_at", startIso).lt("scheduled_at", endIso).not("assigned_to", "is", null).limit(5000),
    supabase.from("offers").select("created_by, status").gte("created_at", startIso).lt("created_at", endIso).not("created_by", "is", null).limit(5000),
    supabase
      .from("commissions")
      .select("gross_amount, deal:deals(assigned_to)")
      .gte("created_at", startIso)
      .lt("created_at", endIso)
      .in("status", ["paid", "collected"])
      .limit(5000),
  ]);

  const map = new Map<string, KpiAgg>();
  const get = (uid: string) => {
    let k = map.get(uid);
    if (!k) {
      k = { customer_count: 0, call_count: 0, appoint_count: 0, offer_count: 0, deal_count: 0, revenue: 0 };
      map.set(uid, k);
    }
    return k;
  };
  for (const r of cust ?? []) get(String(r.assigned_to)).customer_count += 1;
  for (const r of cal ?? []) get(String(r.handled_by)).call_count += 1;
  for (const r of appt ?? []) get(String(r.assigned_to)).appoint_count += 1;
  for (const r of off ?? []) {
    const k = get(String(r.created_by));
    k.offer_count += 1;
    if (r.status === "accepted") k.deal_count += 1;
  }
  for (const r of comm ?? []) {
    const rel = r.deal as { assigned_to?: string | null } | { assigned_to?: string | null }[] | null;
    const deal = Array.isArray(rel) ? rel[0] : rel;
    if (!deal?.assigned_to) continue;
    get(String(deal.assigned_to)).revenue += Number(r.gross_amount || 0);
  }
  return map;
}

/**
 * Skor formülü tek yerde — tablo, rozetler ve geçen-ay kıyası aynı formülü
 * kullanır: çağrı×1 + randevu×2 + teklif×3 + satış×10 + gelir/10000.
 */
function scoreOf(k: Pick<KpiAgg, "call_count" | "appoint_count" | "offer_count" | "deal_count" | "revenue">) {
  return Math.round(
    k.call_count * 1 + k.appoint_count * 2 + k.offer_count * 3 + k.deal_count * 10 + k.revenue / 10_000,
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
  revenue:        number;
  conversionRate: string;
  score:          number;
};

export default async function DanismanKpiPage({
  searchParams,
}: {
  searchParams?: Promise<{ ay?: string }>;
}) {
  const { tenantId, userId } = await requireModulePage("reports");
  const supabase = await createClient();

  // ?ay=YYYY-MM — dönem seçici. Geçersiz/gelecek değer bu aya düşer;
  // gezinme linkleri sunucuda hesaplanır (randevular hafta görünümü deseni).
  const sp = (await searchParams) ?? {};
  const thisMonthStart = new Date();
  thisMonthStart.setDate(1);
  thisMonthStart.setHours(0, 0, 0, 0);

  let monthStart = thisMonthStart;
  const ayMatch = /^(\d{4})-(\d{2})$/.exec(sp.ay ?? "");
  if (ayMatch) {
    const requested = new Date(Number(ayMatch[1]), Number(ayMatch[2]) - 1, 1);
    if (!Number.isNaN(requested.getTime()) && requested.getTime() < thisMonthStart.getTime()) {
      monthStart = requested;
    }
  }
  const isCurrentMonth = monthStart.getTime() === thisMonthStart.getTime();
  const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1);

  const ayParam = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const prevMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() - 1, 1);
  const prevHref = `/app/danisman-kpi?ay=${ayParam(prevMonth)}`;
  const nextMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1);
  // Gelecek aya gezinme yok: sonraki ay linki yalnız geçmiş ay görüntülenirken.
  const nextHref = isCurrentMonth ? null : `/app/danisman-kpi?ay=${ayParam(nextMonth)}`;

  // Profiller + tek round-trip aggregate RPC (5 tablo, Postgres tarafında toplanır)
  /*
   * Koc icin ek sinyaller. Hepsi `head: true` + `count` ile geliyor: satir
   * cekilmiyor, yalnizca sayilar. Bunlari HER danisman icin ayri sormak
   * N+1 olurdu; koc kisisel bir arac oldugu icin yalnizca OTURUM ACAN
   * kullanici icin hesaplaniyor.
   */
  const bugun = new Date();
  const onbesGunSonra = new Date(bugun.getTime() + 15 * 86_400_000).toISOString().slice(0, 10);
  const bugunISO = bugun.toISOString();
  const otuzGunOnce = new Date(bugun.getTime() - 30 * 86_400_000).toISOString();

  // KPI toplamları: bu ay için mevcut RPC (açık uçlu >= bu ayla eşdeğer);
  // geçmiş ay için kapalı aralıklı JS agregasyonu (loadKpisForRange).
  const kpiPromise: PromiseLike<Map<string, KpiAgg>> = isCurrentMonth
    ? supabase
        .rpc("advisor_kpis", { p_tenant_id: tenantId, p_month_start: monthStart.toISOString() })
        .then(({ data }) => {
          const map = new Map<string, KpiAgg>();
          for (const r of (data ?? []) as Array<Record<string, unknown>>) {
            map.set(String(r.assigned_to), {
              customer_count: Number(r.customer_count ?? 0),
              call_count:     Number(r.call_count ?? 0),
              appoint_count:  Number(r.appoint_count ?? 0),
              offer_count:    Number(r.offer_count ?? 0),
              deal_count:     Number(r.deal_count ?? 0),
              revenue:        Number(r.revenue ?? 0),
            });
          }
          return map;
        })
    : loadKpisForRange(supabase, monthStart.toISOString(), monthEnd.toISOString());

  const [
    { data: profiles },
    kpiByUid,
    // Geçen ay kıyası (rozet şeridi + tablo ilerleme okları): kapalı aralık
    // [önceki ay, seçili ay). scoreOnly — yalnız skor bileşenleri çekilir.
    prevKpiByUid,
    { count: yetkiBiten },
    { count: gecikmisGorev },
    { count: pahaliPortfoy },
    { count: soguyanMusteri },
    { data: office },
  ] = await Promise.all([
    supabase.from("profiles").select("id, full_name, role").limit(50),
    kpiPromise,
    loadKpisForRange(supabase, prevMonth.toISOString(), monthStart.toISOString(), { scoreOnly: true }),
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
  const donem = new Intl.DateTimeFormat("tr-TR", { month: "long", year: "numeric" }).format(monthStart);

  // Danışman bazlı hesapla
  const advisorMap = new Map<string, AdvisorKpi>();

  for (const p of profiles ?? []) {
    if (!["advisor", "team_lead", "branch_manager", "gm", "owner"].includes(p.role)) continue;
    const k = kpiByUid.get(p.id);
    advisorMap.set(p.id, {
      id:             p.id,
      full_name:      p.full_name,
      role:           p.role,
      customerCount:  k?.customer_count ?? 0,
      callCount:      k?.call_count ?? 0,
      appointCount:   k?.appoint_count ?? 0,
      offerCount:     k?.offer_count ?? 0,
      dealCount:      k?.deal_count ?? 0,
      revenue:        k?.revenue ?? 0,
      conversionRate: "—",
      score:          0,
    });
  }

  // Dönüşüm oranı + skor
  for (const [, adv] of advisorMap) {
    adv.conversionRate = pct(adv.dealCount, adv.offerCount);
    // Skor: ağırlıklı formül — scoreOf (tablo/rozet/kıyas aynı formül)
    adv.score = scoreOf({
      call_count:    adv.callCount,
      appoint_count: adv.appointCount,
      offer_count:   adv.offerCount,
      deal_count:    adv.dealCount,
      revenue:       adv.revenue,
    });
  }

  const advisors = [...advisorMap.values()]
    .sort((a, b) => b.score - a.score);

  const topScore = Math.max(1, ...advisors.map((a) => a.score));

  // ── Geçen ay kıyası: skorlar + geçen ayın lideri ──────────────────────────
  // Lider araması mevcut profillerle sınırlı — adı gösterilecek kişi zaten
  // aktif ekip listesinde olmalı.
  const prevScoreByUid = new Map<string, number>();
  for (const a of advisors) {
    const pk = prevKpiByUid.get(a.id);
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
  if (ciroLideri && ciroLideri.revenue > 0) {
    rozetler.push({ emoji: "💰", ad: "Ciro Lideri", sahip: ciroLideri, aciklama: money(ciroLideri.revenue) });
  }
  const rozetByUid = new Map<string, Rozet[]>();
  for (const r of rozetler) rozetByUid.set(r.sahip.id, [...(rozetByUid.get(r.sahip.id) ?? []), r]);
  const yeniLider = Boolean(prevLeader && lider && prevLeader.id !== lider.id);

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
    .filter((a) => a.revenue > 0)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 8)
    .map((a) => ({ id: a.id, name: a.full_name, revenue: a.revenue }));

  return (
    <div className="space-y-6">
      {/* Hero — çıktıda yok; kâğıttaki başlık aşağıdaki print-only bant. */}
      <section className="no-print theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-30" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="flex items-center gap-2 text-xs font-semibold text-brand-300">
              <Trophy className="h-4 w-4" /> {isCurrentMonth ? "Bu ay sıralaması" : "Dönem sıralaması"}
            </span>
            <h1 className="mt-2 font-display text-2xl font-extrabold text-white md:text-3xl">Danışman KPI Paneli</h1>
            <p className="mt-1 text-sm text-white/75">
              {isCurrentMonth ? "Bu ayki" : `${donem} dönemi`} aktivite, teklif ve gelir performansı.
            </p>
            {/* Dönem gezinme — ?ay=YYYY-MM, sunucuda hesaplanan Link'ler
                (randevular hafta görünümü deseni). Gelecek aya gidilmez. */}
            <div className="mt-3 flex items-center gap-1">
              <Link
                href={prevHref}
                className="focus-ring grid h-8 w-8 place-items-center rounded-[8px] border border-white/15 text-white/70 transition hover:bg-white/10 hover:text-white"
                aria-label="Önceki ay"
              >
                <ChevronLeft className="h-4 w-4" />
              </Link>
              <span className="min-w-[120px] px-2 text-center text-sm font-bold text-white first-letter:uppercase">
                {donem}
              </span>
              {nextHref ? (
                <Link
                  href={nextHref}
                  className="focus-ring grid h-8 w-8 place-items-center rounded-[8px] border border-white/15 text-white/70 transition hover:bg-white/10 hover:text-white"
                  aria-label="Sonraki ay"
                >
                  <ChevronRight className="h-4 w-4" />
                </Link>
              ) : (
                <span
                  className="grid h-8 w-8 cursor-not-allowed place-items-center rounded-[8px] border border-white/8 text-white/25"
                  aria-hidden="true"
                >
                  <ChevronRight className="h-4 w-4" />
                </span>
              )}
              {!isCurrentMonth ? (
                <Link
                  href="/app/danisman-kpi"
                  className="focus-ring ml-1 rounded-[8px] border border-white/15 px-2.5 py-1.5 text-[11px] font-semibold text-white/70 transition hover:bg-white/10 hover:text-white"
                >
                  Bu ay
                </Link>
              ) : null}
            </div>
            <div className="mt-3">
              <PrintButton />
            </div>
          </div>
          <div className="flex gap-3">
            {[
              { label: "Danışman", value: advisors.length, href: "/app/ekip" },
              { label: "Toplam gelir", value: money(advisors.reduce((s, a) => s + a.revenue, 0)), href: "/app/komisyon" },
              { label: "Toplam satış", value: advisors.reduce((s, a) => s + a.dealCount, 0), href: "/app/anlasmalar" },
            ].map((k) => (
              <Link
                key={k.label}
                href={k.href}
                className="focus-ring press lift group block rounded-[14px] border border-white/12 bg-white/8 p-3 text-center hover:border-white/30"
              >
                <p className="flex items-center justify-center gap-1 font-display text-xl font-extrabold text-white">
                  {k.value}
                  <ArrowUpRight className="hover-action h-3.5 w-3.5 text-white/30 opacity-0 transition group-hover:text-white group-hover:opacity-100" />
                </p>
                <p className="text-[11px] text-white/70">{k.label}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Rozet şeridi — seçili ayın verisinden türetilir, veri yoksa gizli.
          Bilinçli olarak sade: tablodaki madalya renk diliyle uyumlu amber
          vurgu, animasyon/konfeti yok. Resmi karne çıktısına girmez. */}
      {rozetler.length > 0 ? (
        <section className="no-print space-y-2">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {rozetler.map((r) => (
              <Link
                key={r.ad}
                href={`/app/ekip/${r.sahip.id}`}
                className="focus-ring press lift surface-card flex items-center gap-3 rounded-[14px] px-4 py-3"
                aria-label={`${r.ad}: ${r.sahip.full_name}`}
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-amber-400/15 text-base" aria-hidden="true">
                  {r.emoji}
                </span>
                <span className="min-w-0">
                  <span className="block text-[10px] font-bold uppercase tracking-[0.1em] text-text-faint">{r.ad}</span>
                  <span className="block truncate text-sm font-bold text-ink-950">{r.sahip.full_name}</span>
                  <span className="block text-[11px] text-text-muted">{r.aciklama}</span>
                </span>
              </Link>
            ))}
          </div>
          {prevLeader ? (
            <p className="flex flex-wrap items-center gap-2 px-1 text-xs text-text-muted">
              Geçen ayın lideri: <span className="font-semibold text-ink-950">{prevLeader.full_name}</span>
              {yeniLider ? (
                <span className="rounded-full bg-brand-600/10 px-2 py-0.5 text-[11px] font-bold text-brand-700">
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
      {isCurrentMonth ? (
        <div className="no-print">
          <CoachPanel actions={coachActions} adSoyad={ben?.full_name ?? null} />
        </div>
      ) : (
        <p className="no-print rounded-[14px] border border-line bg-canvas px-4 py-3 text-xs text-text-muted">
          Koç önerileri yalnız içinde bulunulan ay için gösterilir — geçmiş dönem karnesinde gizlenir.
        </p>
      )}

      {/* Karne başlığı — yalnızca çıktıda: ofis adı + dönem (değerleme
          raporundaki başlık bandı deseni). */}
      <header className="print-only hairline-b pb-5">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-brand-600">
          {office?.name ?? "Emlak ofisi"}
        </p>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-4">
          <h1 className="font-display text-2xl font-extrabold tracking-[-0.02em] text-ink-950">Danışman karnesi</h1>
          <dl className="text-right text-xs text-text-muted">
            <div className="flex justify-end gap-2">
              <dt>Dönem</dt>
              <dd className="font-semibold text-ink-950">{donem}</dd>
            </div>
            <div className="mt-1 flex justify-end gap-2">
              <dt>Danışman sayısı</dt>
              <dd className="numeric font-semibold text-ink-950">{advisors.length}</dd>
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
                <TH align="right">Gelir</TH>
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
                          ? "text-amber-500"
                          : i === 1
                            ? "text-text-muted"
                            : i === 2
                              ? "text-amber-700"
                              : "text-text-faint"
                      }`}
                    >
                      {i + 1}
                    </span>
                  </TD>
                  <TD>
                    <Link href={`/app/ekip/${a.id}`} className="absolute inset-0" aria-label={`${a.full_name} danışman detayı`} />
                    <p className="font-semibold text-ink-950 group-hover:text-brand-600">
                      {a.full_name}
                      {(rozetByUid.get(a.id) ?? []).map((r) => (
                        <span key={r.ad} className="no-print ml-1 text-[12px]" title={r.ad} aria-label={r.ad}>
                          {r.emoji}
                        </span>
                      ))}
                    </p>
                    <p className="text-[11px] text-text-faint capitalize">{a.role}</p>
                  </TD>
                  {/* Hücre drill-down'ları: relative z-10 ile satır overlay linkinin üstünde */}
                  <TD align="right" className="text-text-muted">
                    <Link
                      href={`/app/musteriler?assigned=${a.id}`}
                      className="focus-ring relative z-10 rounded-[6px] hover:text-brand-600 hover:underline"
                      aria-label={`${a.full_name} müşterileri`}
                    >
                      {a.customerCount}
                    </Link>
                  </TD>
                  <TD align="right" className="text-text-muted">
                    <Link
                      href={`/app/arama?danisman=${a.id}`}
                      className="focus-ring relative z-10 rounded-[6px] hover:text-brand-600 hover:underline"
                      aria-label={`${a.full_name} çağrıları`}
                    >
                      {a.callCount}
                    </Link>
                  </TD>
                  <TD align="right" className="text-text-muted">
                    <Link
                      href="/app/randevular"
                      className="focus-ring relative z-10 rounded-[6px] hover:text-brand-600 hover:underline"
                      aria-label={`${a.full_name} randevuları`}
                    >
                      {a.appointCount}
                    </Link>
                  </TD>
                  <TD align="right" className="text-text-muted">{a.offerCount}</TD>
                  <TD align="right" className="font-semibold text-ink-950">{a.dealCount}</TD>
                  <TD align="right" className="text-text-muted">{a.conversionRate}</TD>
                  {/* mint-700 bu turda tanımlandı; öncesinde sınıf sessizce düşüyordu */}
                  <TD align="right" className="font-bold text-mint-700">{a.revenue > 0 ? money(a.revenue) : "—"}</TD>
                  <TD>
                    <div className="flex items-center gap-2">
                      <div className="surface-sunken h-1.5 w-16 overflow-hidden rounded-full">
                        <div
                          className="h-full rounded-full bg-[image:var(--grad-brand)]"
                          style={{ width: `${(a.score / topScore) * 100}%` }}
                        />
                      </div>
                      <span className="numeric text-xs font-bold text-ink-950">{a.score}</span>
                      {/* Önceki aya göre ilerleme — ayrıntı title'da (ekran okuyucu için aria-label) */}
                      <span
                        className={`text-xs font-bold ${fark > 0 ? "text-mint-700" : fark < 0 ? "text-danger-600" : "text-text-faint"}`}
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
          <div className="hairline-t pt-1.5 text-[11px] text-text-muted">Hazırlayan · ad, soyad, tarih</div>
        </div>
        <div>
          <div className="hairline-t pt-1.5 text-[11px] text-text-muted">Ofis yetkilisi · ad, soyad, imza</div>
        </div>
      </footer>
    </div>
  );
}
