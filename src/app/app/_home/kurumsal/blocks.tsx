import { Suspense } from "react";
import {
  Activity,
  AlertTriangle,
  CalendarDays,
  CalendarPlus,
  ClipboardList,
  DatabaseBackup,
  RefreshCw,
  ServerCog,
  Coins,
  FileSignature,
  FileText,
  Handshake,
  Home,
  Inbox,
  Landmark,
  ListPlus,
  Phone,
  PhoneIncoming,
  ReceiptText,
  Scale,
  SquareCheckBig,
  Target,
  UserPlus,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { DataFreshness } from "@/components/ui/data-freshness";
import { KiraIcon, KomisyonIcon, PortalTeyitIcon, SistemSagligiIcon } from "@/components/ui/icons/brand-icons";
import { loadCallbackCount, loadCallPanelTiles, loadFinancePanelTiles, loadMissedCallsToday, loadMyDayTiles, loadRoleAttentionExtras, loadRoleKpis, loadTeamDayCounts, loadTeamPanelTiles, type KpiCardSpec, type PanelTileData } from "./role-data";
import { entryHref } from "@/lib/finance/entry-workspace";
import { financeHref } from "@/lib/finance/routes";
import { ScopeSwitch } from "@/components/ui/scope-switch";
import { DAY_MS, formatTrTime, now, trDayKey, trParts } from "@/lib/clock";
import { moneyTry } from "@/lib/leak-shield";
import { appointmentTypeLabel } from "@/lib/appointment-labels";
import { appointmentHref, taskHref } from "@/lib/notification-text";
import { directionsHref, routeDirectionsHref } from "@/lib/route-plan";
import { getHeroPhoto, type HeroPhotoTheme } from "@/lib/media/hero-photo-source";
import { loadAttention, loadCommissionSummary, loadKpiCounts, loadMoneySummary, loadMyTarget, loadOfficeTarget, loadTaskSummary, loadTodayAppointments, type HomeCtx } from "../data";
import { timeGreeting } from "@/lib/greeting-name";
import { monthProgress } from "../home-metrics";
import { homeHref, type HomeParams } from "../kapsam-anahtari";
import type { HomeLayout } from "../home-layout";
import { OVERALL_LABEL } from "@/lib/status-page/model";
import { activityStatus, apptStatus, backupHealthy, backupWhen, roleHomePlan, roleSentenceParts, type RoleKpiKey, attentionAge, attentionMore, buildGoalView, rankAttentionRecords, dueChip, heroSentenceParts, heroStatusCounts, longDate, postSetupKind, sceneOf, type SalesFilter, type SalesRange } from "./core";
import { neYapmakChips } from "../ne-yapmak-chips";
import { HeroArama } from "./hero-arama";
import { presenceTimeLabel } from "@/lib/presence";
import { loadAttentionRecords, loadHeroPhoto, loadOfficeStatus, loadRecentListings, loadSalesPerformance, loadServiceStatus, loadTeamToday, type ServiceStatus, loadTopContributor, loadUpcomingTasks, loadWonDealsThisMonth } from "./data";
import { buildMonthCloseChecklist, monthNameTr, previousMonthKey } from "@/lib/finance/month-close";
import { loadMonthCloseSignals } from "@/lib/finance/insights-load";
import { canHandleSalary } from "@/lib/finance/cash/categories";
import { insightLinks, monthRange } from "../../finans/(merkez)/_tabs/insight-links";
import {
  AttentionPanel,
  MonthCloseHomeCard,
  OfficeGoalCard,
  PersonalGoalCard,
  type GoalCardView,
  HeroPhoto,
  KPI_ICONS,
  KpiCard,
  KpiMenu,
  KurumsalHero,
  OfficeStatusPanel,
  SalesPerformance,
  SentenceText,
  Spark,
  StatusChips,
  TeamToday,
  Timeline,
  type HeroAction,
  type StatusChip,
  type StatusFootTile,
  type StatusTile,
  type Tone,
} from "./views";
import { RecentListings, TaskList } from "./views-lists";

const can = (ctx: HomeCtx, mod: keyof HomeCtx["perms"], action: "view" | "create" | "edit" = "view") => (ctx.perms[mod] ?? []).includes(action);

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
        { href: entryHref({ tab: "gelir" }), label: "Gelir ekle", icon: ReceiptText, primary: true, ok: fin },
        { href: entryHref({ tab: "gider" }), label: "Gider ekle", icon: Wallet, ok: fin },
        { href: financeHref("tahsilat"), label: "Tahsilat", icon: Landmark, ok: can(ctx, "commissions") },
        { href: financeHref("cari", { gorunum: "acik" }), label: "Alacak ve borç", icon: Scale, ok: can(ctx, "expenses") },
        { href: entryHref({ tab: "belge" }), label: "Fatura / belge", icon: FileText, ok: fin },
      ];
      break;
    }
    case "call_center":
      all = [
        { href: "/app/gelen-kutusu?sekme=cagri", label: "Arama kaydet", icon: Phone, primary: true, ok: can(ctx, "calls", "create") },
        { ...newDemand, label: "Talep ekle" },
        newCustomer,
        newAppt,
        { href: "/app/arama-listesi", label: "Arama listesi", icon: Phone, ok: can(ctx, "customers") },
        newTask,
      ];
      break;
    case "advisor":
    case "team_lead":
      all = [{ ...newAppt, primary: true }, newCustomer, newListing, newTask, newDemand, newDeal, newOffer, newContract];
      break;
    default:
      all = [{ ...newListing, primary: true }, newCustomer, newAppt, newTask, newDemand, newDeal, newOffer, newContract];
  }
  const ok = all.filter((a) => a.ok).map(({ ok: _ok, ...a }) => a);
  // Birincil yoksa (ör. portföy ekleme yetkisi yok) ilk eylem birincil olur.
  if (ok.length > 0 && !ok.some((a) => a.primary)) ok[0] = { ...ok[0]!, primary: true };
  return { primary: ok.slice(0, 4), more: ok.slice(4) };
}

