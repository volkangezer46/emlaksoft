import { Suspense } from "react";
import {
  Activity,
  AlertTriangle,
  CalendarDays,
  CalendarPlus,
  ClipboardList,
  Coins,
  FileClock,
  FileSignature,
  FileText,
  Handshake,
  Home,
  Inbox,
  Landmark,
  ListPlus,
  Phone,
  ReceiptText,
  Scale,
  SquareCheckBig,
  Target,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";
import { DataFreshness } from "@/components/ui/data-freshness";
import { entryHref } from "@/lib/finance/entry-workspace";
import { earningsPath, financeHref, financePath } from "@/lib/finance/routes";
import { ScopeSwitch } from "@/components/ui/scope-switch";
import { formatTrTime, now, trDayKey, trParts } from "@/lib/clock";
import { moneyTry } from "@/lib/leak-shield";
import { appointmentTypeLabel } from "@/lib/appointment-labels";
import { appointmentHref, taskHref } from "@/lib/notification-text";
import { directionsHref, routeDirectionsHref } from "@/lib/route-plan";
import { getHeroPhoto, type HeroPhotoTheme } from "@/lib/media/hero-photo-source";
import { loadAttention, loadCommissionSummary, loadMoneySummary, loadMyTarget, loadOfficeTarget, loadTodayAppointments, type HomeCtx } from "../data";
import { timeGreeting } from "@/lib/greeting-name";
import { monthProgress, targetPace } from "../home-metrics";
import { homeHref, type HomeParams } from "../kapsam-anahtari";
import type { HomeLayout } from "../home-layout";
import { apptStatus, deltaOf, dueChip, heroSentenceParts, heroStatusCounts, longDate, sceneOf, type SalesFilter, type SalesRange } from "./core";
import { neYapmakChips } from "../ne-yapmak-chips";
import { HeroArama } from "./hero-arama";
import { loadHeroPhoto, loadKpiData, loadOfficeStatus, loadRecentListings, loadSalesPerformance, loadTeamToday, loadUpcomingTasks } from "./data";
import {
  AttentionPanel,
  CardSkeleton,
  GoalCard,
  HeroPhoto,
  KPI_ICONS,
  KpiCard,
  KpiMenu,
  KpiSkeleton,
  KurumsalHero,
  OfficeStatusPanel,
  RecentListings,
  SalesPerformance,
  SentenceText,
  Spark,
  StatusChips,
  TaskList,
  TeamToday,
  Timeline,
  type HeroAction,
  type StatusChip,
  type StatusTile,
  type Tone,
} from "./views";

const can = (ctx: HomeCtx, mod: keyof HomeCtx["perms"], action: "view" | "create" = "view") => (ctx.perms[mod] ?? []).includes(action);

/* ================================ KAHRAMAN ================================ */

/**
 * Hızlı işlemler ROL BAZLI (İŞLEYİŞ: "kahraman hızlı düğmeleri rol bazlı"): yalnız "create" yetkisi olan ve ofisin
 * kapatmadığı modüller. Yönetim: ilan → müşteri → randevu → görev. Danışman: müşteri önde (günlük işi). Muhasebe:
 * "Gelir/Gider ekle" birincil + tahsilat / alacak-borç / belge (anlaşma açmak muhasebenin işi değil). Arama merkezi:
 * müşteri + arama listesi + randevu.
 */
export function heroActions(ctx: HomeCtx, off: (k: string) => boolean, variant: HomeLayout["variant"]): { primary: HeroAction[]; more: HeroAction[] } {
  type A = HeroAction & { ok: boolean };
  const newListing: A = { href: "/app/portfoyler/yeni", label: "Yeni ilan", icon: Home, ok: can(ctx, "properties", "create") };
  const newCustomer: A = { href: "/app/musteriler/yeni", label: "Yeni müşteri", icon: UserPlus, ok: can(ctx, "customers", "create") };
  const newAppt: A = { href: "/app/randevular/yeni", label: "Randevu ekle", icon: CalendarPlus, ok: can(ctx, "appointments", "create") };
  const newTask: A = { href: "/app/gorevler/yeni", label: "Görev oluştur", icon: ListPlus, ok: can(ctx, "tasks", "create") };
  const newDemand: A = { href: "/app/talepler/yeni", label: "Yeni talep", icon: Target, ok: can(ctx, "demands", "create") };
  const newDeal: A = { href: "/app/anlasmalar/yeni", label: "Yeni anlaşma", icon: Handshake, ok: can(ctx, "commissions", "create") };
  const newOffer: A = { href: "/app/teklifler/yeni", label: "Yeni teklif", icon: ClipboardList, ok: can(ctx, "offers", "create") && !off("offers") };
  const newContract: A = { href: "/app/sozlesmeler/yeni", label: "Yeni sözleşme", icon: FileSignature, ok: can(ctx, "contracts", "create") && !off("contracts") };
  let all: A[];
  switch (variant) {
    case "accounting": {
      const fin = can(ctx, "expenses", "create");
      all = [
        { href: entryHref(), label: "Gelir/Gider ekle", icon: ReceiptText, primary: true, ok: fin },
        { href: financeHref("tahsilat"), label: "Tahsilat", icon: Landmark, ok: can(ctx, "commissions") },
        { href: financeHref("cari", { gorunum: "acik" }), label: "Alacak ve borç", icon: Scale, ok: can(ctx, "expenses") },
        { href: entryHref({ tab: "belge" }), label: "Fatura / belge", icon: FileText, ok: fin },
      ];
      break;
    }
    case "call_center":
      all = [
        { ...newCustomer, primary: true },
        { href: "/app/arama-listesi", label: "Arama listesi", icon: Phone, ok: can(ctx, "customers") },
        newAppt,
        newTask,
        newDemand,
      ];
      break;
    case "advisor":
    case "team_lead":
      all = [{ ...newCustomer, primary: true }, newAppt, newListing, newTask, newDemand, newDeal, newOffer, newContract];
      break;
    default:
      all = [{ ...newListing, primary: true }, newCustomer, newAppt, newTask, newDemand, newDeal, newOffer, newContract];
  }
  const ok = all.filter((a) => a.ok).map(({ ok: _ok, ...a }) => a);
  // Birincil yoksa (ör. portföy ekleme yetkisi yok) ilk eylem birincil olur.
  if (ok.length > 0 && !ok.some((a) => a.primary)) ok[0] = { ...ok[0]!, primary: true };
  return { primary: ok.slice(0, 4), more: ok.slice(4) };
}

async function HeroSummary({ ctx }: { ctx: HomeCtx }) {
  const s = await loadOfficeStatus(ctx);
  return <SentenceText parts={heroSentenceParts({ appointments: s.todayAppointments, demands: s.newDemands, listingUpdates: s.overdueListings || null, mine: ctx.scopeMine })} />;
}

/** Muhasebe özeti: vadesi geçen kalem > incelenecek kayıt > sakin durum (kalın sayılı tek cümle). */
async function AccountingSummary({ ctx }: { ctx: HomeCtx }) {
  const m = await loadMoneySummary(ctx).catch(() => null);
  const overdue = m?.overdueCount ?? 0;
  const review = m?.reviewCount ?? 0;
  if (overdue === 0 && review === 0) return <>Bugün vadesi geçen ya da incelenecek kayıt görünmüyor; bu ayın hareketlerini gözden geçirebilirsiniz.</>;
  return (
    <SentenceText
      parts={[
        { text: "Bugün " },
        ...(overdue > 0 ? [{ text: overdue.toLocaleString("tr-TR"), strong: true }, { text: " vadesi geçen kalem" }] : []),
        ...(overdue > 0 && review > 0 ? [{ text: " ve " }] : []),
        ...(review > 0 ? [{ text: review.toLocaleString("tr-TR"), strong: true }, { text: " incelenecek kayıt" }] : []),
        { text: " sizi bekliyor." },
      ]}
    />
  );
}

const freshChip = (nowMs: number) => <DataFreshness asOf={nowMs} className="kh-fresh" />;

/**
 * Durum hapları (yönetim + danışman): Dikkat listesiyle AYNI küme (`loadAttention`): acil kalemlerin toplamı ("12 geciken
 * işlem" → tek kalemse o listeye, çoksa Dikkat'e) ve karar bekleyen onaylar ("3 önemli onay" → Onaylar, bana).
 */
async function HeroStatus({ ctx, nowMs }: { ctx: HomeCtx; nowMs: number }) {
  const items = await loadAttention(ctx).catch(() => []);
  const { overdue, approvals } = heroStatusCounts(items);
  const urgent = items.filter((i) => i.level === "acil");
  const chips: StatusChip[] = [];
  if (overdue > 0) chips.push({ key: "geciken", label: `${overdue.toLocaleString("tr-TR")} geciken işlem`, href: urgent.length === 1 ? urgent[0]!.href : "#dikkat", tone: "danger" });
  if (approvals > 0) chips.push({ key: "onay", label: `${approvals.toLocaleString("tr-TR")} önemli onay`, href: "/app/onaylar?kim=bana", tone: "rose" });
  if (chips.length === 0) chips.push({ key: "sakin", label: "Geciken iş yok", href: ctx.scopeMine ? "/app/gorevler?mine=1" : "/app/gorevler", tone: "success" });
  return <StatusChips fresh={freshChip(nowMs)} chips={chips} />;
}

/** Muhasebe durum hapları: vadesi geçen (kırmızı) · incelenecek (amber); aynı finans hedefleri. */
async function AccountingStatus({ ctx, nowMs }: { ctx: HomeCtx; nowMs: number }) {
  const m = await loadMoneySummary(ctx).catch(() => null);
  const chips: StatusChip[] = [];
  if ((m?.overdueCount ?? 0) > 0) chips.push({ key: "vade", label: `${m!.overdueCount!.toLocaleString("tr-TR")} vadesi geçen`, href: financeHref("cari", { gorunum: "acik", kova: "gecikmis" }), tone: "danger" });
  if ((m?.reviewCount ?? 0) > 0) chips.push({ key: "incele", label: `${m!.reviewCount!.toLocaleString("tr-TR")} incelenecek`, href: financeHref("kasa-banka"), tone: "warn" });
  return <StatusChips fresh={freshChip(nowMs)} chips={chips} />;
}

/** Kahraman fotoğrafı akışı: ofisin yayındaki portföy kapağı (seçilmiş fotoğraf yoksa); yoksa çizim kalır. */
async function HeroPhotoStream({ ctx }: { ctx: HomeCtx }) {
  const p = await loadHeroPhoto(ctx).catch(() => null);
  return p ? <HeroPhoto photo={{ src: p.src, width: 1280, height: 520, title: p.title, focus: "60% 55%" }} /> : null;
}

const n = (v: number) => v.toLocaleString("tr-TR");

/**
 * OFİS DURUMU (yönetim): Portal teyidi bekleyen ilan · Aktif kullanıcı n/m (bugün aktif) · Bugünkü görevler (gecikmiş) ·
 * İlan sağlığı %. Başlıktaki durum: gecikmiş görev ve teyit bekleyen ilan yoksa "Her şey yolunda" (nabızlı yeşil).
 */
async function StatusStream({ ctx }: { ctx: HomeCtx }) {
  const [s, team] = await Promise.all([loadOfficeStatus(ctx), loadTeamToday(ctx).catch(() => null)]);
  const tiles: StatusTile[] = [];
  if (s.liveListings != null)
    tiles.push({
      key: "teyit",
      icon: FileClock,
      tone: "gold",
      label: "Portal teyidi bekleyen ilan",
      value: n(s.overdueListings),
      chip: { text: `${n(s.liveListings)} yayında`, tone: "neutral" },
      href: "/app/ilan-kontrol",
    });
  if (s.activeUsers != null)
    tiles.push({
      key: "kullanici",
      icon: Users,
      tone: "sky",
      label: "Aktif kullanıcı",
      value: n(s.activeUsers),
      unit: s.seatLimit ? ` / ${n(s.seatLimit)}` : undefined,
      chip: team ? { text: `${n(team.total)} bugün aktif`, tone: team.total > 0 ? "success" : "neutral" } : null,
      href: "/app/ekip",
    });
  if (s.tasksToday)
    tiles.push({
      key: "gorev",
      icon: SquareCheckBig,
      tone: "violet",
      label: ctx.scopeMine ? "Bugünkü görevlerim" : "Bugün görevler",
      value: n(s.tasksToday.dueToday),
      chip: s.tasksToday.overdue > 0 ? { text: `${n(s.tasksToday.overdue)} gecikmiş`, tone: "danger" } : { text: "Gecikme yok", tone: "success" },
      href: s.tasksToday.overdue > 0 ? `/app/gorevler?filter=overdue${ctx.scopeMine ? "&mine=1" : ""}` : `/app/gorevler?filter=today${ctx.scopeMine ? "&mine=1" : ""}`,
    });
  if (s.healthPct != null)
    tiles.push({
      key: "saglik",
      icon: Activity,
      tone: "mint",
      label: "İlan teyit sağlığı",
      value: `%${s.healthPct}`,
      chip: s.overdueListings === 0 ? { text: "Tüm ilanlar güncel", tone: "success" } : { text: `${n(s.overdueListings)} ilan bekliyor`, tone: "warn" },
      href: "/app/ilan-kontrol",
    });
  const ok = s.overdueListings === 0 && (s.tasksToday?.overdue ?? 0) === 0;
  return <OfficeStatusPanel title="Ofis durumu" health={{ ok, label: ok ? "Her şey yolunda" : "İlgi bekleyen var", href: ok ? "/app/ilan-kontrol" : "#dikkat" }} tiles={tiles.slice(0, 4)} />;
}

/** GÜNÜM (danışman / takım lideri): bugünkü randevularım · görevlerim (gecikmiş) · bu ay kazancım · yeni talepler. */
async function MyDayStream({ ctx }: { ctx: HomeCtx }) {
  const [s, k] = await Promise.all([loadOfficeStatus(ctx), loadKpiData(ctx)]);
  const tiles: StatusTile[] = [];
  if (s.todayAppointments != null)
    tiles.push({ key: "randevu", icon: CalendarDays, tone: "sky", label: "Bugünkü randevularım", value: n(s.todayAppointments), chip: s.todayAppointments === 0 ? { text: "Program boş", tone: "neutral" } : null, href: "/app/randevular?gorunum=rota&gun=bugun" });
  if (s.tasksToday)
    tiles.push({
      key: "gorev",
      icon: SquareCheckBig,
      tone: "violet",
      label: "Bugünkü görevlerim",
      value: n(s.tasksToday.dueToday),
      chip: s.tasksToday.overdue > 0 ? { text: `${n(s.tasksToday.overdue)} gecikmiş`, tone: "danger" } : { text: "Gecikme yok", tone: "success" },
      href: s.tasksToday.overdue > 0 ? "/app/gorevler?filter=overdue&mine=1" : "/app/gorevler?filter=today&mine=1",
    });
  if (k.revenue) tiles.push({ key: "kazanc", icon: Coins, tone: "gold", label: "Kazancım · bu ay", value: moneyTry(k.revenue.thisMonth), chip: null, href: earningsPath() });
  if (s.newDemands != null) tiles.push({ key: "talep", icon: Target, tone: "mint", label: "Yeni talep", value: n(s.newDemands), chip: null, href: "/app/talepler?status=new" });
  const ok = (s.tasksToday?.overdue ?? 0) === 0;
  return <OfficeStatusPanel title="Günüm" health={{ ok, label: ok ? "Her şey yolunda" : "Geciken işin var", href: ok ? "/app/gorevler?mine=1" : "/app/gorevler?filter=overdue&mine=1" }} tiles={tiles.slice(0, 4)} />;
}

/** FİNANS DURUMU (muhasebe): kasa · açık alacak · vadesi geçen · incelenecek (finans genel bakışla aynı RPC ve hedefler). */
async function FinanceStatusStream({ ctx }: { ctx: HomeCtx }) {
  const m = await loadMoneySummary(ctx).catch(() => null);
  if (!m || m.cash === null) return null;
  const overdue = m.overdueCount ?? 0;
  const review = m.reviewCount ?? 0;
  const tiles: StatusTile[] = [
    { key: "kasa", icon: Landmark, tone: "gold", label: "Kasa ve banka", value: moneyTry(m.cash), chip: null, href: financeHref("kasa-banka") },
    ...(m.receivable != null ? [{ key: "alacak", icon: Scale, tone: "sky" as Tone, label: "Açık alacak", value: moneyTry(m.receivable), chip: null, href: financeHref("cari", { gorunum: "acik" }) }] : []),
    { key: "vade", icon: AlertTriangle, tone: "rose", label: "Vadesi geçen", value: n(overdue), chip: overdue > 0 ? { text: "Tahsil/ödeme bekliyor", tone: "danger" } : { text: "Gecikme yok", tone: "success" }, href: financeHref("cari", { gorunum: "acik", kova: "gecikmis" }) },
    { key: "incele", icon: Inbox, tone: "violet", label: "İncelenecek", value: n(review), chip: review > 0 ? { text: "Ekstre ve fiş", tone: "warn" } : { text: "Hepsi işlendi", tone: "success" }, href: financeHref("kasa-banka") },
  ];
  const ok = overdue === 0;
  return <OfficeStatusPanel title="Finans durumu" health={{ ok, label: ok ? "Her şey yolunda" : "Vadesi geçen var", href: financeHref("cari", { gorunum: "acik", kova: "gecikmis" }) }} tiles={tiles} />;
}

function StatusSkeleton() {
  return (
    <div className="kh-status kh-skel" aria-hidden="true">
      <span className="skeleton block h-6 w-40 rounded-md opacity-40" />
      <div className="kh-status-grid mt-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <span key={i} className="kh-tile skeleton opacity-30" />
        ))}
      </div>
    </div>
  );
}

