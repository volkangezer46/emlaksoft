import { Suspense } from "react";
import Link from "@/components/ui/smart-link";
import {
  AlertTriangle,
  ArrowRight,
  CalendarPlus,
  ClipboardList,
  FileSignature,
  FileText,
  Handshake,
  Home,
  Inbox,
  Landmark,
  ListPlus,
  Activity,
  Database,
  Phone,
  ReceiptText,
  Scale,
  Target,
  UserPlus,
  Users,
} from "lucide-react";
import { DataFreshness } from "@/components/ui/data-freshness";
import { entryHref } from "@/lib/finance/entry-workspace";
import { financeHref } from "@/lib/finance/routes";
import { ScopeSwitch } from "@/components/ui/scope-switch";
import { formatTrTime, now, trParts } from "@/lib/clock";
import { financePath } from "@/lib/finance/routes";
import { moneyTry } from "@/lib/leak-shield";
import { appointmentTypeLabel } from "@/lib/appointment-labels";
import { appointmentHref, taskHref } from "@/lib/notification-text";
import { directionsHref, routeDirectionsHref } from "@/lib/route-plan";
import { loadOfficeIdentity } from "@/lib/app-shell/office-identity";
import { loadWeather } from "@/lib/weather";
import { loadAttention, loadMoneySummary, loadTodayAppointments, type HomeCtx } from "../data";
import { timeGreeting } from "@/lib/greeting-name";
import { heroFocus } from "../home-metrics";
import { homeHref, type HomeParams } from "../kapsam-anahtari";
import type { HomeLayout } from "../home-layout";
import { apptStatus, deltaOf, dueChip, heroSentence, longDate, sceneOf, type SalesFilter, type SalesRange } from "./core";
import { neYapmakChips } from "../ne-yapmak-chips";
import { HeroArama } from "./hero-arama";
import { loadHeroPhoto, loadKpiData, loadOfficeStatus, loadRecentListings, loadSalesPerformance, loadUpcomingTasks } from "./data";
import {
  CardSkeleton,
  HeroPhoto,
  KPI_ICONS,
  KpiCard,
  KpiMenu,
  KpiSkeleton,
  KurumsalHero,
  OfficeStatusPanel,
  RecentListings,
  SalesPerformance,
  Spark,
  TaskList,
  Timeline,
  WeatherChip,
  type HeroAction,
  type StatusItem,
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
  return <span className="kh-hero-sum">{heroSentence({ appointments: s.todayAppointments, demands: s.newDemands, listingUpdates: s.overdueListings || null, mine: ctx.scopeMine })}</span>;
}

/** "Önce bununla başlayın: 12 geciken kira tahsilatı →" — dikkat listesinin en öncelikli kalemi (yönetim + danışman). */
async function HeroFocus({ ctx }: { ctx: HomeCtx }) {
  const f = heroFocus(await loadAttention(ctx).catch(() => []));
  return (
    <p className="kh-hero-lead">
      {f.lead}{" "}
      <Link href={f.href} className="kh-hero-link focus-ring">
        {f.text}
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Link>
      {f.rest > 0 ? (
        <a href="#dikkat" className="kh-hero-rest focus-ring">
          {" "}
          · {f.rest} konu daha dikkat bekliyor
        </a>
      ) : null}
    </p>
  );
}

/** Muhasebe önceliği: vadesi geçen kalem > incelenecek kayıt > sakin durum (tek cümle, filtreli hedef). */
async function AccountingFocus({ ctx }: { ctx: HomeCtx }) {
  const m = await loadMoneySummary(ctx).catch(() => null);
  const overdue = m?.overdueCount ?? 0;
  const review = m?.reviewCount ?? 0;
  const f =
    overdue > 0
      ? { lead: "Önce bununla başlayın:", text: `${overdue} vadesi geçen kalem`, href: financeHref("cari", { gorunum: "acik", kova: "gecikmis" }) }
      : review > 0
        ? { lead: "Öncelik:", text: `${review} kayıt incelenmeyi bekliyor`, href: financeHref("kasa-banka") }
        : { lead: "Bugün acil bir konu görünmüyor.", text: "Bu ayın hareketlerini gözden geçirin", href: financeHref("hareketler", m ? { from: m.monthFrom, to: m.today } : undefined) };
  return (
    <p className="kh-hero-lead">
      {f.lead}{" "}
      <Link href={f.href} className="kh-hero-link focus-ring">
        {f.text}
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </p>
  );
}