/** Rolün ana ekran planı (KPI seti, sağ panel, Dikkat kategorileri): tek karar `roleHomePlan` (core.ts). */
export function planOf(ctx: HomeCtx) {
  return roleHomePlan(ctx.role, (m) => (ctx.perms[m as keyof HomeCtx["perms"]] ?? []).includes("view"), { scopeMine: ctx.isManagement && ctx.scopeMine });
}

/** Rol bazlı özet cümlesi (`roleSentenceParts`): yönetim ofisin günü, takım lideri ekibi, danışman kendi günü, çağrı kuyruğu. */
async function HeroSummary({ ctx }: { ctx: HomeCtx }) {
  const persona = planOf(ctx).persona;
  if (persona === "ofis-yonetimi" || persona === "sube-operasyonu") {
    const s = await loadOfficeStatus(ctx);
    return <SentenceText parts={heroSentenceParts({ appointments: s.todayAppointments, demands: s.newDemands, listingUpdates: s.overdueListings || null, mine: ctx.scopeMine })} />;
  }
  const can = (m: keyof HomeCtx["perms"]) => (ctx.perms[m] ?? []).includes("view");
  if (persona === "takim-lideri") {
    const [t, cb] = await Promise.all([loadTeamDayCounts(ctx).catch(() => null), loadCallbackCount(ctx).catch(() => null)]);
    if (t?.personal) {
      const tasks = can("tasks") ? await loadTaskSummary(ctx).catch(() => null) : null;
      return <SentenceText parts={roleSentenceParts("danisman", { appointments: t.appointments, tasksDue: tasks?.dueToday ?? null, callbacks: cb })} />;
    }
    return <SentenceText parts={roleSentenceParts(persona, { appointments: t?.appointments, overdueTasks: t?.overdue, callbacks: cb })} />;
  }
  if (persona === "cagri-merkezi") {
    const [k, missed, cb] = await Promise.all([can("calls") ? loadKpiCounts(ctx).catch(() => null) : Promise.resolve(null), loadMissedCallsToday(ctx).catch(() => null), loadCallbackCount(ctx).catch(() => null)]);
    return <SentenceText parts={roleSentenceParts(persona, { callsToday: k?.callsToday ?? null, missedCalls: missed, callbacks: cb })} />;
  }
  const [appts, tasks, cb] = await Promise.all([
    can("appointments") ? loadTodayAppointments(ctx).catch(() => null) : Promise.resolve(null),
    can("tasks") ? loadTaskSummary(ctx).catch(() => null) : Promise.resolve(null),
    loadCallbackCount(ctx).catch(() => null),
  ]);
  return <SentenceText parts={roleSentenceParts("danisman", { appointments: appts?.total ?? null, tasksDue: tasks?.dueToday ?? null, callbacks: cb })} />;
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
 * OFİS DURUMU (yönetim, v5): Portal teyit bekleyen ilan (+N: son 24 saatte süresi dolan) · Aktif kullanıcı n/m (bugün
 * aktif; çevrimiçi/oturum kaydı tutulmadığı için "çevrimiçi" iddiası yok) · Bugünkü görev (gecikmiş) · Ofis sağlık skoru
 * (kabuktaki "Skor 78" ile aynı kaynak; okunamazsa İlan teyit sağlığı %). Başlıktaki durum: gecikmiş görev ve teyit
 * bekleyen ilan yoksa "Her şey yolunda" (nabızlı yeşil), varsa "İlgi bekleyen var" (amber, Dikkat listesine).
 */
async function StatusStream({ ctx }: { ctx: HomeCtx }) {
  const [s, team, svc] = await Promise.all([loadOfficeStatus(ctx), loadTeamToday(ctx).catch(() => null), loadServiceStatus().catch(() => null)]);
  const tiles: StatusTile[] = [];
  if (s.liveListings != null)
    tiles.push({
      key: "teyit",
      icon: PortalTeyitIcon,
      tone: "gold",
      // F8: kısa etiket (karoda kesilmez); tam ad ipucunda.
      label: "Teyit bekleyen",
      title: "Portal teyit bekleyen ilan",
      value: n(s.overdueListings),
      chip: s.newOverdueListings > 0 ? { text: `+${n(s.newOverdueListings)}`, tone: "warn", title: `Son 24 saatte ${n(s.newOverdueListings)} ilanın teyit süresi doldu` } : { text: `${n(s.liveListings)} yayında`, tone: "neutral" },
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
      chip: team ? { text: `${n(team.total)} bugün aktif`, tone: team.total > 0 ? "success" : "neutral", dot: team.total > 0 } : null,
      href: "/app/ekip",
    });
  if (s.tasksToday)
    tiles.push({
      key: "gorev",
      icon: SquareCheckBig,
      tone: "violet",
      label: ctx.scopeMine ? "Bugünkü görevim" : "Bugünkü görev",
      value: n(s.tasksToday.dueToday),
      chip: s.tasksToday.overdue > 0 ? { text: `${n(s.tasksToday.overdue)} gecikmiş`, tone: "danger" } : { text: "Gecikme yok", tone: "success" },
      href: s.tasksToday.overdue > 0 ? `/app/gorevler?filter=overdue${ctx.scopeMine ? "&mine=1" : ""}` : `/app/gorevler?filter=today${ctx.scopeMine ? "&mine=1" : ""}`,
    });
  if (s.score)
    tiles.push({
      key: "skor",
      icon: SistemSagligiIcon,
      tone: s.score.score >= 60 ? "mint" : s.score.score >= 40 ? "gold" : "rose",
      label: "Ofis sağlık skoru",
      value: n(s.score.score),
      unit: " / 100",
      chip: { text: s.score.label, tone: s.score.score >= 60 ? "success" : s.score.score >= 40 ? "warn" : "danger" },
      title: "Kural tabanlı ofis skoru: açık talepler, canlı portal ilanları, son 7 günün randevu ve aramaları ile son 30 günün kapanışları puan ekler; gecikmiş portal teyitleri puan düşürür.",
      href: "/app/ilan-kontrol",
    });
  else if (s.healthPct != null)
    tiles.push({
      key: "saglik",
      icon: SistemSagligiIcon,
      tone: "mint",
      label: "İlan teyit sağlığı",
      // Hiç teyitli ilan yokken "%0" bozuk görünüyordu: değer "—", hap kaç ilanın beklediğini söyler.
      value: s.healthPct === 0 && s.overdueListings > 0 ? "—" : `%${s.healthPct}`,
      chip: s.overdueListings === 0 ? { text: "Tüm ilanlar güncel", tone: "success" } : { text: `${n(s.overdueListings)} ilan bekliyor`, tone: "warn" },
      href: "/app/ilan-kontrol",
    });
  const ok = s.overdueListings === 0 && (s.tasksToday?.overdue ?? 0) === 0;
  return <OfficeStatusPanel title="Ofis durumu" health={{ ok, label: ok ? "Her şey yolunda" : "İlgi bekleyen var", href: ok ? "/app/ilan-kontrol" : "#dikkat" }} tiles={tiles.slice(0, 4)} foot={serviceFoot(svc, now())} />;
}

/**
 * Ofis durumu ALT SATIRI: "Sistem durumu" (kamuya açık /durum kaynağı) + "Son yedekleme" (yalnız zaman/durum). Sistem
 * durumu okunamazsa yerine "Senkron · Son güncelleme HH:MM" (bu sayfanın veri tazeliği). Yedek okunamazsa karo yok.
 */
function serviceFoot(svc: ServiceStatus | null, nowMs: number): StatusFootTile[] {
  const foot: StatusFootTile[] = [];
  if (svc && svc.level !== "unknown") {
    const ok = svc.level === "operational";
    // F8: kısa değer ("Çalışıyor" / "Uyarı var"); tam metin ipucunda (dar karoda kesilmez).
    foot.push({ key: "sistem", icon: ServerCog, ok, label: "Sistem durumu", value: ok ? "Çalışıyor" : "Uyarı var", title: ok ? "Tüm servisler çalışıyor" : OVERALL_LABEL[svc.level], href: "/durum" });
  } else {
    foot.push({ key: "senkron", icon: RefreshCw, ok: true, label: "Senkron", value: `Son güncelleme ${formatTrTime(nowMs)}`, href: "/durum" });
  }
  if (svc?.backup) {
    const ok = backupHealthy(svc.backup, nowMs);
    const when = backupWhen(svc.backup.atMs, nowMs);
    foot.push({
      key: "yedek",
      icon: DatabaseBackup,
      ok,
      label: "Son yedekleme",
      value: svc.backup.status === "ok" ? when : `${when} · sorunlu`,
      title: ok ? `Son yedekleme: ${when}` : `Son yedekleme: ${when} (${svc.backup.status === "ok" ? "gecikmiş" : "tamamlanamadı"})`,
      href: "/durum",
    });
  }
  return foot;
}

const PANEL_ICON: Record<string, { icon: LucideIcon; tone: Tone }> = {
  siradaki: { icon: CalendarDays, tone: "sky" },
  gorev: { icon: SquareCheckBig, tone: "violet" },
  "geri-donus": { icon: Phone, tone: "gold" },
  portfoy: { icon: Home, tone: "mint" },
  alacak: { icon: Scale, tone: "sky" },
  giris: { icon: ReceiptText, tone: "mint" },
  komisyon: { icon: Coins, tone: "gold" },
  kira: { icon: KiraIcon, tone: "rose" },
  "ay-arama": { icon: PhoneIncoming, tone: "sky" },
  randevu: { icon: CalendarDays, tone: "mint" },
};
const toTiles = (rows: PanelTileData[]): StatusTile[] =>
  rows.map((r) => ({ ...r, icon: PANEL_ICON[r.key]?.icon ?? Users, tone: PANEL_ICON[r.key]?.tone ?? "sky" }));

/** BENİM GÜNÜM (danışman; yönetimde "Benim işlerim"): sıradaki randevum · bugünkü görevim · geri dönüş bekleyen · portföyüm. */
async function MyDayStream({ ctx }: { ctx: HomeCtx }) {
  const tiles = toTiles(await loadMyDayTiles(ctx).catch(() => []));
  const late = tiles.find((t) => t.key === "gorev")?.chip?.tone === "danger";
  return <OfficeStatusPanel title="Benim günüm" health={{ ok: !late, label: late ? "Geciken işin var" : "Her şey yolunda", href: late ? "/app/gorevler?filter=overdue&mine=1" : "/app/gorevler?mine=1" }} tiles={tiles} />;
}

/** EKİBİM BUGÜN (takım lideri): ekip üyelerinin bugünkü kayıt sayısı + son faaliyeti; takım yoksa "Benim günüm". */
async function TeamStatusStream({ ctx }: { ctx: HomeCtx }) {
  const rows = await loadTeamPanelTiles(ctx, activityStatus).catch(() => null);
  if (!rows || rows.length === 0) return <MyDayStream ctx={ctx} />;
  const t = await loadTeamDayCounts(ctx).catch(() => null);
  const late = (t?.overdue ?? 0) > 0;
  return (
    <OfficeStatusPanel
      title="Ekibim bugün"
      health={{ ok: !late, label: late ? "Ekipte geciken iş var" : "Ekip yolunda", href: late ? "/app/gorevler?filter=overdue" : "/app/ekip" }}
      tiles={rows.map((r) => ({ ...r, icon: Users, tone: "sky" as Tone }))}
    />
  );
}

/** FİNANS DURUMU (muhasebe): açık alacak · bu ay giriş · bu ay komisyon · geciken kira (KPI satırında olmayanlar). */
async function FinanceStatusStream({ ctx }: { ctx: HomeCtx }) {
  const [rows, m] = await Promise.all([loadFinancePanelTiles(ctx).catch(() => null), loadMoneySummary(ctx).catch(() => null)]);
  if (!rows) return null;
  const ok = (m?.overdueCount ?? 0) === 0;
  return <OfficeStatusPanel title="Finans durumu" health={{ ok, label: ok ? "Her şey yolunda" : "Vadesi geçen var", href: financeHref("cari", { gorunum: "acik", kova: "gecikmis" }) }} tiles={toTiles(rows)} />;
}

/** ARAMA DURUMU (çağrı merkezi): bu ay gelen arama · geri dönüş bekleyen · bugünkü görevim · bugünkü randevu. */
async function CallStatusStream({ ctx }: { ctx: HomeCtx }) {
  const [rows, missed] = await Promise.all([loadCallPanelTiles(ctx).catch(() => []), loadMissedCallsToday(ctx).catch(() => null)]);
  const ok = (missed ?? 0) === 0;
  return <OfficeStatusPanel title="Arama durumu" health={{ ok, label: ok ? "Cevapsız yok" : `${n(missed ?? 0)} cevapsız`, href: "/app/gelen-kutusu?sekme=cagri&yon=missed" }} tiles={toTiles(rows)} />;
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
  // Sağ panel rol planından (`roleHomePlan`): yönetim "Ofis durumu", takım lideri "Ekibim bugün", danışman "Benim günüm",
  // muhasebe "Finans durumu", çağrı merkezi "Arama durumu".
  const panel = planOf(ctx).panel;
  const aside =
    panel === "ofis-durumu" ? (
      <StatusStream ctx={ctx} />
    ) : panel === "ekibim" ? (
      <TeamStatusStream ctx={ctx} />
    ) : panel === "benim-gunum" ? (
      <MyDayStream ctx={ctx} />
    ) : panel === "finans-durumu" ? (
      <FinanceStatusStream ctx={ctx} />
    ) : (
      <CallStatusStream ctx={ctx} />
    );
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
      search={<HeroArama chips={chips} storageScope={ctx.tenantId && ctx.userId ? `${ctx.tenantId}:${ctx.userId}` : undefined} />}
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
      aside={<Suspense fallback={<StatusSkeleton />}>{aside}</Suspense>}
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

/** KPI kartı ikonu (anahtar → ikon; referans: altın para, mavi belge, pembe kişiler, yeşil kişi, mavi telefon). */
const KPI_ICON: Record<RoleKpiKey, LucideIcon> = {
  ciro: KPI_ICONS.revenue,
  kazancim: KPI_ICONS.revenue,
  "bu-ay-komisyon": KomisyonIcon,
  "aktif-anlasma": KPI_ICONS.deals,
  "aktif-anlasmam": KPI_ICONS.deals,
  "yeni-talep": KPI_ICONS.demands,
  "yeni-musteri": KPI_ICONS.customers,
  "gelen-arama": KPI_ICONS.calls,
  "bugunku-randevu": CalendarDays,
  "bugunku-randevum": CalendarDays,
  "atanmamis-portfoy": Inbox,
  "geciken-gorev": SquareCheckBig,
  "teyit-bekleyen": PortalTeyitIcon,
  "ekip-kapanis": Handshake,
  "ekip-anlasma": KPI_ICONS.deals,
  "ekip-geciken-gorev": SquareCheckBig,
  "ekip-randevu": CalendarDays,
  "ekip-yeni-musteri": KPI_ICONS.customers,
  "hedefime-kalan": Target,
  musterilerim: Users,
  "kasa-banka": Landmark,
  "bu-ay-net": Scale,
  "vadesi-gecen": AlertTriangle,
  "bu-ay-gider": Wallet,
  incelenecek: Inbox,
  "bugun-gelen-arama": KPI_ICONS.calls,
  "cevapsiz-arama": Phone,
  "yanit-suresi": Activity,
  "bugun-yeni-musteri": UserPlus,
  "bugun-randevu": CalendarPlus,
};

/**
 * KPI SATIRI (v5, ROL BAZLI): kartlar `roleHomePlan` (core.ts) kararıdır — yönetim ofisin cirosu/anlaşması/talebi/müşterisi/
 * araması, şube müdürü operasyon (randevu · atanmamış portföy · geciken görev), takım lideri ekibinin toplamı, danışman
 * kendi kazancı/hedefi/anlaşması/randevusu/müşterisi, muhasebe kasa · net · vadesi geçen · gider · incelenecek, çağrı
 * merkezi bugünkü/cevapsız arama · yanıt süresi · açtığı müşteri · randevuya dönüşen. Para kartı yetkisiz rolde çıkmaz.
 */
export async function KpiRow({ ctx }: { ctx: HomeCtx }) {
  const plan = planOf(ctx);
  const specs = (await loadRoleKpis(ctx, plan.kpis)).filter((c): c is KpiCardSpec => c !== null);
  if (specs.length === 0) return null;
  const targetHref = can(ctx, "targets") ? "/app/hedefler" : null;
  return (
    <div className="kh-kpis" data-count={specs.length} data-persona={plan.persona} role="list" aria-label="Göstergeleriniz">
      {specs.map((c) => (
        <div key={c.key} className="kh-kpi-cell" role="listitem">
          <KpiCard
            title={c.title}
            value={c.value}
            href={c.href}
            icon={KPI_ICON[c.key]}
            tone={c.tone}
            delta={c.delta}
            deltaContext={c.deltaContext}
            caption={c.caption}
            spark={c.spark ? <Spark values={c.spark.values} tone={c.tone} label={c.spark.label} /> : undefined}
            menu={<KpiMenu reportHref={c.reportHref ?? "/app/raporlar"} targetHref={c.key === "ciro" || c.key === "kazancim" || c.key === "hedefime-kalan" ? targetHref : null} copyText={`${c.title}: ${c.value}`} />}
          />
        </div>
      ))}
    </div>
  );
}

/* ================================ DİKKAT · KURULUM · EKİP ================================ */

/**
 * DİKKAT GEREKTİRENLER (ilk ekran, v5): her kategoride en öncelikli TEK GERÇEK KAYIT (`loadAttentionRecords`) — önem, sonra
 * yaş sırasıyla en çok `max` satır (`rankAttentionRecords`); kategorinin geri kalanı "+N daha". Fazla kategori
 * "Tümünü gör" ile (`?dikkat=tum`).
 */
export async function AttentionBlock({ ctx, params, max = 5 }: { ctx: HomeCtx; params: HomeParams; max?: number }) {
  const plan = planOf(ctx);
  const allowed = new Set<string>(plan.attention);
  const [base, extras] = await Promise.all([loadAttentionRecords(ctx).catch(() => []), loadRoleAttentionExtras(ctx, plan.attention).catch(() => [])]);
  const records = [...base, ...extras].filter((r) => allowed.has(r.key));
  const all = params.dikkat === "tum";
  const { rows, hidden } = rankAttentionRecords(records, all ? records.length : max);
  const nowMs = now();
  return (
    <AttentionPanel
      total={records.length}
      allHref={hidden > 0 || all ? homeHref(params, { dikkat: all ? undefined : "tum" }) : null}
      allLabel={all ? "Daha az göster" : "Tümünü gör"}
      rows={rows.map((r) => ({
        id: r.key,
        label: r.title,
        hint: r.detail ?? "",
        href: r.href,
        level: r.level,
        age: attentionAge(r, nowMs),
        overdueAge: r.ageKind === "elapsed",
        more: attentionMore(r.total),
      }))}
    />
  );
}

/**
 * KURULUM SONRASI KART (kurulum %100 olunca "Kurulumunu tamamla"nın AYNI yerini aynı ölçüyle alır; rol seçimi saf
 * `postSetupKind`): yönetim (ofis geneli) → "Bu ayın hedefi", danışman / "Benim işlerim" → "Kişisel hedefim", muhasebe →
 * "Ay sonu kapanışı". Hedef halkası /app/hedefler ile aynı gerçekleşme kuralını kullanır (bu ayın komisyonu; komisyon
 * görmeyen kullanıcıda kapanış hedefi). Tahmin etiketlidir ve ayın ilk günlerinde üretilmez (`monthEndEstimate`).
 */
export async function PostSetupBlock({ ctx }: { ctx: HomeCtx }) {
  const kind = postSetupKind({ role: ctx.role, isManagement: ctx.isManagement, scopeMine: ctx.scopeMine });
  if (kind === "month-close") return <MonthCloseBlock ctx={ctx} />;
  const personal = kind === "personal-goal";
  const nowMs = now();
  const [target, commission, won, top, tasks] = await Promise.all([
    (personal ? loadMyTarget(ctx) : loadOfficeTarget(ctx)).catch(() => null),
    ctx.canSeeCommissions ? loadCommissionSummary(ctx).catch(() => null) : Promise.resolve(null),
    loadWonDealsThisMonth(ctx, personal).catch(() => null),
    personal ? Promise.resolve(null) : loadTopContributor(ctx).catch(() => null),
    personal ? loadUpcomingTasks(ctx, 6).catch(() => null) : Promise.resolve(null),
  ]);
  const { elapsedPct, daysLeft } = monthProgress(nowMs);
  const goal = buildGoalView({
    targetRevenue: target?.target_revenue as number | null | undefined,
    targetDeals: target?.target_deals as number | null | undefined,
    actualRevenue: commission ? (commission.monthTotals.at(-1) ?? 0) : null,
    wonDeals: won,
    canSeeMoney: ctx.canSeeCommissions,
    elapsedPct,
    daysLeft,
  });
  const fmt = (v: number) => (goal.state === "tracking" && goal.metric === "deals" ? `${n(v)} kapanış` : moneyTry(v));
  const view: GoalCardView =
    goal.state === "no-target"
      ? { state: "no-target" }
      : {
          state: "tracking",
          ringPct: goal.ringPct,
          pct: goal.pct,
          actualText: fmt(goal.actual),
          targetText: fmt(goal.target),
          estimateText: goal.estimate != null ? `≈ ${moneyTry(goal.estimate)}` : null,
          exceeded: goal.exceeded,
        };
  const href = "/app/hedefler";
  const canSet = can(ctx, "targets", "create") || can(ctx, "targets", "edit");
  if (!personal) {
    return (
      <OfficeGoalCard
        view={view}
        daysLeft={goal.daysLeft}
        top={top ? { name: top.name, amountText: moneyTry(top.amount), href: can(ctx, "team") ? `/app/ekip/${top.id}` : href } : null}
        href={href}
        canSet={canSet}
        photo={getHeroPhoto("goal-city", { scene: sceneOf(trParts(nowMs).hour) === "day" ? "day" : "night" })}
      />
    );
  }
  // Bu haftanın adımı: önümüzdeki 7 gün içindeki (gecikmiş dahil) açık görevlerimden öncelikli olan, yoksa en yakın vadeli.
  const weekEnd = nowMs + 7 * DAY_MS;
  const mine = (tasks ?? []).filter((t) => !t.dueAt || Date.parse(t.dueAt) <= weekEnd);
  const pick = mine.find((t) => t.high) ?? mine[0] ?? null;
  return (
    <PersonalGoalCard
      view={view}
      daysLeft={goal.daysLeft}
      next={pick ? { title: pick.title, href: taskHref(pick.id), when: dueChip(pick.dueAt, nowMs).label } : null}
      href={href}
      canSet={canSet}
      photo={getHeroPhoto("goal-keys", { scene: sceneOf(trParts(nowMs).hour) === "day" ? "day" : "night" })}
    />
  );
}

/** AY SONU KAPANIŞI (muhasebe): geçen ayın kontrol listesi — finans Genel bakış kartıyla aynı sinyaller ve hedefler. */
async function MonthCloseBlock({ ctx }: { ctx: HomeCtx }) {
  if (!can(ctx, "expenses", "edit")) return null;
  const monthKey = previousMonthKey(trDayKey(now()));
  const { from, to } = monthRange(monthKey);
  const [s, money] = await Promise.all([loadMonthCloseSignals(monthKey, canHandleSalary(ctx.role)).catch(() => null), loadMoneySummary(ctx).catch(() => null)]);
  if (!s) return null;
  const res = buildMonthCloseChecklist(
    {
      monthKey,
      locked: s.locked,
      unreconciledBank: s.unreconciledBank,
      reviewCount: money?.reviewCount ?? null,
      receiptlessExpenses: s.receiptlessExpenses,
      noVatEntries: s.noVatEntries,
      vatPayable: s.vatPayable,
    },
    {
      reconcile: insightLinks.unreconciled(s.bankAccountIds, from, to),
      review: insightLinks.review(),
      receipts: insightLinks.receiptless(from, to),
      noVat: insightLinks.noVat(from, to),
      vat: insightLinks.vatYear(monthKey.slice(0, 4)),
      lock: insightLinks.periodLock(),
    },
  );
  // Yapılacaklar önde (sıra korunur), sonra okunamayanlar, en sonda tamamlananlar.
  const order = { todo: 0, unknown: 1, done: 2 } as const;
  const steps = [...res.steps].sort((a, b) => order[a.status] - order[b.status]).map((st) => ({ key: st.key, label: st.label, status: st.status, href: st.href }));
  return (
    <MonthCloseHomeCard
      monthName={monthNameTr(monthKey)}
      done={res.done}
      total={res.total}
      closed={res.closed}
      steps={steps}
      href={insightLinks.periodLock()}
      photo={getHeroPhoto("hero-accounting", { scene: "day" })}
    />
  );
}

/** BUGÜN OFİSTE OLANLAR (yönetim): ekip durumu + bugünkü denetim kayıtları → kişi, unvan, son görülme, durum hapı. */
export async function TeamTodayBlock({ ctx }: { ctx: HomeCtx }) {
  const team = await loadTeamToday(ctx).catch(() => null);
  if (!team) return null;
  const nowMs = now();
  const today = trDayKey(nowMs);
  return (
    <TeamToday
      people={team.people.slice(0, 6).map((p) => ({
        id: p.id,
        name: p.name,
        avatarUrl: p.avatarUrl,
        avatarPreset: p.avatarPreset,
        roleTitle: p.roleTitle,
        presence: p.presence,
        note: p.note,
        activity: p.activity,
        when: presenceTimeLabel(p.atMs, nowMs),
        today: p.today,
        // Kişinin ofis kontrolü akışı (son kaydının gününden bugüne).
        href: `/app/ofis-kontrol?aktor=${p.id}&from=${p.today ? today : p.day}&to=${today}`,
      }))}
      total={team.total}
      allHref="/app/ekip"
    />
  );
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

export { CardSkeleton, KpiRowSkeleton } from "./skeletons";