const HERO_THEME: Record<HomeLayout["variant"], HeroPhotoTheme> = {
  management: "hero-villa-dusk",
  advisor: "hero-advisor",
  team_lead: "hero-advisor",
  accounting: "hero-accounting",
  call_center: "hero-advisor",
};

export function HeroBlock({
  ctx,
  layout,
  params,
  officeView,
  off,
  name,
}: {
  ctx: HomeCtx;
  layout: HomeLayout;
  params: HomeParams;
  officeView: boolean;
  off: (k: string) => boolean;
  /** Selamdaki ad (`greetingName`: ad soyad → e-posta → rol unvanı). */
  name: string | null;
}) {
  const nowMs = now();
  const p = trParts(nowMs);
  const { primary, more } = heroActions(ctx, off, layout.variant);
  const accessible = (Object.keys(ctx.perms) as (keyof HomeCtx["perms"])[]).filter((m) => (ctx.perms[m] ?? []).includes("view"));
  const creatable = accessible.filter((m) => (ctx.perms[m] ?? []).includes("create"));
  const chips = neYapmakChips(layout.variant, ctx.role === "owner", { accessible, creatable }).slice(0, 3);
  const accounting = layout.variant === "accounting";
  const sumFallback = <span className="kh-sum-skel">Günün özeti hazırlanıyor…</span>;
  const statusFallback = <StatusChips fresh={freshChip(nowMs)} chips={[]} />;
  // Sağ panel rol bazlı: yönetim "Ofis durumu", danışman "Günüm", muhasebe "Finans durumu"; arama merkezinde yok.
  const aside =
    layout.variant === "management" ? (
      <StatusStream ctx={ctx} />
    ) : layout.variant === "advisor" || layout.variant === "team_lead" ? (
      <MyDayStream ctx={ctx} />
    ) : accounting ? (
      <FinanceStatusStream ctx={ctx} />
    ) : null;
  const curated = getHeroPhoto(HERO_THEME[layout.variant], { scene: sceneOf(p.hour) });
  return (
    <KurumsalHero
      dateText={longDate(nowMs)}
      greeting={timeGreeting(p.hour)}
      name={name}
      scene={sceneOf(p.hour)}
      summary={<Suspense fallback={sumFallback}>{accounting ? <AccountingSummary ctx={ctx} /> : <HeroSummary ctx={ctx} />}</Suspense>}
      status={
        layout.variant === "call_center" ? (
          statusFallback
        ) : (
          <Suspense fallback={statusFallback}>{accounting ? <AccountingStatus ctx={ctx} nowMs={nowMs} /> : <HeroStatus ctx={ctx} nowMs={nowMs} />}</Suspense>
        )
      }
      search={<HeroArama chips={chips} />}
      actions={primary}
      moreActions={more}
      scope={
        layout.scopeSwitch ? (
          <ScopeSwitch
            label="Ana ekran kapsamı"
            quietHint
            value={officeView ? "ofis" : "ben"}
            office={{ href: homeHref(params, { kapsam: "ofis" }), hint: "Ofisin tüm danışmanları ve kayıtları" }}
            mine={{ href: homeHref(params, { kapsam: "ben" }), hint: "Yalnız size atanmış kayıtlar" }}
          />
        ) : null
      }
      aside={aside ? <Suspense fallback={<StatusSkeleton />}>{aside}</Suspense> : null}
      photo={
        curated ? (
          <HeroPhoto photo={curated} />
        ) : (
          <Suspense fallback={null}>
            <HeroPhotoStream ctx={ctx} />
          </Suspense>
        )
      }
    />
  );
}

