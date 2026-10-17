import { Suspense, cache } from "react";
import Link from "@/components/ui/smart-link";
import {
  Activity,
  BarChart3,
  Bot,
  Building2,
  CreditCard,
  FlaskConical,
  Gauge,
  Headset,
  LifeBuoy,
  Megaphone,
  Radar,
  Settings,
  ShieldCheck,
  Users,
  Wallet,
} from "lucide-react";
import { DataFreshness } from "@/components/ui/data-freshness";
import { EmptyState } from "@/components/ui/empty-state";
import { formatTrTime, now, trParts } from "@/lib/clock";
import { formatNumberTr, formatTry } from "@/lib/format";
import { timeGreeting, greetingNameOf } from "@/lib/greeting-name";
import { getHeroPhoto } from "@/lib/media/hero-photo-source";
import { auditActionLabel } from "@/lib/admin-format";
import { systemStatusOf } from "@/lib/admin/system-status";
import { getAdminBadges } from "@/lib/admin-badges";
import { platformCanAccess, type PlatformAccessSubject, type PlatformModule } from "@/lib/platform-access";
import { deltaOf, longDate, sceneOf } from "@/app/app/_home/kurumsal/core";
import { HeroArama } from "@/app/app/_home/kurumsal/hero-arama";
import {
  AttentionPanel,
  CardSkeleton,
  HeroPhoto,
  KpiCard,
  KpiSkeleton,
  KurumsalHero,
  OfficeStatusPanel,
  Spark,
  StatusChips,
  type HeroAction,
  type StatusChip,
  type StatusTile,
} from "@/app/app/_home/kurumsal/views";
import { loadPlatformHome } from "./platform-sections";
import { buildAttentionRows, collapseFeed, cronTileStatus, type ScoredRow } from "./home-rules";

/**
 * KONTROL PANELİ v4 (sahip kararı 2026-10-16: "süper admin ekranı da ofis ekranı temasında olsun"): ofis ana ekranıyla
 * AYNI bileşenler (`_home/kurumsal/views.tsx`, `home.css`): fotoğraflı kahraman + saatine göre selam ve ad soyad, durum
 * hapları, "Ne yapmak istiyorsun?" komut çubuğu (aynı komut paleti), koyu cam "Platform durumu" paneli, 5 KPI, "Dikkat
 * gerektirenler" ve "Bugün platformda" akışı. Veri YALNIZ mevcut kaynaklardan (`loadPlatformHome`: rapor toplulaştırması,
 * dikkat kuyruğu, canlı talep sayımı, sistem sağlığı; `getAdminBadges`: onay / vadesi geçmiş fatura / KVKK sayaçları);
 * okunamayan değer kartta "—" ya da boş durumdur, sıfır gibi gösterilmez. Para tam TL (`formatTry`, ₺ önekli, kısaltmasız).
 */

type Staff = PlatformAccessSubject & { full_name: string };

const freshChip = (nowMs: number) => <DataFreshness asOf={nowMs} className="kh-fresh" />;

