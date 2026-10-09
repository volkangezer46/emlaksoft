import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { assertQueryBatchSucceeded } from "@/lib/supabase/query-batch";
import Link from "@/components/ui/smart-link";
import {
  AlertTriangle, Award, Building2, CalendarCheck2, CalendarClock, ChevronLeft, ChevronRight, Crown, Flame,
  Handshake, HelpCircle, Medal, Minus, Rocket, Star, Target, TrendingDown, TrendingUp, Trophy,
  Tv, Users, Zap,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Avatar } from "@/components/ui/avatar";
import { requireModulePage } from "@/lib/require-module-page";
import { EmptyState } from "@/components/ui/empty-state";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Table, TableFrame, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { TvAutoRefresh, TvClock } from "@/app/app/tv-mode";
import { now } from "@/lib/clock";
import { measure } from "@/lib/server-timing";
import { getSampleScope } from "@/lib/sample-scope";
import { cachedTenantAggregate } from "@/lib/cache/tenant-aggregate";
import {
  BADGES,
  BADGE_BY_CODE,
  SCORE_RULES,
  SCORE_RULE_HINTS,
  SCORE_RULE_KEYS,
  SCORE_RULE_LABELS,
  evaluateBadges,
  type AgentStats,
} from "@/lib/gamification";
import {
  LEAGUE_ROLES,
  loadLeagueData,
  loadLeagueSettings,
  periodOf,
  periodRange,
  previousPeriod,
} from "@/lib/gamification-query";
import { currentLeaguePeriod, isWeekKey, nextLeaguePeriod, previousLeaguePeriod } from "@/lib/league/periods";
import { lowActivityAdvisors } from "@/lib/league/coach";
import { evidenceHref } from "@/lib/league/evidence";
import { loadChallengeBoard } from "@/lib/league/challenge-load";
import { loadAdvisorMetrics, trMonthPeriod } from "@/lib/team/advisor-metrics";

import { PageHeader } from "@/components/ui/page-header";
import { podiumColumns } from "@/components/ui/dashboard-grid";
import { HelpTip } from "@/components/ui/help-tip";
import { roleLabel } from "@/lib/role-labels";
import { ChallengesPanel } from "./challenges-panel";
import { LeagueRulesForm } from "./rules-form";

export const metadata = { title: "Ekip Ligi" };
/**
 * /app/lig — ofis motivasyon ekranı (Lig 2.0).
 *
 * NE ÇÖZÜYOR: Ofiste "kim ne kadar üretti" sorusu ya hiç sorulmuyor ya da ay
 * sonu toplantısında tek seferde konuşuluyor. Lig tablosu bunu HAFTALIK/AYLIK ve
 * ŞEFFAF yapıyor: puan kuralı herkese açık ve ofis ayarlı, sıralama canlı, her adet
 * tıklanınca kanıt kayıtlarına gider, rozet kalıcı. `?tv=1` ile ofis ekranına asılır.
 *
 * KAZANÇ GİZLİLİĞİ (P12): ligde CİRO/KOMİSYON TUTARI GÖSTERİLMEZ — yalnız puan ve adet.
 * Tutar sütunu/sıralaması ofis yöneticisi `Kurallar` sekmesinden bilinçli açmadıkça hiç sorgulanmaz.
 *
 * KPI PANELİNDEN FARKI: /app/danisman-kpi bir KARNE — ciro/dönüşüm/koç
 * önerisi, yöneticiye bakar. Burası bir OYUN — puan/rozet/seri, danışmana
 * bakar. İkisi ayrı formül kullanır ve bu bilinçlidir.
 *
 * Sekmeler (?sekme=): sıralama (varsayılan) · meydan okumalar · kurallar.
 */

export const dynamic = "force-dynamic";

/** Rozet ikon adı → lucide bileşeni. Katalog (lib) React bilmez; eşleme burada. */
const BADGE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Handshake, Building2, Target, Crown, Medal, Star, Zap, Flame, CalendarClock,
  Rocket, CalendarCheck2, Users,
};

function badgeIcon(name: string) {
  return BADGE_ICONS[name] ?? Award;
}

function dateLabel(iso: string) {
  return new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(iso));
}

/**
 * Sıra değişim rozeti — önceki dönemin sırasına göre.
 * Pozitif delta = yükseliş (mint), negatif = geriye düşüş (danger).
 */