/* ================================ KPI SATIRI ================================ */

export function KpiRowSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="kh-kpis" data-count={count}>
      {Array.from({ length: count }).map((_, i) => (
        <KpiSkeleton key={i} />
      ))}
    </div>
  );
}

/**
 * KPI SATIRI (v4): Bu ay ciro · Aktif anlaşma · Yeni talep · Yeni müşteri · Gelen arama. Her kartta bu ay ↔ geçen ayın eş
 * dönemi değişimi ve son 12 haftanın mini çubukları (ciroda son 6 ay). Kapsam: danışmanda / "Benim işlerim"de kişisel.
 */
export async function KpiRow({ ctx }: { ctx: HomeCtx }) {
  const k = await loadKpiData(ctx);
  const targetHref = can(ctx, "targets") ? "/app/hedefler" : null;
  const mine = ctx.scopeMine;
  const { from, to } = { from: ctx.monthStartKey, to: trDayKey(now()) };
  const cards: { key: string; node: React.ReactNode }[] = [];
  const weeks = "Son 12 hafta";
  if (k.revenue) {
    const title = ctx.isManagement && !mine ? "Bu ay ciro" : "Kazancım (bu ay)";
    const value = moneyTry(k.revenue.thisMonth);
    cards.push({
      key: "ciro",
      node: (
        <KpiCard
          title={title}
          value={value}
          href={mine && !ctx.isManagement ? earningsPath() : financePath("komisyon")}
          icon={KPI_ICONS.revenue}
          tone="gold"
          delta={deltaOf(k.revenue.thisMonth, k.revenue.prevMonth)}
          spark={<Spark values={k.revenue.monthly} tone="gold" label="Son 6 ay aylık komisyon" />}
          menu={<KpiMenu reportHref={financePath("raporlar")} targetHref={targetHref} copyText={`${title}: ${value}`} />}
        />
      ),
    });
  }
  if (k.deals) {
    const value = n(k.deals.open);
    const title = mine ? "Aktif anlaşmam" : "Aktif anlaşma";
    cards.push({
      key: "anlasma",
      node: (
        <KpiCard
          title={title}
          value={value}
          href={mine ? `/app/anlasmalar?danisman=${ctx.userId}` : "/app/anlasmalar"}
          icon={KPI_ICONS.deals}
          tone="brand"
          delta={deltaOf(k.deals.thisMonth, k.deals.prevMonth)}
          caption={k.deals.thisMonth > 0 ? `Bu ay ${n(k.deals.thisMonth)} yeni` : undefined}
          spark={<Spark values={k.deals.weekly} tone="brand" label={`${weeks} açılan anlaşma`} />}
          menu={<KpiMenu reportHref="/app/raporlar/huni" targetHref={targetHref} copyText={`${title}: ${value}`} />}
        />
      ),
    });
  }
  if (k.demands) {
    const value = n(k.demands.thisMonth);
    cards.push({
      key: "talep",
      node: (
        <KpiCard
          title="Yeni talep"
          value={value}
          href={`/app/talepler?eklenen=30${mine ? `&danisman=${ctx.userId}` : ""}`}
          icon={KPI_ICONS.demands}
          tone="pink"
          delta={deltaOf(k.demands.thisMonth, k.demands.prevMonth)}
          deltaContext="önceki 30 güne göre"
          caption="Son 30 gün"
          spark={<Spark values={k.demands.weekly} tone="pink" label={`${weeks} yeni talep`} />}
          menu={<KpiMenu reportHref="/app/raporlar/talep-arz" copyText={`Yeni talep (30 gün): ${value}`} />}
        />
      ),
    });
  }
  if (k.customers) {
    const value = n(k.customers.thisMonth);
    cards.push({
      key: "musteri",
      node: (
        <KpiCard
          title="Yeni müşteri"
          value={value}
          href={`/app/musteriler?from=${from}&to=${to}${mine ? `&assigned=${ctx.userId}` : ""}`}
          icon={KPI_ICONS.customers}
          tone="mint"
          delta={deltaOf(k.customers.thisMonth, k.customers.prevMonth)}
          spark={<Spark values={k.customers.weekly} tone="mint" label={`${weeks} yeni müşteri`} />}
          menu={<KpiMenu reportHref="/app/raporlar/huni" copyText={`Yeni müşteri (bu ay): ${value}`} />}
        />
      ),
    });
  }
  if (k.calls) {
    const value = n(k.calls.thisMonth);
    cards.push({
      key: "arama",
      node: (
        <KpiCard
          title={mine ? "Gelen aramam" : "Gelen arama"}
          value={value}
          href={`/app/gelen-kutusu?sekme=cagri&yon=inbound&from=${from}&to=${to}`}
          icon={KPI_ICONS.calls}
          tone="sky"
          delta={deltaOf(k.calls.thisMonth, k.calls.prevMonth)}
          spark={<Spark values={k.calls.weekly} tone="sky" label={`${weeks} gelen arama`} />}
          menu={<KpiMenu reportHref="/app/raporlar" copyText={`Gelen arama (bu ay): ${value}`} />}
        />
      ),
    });
  }
  if (cards.length === 0) return null;
  return (
    <div className="kh-kpis" data-count={cards.length} role="list" aria-label="Bu ayın göstergeleri">
      {cards.map((c) => (
        <div key={c.key} className="kh-kpi-cell" role="listitem">
          {c.node}
        </div>
      ))}
    </div>
  );
}