async function HeroPhotoStream({ ctx }: { ctx: HomeCtx }) {
  const p = await loadHeroPhoto(ctx).catch(() => null);
  return p ? <HeroPhoto src={p.src} title={p.title} /> : null;
}

/** Ofis durumu paneli: ilan teyit sağlığı + ofis kartıyla aynı kimlik (şehir) + hava durumu (varsa). */
async function StatusStream({ ctx }: { ctx: HomeCtx }) {
  const nowMs = now();
  const [s, identity] = await Promise.all([loadOfficeStatus(ctx), loadOfficeIdentity(ctx.tenantId)]);
  const weather = identity?.coords ? await loadWeather(identity.coords) : null;
  const ok = s.overdueListings === 0;
  const items: StatusItem[] = [];
  if (s.liveListings != null) items.push({ icon: Database, tone: "gold", value: s.liveListings.toLocaleString("tr-TR"), label: ctx.scopeMine ? "Yayındaki ilanım" : "Yayındaki ilan", href: "/app/ilan-kontrol" });
  if (s.activeUsers != null) items.push({ icon: Users, tone: "violet", value: s.activeUsers.toLocaleString("tr-TR"), label: "Aktif kullanıcı", href: "/app/ekip" });
  else if (s.todayAppointments != null) items.push({ icon: CalendarPlus, tone: "violet", value: s.todayAppointments.toLocaleString("tr-TR"), label: "Bugünkü randevu", href: "/app/randevular" });
  // "%0 teyit sağlığı" alarm gibi okunuyordu: güncel / toplam sayı olarak yazılır (aynı ölçü, açık anlam).
  if (s.liveListings != null && s.liveListings > 0)
    items.push({ icon: Activity, tone: ok ? "mint" : "gold", value: `${(s.liveListings - s.overdueListings).toLocaleString("tr-TR")}/${s.liveListings.toLocaleString("tr-TR")}`, label: "Teyidi güncel ilan", href: "/app/ilan-kontrol" });
  return (
    <OfficeStatusPanel
      ok={ok}
      headline="Ofis durumu"
      detail={s.liveListings == null ? "Günlük işler yolunda" : ok ? "Tüm ilanlar güncel" : `${s.overdueListings} ilan teyit bekliyor`}
      time={formatTrTime(nowMs)}
      href={s.liveListings == null ? "/app/gorevler" : "/app/ilan-kontrol"}
      items={items}
      weather={weather && identity?.city ? <WeatherChip weather={weather} city={identity.city} /> : null}
    />
  );
}

function StatusSkeleton() {
  return (
    <div className="kh-status kh-skel" aria-hidden="true">
      <span className="skeleton block h-11 rounded-[var(--radius-control)]" />
      <span className="skeleton mt-3 block h-14 rounded-[var(--radius-control)]" />
      <span className="skeleton mt-2 block h-14 rounded-[var(--radius-control)]" />
    </div>
  );
}

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
  const focusFallback = <p className="kh-hero-lead">Günün önceliği hazırlanıyor…</p>;
  const focus =
    layout.variant === "accounting" ? (
      <Suspense fallback={focusFallback}>
        <AccountingFocus ctx={ctx} />
      </Suspense>
    ) : layout.variant === "call_center" ? (
      <Suspense fallback={focusFallback}>
        <p className="kh-hero-lead">
          <HeroSummary ctx={ctx} />
        </p>
      </Suspense>
    ) : (
      <Suspense fallback={focusFallback}>
        <HeroFocus ctx={ctx} />
      </Suspense>
    );
  // Ofis durumu paneli yalnız yönetimde (danışmana ofis geneli teyit metriği gösterilmez; muhasebede anlamsız).
  const management = layout.variant === "management";
  return (
    <KurumsalHero
      dateText={longDate(nowMs)}
      greeting={timeGreeting(p.hour)}
      name={name}
      scene={sceneOf(p.hour)}
      focus={focus}
      summary={
        layout.variant === "accounting" || layout.variant === "call_center" ? null : (
          <Suspense fallback={<span className="kh-hero-sum">Günün özeti hazırlanıyor…</span>}>
            <HeroSummary ctx={ctx} />
          </Suspense>
        )
      }
      freshness={<DataFreshness asOf={nowMs} className="kh-fresh" />}
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
      aside={
        management ? (
          <Suspense fallback={<StatusSkeleton />}>
            <StatusStream ctx={ctx} />
          </Suspense>
        ) : null
      }
      photo={
        <Suspense fallback={null}>
          <HeroPhotoStream ctx={ctx} />
        </Suspense>
      }
    />
  );
}