function heroActions(role: PlatformAccessSubject): { primary: HeroAction[]; more: HeroAction[] } {
  const can = (m: PlatformModule) => platformCanAccess(role, m);
  const all: (HeroAction & { ok: boolean })[] = [
    { href: "/admin/tenants/yeni", label: "Yeni ofis", icon: Building2, primary: true, ok: can("tenants") },
    { href: "/admin/tickets", label: "Talepler", icon: LifeBuoy, ok: can("tickets") },
    { href: "/admin/raporlar", label: "Raporlar", icon: BarChart3, ok: can("reports") },
    { href: "/admin/billing/tahsilat", label: "Tahsilat", icon: Wallet, ok: can("billing") },
    { href: "/admin/duyuru", label: "Toplu duyuru", icon: Megaphone, ok: can("broadcast") },
    { href: "/admin/sistem", label: "Sistem durumu", icon: Radar, ok: can("sistem") },
    { href: "/admin/ayarlar/menu", label: "Menü yönetimi", icon: Settings, ok: can("sistem") },
  ];
  const ok = all.filter((a) => a.ok).map(({ ok: _ok, ...a }) => a);
  return { primary: ok.slice(0, 3), more: ok.slice(3) };
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

/** Kahraman: selam + özet + durum hapları + komut çubuğu + hızlı işlemler; sağda "Platform durumu". */
export function PlatformHero({ staff, modules }: { staff: Staff; modules: readonly PlatformModule[] }) {
  const nowMs = now();
  const p = trParts(nowMs);
  const scene = sceneOf(p.hour);
  const photo = getHeroPhoto("hero-villa-dusk", { scene });
  const { primary, more } = heroActions(staff);
  return (
    <KurumsalHero
      dateText={longDate(nowMs)}
      greeting={timeGreeting(p.hour)}
      name={greetingNameOf(staff.full_name) ?? null}
      scene={scene}
      summary={
        <Suspense fallback={<span className="kh-sum-skel">Platform özeti hazırlanıyor…</span>}>
          <HeroSummary role={staff} modules={modules} />
        </Suspense>
      }
      status={
        <Suspense fallback={<StatusChips fresh={freshChip(nowMs)} chips={[]} />}>
          <HeroStatus role={staff} modules={modules} nowMs={nowMs} />
        </Suspense>
      }
      search={<HeroArama chips={["ofis ara", "talep aç", "rapor al"]} />}
      actions={primary}
      moreActions={more}
      aside={
        <Suspense fallback={<StatusSkeleton />}>
          <PlatformStatus role={staff} modules={modules} />
        </Suspense>
      }
      photo={photo ? <HeroPhoto photo={photo} /> : null}
    />
  );
}

/** Özet cümlesi (KPI'ları tekrarlamaz): kaç konu bekliyor ve en önceliklisi. `<p>` içinde çizilir: yalnız satır içi öğe. */
async function HeroSummary({ role, modules }: { role: PlatformAccessSubject; modules: readonly PlatformModule[] }) {
  const rows = await loadAttentionRows(role, modules);
  const top = rows[0];
  if (!top) return <>Platform sakin: <strong>bekleyen öncelikli iş yok</strong>.</>;
  return (
    <>
      <strong>{rows.length}</strong> konu dikkatinizi bekliyor; en öncelikli:{" "}
      <Link href={top.href} className="focus-ring rounded-sm font-semibold underline-offset-2 hover:underline">
        {top.label.toLocaleLowerCase("tr-TR")}
      </Link>
      .
    </>
  );
}

/** Durum hapları: tazelik + gecikmiş/başarısız (kırmızı) + karar bekleyen (turuncu) + bilgi; her biri süzülmüş listeye. */
async function HeroStatus({ role, modules, nowMs }: { role: PlatformAccessSubject; modules: readonly PlatformModule[]; nowMs: number }) {
  const [rows, badges] = await Promise.all([loadAttentionRows(role, modules), getAdminBadges(modules).catch(() => null)]);
  const chips: StatusChip[] = [];
  // Tek önem kuralı: "N acil konu" = Dikkat gerektirenler'deki "Acil" rozetli satırlar (aynı satır listesi).
  const urgent = rows.filter((r) => r.level === "acil");
  if (urgent.length > 0) chips.push({ key: "acil", label: `${urgent.length} acil konu`, href: urgent.length === 1 ? urgent[0]!.href : "/admin#dikkat", tone: "danger" });
  if (badges?.payments) chips.push({ key: "fatura", label: `${formatNumberTr(badges.payments)} gecikmiş fatura`, href: "/admin/billing/tahsilat", tone: "rose" });
  if (badges?.approvals) chips.push({ key: "onay", label: `${formatNumberTr(badges.approvals)} onay bekliyor`, href: "/admin/onaylar?durum=bekleyen", tone: "warn" });
  if (chips.length === 0) chips.push({ key: "sakin", label: "Acil iş yok", href: "/admin#dikkat", tone: "success" });
  return <StatusChips fresh={freshChip(nowMs)} chips={chips.slice(0, 3)} />;
}

/**
 * Koyu cam "Platform durumu" (platform operatörünün nabzı): cron/entegrasyon sağlığı, bugün etkin ofis (denetim izi
 * hareketi olan ofis; kullanıcı bazında "son görülme" kaynağı yok), gecikmiş ödeme ve 7 gün içinde biten deneme.
 * Karolar role göre: sistem, ofis ve gelir yetkisi olmayan personel o karoyu görmez.
 */
async function PlatformStatus({ role, modules }: { role: PlatformAccessSubject; modules: readonly PlatformModule[] }) {
  const [h, badges] = await Promise.all([loadPlatformHome(role), getAdminBadges(modules).catch(() => null)]);
  const can = (m: PlatformModule) => platformCanAccess(role, m);
  const sys = h.health ? systemStatusOf(h.health) : null;
  const tiles: StatusTile[] = [];
  if (can("sistem")) {
    const cron = cronTileStatus(h.health?.cronTotal ?? null, h.health?.cronErrors ?? null);
    tiles.push({
      key: "saglik",
      icon: Activity,
      tone: cron.tone,
      label: "Cron sağlığı",
      value: cron.value,
      chip: cron.chip,
      href: cron.href,
    });
  }
  if (can("tenants")) {
    tiles.push({ key: "etkin", icon: Users, tone: "brand", label: "Bugün etkin ofis", value: h.ok && h.activeOfficesToday !== null ? formatNumberTr(h.activeOfficesToday) : "—", chip: h.ok ? { text: `${formatNumberTr(h.active)} ücretli`, tone: "neutral" } : null, href: "/admin/tenants?durum=active" });
  }
  if (can("billing")) {
    const n = badges?.payments ?? null;
    tiles.push({ key: "odeme", icon: CreditCard, tone: n ? "rose" : "mint", label: "Gecikmiş ödeme", value: n === null ? "—" : formatNumberTr(n), chip: n ? { text: "tahsilat bekliyor", tone: "danger" } : null, href: "/admin/billing/tahsilat" });
  }
  if (can("tenants")) {
    tiles.push({ key: "deneme", icon: FlaskConical, tone: h.ok && h.soon ? "amber" : "cyan", label: "7 günde biten", value: h.ok ? formatNumberTr(h.soon) : "—", chip: h.ok && h.trial ? { text: `${formatNumberTr(h.trial)} denemede`, tone: "neutral" } : null, href: "/admin/tenants?deneme=bitiyor" });
  }
  const health = !h.health
    ? { ok: false, label: "Sağlık okunamadı", href: "/admin/sistem" }
    : sys?.level === "ok"
      ? { ok: true, label: "Sistem sağlıklı", href: "/admin/sistem" }
      : { ok: false, label: "İlgi bekliyor", href: "/admin/sistem" };
  return <OfficeStatusPanel title="Platform durumu" health={health} tiles={tiles.slice(0, 4)} />;
}

export function PlatformKpiSkeleton() {
  return (
    <div className="kh-kpis" data-count={5} aria-hidden="true">
      {Array.from({ length: 5 }).map((_, i) => (
        <KpiSkeleton key={i} />
      ))}
    </div>
  );
}

/**
 * 5 KPI: MRR · Aktif ofis · Deneme → ücretli · Açık talep / SLA · AI kredi kullanımı. Değişim yalnız gerçek önceki değer
 * varsa (`@/lib/trend` kuralı: önceki 0 ise "yeni", ikisi 0 ise hap yok); mini çubuklar gerçek seriden (en az 2 nokta).
 */
export async function PlatformKpiRow({ role }: { role: PlatformAccessSubject }) {
  const h = await loadPlatformHome(role);
  const can = (m: PlatformModule) => platformCanAccess(role, m);
  if (!h.ok) {
    return <EmptyState variant="compact" illustration="rapor" title="Özet göstergeler okunamadı" description="Rapor toplulaştırması şu an yanıt vermedi; birkaç saniye sonra yenileyin." action={{ href: "/admin/sistem", label: "Sistem durumunu aç" }} />;
  }
  const series = (xs: number[]) => (xs.length >= 2 ? xs : null);
  type Week = { tenants: number; active_subscriptions: number; trials: number; tickets: number };
  const weeks: Week[] = h.weekly ?? [];
  const weekly = (pick: (w: Week) => number) => series(weeks.map((w) => Number(pick(w)) || 0));
  const cards: { key: string; node: React.ReactNode }[] = [];
  if (can("billing")) {
    const last = h.mrrSeries.at(-1);
    const prev = h.mrrSeries.length >= 2 ? h.mrrSeries.at(-2) : undefined;
    const sp = series(h.mrrSeries.slice(-12));
    cards.push({
      key: "mrr",
      node: (
        <KpiCard
          title="MRR"
          value={formatTry(h.mrr)}
          href="/admin/billing"
          icon={Wallet}
          tone="gold"
          delta={last !== undefined && prev !== undefined ? deltaOf(last, prev) : null}
          deltaContext="önceki ay sonuna göre"
          caption="Aylık gelir"
          spark={sp ? <Spark values={sp} tone="gold" label="Son aylar aylık yinelenen gelir" /> : undefined}
        />
      ),
    });
  }
  if (can("tenants")) {
    const sp = weekly((w) => w.active_subscriptions);
    cards.push({
      key: "aktif",
      node: (
        <KpiCard
          title="Ücretli ofis"
          value={formatNumberTr(h.active)}
          href="/admin/tenants?durum=active"
          icon={Building2}
          tone="brand"
          caption={h.newTenants > 0 ? `+${formatNumberTr(h.newTenants)} yeni · 30 gün` : `${formatNumberTr(h.totalTenants)} toplam`}
          spark={sp ? <Spark values={sp} tone="brand" label="Son 8 hafta haftalık yeni aktif abonelik" /> : undefined}
        />
      ),
    });
    const conv = h.trialConv;
    const sp2 = weekly((w) => w.trials);
    cards.push({
      key: "donusum",
      node: (
        <KpiCard
          title="Deneme dönüşümü"
          value={conv && conv.rate !== null ? `%${formatNumberTr(conv.rate)}` : "—"}
          href="/admin/tenants?durum=trial"
          icon={FlaskConical}
          tone="mint"
          caption={!conv ? "Dönüşüm okunamadı" : conv.ended === 0 ? "Biten deneme yok" : `${formatNumberTr(conv.converted)} / ${formatNumberTr(conv.ended)} deneme`}
          spark={sp2 ? <Spark values={sp2} tone="mint" label="Son 8 hafta haftalık yeni deneme" /> : undefined}
        />
      ),
    });
  }
  if (can("tickets")) {
    const sp = weekly((w) => w.tickets);
    const sla = h.slaBreached;
    cards.push({
      key: "talep",
      node: (
        <KpiCard
          title="Açık talep"
          value={h.tickets.open === null ? "—" : formatNumberTr(h.tickets.open)}
          href={sla ? "/admin/tickets?sla=breached" : "/admin/tickets?durum=acik"}
          icon={Headset}
          tone={sla ? "rose" : "cyan"}
          caption={sla === null ? "Süre okunamadı" : sla > 0 ? `${formatNumberTr(sla)} yanıt gecikti` : "Gecikme yok"}
          spark={sp ? <Spark values={sp} tone={sla ? "rose" : "cyan"} label="Son 8 hafta haftalık yeni destek talebi" /> : undefined}
        />
      ),
    });
  }
  if (can("billing")) {
    const ai = h.usage?.byUnit.ai ?? null;
    const cur = ai?.at(-1);
    const prev = ai && ai.length >= 2 ? ai.at(-2) : undefined;
    cards.push({
      key: "ai",
      node: (
        <KpiCard
          title="AI kredisi"
          value={cur === undefined ? "—" : formatNumberTr(Math.round(cur))}
          href="/admin/ai-kullanim"
          icon={Bot}
          tone="violet"
          delta={cur !== undefined && prev !== undefined ? deltaOf(cur, prev, true) : null}
          deltaContext="geçen aya göre"
          caption={cur === undefined ? "Okunamadı" : "Bu ay harcanan"}
          spark={ai && ai.length >= 2 ? <Spark values={ai} tone="violet" label="Son 6 ay aylık AI kredi tüketimi" /> : undefined}
        />
      ),
    });
  }
  if (cards.length === 0) return null;
  return (
    <div className="kh-kpis" data-count={cards.length} role="list" aria-label="Platform göstergeleri">
      {cards.map((c) => (
        <div key={c.key} className="kh-kpi-cell" role="listitem">
          {c.node}
        </div>
      ))}
    </div>
  );
}

/**
 * DİKKAT GEREKTİRENLER: önce SOMUT kayıtlar (vadesi geçmiş fatura, SLA'sı aşılmış talep, bekleyen onay, biten deneme,
 * hatalı cron işi; her biri kendi kaydına), sonra önem sıralı kuyruk (`loadAttention`: iade/manuel ödeme, hatalı cron, EF mutabakatı, acil talep,
 * riskli ofis, biten deneme, operasyon hazırlığı, dönemi bitmiş aktif abonelik) + yan menü sayaçları (vadesi geçmiş
 * fatura, bekleyen dört göz onayı, açık KVKK başvurusu) + SLA aşımı. En çok 6 satır.
 */
export async function PlatformAttention({ role, modules }: { role: PlatformAccessSubject; modules: readonly PlatformModule[] }) {
  const rows = await loadAttentionRows(role, modules);
  const shown = rows.slice(0, ATTENTION_SHOWN);
  return <AttentionPanel rows={shown.map(({ severity: _s, ...r }) => r)} total={rows.length} allHref={null} />;
}

const ATTENTION_SHOWN = 7;


/**
 * Dikkat satırları TEK kaynak (kart + kahraman hapı + özet cümlesi aynı listeyi okur; F13): önem `attentionLevel(severity)`
 * ile bir kez hesaplanır. Kuyruk kalemlerinin adedi rozet sütununa değil etiketin yanına (`more`) yazılır: rozetler hizalı.
 */
const loadAttentionRows = cache(async (role: PlatformAccessSubject, modules: readonly PlatformModule[]): Promise<ScoredRow[]> => {
  const [h, badges] = await Promise.all([loadPlatformHome(role), getAdminBadges(modules).catch(() => null)]);
  return buildAttentionRows(h, badges, role, now());
});




type FeedRow = { id: string; at: string; label: string; hint: string; href: string; icon: typeof Activity; tone: "brand" | "mint" | "cyan" | "slate" };


/** BUGÜN PLATFORMDA: TR günü başından bu yana açılan ofis, destek talebi ve platform işlemi (yetkiye göre), saat sırasıyla. */
export async function PlatformToday({ role }: { role: PlatformAccessSubject }) {
  const h = await loadPlatformHome(role);
  const can = (m: PlatformModule) => platformCanAccess(role, m);
  const rows: FeedRow[] = [];
  if (h.ok && can("tenants")) for (const t of h.today.tenants ?? []) rows.push({ id: `t-${t.id}`, at: t.created_at, label: t.name || "Yeni ofis", hint: "Yeni ofis açıldı", href: `/admin/tenants/${t.id}`, icon: Building2, tone: "mint" });
  if (h.ok && can("tickets")) for (const t of h.today.tickets ?? []) rows.push({ id: `k-${t.id}`, at: t.created_at, label: t.subject || "Destek talebi", hint: "Yeni destek talebi", href: `/admin/tickets/${t.id}`, icon: LifeBuoy, tone: "cyan" });
  if (h.ok && can("activity")) for (const a of h.today.audit ?? []) rows.push({ id: `a-${a.id}`, at: a.created_at, label: auditActionLabel(a.action), hint: "Platform işlemi", href: "/admin/aktivite", icon: ShieldCheck, tone: "slate" });
  rows.sort((a, b) => (a.at < b.at ? 1 : -1));
  const shown = collapseFeed(rows).slice(0, 8);
  return (
    <section className="kh-card kh-timeline" aria-labelledby="pl-today-title">
      <div className="kh-card-head">
        <span className="kh-ico t-brand" aria-hidden="true">
          <Gauge className="h-[18px] w-[18px]" />
        </span>
        <h2 id="pl-today-title" className="kh-card-title">
          Bugün platformda
        </h2>
        {can("activity") ? (
          <Link href="/admin/aktivite" className="kh-seeall focus-ring ml-auto">
            Tümünü gör
          </Link>
        ) : null}
      </div>
      {!h.ok ? (
        <EmptyState variant="compact" illustration="rapor" title="Akış okunamadı" description="Bugünün kayıtları şu an alınamadı; birkaç saniye sonra yenileyin." />
      ) : shown.length === 0 ? (
        <EmptyState variant="compact" illustration="rapor" title="Bugün henüz hareket yok" description="Yeni ofis, destek talebi ve platform işlemleri gün içinde burada saat sırasıyla görünür." />
      ) : (
        <ol className="kh-tl-list">
          {shown.map((r) => (
            <li key={r.id} className={`kh-tl-row t-${r.tone}`}>
              <time className="kh-tl-time" dateTime={r.at}>
                {formatTrTime(r.at)}
              </time>
              <span className="kh-tl-bar" aria-hidden="true" />
              <span className={`kh-ico sm t-${r.tone}`} aria-hidden="true">
                <r.icon className="h-4 w-4" />
              </span>
              <Link href={r.href} className="kh-tl-main focus-ring" title={`${r.label} · ${r.hint}`}>
                <span className="kh-clamp2 text-sm font-semibold text-[var(--heading)]">
                  {r.label}
                  {r.times > 1 ? <span className="ml-1 font-medium text-text-muted">×{formatNumberTr(r.times)}</span> : null}
                </span>
                <span className="kh-clamp2 text-xs text-text-muted">{r.hint}</span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export { CardSkeleton };