/* ================================ DİKKAT · KURULUM · EKİP ================================ */

const ATTN_UNIT: Record<string, string> = { tahsilat: "kira", gorev: "görev", onay: "onay", "riskli-anlasma": "anlaşma", pasif: "danışman" };

/** DİKKAT GEREKTİRENLER (ilk ekran): `loadAttention` kalemleri; en çok `max` satır, fazlası "Tümünü gör" ile (`?dikkat=tum`). */
export async function AttentionBlock({ ctx, params, max = 5 }: { ctx: HomeCtx; params: HomeParams; max?: number }) {
  const items = await loadAttention(ctx).catch(() => []);
  const all = params.dikkat === "tum";
  const shown = all ? items : items.slice(0, max);
  return (
    <AttentionPanel
      total={items.length}
      allHref={items.length > max ? homeHref(params, { dikkat: all ? undefined : "tum" }) : null}
      rows={shown.map((i) => ({
        id: i.id,
        label: i.label,
        hint: i.hint,
        href: i.href,
        level: i.level,
        meta: typeof i.count === "number" ? `${n(i.count)} ${ATTN_UNIT[i.id] ?? "kalem"}` : null,
      }))}
    />
  );
}

/**
 * Kurulum %100 olunca aynı yeri alan OFİS HEDEFİ / KİŞİSEL HEDEF halkası: bu ayın komisyon hedefine gerçekleşme (tempo:
 * `targetPace`, /app/hedefler ile aynı kural). Komisyon görme yetkisi yoksa çizilmez.
 */