/* ================================ KPI SATIRI ================================ */

export function KpiRowSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="kh-kpis" data-count={count}>
      {Array.from({ length: count }).map((_, i) => (
        <KpiSkeleton key={i} />
      ))}
    </div>
  );
}

export async function KpiRow({ ctx, opts }: { ctx: HomeCtx; opts?: { hideAppointments?: boolean } }) {
  const k = await loadKpiData(ctx);
  const targetHref = can(ctx, "targets") ? "/app/hedefler" : null;
  const mine = ctx.scopeMine;
  const cards: { key: string; node: React.ReactNode }[] = [];
  if (k.revenue) {
    const title = ctx.isManagement && !mine ? "Ciro (bu ay)" : "Kazancım (bu ay)";
    const value = moneyTry(k.revenue.thisMonth);
    cards.push({
      key: "ciro",
      node: (
        <KpiCard
          title={title}
          value={value}
          href={financePath("komisyon")}
          icon={KPI_ICONS.revenue}
          tone="gold"
          delta={deltaOf(k.revenue.thisMonth, k.revenue.prevMonth)}
          caption={`Geçen ay: ${moneyTry(k.revenue.prevMonth)}`}
          spark={<Spark values={k.revenue.monthly} tone="gold" label="Son 6 ay aylık komisyon" />}
          menu={<KpiMenu reportHref={financePath("raporlar")} targetHref={targetHref} copyText={`${title}: ${value}`} />}
        />
      ),
    });
  }
  if (k.properties) {
    const value = k.properties.active.toLocaleString("tr-TR");
    cards.push({
      key: "portfoy",
      node: (
        <KpiCard
          title={mine ? "Aktif portföyüm" : "Aktif portföy"}
          value={value}
          href="/app/portfoyler"
          icon={KPI_ICONS.properties}
          tone="brand"
          delta={deltaOf(k.properties.newThisMonth, k.properties.newPrevMonth)}
          caption={k.properties.newPrevMonth === 0 && k.properties.newThisMonth > 0 ? `Bu ay ${k.properties.newThisMonth} yeni (geçen ay yoktu)` : k.properties.newThisMonth > 0 ? `Bu ay ${k.properties.newThisMonth} yeni eklendi` : "Bu ay yeni eklenen yok"}
          spark={<Spark values={k.properties.weekly} tone="brand" label="Son 7 hafta eklenen portföy" />}
          menu={<KpiMenu reportHref="/app/raporlar/talep-arz" targetHref={targetHref} copyText={`Aktif portföy: ${value}`} />}
        />
      ),
    });
  }
  if (k.customers) {
    const value = k.customers.active.toLocaleString("tr-TR");
    cards.push({
      key: "musteri",
      node: (
        <KpiCard
          title={mine ? "Müşterilerim" : "Aktif müşteri"}
          value={value}
          href="/app/musteriler"
          icon={KPI_ICONS.customers}
          tone="violet"
          delta={deltaOf(k.customers.thisMonth, k.customers.prevMonth)}
          caption={
            k.customers.thisMonth > 0 && k.customers.thisMonth >= k.customers.active
              ? "Tamamı bu ay eklendi"
              : k.customers.thisMonth > 0
                ? `Bu ay ${k.customers.thisMonth} yeni`
                : "Bu ay yeni müşteri yok"
          }
          spark={<Spark values={k.customers.weekly} tone="violet" label="Son 7 hafta yeni müşteri" />}
          menu={<KpiMenu reportHref="/app/raporlar/huni" targetHref={targetHref} copyText={`Aktif müşteri: ${value}`} />}
        />
      ),
    });
  }
  if (k.appointments && !opts?.hideAppointments) {
    const value = k.appointments.today.toLocaleString("tr-TR");
    cards.push({
      key: "randevu",
      node: (
        <KpiCard
          title="Bugünkü randevu"
          value={value}
          href="/app/randevular"
          icon={KPI_ICONS.appointments}
          tone="mint"
          caption={k.appointments.today > 0 ? `${k.appointments.done} tamamlandı` : "Bugün randevu yok"}
          spark={<Spark values={k.appointments.daily} tone="mint" kind="bars" label="Son 7 gün günlük randevu" />}
          menu={<KpiMenu reportHref="/app/raporlar" targetHref={null} copyText={`Bugünkü randevu: ${value}`} />}
        />
      ),
    });
  }
  if (cards.length === 0) return null;
  return <div className="kh-kpis" data-count={cards.length}>{cards.map((c) => <div key={c.key} className="min-w-0">{c.node}</div>)}</div>;
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
 * Muhasebe ilk ekranı (P0-6): Kasa · Bu ay net · Vadesi geçen · İncelenecek — finans genel bakışla AYNI kaynak
 * (`finance_overview` RPC, `loadMoneySummary`) ve aynı hedefler. Okunamayan kalem çizilmez (sahte 0 yok).
 */
export async function AccountingKpiRow({ ctx }: { ctx: HomeCtx }) {
  const m = await loadMoneySummary(ctx).catch(() => null);
  if (!m || m.cash === null) return null;
  const net = (m.monthIn ?? 0) - (m.monthOut ?? 0);
  const cards = [
    { key: "kasa", node: <KpiCard title="Kasa" value={moneyTry(m.cash)} href={financeHref("kasa-banka")} icon={Landmark} tone="brand" caption="Kasa ve banka toplamı" /> },
    {
      key: "net",
      node: (
        <KpiCard
          title="Bu ay net"
          value={`${net < 0 ? "−" : ""}${moneyTry(Math.abs(net))}`}
          href={financeHref("hareketler", { from: m.monthFrom, to: m.today })}
          icon={Scale}
          tone={net >= 0 ? "mint" : "rose"}
          caption={`Giriş ${moneyTry(m.monthIn ?? 0)} · Çıkış ${moneyTry(m.monthOut ?? 0)}`}
        />
      ),
    },
    {
      key: "vade",
      node: (
        <KpiCard
          title="Vadesi geçen"
          value={(m.overdueCount ?? 0).toLocaleString("tr-TR")}
          href={financeHref("cari", { gorunum: "acik", kova: "gecikmis" })}
          icon={AlertTriangle}
          tone={(m.overdueCount ?? 0) > 0 ? "rose" : "mint"}
          caption={(m.overdueCount ?? 0) > 0 ? "Tahsil/ödeme bekleyen kalem" : "Vadesi geçen kalem yok"}
        />
      ),
    },
    {
      key: "incele",
      node: (
        <KpiCard
          title="İncelenecek"
          value={(m.reviewCount ?? 0).toLocaleString("tr-TR")}
          href={financeHref("kasa-banka")}
          icon={Inbox}
          tone={(m.reviewCount ?? 0) > 0 ? "gold" : "mint"}
          caption={(m.reviewCount ?? 0) > 0 ? "Ekstre, düzenli ödeme ve fiş" : "İncelenecek kayıt yok"}
        />
      ),
    },
  ];
  return <div className="kh-kpis" data-count={cards.length}>{cards.map((c) => <div key={c.key} className="min-w-0">{c.node}</div>)}</div>;
}