function RankTrend({ current, previous, unit }: { current: number; previous: number | undefined; unit: string }) {
  const dat = unit === "hafta" ? "haftaya" : "aya";
  if (previous === undefined) {
    return (
      <span
        title={`Geçen ${unit} ligde kaydı yok — ilk kez sıralandı`}
        className="inline-flex items-center rounded-full bg-surface-accent-soft px-1.5 py-0.5 text-xs font-bold text-accent-text"
      >
        yeni
      </span>
    );
  }
  const delta = previous - current; // pozitif = yukarı çıktı
  if (delta === 0) {
    return (
      <span title={`Geçen ${dat} göre sıra değişmedi`} className="inline-flex text-text-faint">
        <Minus className="h-3 w-3" />
      </span>
    );
  }
  const up = delta > 0;
  return (
    <span
      title={`Geçen ${dat} göre ${Math.abs(delta)} sıra ${up ? "yükseldi" : "geriledi"}`}
      className={`inline-flex items-center gap-0.5 text-xs font-bold tabular-nums ${up ? "text-success-strong" : "text-danger-strong"}`}
    >
      {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {Math.abs(delta)}
    </span>
  );
}

type SearchParams = { donem?: string; kapsam?: string; tv?: string; sekme?: string; sirala?: string };

export default async function LigPage({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  const { tenantId, userId, role, perms } = await requireModulePage("reports", "/app/lig");
  const sp = (await searchParams) ?? {};
  const tvMode = sp.tv === "1";
  const sekme = sp.sekme === "meydan" ? "meydan" : sp.sekme === "kurallar" ? "kurallar" : "siralama";

  // Platform ekibi (impersonation dışı) tek bir ofise bağlı değil — lig
  // ofis içi bir yarış, kiracısız bağlamda anlamı yok.
  if (!tenantId) {
    return (
      <EmptyState illustration="ekip"
        icon={Trophy}
        title="Lig tablosu ofis bağlamı ister"
        description="Platform hesabıyla giriş yaptınız. Bir ofisin lig tablosunu görmek için o ofise geçiş yapın."
        action={{ href: "/app", label: "Panele dön" }}
      />
    );
  }

  const canCreate = (perms.targets ?? []).includes("create");
  const canEdit = (perms.targets ?? []).includes("edit");

  const nowMs = now();
  const todayIso = new Date(nowMs).toISOString().slice(0, 10);

  // ?donem=YYYY-MM veya YYYY-Www — geçersiz veya GELECEK dönem bu döneme düşer
  // (geleceğe gezinme yok, henüz olmamış bir yarış).
  const askedRaw = sp.donem ?? "";
  const kind: "month" | "week" = isWeekKey(askedRaw) ? "week" : "month";
  const currentPeriod = currentLeaguePeriod(kind, nowMs);
  const askedValid = kind === "week" ? periodRange(askedRaw).period === askedRaw : /^\d{4}-\d{2}$/.test(askedRaw);
  const asked = askedValid ? askedRaw : currentPeriod;
  const period = asked > currentPeriod ? currentPeriod : asked;
  const range = periodRange(period);
  const isCurrent = period === currentPeriod;
  const unit = kind === "week" ? "hafta" : "ay";

  const supabase = await createClient();

  // Şube kapsamı: ofiste birden çok şube varsa "kapsam" seçici görünür. Şube listesi ile ayarlar bağımsız: tek turda.
  const [branchRes, settings] = await Promise.all([
    supabase.from("branches").select("id, name").eq("tenant_id", tenantId).eq("is_active", true).limit(50),
    loadLeagueSettings(supabase, tenantId),
  ]);
  assertQueryBatchSucceeded([branchRes], ["lig-subeler"], "Lig");
  const branches = branchRes.data ?? [];
  const branchId = branches.some((b) => String(b.id) === sp.kapsam) ? sp.kapsam! : null;

  const showAmounts = settings.showAmounts && !tvMode && range.kind === "month";
  const wantsPrev = !tvMode && sekme === "siralama";
  const badgeMonth = range.kind === "week" ? periodOf(new Date(nowMs)) : period;

  // Tutar sütunu (P12): YALNIZ ofis yöneticisi "tutar bazlı sıralamayı aç" dediyse sorgulanır. Kapalıyken ligde
  // hiçbir ciro/komisyon verisi okunmaz ve çizilmez. Açıkken de değerler kişinin kazanç görme yetkisine tabidir.
  const metricsP = (async () => {
    if (showAmounts) {
      const [py, pm] = period.split("-").map(Number);
      return await loadAdvisorMetrics(supabase, {
        viewer: { userId, role, perms },
        tenantId,
        period: trMonthPeriod(py, pm - 1),
        nowMs,
      });
    }
    return null;
  })();

  // Kazanılmış rozetler (DB) — dönemsel rozetler AYA yazılır (haftalık görünümde içinde bulunulan ay),
  // ömür boyu rozetler period IS NULL satırına düşer. `or` ile tek sorguda.
  const badgesP = fetchAllRows((from, to) =>
    supabase
      .from("agent_badges")
      .select("staff_id, badge_code, earned_at, period")
      .eq("tenant_id", tenantId)
      .or(`period.eq.${badgeMonth},period.is.null`)
      .order("id", { ascending: true })
      .range(from, to),
  );

  // ── Önceki döneme göre sıra değişimi ────────────────────────────────────
  // Aylıkta mühürlü `agent_score_snapshots` (cron lig-snapshot) kullanılır; mühür yoksa (hafta, ya da ay kapanışı
  // henüz mühürlenmemiş, ya da şube kapsamı) önceki dönem aynı hesapla CANLI sıralanır.
  const prevRankP = (async () => {
    const out = new Map<string, number>();
    if (!wantsPrev) return out;
    if (range.kind === "month" && branchId === null) {
      const { data: prevSnaps } = await supabase
        .from("agent_score_snapshots")
        .select("staff_id, rank")
        .eq("tenant_id", tenantId)
        .eq("period", previousPeriod(period));
      for (const s of prevSnaps ?? []) {
        if (s.rank != null) out.set(String(s.staff_id), Number(s.rank));
      }
    }
    if (out.size === 0) {
      // Önceki dönemin canlı sıralaması 20+ sorgu: kısa süreli (tenant + kullanıcı + dönem + şube anahtarlı) önbellek.
      // Yalnız [staffId, sıra] çiftleri saklanır (JSON); yazma action'ları etiketi düşürür.
      const pairs = await measure("lig-onceki-donem", () =>
        cachedTenantAggregate(
          "lig-onceki-donem",
          { tenantId, userId, scope: `${period}:${branchId ?? "-"}` },
          async () => {
            const prev = await loadLeagueData(supabase, {
              period: previousLeaguePeriod(period, nowMs), tenantId, branchId, todayIso, nowMs, settings,
            });
            return prev.ranked.filter((r) => r.total > 0).map((r) => [r.staffId, r.rank] as [string, number]);
          },
          120,
        ));
      for (const [staffId, rank] of pairs) out.set(staffId, rank);
    }
    return out;
  })();

  // Bu dönemin lig verisi + yukarıdaki bağımsız okumalar BİRLİKTE (eskiden ~6 ardışık tur).
  // Meydan okuma panosu lig verisini BEKLEMEZ: örnek-veri kapsamı ortak tek okuma, danışman kümesi lig profil okumasından söz olarak
  // gelir (etkinlik sorguları kümeyi en sonda bekler). Eskiden lig bitince ardışık başlıyordu (+~300 ms).
  const sampleP = getSampleScope(supabase, tenantId);
  const leagueP = measure("lig-veri", () => loadLeagueData(supabase, { period, tenantId, branchId, todayIso, nowMs, settings, sampleScope: sampleP }));
  const agentIdsP = leagueP.then((l) => new Set(l.agents.map((a) => a.id)) as ReadonlySet<string>);
  agentIdsP.catch(() => undefined);
  const challengeP = sekme !== "kurallar"
    ? measure("lig-meydan-okuma", () => loadChallengeBoard(supabase, { tenantId, agentIds: agentIdsP, includeSample: sampleP.then((s) => s.include), nowMs }))
    : Promise.resolve([]);
  const [league, metrics, badgeRes, prevRankByStaff, challengeCards] = await Promise.all([
    leagueP,
    metricsP,
    badgesP,
    prevRankP,
    challengeP,
  ]);

  assertQueryBatchSucceeded([badgeRes], ["lig-rozetler"], "Lig");
  const badgeRows = badgeRes.data;

  const metricsById = new Map<string, { dealCount: number; revenue: number | null }>();
  if (metrics) for (const m of metrics.rows) metricsById.set(m.id, { dealCount: m.dealCount, revenue: m.revenue });

  // Avatarlar lig profil okumasıyla birlikte gelir (ayrı sorgu yok).
  const avatars = new Map(league.agents.map((a) => [a.id, { avatar_url: a.avatarUrl, avatar_preset: a.avatarPreset }]));

  /** staffId → (badgeCode → kazanma tarihi) */
  const earnedDb = new Map<string, Map<string, string>>();
  for (const r of badgeRows ?? []) {
    const sid = String(r.staff_id);
    const m = earnedDb.get(sid) ?? new Map<string, string>();
    m.set(String(r.badge_code), String(r.earned_at));
    earnedDb.set(sid, m);
  }

  const hasPrevRanks = prevRankByStaff.size > 0;

  const agentById = new Map(league.agents.map((a) => [a.id, a]));

  /**
   * Gösterilen rozet = DB'de MÜHÜRLÜ olan ∪ ŞU AN koşulu sağlanan.
   * Birleşim bilinçli: cron mühürler, ama danışman ayın 10'unda
   * "5. anlaşmamı yaptım" dediğinde rozeti aynı gün görmeli. Mühürlü rozet
   * ise koşul sonradan bozulsa bile (kayıt silindi vs.) geri alınmaz.
   * Haftalık görünümde yalnız ömür boyu rozetler canlı değerlendirilir (aylık eşikler haftaya uygulanmaz).
   */
  function badgesOf(staffId: string, stats: AgentStats) {
    const db = earnedDb.get(staffId);
    const live = new Set(evaluateBadges(stats, range.kind === "week" ? { scope: "lifetime" } : {}));
    const codes = new Set<string>([...(db?.keys() ?? []), ...live]);
    return BADGES.filter((b) => codes.has(b.code)).map((b) => ({
      def: b,
      earnedAt: db?.get(b.code) ?? null,
    }));
  }

  let rows = league.ranked.map((r) => {
    const stats = league.statsById.get(r.staffId) ?? null;
    return {
      ...r,
      agent: agentById.get(r.staffId) ?? null,
      streak: league.streakById.get(r.staffId) ?? 0,
      badges: stats ? badgesOf(r.staffId, stats) : [],
    };
  }).filter((r) => r.agent !== null);

  // Tutar bazlı görünüm (yalnız ayarla açıksa): tablo sırası tutara göre; "#" sütunu PUAN sırasında kalır.
  const sortByAmount = showAmounts && sp.sirala === "tutar";
  if (sortByAmount) {
    rows = [...rows].sort((a, b) => (metricsById.get(b.staffId)?.revenue ?? -1) - (metricsById.get(a.staffId)?.revenue ?? -1));
  }
  // Profil fotoğrafı / hazır avatar (ayrı, hata-toleranslı tek sorgu; yoksa baş harf).
  const hasActivity = rows.some((r) => r.total > 0);
  const podium = rows.filter((r) => r.total > 0 && !sortByAmount).slice(0, 3);

  // Dönem gezinme linkleri
  const keepScope = branchId ? `&kapsam=${branchId}` : "";
  const tabQs = sekme === "siralama" ? "" : `&sekme=${sekme}`;
  const linkFor = (p: string, extra = "") => `/app/lig?donem=${p}${keepScope}${extra}`;
  const prevHref = linkFor(previousLeaguePeriod(period, nowMs), tabQs);
  const nextHref = isCurrent ? null : linkFor(nextLeaguePeriod(period, nowMs), tabQs);
  const monthPeriod = currentLeaguePeriod("month", nowMs);
  const weekPeriod = currentLeaguePeriod("week", nowMs);

  // Kişisel rozet galerisi oturum açan kullanıcı içindir.
  const myRow = rows.find((r) => r.staffId === userId) ?? null;
  const myStats = myRow ? league.statsById.get(userId) ?? null : null;
  const myEarned = new Map((myRow?.badges ?? []).map((b) => [b.def.code, b.earnedAt]));

  // Düşük aktivite uyarısı (yalnız içinde bulunulan dönem, yönetici): kanıtlı, ofis medyanına göre.
  const elapsed = isCurrent ? Math.max(0, Math.min(1, (nowMs - range.startMs) / (range.endMs - range.startMs))) : 1;
  const lowFindings = canEdit && isCurrent && branchId === null
    ? lowActivityAdvisors(
        rows.filter((r) => LEAGUE_ROLES.includes(r.agent!.role as (typeof LEAGUE_ROLES)[number]))
          .map((r) => ({ staffId: r.staffId, name: r.agent!.fullName, total: r.total, activityCount: r.activityCount })),
        elapsed,
      )
    : [];

  // ── TV MODU ─────────────────────────────────────────────────────────────
  // Ofis ekranına asılan sade tablo: yalnız sıra/ad/puan/seri. Filtre yok,
  // link yok (kimse TV'ye tıklamaz), 30 sn'de bir sunucu verisi tazelenir.
  if (tvMode) {
    return (
      <div className="tv-zoom space-y-5">
        <TvAutoRefresh intervalMs={30_000} />
        <div className="theme-dark flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] bg-[image:var(--grad-ink)] px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="status-pulse h-3 w-3 rounded-full bg-mint-400" />
            <p className="font-display text-2xl font-extrabold text-white">
              Ekip Ligi · <span className="capitalize">{range.label}</span>
            </p>
            <span className="rounded-full bg-white/10 px-2.5 py-1 text-sm font-semibold text-white/70">
              30 sn’de bir yenilenir
            </span>
          </div>
          <div className="flex items-center gap-4">
            <TvClock />
            <Link
              href={`/app/lig?donem=${period}${keepScope}`}
              className="focus-ring press rounded-[var(--radius-control)] border border-white/15 bg-white/5 px-3 py-1.5 text-sm font-semibold text-white/80 transition hover:bg-white/10 hover:text-white"
            >
              Çık
            </Link>
          </div>
        </div>

        {hasActivity ? (
          <TableFrame minWidth={640}>
            <Table>
              <THead>
                <TR>
                  <TH>#</TH>
                  <TH>Danışman</TH>
                  <TH align="right">Puan</TH>
                  <TH align="right">Anlaşma</TH>
                  <TH align="right">Seri</TH>
                </TR>
              </THead>
              <TBody>
                {rows.filter((r) => r.total > 0).slice(0, 12).map((r) => (
                  <TR key={r.staffId}>
                    <TD>
                      <span
                        className={`numeric font-display text-2xl font-extrabold ${
                          r.rank === 1 ? "text-amber-500" : r.rank === 2 ? "text-text-muted" : r.rank === 3 ? "text-amber-700" : "text-text-faint"
                        }`}
                      >
                        {r.rank}
                      </span>
                    </TD>
                    <TD>
                      <span className="flex items-center gap-3 font-display text-xl font-bold text-text">
                        <Avatar name={r.agent!.fullName} src={avatars.get(r.staffId)?.avatar_url} preset={avatars.get(r.staffId)?.avatar_preset} size="lg" />
                        {r.agent!.fullName}
                      </span>
                    </TD>
                    <TD align="right">
                      <span className="numeric font-display text-2xl font-extrabold text-accent-text">{r.total}</span>
                    </TD>
                    <TD align="right">
                      <span className="numeric text-xl font-bold text-text">{r.breakdown.deal_won.count}</span>
                    </TD>
                    <TD align="right">
                      <span className="numeric text-xl font-bold text-amber-600">
                        {r.streak > 0 ? `🔥 ${r.streak}` : "—"}
                      </span>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableFrame>
        ) : (
          <p className="py-20 text-center font-display text-2xl font-bold text-text-muted">
            Bu dönemde henüz aktivite yok.
          </p>
        )}
      </div>
    );
  }

  // ── NORMAL MOD ──────────────────────────────────────────────────────────
  const podiumStyle = [
    { order: "sm:order-2", bar: "h-24 bg-amber-400", ring: "bg-amber-400 text-ink-950", medal: "🥇", tone: "border-amber-400/60" },
    { order: "sm:order-1", bar: "h-16 bg-ink-950/20", ring: "bg-canvas text-text-muted border border-line-strong", medal: "🥈", tone: "border-line-strong" },
    { order: "sm:order-3", bar: "h-12 bg-amber-700/40", ring: "bg-amber-700/15 text-amber-700", medal: "🥉", tone: "border-amber-700/40" },
  ];

  const tabOptions = [
    { value: "siralama", label: "Sıralama", href: linkFor(period) },
    { value: "meydan", label: "Meydan okumalar", href: linkFor(period, "&sekme=meydan") },
    { value: "kurallar", label: "Puan kuralları", href: linkFor(period, "&sekme=kurallar") },
  ];

  const liveChallenges = challengeCards.filter((c) => c.state === "live");
  const nameById = new Map(league.agents.map((a) => [a.id, a.fullName]));

  const ruleItems = SCORE_RULE_KEYS.map((key) => ({
    key,
    label: SCORE_RULE_LABELS[key],
    hint: SCORE_RULE_HINTS[key],
    points: settings.ruleset[key],
    defaultPoints: SCORE_RULES[key],
  }));
  const metricOptions = SCORE_RULE_KEYS.map((key) => ({ value: key, label: SCORE_RULE_LABELS[key] }));
  const defaultStart = new Date(nowMs + 3 * 3_600_000).toISOString().slice(0, 10);
  const defaultEnd = new Date(nowMs + 3 * 3_600_000 + 29 * 86_400_000).toISOString().slice(0, 10);

  return (
    <div className="space-y-6">
      {/* Hero: dönem seçici + kapsam + TV modu girişi */}
      <PageHeader title="Lig Tablosu" eyebrow="Ekip ligi" description={<>Haftalık ve aylık puan sıralaması, meydan okumalar, rozetler ve çalışma serileri. <HelpTip topic="lig" /></>} actions={
<div className="flex flex-wrap items-center gap-3"><div className="flex items-center gap-3">
            <Link
              href="/app/danisman-kpi"
              className="focus-ring press rounded-[var(--radius-control)] border border-line bg-surface px-3.5 py-2 text-xs font-semibold text-text-muted transition hover:bg-surface-2 hover:text-text"
            >
              Danışman KPI karnesi
            </Link>
            <Link
              href={`/app/lig?donem=${period}${keepScope}&tv=1`}
              title="TV modu — ofis ekranı görünümü"
              aria-label="TV modunu aç"
              className="focus-ring press grid h-9 w-9 place-items-center rounded-[var(--radius-control)] border border-line bg-surface text-text-muted transition hover:bg-surface-2 hover:text-text"
            >
              <Tv className="h-4 w-4" />
            </Link>
          </div>
<><div className="flex flex-wrap items-center gap-1">
              <Link
                href={prevHref}
                className="focus-ring grid h-9 w-9 place-items-center rounded-[var(--radius-control)] border border-line text-text-muted transition hover:bg-surface-2 hover:text-text"
                aria-label="Önceki dönem"
              >
                <ChevronLeft className="h-4 w-4" />
              </Link>
              <span className="min-w-[128px] px-2 text-center text-sm font-bold text-text first-letter:uppercase">
                {range.label}
              </span>
              {nextHref ? (
                <Link
                  href={nextHref}
                  className="focus-ring grid h-9 w-9 place-items-center rounded-[var(--radius-control)] border border-line text-text-muted transition hover:bg-surface-2 hover:text-text"
                  aria-label="Sonraki dönem"
                >
                  <ChevronRight className="h-4 w-4" />
                </Link>
              ) : (
                <span
                  className="grid h-9 w-9 cursor-not-allowed place-items-center rounded-[var(--radius-control)] border border-line text-text-faint opacity-60"
                  aria-hidden="true"
                >
                  <ChevronRight className="h-4 w-4" />
                </span>
              )}
              {!isCurrent ? (
                <Link
                  href={linkFor(currentPeriod, tabQs)}
                  className="focus-ring ml-1 rounded-[var(--radius-control)] border border-line px-2.5 py-1.5 text-xs font-semibold text-text-muted transition hover:bg-surface-2 hover:text-text"
                >
                  {kind === "week" ? "Bu hafta" : "Bu ay"}
                </Link>
              ) : null}
            </div>

            {/* Dönem türü: hafta / ay */}
            <div className="flex flex-wrap items-center gap-1.5">
              <Link
                href={linkFor(weekPeriod, tabQs)}
                aria-current={kind === "week" ? "true" : undefined}
                className={`focus-ring rounded-full px-3 py-1 text-xs font-semibold transition ${
                  kind === "week" ? "bg-accent text-accent-fg" : "border border-line text-text-muted hover:bg-surface-2"
                }`}
              >
                Haftalık
              </Link>
              <Link
                href={linkFor(monthPeriod, tabQs)}
                aria-current={kind === "month" ? "true" : undefined}
                className={`focus-ring rounded-full px-3 py-1 text-xs font-semibold transition ${
                  kind === "month" ? "bg-accent text-accent-fg" : "border border-line text-text-muted hover:bg-surface-2"
                }`}
              >
                Aylık
              </Link>
            </div>

            {/* Kapsam: yalnız birden çok şube varsa anlamlı */}
            {branches.length > 1 ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <Link
                  href={`/app/lig?donem=${period}${tabQs}`}
                  className={`focus-ring rounded-full px-3 py-1 text-xs font-semibold transition ${
                    branchId === null ? "bg-accent text-accent-fg" : "border border-line text-text-muted hover:bg-surface-2"
                  }`}
                >
                  Tüm ofis
                </Link>
                {branches.map((b) => (
                  <Link
                    key={String(b.id)}
                    href={`/app/lig?donem=${period}&kapsam=${b.id}${tabQs}`}
                    className={`focus-ring rounded-full px-3 py-1 text-xs font-semibold transition ${
                      branchId === String(b.id) ? "bg-accent text-accent-fg" : "border border-line text-text-muted hover:bg-surface-2"
                    }`}
                  >
                    {String(b.name)}
                  </Link>
                ))}
              </div>
            ) : null}</></div>
} />

      <SegmentedControl options={tabOptions} value={sekme} label="Lig bölümleri" className="max-w-xl" />

      {sekme === "meydan" ? (
        <ChallengesPanel
          cards={challengeCards}
          names={nameById}
          nowMs={nowMs}
          canCreate={canCreate}
          canEdit={canEdit}
          metrics={metricOptions}
          defaultStart={defaultStart}
          defaultEnd={defaultEnd}
        />
      ) : sekme === "kurallar" ? (
        <section className="surface-card space-y-4 rounded-[var(--radius-panel)] p-5">
          <div>
            <p className="flex items-center gap-2 text-xs font-semibold text-accent-text">
              <Target className="h-4 w-4" /> Nasıl puan kazanılır
            </p>
            <p className="mt-1 text-xs text-text-muted">
              Puan kuralları herkese açıktır{settings.customized ? " ve bu ofis için özelleştirilmiştir" : " (varsayılan değerler)"}.
              Her puan gerçek bir kayıttan gelir; örnek (demo) veri sayılmaz, aynı kayıt iki kez sayılmaz, silinen veya
              geri alınan kayıt puanını düşürür. 0 puan = kural kapalı. Ciro/komisyon tutarı ligde puan kaynağı değildir.
            </p>
          </div>
          {canEdit ? (
            <LeagueRulesForm items={ruleItems} showAmounts={settings.showAmounts} />
          ) : (
            <ScoreRulesCard ruleset={settings.ruleset} />
          )}
        </section>
      ) : !hasActivity ? (
        <>
          <EmptyState illustration="ekip"
            icon={Trophy}
            title="Bu dönemde henüz aktivite yok"
            description={`${range.label} döneminde puan üreten bir kayıt bulunamadı. Aşağıdaki kalemlerden herhangi biri puan getirir.`}
            tone="amber"
            action={{ href: "/app/portfoyler", label: "Portföylere git" }}
          />
          <ScoreRulesCard ruleset={settings.ruleset} />
        </>
      ) : (
        <>
          {/* ── Süren meydan okumalar (kısa şerit) ───────────────────── */}
          {liveChallenges.length > 0 ? (
            <section className="grid gap-3 sm:grid-cols-2" aria-label="Süren meydan okumalar">
              {liveChallenges.slice(0, 2).map(({ def, progress }) => (
                <Link
                  key={def.id}
                  href={linkFor(period, "&sekme=meydan")}
                  className="focus-ring press lift surface-card block rounded-[var(--radius-card)] p-4"
                >
                  <p className="flex items-center gap-2 text-xs font-semibold text-accent-text">
                    <Rocket className="h-4 w-4" aria-hidden="true" /> Meydan okuma
                  </p>
                  <p className="mt-1 truncate font-display text-sm font-bold text-text">{def.title}</p>
                  <p className="mt-1 text-xs text-text-muted">
                    <span className="numeric font-bold text-text">{progress.current}</span> / {progress.target} ·{" "}
                    {SCORE_RULE_LABELS[def.metric]}
                  </p>
                  <div
                    className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-line"
                    role="progressbar"
                    aria-label={`${def.title} ilerlemesi`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={progress.pct}
                  >
                    <div className="h-full rounded-full bg-accent" style={{ width: `${progress.pct}%` }} />
                  </div>
                </Link>
              ))}
            </section>
          ) : null}

          {/* ── Düşük aktivite uyarısı (yönetici, kanıtlı) ──────────────── */}
          {lowFindings.length > 0 ? (
            <section className="rounded-[var(--radius-card)] border border-amber-400/50 bg-amber-400/10 p-4" aria-label="Düşük aktivite uyarısı">
              <p className="flex items-center gap-2 text-xs font-bold text-amber-700">
                <AlertTriangle className="h-4 w-4" aria-hidden="true" /> Düşük aktivite uyarısı
              </p>
              <ul className="mt-2 space-y-1">
                {lowFindings.map((f) => (
                  <li key={f.staffId}>
                    <Link href={f.href} className="focus-ring rounded text-sm text-text hover:text-accent-text hover:underline">
                      {f.evidence}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {/* ── PODYUM: ilk üç ─────────────────────────────────────────── */}
          {podium.length > 0 ? (
            <section className={`dashboard-panel relative overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface p-6 ${podium.length === 1 ? "mx-auto w-full max-w-md text-center" : ""}`}>
              <div className="pointer-events-none absolute -left-10 -top-16 h-48 w-48 rounded-full bg-amber-400/15 blur-[70px]" />
              <div className="relative">
                <p className={`flex items-center gap-2 text-xs font-semibold text-amber-600 ${podium.length === 1 ? "justify-center" : ""}`}>
                  <Crown className="h-4 w-4" /> Podyum
                </p>
                <h2 className="mt-1 font-display text-lg font-bold text-text first-letter:uppercase">
                  {podium.length === 1 ? `${range.label} lideri` : `${range.label} ilk üçü`}
                </h2>
                <div className={`mt-6 grid gap-3 sm:items-end ${podiumColumns(podium.length)}`}>
                  {podium.map((r, i) => {
                    const s = podiumStyle[i];
                    return (
                      <Link
                        key={r.staffId}
                        href={`/app/ekip/${r.staffId}`}
                        className={`focus-ring press lift group flex flex-col rounded-[var(--radius-panel)] border-2 bg-canvas/40 p-4 text-center transition hover:border-brand-300 ${s.tone} ${s.order}`}
                        aria-label={`${r.rank}. sıra: ${r.agent!.fullName} — ${r.total} puan`}
                      >
                        <Avatar name={r.agent!.fullName} src={avatars.get(r.staffId)?.avatar_url} preset={avatars.get(r.staffId)?.avatar_preset} size="lg" className="mx-auto h-14 w-14 text-base" />
                        <p className="mt-2 flex items-center justify-center gap-1 truncate font-display text-sm font-bold text-text group-hover:text-accent-text">
                          <span aria-hidden="true">{s.medal}</span> {r.agent!.fullName}
                        </p>
                        <p className="numeric font-display text-2xl font-extrabold text-accent-text">{r.total}</p>
                        <p className="text-xs text-text-muted">
                          puan · {r.badges.length} rozet
                          {r.streak > 0 ? ` · 🔥 ${r.streak} gün` : ""}
                        </p>
                        <div className={`mt-3 w-full rounded-t-[var(--radius-control)] ${s.bar}`} aria-hidden="true" />
                      </Link>
                    );
                  })}
                </div>
              </div>
            </section>
          ) : null}

          {showAmounts ? (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-text-muted">Sıralama:</span>
              <Link
                href={linkFor(period)}
                className={`focus-ring rounded-full px-3 py-1 font-semibold ${!sortByAmount ? "bg-accent text-accent-fg" : "border border-line text-text-muted hover:bg-surface-2"}`}
              >
                Puana göre
              </Link>
              <Link
                href={linkFor(period, "&sirala=tutar")}
                className={`focus-ring rounded-full px-3 py-1 font-semibold ${sortByAmount ? "bg-accent text-accent-fg" : "border border-line text-text-muted hover:bg-surface-2"}`}
              >
                Tutara göre
              </Link>
            </div>
          ) : null}

          {/* ── LİG TABLOSU ────────────────────────────────────────────── */}
          <TableFrame minWidth={showAmounts ? 1040 : 840}>
            <Table>
              <THead>
                <TR>
                  <TH>#</TH>
                  <TH>Danışman</TH>
                  <TH align="right">Puan</TH>
                  <TH>Puan kırılımı (adet)</TH>
                  {showAmounts ? <TH align="right">Satış</TH> : null}
                  {showAmounts ? <TH align="right">Gelir (pay)</TH> : null}
                  <TH align="right">Seri</TH>
                  <TH>Rozetler</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((r) => {
                  const ben = r.staffId === userId;
                  const parts = SCORE_RULE_KEYS
                    .filter((k) => r.breakdown[k].count > 0)
                    .sort((a, b) => r.breakdown[b].points - r.breakdown[a].points);
                  return (
                    <TR key={r.staffId} interactive className={ben ? "bg-surface-accent-soft" : undefined}>
                      <TD>
                        <div className="flex items-center gap-2">
                          <span
                            className={`numeric font-display font-bold ${
                              r.rank === 1 ? "text-amber-500" : r.rank === 2 ? "text-text-muted" : r.rank === 3 ? "text-amber-700" : "text-text-faint"
                            }`}
                          >
                            {r.rank}
                          </span>
                          {/* Önceki döneme göre sıra değişimi */}
                          {hasPrevRanks ? (
                            <RankTrend current={r.rank} previous={prevRankByStaff.get(r.staffId)} unit={unit} />
                          ) : null}
                        </div>
                      </TD>
                      <TD>
                        <Link
                          href={`/app/ekip/${r.staffId}`}
                          className="absolute inset-0"
                          aria-label={`${r.agent!.fullName} danışman detayı`}
                        />
                        <div className="flex items-center gap-2.5">
                          <Avatar name={r.agent!.fullName} src={avatars.get(r.staffId)?.avatar_url} preset={avatars.get(r.staffId)?.avatar_preset} size="md" />
                          <div className="min-w-0">
                            <p className="font-semibold text-text group-hover:text-accent-text">
                              {r.agent!.fullName}
                              {ben ? (
                                <span className="ml-1.5 rounded-full bg-surface-accent-soft px-1.5 py-0.5 text-xs font-bold text-accent-text">
                                  sen
                                </span>
                              ) : null}
                            </p>
                            <p className="text-xs text-text-faint">{roleLabel(r.agent!.role)}</p>
                          </div>
                        </div>
                      </TD>
                      <TD align="right">
                        <span className="numeric font-display text-base font-extrabold text-accent-text">{r.total}</span>
                      </TD>
                      {/* Kırılım: her adet, puanı üreten kayıtların listesine gider (kanıt) */}
                      <TD>
                        {parts.length === 0 ? (
                          <span className="text-xs text-text-faint">—</span>
                        ) : (
                          <span className="flex flex-wrap gap-1">
                            {parts.map((k) => (
                              <Link
                                key={k}
                                href={evidenceHref(k, r.staffId)}
                                className="focus-ring relative z-10 rounded-full border border-line bg-canvas px-2 py-0.5 text-xs font-semibold text-text-muted transition hover:border-brand-300 hover:text-accent-text"
                                aria-label={`${r.agent!.fullName}: ${r.breakdown[k].count} ${SCORE_RULE_LABELS[k]} (${r.breakdown[k].points} puan) — kayıtları aç`}
                                title={`${r.breakdown[k].points} puan`}
                              >
                                {SCORE_RULE_LABELS[k]} <span className="numeric font-bold text-text">{r.breakdown[k].count}</span>
                              </Link>
                            ))}
                          </span>
                        )}
                      </TD>
                      {showAmounts ? (
                        <TD align="right" className="text-text-muted">
                          {metricsById.has(r.staffId) ? (
                            <Link
                              href={`/app/teklifler?danisman=${r.staffId}&durum=accepted`}
                              className="focus-ring relative z-10 rounded-[var(--radius-control)] font-semibold hover:text-accent-text hover:underline"
                              aria-label={`${r.agent!.fullName} kabul edilen teklifleri`}
                            >
                              {metricsById.get(r.staffId)!.dealCount}
                            </Link>
                          ) : (
                            "—"
                          )}
                        </TD>
                      ) : null}
                      {showAmounts ? (
                        <TD align="right" className="font-semibold text-success-strong">
                          {metricsById.get(r.staffId)?.revenue ? (
                            <Link
                              href={r.staffId === userId ? "/app/cuzdan" : "/app/cuzdan?sekme=ofis"}
                              className="focus-ring relative z-10 rounded-[var(--radius-control)] hover:underline"
                            >
                              {new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(metricsById.get(r.staffId)!.revenue!)}
                            </Link>
                          ) : (
                            <span className="text-text-faint">—</span>
                          )}
                        </TD>
                      ) : null}
                      <TD align="right">
                        <span
                          className={`numeric text-xs font-bold ${r.streak > 0 ? "text-amber-600" : "text-text-faint"}`}
                          title={r.streak > 0 ? `${r.streak} gün kesintisiz aktivite` : "Seri yok"}
                        >
                          {r.streak > 0 ? `🔥 ${r.streak}` : "—"}
                        </span>
                      </TD>
                      <TD>
                        {r.badges.length === 0 ? (
                          <span className="text-xs text-text-faint">—</span>
                        ) : (
                          <span className="flex flex-wrap items-center gap-1">
                            {r.badges.slice(0, 6).map((b) => {
                              const Icon = badgeIcon(b.def.icon);
                              return (
                                <span
                                  key={b.def.code}
                                  title={b.earnedAt ? `${b.def.name} · ${dateLabel(b.earnedAt)}` : b.def.name}
                                  aria-label={b.def.name}
                                  className="grid h-6 w-6 place-items-center rounded-full bg-amber-400/15 text-amber-700"
                                >
                                  <Icon className="h-3.5 w-3.5" />
                                </span>
                              );
                            })}
                            {r.badges.length > 6 ? (
                              <span className="text-xs font-semibold text-text-muted">+{r.badges.length - 6}</span>
                            ) : null}
                          </span>
                        )}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </TableFrame>

          <ScoreRulesCard ruleset={settings.ruleset} />
        </>
      )}

      {/* ── ROZET GALERİSİ (kişisel) ─────────────────────────────────────── */}
      {sekme === "siralama" ? (
        <section className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className="flex items-center gap-2 text-xs font-semibold text-accent-text">
                <Award className="h-4 w-4" /> Rozet galerisi
              </p>
              <h2 className="mt-1 font-display text-lg font-bold text-text">
                {myRow ? `${myRow.agent!.fullName} — rozetlerin` : "Rozetler"}
              </h2>
            </div>
            <p className="text-xs text-text-muted">
              <span className="numeric font-bold text-text">{myEarned.size}</span> / {BADGES.length} rozet kazanıldı
            </p>
          </div>

          {!myStats ? (
            <p className="rounded-[var(--radius-card)] border border-line bg-canvas px-4 py-3 text-xs text-text-muted">
              Rozet galerisi kişiseldir — bu dönemde ligde yarışan bir danışman kaydınız bulunmuyor.
              Aşağıdaki kartlar yine de hangi rozetin nasıl kazanıldığını gösterir.
            </p>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {BADGES.map((b) => {
              const earnedAt = myEarned.get(b.code);
              const kazanildi = myEarned.has(b.code);
              const Icon = badgeIcon(b.icon);
              return (
                <div
                  key={b.code}
                  className={`surface-card rounded-[var(--radius-card)] p-4 transition ${kazanildi ? "" : "opacity-55"}`}
                >
                  <div className="flex items-start gap-3">
                    <span
                      className={`grid h-11 w-11 shrink-0 place-items-center rounded-[var(--radius-card)] ${
                        kazanildi ? "bg-amber-400/18 text-amber-700" : "bg-ink-950/6 text-text-faint"
                      }`}
                      aria-hidden="true"
                    >
                      <Icon className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 font-display text-sm font-bold text-text">
                        {b.name}
                        <span className="rounded-full bg-ink-950/5 px-1.5 py-0.5 text-xs font-bold uppercase tracking-[0.08em] text-text-faint">
                          {b.scope === "monthly" ? "aylık" : "kalıcı"}
                        </span>
                      </p>
                      {kazanildi ? (
                        <>
                          <p className="mt-0.5 text-xs text-text-muted">{b.description}</p>
                          <p className="mt-1 text-xs font-semibold text-success-strong">
                            {earnedAt ? `Kazanıldı · ${dateLabel(earnedAt)}` : "Kazanıldı · bu dönem"}
                          </p>
                        </>
                      ) : (
                        <p className="mt-0.5 flex items-start gap-1 text-xs text-text-muted">
                          <HelpCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-faint" />
                          {b.howTo}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}

/** Puan tablosu kartı — kural şeffaflığı ligin güvenilirliğinin şartı (ofis ayarlı değerler). */
function ScoreRulesCard({ ruleset }: { ruleset: Readonly<Record<(typeof SCORE_RULE_KEYS)[number], number>> }) {
  return (
    <section className="surface-card rounded-[var(--radius-panel)] p-5">
      <p className="flex items-center gap-2 text-xs font-semibold text-accent-text">
        <Target className="h-4 w-4" /> Nasıl puan kazanılır
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {SCORE_RULE_KEYS.map((key) => (
          <div key={key} className="flex items-center justify-between gap-3 rounded-[var(--radius-card)] bg-canvas px-3 py-2.5">
            <span className="text-xs text-text-muted">{SCORE_RULE_HINTS[key]}</span>
            <span className={`numeric shrink-0 font-display text-sm font-extrabold ${ruleset[key] > 0 ? "text-text" : "text-text-faint"}`}>
              {ruleset[key] > 0 ? `+${ruleset[key]}` : "kapalı"}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-text-faint">
        Puanlar dönem başında sıfırlanır; rozetler kalıcıdır. Puan kırılımındaki adetlere tıklayarak
        ilgili kayıtlara gidebilirsiniz. Rozet kataloğu: {BADGE_BY_CODE.size} rozet.
      </p>
    </section>
  );
}