export async function GoalBlock({ ctx }: { ctx: HomeCtx }) {
  if (!ctx.canSeeCommissions) return null;
  const personal = !ctx.isManagement || ctx.scopeMine;
  const [target, commission] = await Promise.all([(personal ? loadMyTarget(ctx) : loadOfficeTarget(ctx)).catch(() => null), loadCommissionSummary(ctx).catch(() => null)]);
  const actual = commission?.monthTotals.at(-1) ?? 0;
  const tRev = Number(target?.target_revenue ?? 0);
  const { elapsedPct, daysLeft } = monthProgress(now());
  const pace = targetPace({ actual, target: tRev, elapsedPct, daysLeft });
  return (
    <GoalCard
      title={personal ? "Kişisel hedefim" : "Ofis hedefi"}
      pct={pace ? Math.min(100, pace.pct) : null}
      actualText={pace ? moneyTry(actual) : null}
      targetText={pace ? moneyTry(tRev) : null}
      paceText={pace ? (pace.state === "exceeded" ? "Hedef aşıldı" : `Gerekli hız ${moneyTry(pace.requiredPerDay)}/gün · ${pace.daysLeft} gün kaldı`) : null}
      href="/app/hedefler"
      canSet={can(ctx, "targets")}
      photo={getHeroPhoto("setup-villa")}
    />
  );
}

/** BUGÜN OFİSTE OLANLAR (yönetim): bugünkü denetim kayıtlarından ekip + son faaliyet. */
export async function TeamTodayBlock({ ctx }: { ctx: HomeCtx }) {
  const team = await loadTeamToday(ctx).catch(() => null);
  if (!team) return null;
  return <TeamToday people={team.people.slice(0, 8)} total={team.total} allHref={`/app/ofis-kontrol?from=${trDayKey(now())}&to=${trDayKey(now())}`} />;
}

/* ================================ SATIŞ PERFORMANSI ================================ */

export async function SalesBlock({ ctx, range, filter, params }: { ctx: HomeCtx; range: SalesRange; filter: SalesFilter; params: HomeParams }) {
  const data = await loadSalesPerformance(ctx, range, filter);
  if (!data) return null;
  const href = (patch: Partial<HomeParams>) => homeHref(params, patch);
  const advisorName = filter.danisman ? data.advisors.find((a) => a.id === filter.danisman)?.name : null;
  const filterLabel = advisorName ?? (filter.tur === "satilik" ? "Satılık portföyler" : filter.tur === "kiralik" ? "Kiralık portföyler" : "Tüm portföyler");
  return (
    <SalesPerformance
      range={range}
      rangeHref={(r) => href({ satis: r === "ay" ? undefined : r })}
      total={moneyTry(data.summary.total)}
      totalDelta={data.summary.totalDelta}
      count={data.summary.count}
      countDelta={data.summary.countDelta}
      avgDays={data.summary.avgDays}
      avgNote={data.summary.avgNote}
      avgDelta={data.summary.avgDelta}
      series={data.series}
      filterLabel={filterLabel}
      filters={[
        { href: href({ tur: undefined }), label: "Tüm portföyler", active: !filter.tur },
        { href: href({ tur: "satilik" }), label: "Satılık", active: filter.tur === "satilik" },
        { href: href({ tur: "kiralik" }), label: "Kiralık", active: filter.tur === "kiralik" },
      ]}
      advisorFilters={
        data.advisors.length > 1
          ? [{ href: href({ danisman: undefined }), label: "Tüm danışmanlar", active: !filter.danisman }, ...data.advisors.map((a) => ({ href: href({ danisman: a.id }), label: a.name, active: filter.danisman === a.id }))]
          : []
      }
      href="/app/anlasmalar?asama=won"
    />
  );
}

/* ================================ RANDEVU / İLAN / GÖREV ================================ */

type Rel<T> = T | T[] | null | undefined;
const one = <T,>(r: Rel<T>): T | null => (Array.isArray(r) ? (r[0] ?? null) : (r ?? null));

export async function TimelineBlock({ ctx }: { ctx: HomeCtx }) {
  if (!can(ctx, "appointments")) return null;
  const { rows, total } = await loadTodayAppointments(ctx);
  const nowMs = now();
  const stops = rows.map((a) => {
    const prop = one(a.property as Rel<{ lat?: number | null; lng?: number | null }>);
    return { lat: prop?.lat ?? null, lng: prop?.lng ?? null, location: a.location };
  });
  return (
    <Timeline
      total={total}
      title={ctx.scopeMine ? "Bugünkü programım" : "Bugünün programı"}
      routeHref="/app/randevular?gorunum=rota&gun=bugun"
      mapsRouteHref={routeDirectionsHref(stops)}
      emptyAction={can(ctx, "appointments", "create") ? { href: "/app/randevular/yeni", label: "Randevu ekle" } : undefined}
      rows={rows.map((a) => {
        const cust = one(a.customer as Rel<{ full_name?: string | null }>);
        const prop = one(a.property as Rel<{ lat?: number | null; lng?: number | null }>);
        return {
          id: a.id,
          time: formatTrTime(a.scheduled_at),
          type: appointmentTypeLabel(a.appointment_type) || "Randevu",
          typeKey: a.appointment_type,
          customer: cust?.full_name?.trim() || "Müşteri seçilmedi",
          place: a.location?.trim() || null,
          status: apptStatus(a.status, a.scheduled_at, nowMs),
          href: appointmentHref(a.id),
          directions: directionsHref({ lat: prop?.lat ?? null, lng: prop?.lng ?? null, location: a.location }),
        };
      })}
    />
  );
}

export async function ListingsBlock({ ctx, scope }: { ctx: HomeCtx; scope: string }) {
  const cards = await loadRecentListings(ctx, 4);
  if (!cards) return null;
  // Kapak zinciri: ilan kapağı → ofisin vitrin kapağı (yayındaki portföy fotoğrafı; istek-içi önbellek, kahramanla aynı) → çizim.
  const fallback = cards.some((c) => !c.coverSrc) ? await loadHeroPhoto(ctx).catch(() => null) : null;
  return <RecentListings cards={cards} scope={scope} fallbackSrc={fallback?.cardSrc ?? null} newHref={can(ctx, "properties", "create") ? "/app/portfoyler/yeni" : null} />;
}

export async function TasksBlock({ ctx }: { ctx: HomeCtx }) {
  const tasks = await loadUpcomingTasks(ctx, 6);
  if (!tasks) return null;
  const nowMs = now();
  return (
    <TaskList
      canComplete={can(ctx, "tasks", "create") || (ctx.perms.tasks ?? []).includes("edit")}
      newHref={can(ctx, "tasks", "create") ? "/app/gorevler/yeni" : null}
      rows={tasks.map((t) => ({ id: t.id, title: t.title, href: taskHref(t.id), due: dueChip(t.dueAt, nowMs), high: t.high, assignee: ctx.scopeMine ? null : t.assignee }))}
    />
  );
}

export { CardSkeleton };

/* ================================ MUHASEBE KPI ================================ */

/**
 * Muhasebe KPI satırı (v4): Bu ay giriş · Bu ay çıkış · Bu ay net · Bu ay komisyon — finans genel bakışla AYNI kaynak
 * (`finance_overview` RPC, `loadMoneySummary`) ve aynı hedefler. Kasa / alacak / vadesi geçen / incelenecek kahramandaki
 * "Finans durumu" panelindedir (aynı sayı iki yerde yok). Okunamayan kalem çizilmez (sahte 0 yok).
 */
export async function AccountingKpiRow({ ctx }: { ctx: HomeCtx }) {
  const m = await loadMoneySummary(ctx).catch(() => null);
  if (!m || m.cash === null) return null;
  const inT = m.monthIn ?? 0;
  const outT = m.monthOut ?? 0;
  const net = inT - outT;
  const month = { from: m.monthFrom, to: m.today };
  const cards = [
    { key: "giris", node: <KpiCard title="Bu ay giriş" value={moneyTry(inT)} href={financeHref("hareketler", { ...month, tur: "gelir" })} icon={ReceiptText} tone="mint" caption="Tahsilat ve diğer gelirler" /> },
    { key: "cikis", node: <KpiCard title="Bu ay çıkış" value={moneyTry(outT)} href={financeHref("hareketler", { ...month, tur: "gider" })} icon={Wallet} tone="rose" caption="Gider ve ödemeler" /> },
    {
      key: "net",
      node: <KpiCard title="Bu ay net" value={`${net < 0 ? "−" : ""}${moneyTry(Math.abs(net))}`} href={financeHref("hareketler", month)} icon={Scale} tone={net >= 0 ? "brand" : "rose"} caption={net >= 0 ? "Giriş çıkıştan fazla" : "Çıkış girişten fazla"} />,
    },
    ...(m.commissionMonth != null
      ? [{ key: "komisyon", node: <KpiCard title="Bu ay komisyon" value={moneyTry(m.commissionMonth)} href={financePath("komisyon")} icon={Coins} tone="gold" caption="Tahakkuk eden komisyon" /> }]
      : []),
  ];
  return (
    <div className="kh-kpis" data-count={cards.length} role="list" aria-label="Bu ayın finans göstergeleri">
      {cards.map((c) => (
        <div key={c.key} className="kh-kpi-cell" role="listitem">
          {c.node}
        </div>
      ))}
    </div>
  );
}
