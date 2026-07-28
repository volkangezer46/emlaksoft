import Link from "next/link";
import {
  Award, Building2, CalendarCheck2, CalendarClock, ChevronLeft, ChevronRight, Crown, Flame,
  Handshake, HelpCircle, Medal, Rocket, Star, Target, Trophy, Tv, Users, Zap,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { EmptyState } from "@/components/app/empty-state";
import { Table, TableFrame, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { TvAutoRefresh, TvClock } from "@/app/app/tv-mode";
import { now } from "@/lib/clock";
import {
  BADGES,
  BADGE_BY_CODE,
  SCORE_RULES,
  SCORE_RULE_LABELS,
  evaluateBadges,
  type AgentStats,
} from "@/lib/gamification";
import { loadLeagueData, periodOf, periodRange } from "@/lib/gamification-query";

/**
 * /app/lig — ofis motivasyon ekranı.
 *
 * NE ÇÖZÜYOR: Ofiste "kim ne kadar üretti" sorusu ya hiç sorulmuyor ya da ay
 * sonu toplantısında tek seferde konuşuluyor. Lig tablosu bunu GÜNLÜK ve
 * ŞEFFAF yapıyor: puan kuralı herkese açık (SCORE_RULES), sıralama canlı,
 * rozet kalıcı. `?tv=1` ile ofis ekranına asılır.
 *
 * KPI PANELİNDEN FARKI: /app/danisman-kpi bir KARNE — ciro/dönüşüm/koç
 * önerisi, yöneticiye bakar. Burası bir OYUN — puan/rozet/seri, danışmana
 * bakar. İkisi ayrı formül kullanır ve bu bilinçlidir: karne parayı,
 * lig davranışı ölçer.
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

/** Ad → monogram (fotoğraf alanı yok; profiles'ta avatar kolonu bulunmuyor). */
function monogram(name: string) {
  return name.split(" ").map((p) => p[0] ?? "").join("").slice(0, 2).toUpperCase() || "?";
}

function dateLabel(iso: string) {
  return new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(iso));
}

/**
 * Kırılım hücresi — görünen her sayı tıklanabilir olmalı (sıfır çıkmaz metrik
 * kuralı). Hedef sayfa danışman filtresini destekliyorsa filtreli, yoksa düz
 * link verilir; olmayan bir query paramı uydurmak `check:links` kontratını
 * kırar ve kullanıcıya filtresiz sayfayı "filtreli" diye gösterirdi.
 */
function Cell({ href, value, label }: { href: string; value: number; label: string }) {
  return (
    <TD align="right" className={value > 0 ? "text-ink-950" : "text-text-faint"}>
      <Link
        href={href}
        className="focus-ring relative z-10 rounded-[6px] font-semibold hover:text-brand-600 hover:underline"
        aria-label={label}
      >
        {value}
      </Link>
    </TD>
  );
}

export default async function LigPage({
  searchParams,
}: {
  searchParams?: Promise<{ donem?: string; kapsam?: string; tv?: string }>;
}) {
  const { tenantId, userId } = await requireModulePage("reports");
  const sp = (await searchParams) ?? {};
  const tvMode = sp.tv === "1";

  // Platform ekibi (impersonation dışı) tek bir ofise bağlı değil — lig
  // ofis içi bir yarış, kiracısız bağlamda anlamı yok.
  if (!tenantId) {
    return (
      <EmptyState
        icon={Trophy}
        title="Lig tablosu ofis bağlamı ister"
        description="Platform hesabıyla giriş yaptınız. Bir ofisin lig tablosunu görmek için o ofise geçiş yapın."
        action={{ href: "/app", label: "Panele dön" }}
      />
    );
  }

  const todayIso = new Date(now()).toISOString().slice(0, 10);
  const currentPeriod = periodOf(new Date(now()));

  // ?donem=YYYY-MM — geçersiz veya GELECEK dönem bu aya düşer (danisman-kpi
  // dönem seçici deseni: geleceğe gezinme yok, henüz olmamış bir yarış).
  const asked = /^\d{4}-\d{2}$/.test(sp.donem ?? "") ? sp.donem! : currentPeriod;
  const period = asked > currentPeriod ? currentPeriod : asked;
  const range = periodRange(period);
  const isCurrent = period === currentPeriod;

  const supabase = await createClient();

  // Şube kapsamı: ofiste birden çok şube varsa "kapsam" seçici görünür.
  const { data: branchRows } = await supabase
    .from("branches").select("id, name").eq("tenant_id", tenantId).eq("is_active", true).limit(50);
  const branches = branchRows ?? [];
  const branchId = branches.some((b) => String(b.id) === sp.kapsam) ? sp.kapsam! : null;

  const league = await loadLeagueData(supabase, { period, tenantId, branchId, todayIso });

  // Kazanılmış rozetler (DB) — dönemsel rozetler bu döneme, ömür boyu
  // rozetler period IS NULL satırına düşer. `or` ile tek sorguda.
  const { data: badgeRows } = await supabase
    .from("agent_badges")
    .select("staff_id, badge_code, earned_at, period")
    .eq("tenant_id", tenantId)
    .or(`period.eq.${period},period.is.null`)
    .limit(2000);

  /** staffId → (badgeCode → kazanma tarihi) */
  const earnedDb = new Map<string, Map<string, string>>();
  for (const r of badgeRows ?? []) {
    const sid = String(r.staff_id);
    const m = earnedDb.get(sid) ?? new Map<string, string>();
    m.set(String(r.badge_code), String(r.earned_at));
    earnedDb.set(sid, m);
  }

  const agentById = new Map(league.agents.map((a) => [a.id, a]));

  /**
   * Gösterilen rozet = DB'de MÜHÜRLÜ olan ∪ ŞU AN koşulu sağlanan.
   * Birleşim bilinçli: cron ay sonunda mühürler, ama danışman ayın 10'unda
   * "5. anlaşmamı yaptım" dediğinde rozeti aynı gün görmeli. Mühürlü rozet
   * ise koşul sonradan bozulsa bile (kayıt silindi vs.) geri alınmaz.
   */
  function badgesOf(staffId: string, stats: AgentStats) {
    const db = earnedDb.get(staffId);
    const live = new Set(evaluateBadges(stats));
    const codes = new Set<string>([...(db?.keys() ?? []), ...live]);
    return BADGES.filter((b) => codes.has(b.code)).map((b) => ({
      def: b,
      earnedAt: db?.get(b.code) ?? null,
    }));
  }

  const rows = league.ranked.map((r) => {
    const stats = league.statsById.get(r.staffId) ?? null;
    return {
      ...r,
      agent: agentById.get(r.staffId) ?? null,
      streak: league.streakById.get(r.staffId) ?? 0,
      badges: stats ? badgesOf(r.staffId, stats) : [],
    };
  }).filter((r) => r.agent !== null);

  const hasActivity = rows.some((r) => r.total > 0);
  const podium = rows.filter((r) => r.total > 0).slice(0, 3);

  // Dönem gezinme linkleri
  const shift = (delta: number) => {
    const d = new Date(range.startIso);
    return periodOf(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + delta, 1)));
  };
  const keepScope = branchId ? `&kapsam=${branchId}` : "";
  const prevHref = `/app/lig?donem=${shift(-1)}${keepScope}`;
  const nextHref = isCurrent ? null : `/app/lig?donem=${shift(1)}${keepScope}`;

  // Kişisel rozet galerisi oturum açan kullanıcı içindir.
  const myRow = rows.find((r) => r.staffId === userId) ?? null;
  const myStats = myRow ? league.statsById.get(userId) ?? null : null;
  const myEarned = new Map((myRow?.badges ?? []).map((b) => [b.def.code, b.earnedAt]));

  // ── TV MODU ─────────────────────────────────────────────────────────────
  // Ofis ekranına asılan sade tablo: yalnız sıra/ad/puan/seri. Filtre yok,
  // link yok (kimse TV'ye tıklamaz), 30 sn'de bir sunucu verisi tazelenir.
  if (tvMode) {
    return (
      <div className="tv-zoom space-y-5">
        <TvAutoRefresh intervalMs={30_000} />
        <div className="theme-dark flex flex-wrap items-center justify-between gap-3 rounded-[16px] bg-[image:var(--grad-ink)] px-6 py-4">
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
              className="focus-ring press rounded-[9px] border border-white/15 bg-white/5 px-3 py-1.5 text-sm font-semibold text-white/80 transition hover:bg-white/10 hover:text-white"
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
                      <span className="font-display text-xl font-bold text-ink-950">{r.agent!.fullName}</span>
                    </TD>
                    <TD align="right">
                      <span className="numeric font-display text-2xl font-extrabold text-brand-600">{r.total}</span>
                    </TD>
                    <TD align="right">
                      <span className="numeric text-xl font-bold text-ink-950">{r.breakdown.deal_won.count}</span>
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

  return (
    <div className="space-y-6">
      {/* Hero: dönem seçici + kapsam + TV modu girişi */}
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-30" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="flex items-center gap-2 text-xs font-semibold text-amber-300">
              <Trophy className="h-4 w-4" /> Ekip ligi
            </span>
            <h1 className="mt-2 font-display text-2xl font-extrabold text-white md:text-3xl">Lig Tablosu</h1>
            <p className="mt-1 text-sm text-white/75">
              Aylık puan yarışı, rozetler ve günlük aktivite serileri.
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-1">
              <Link
                href={prevHref}
                className="focus-ring grid h-8 w-8 place-items-center rounded-[8px] border border-white/15 text-white/70 transition hover:bg-white/10 hover:text-white"
                aria-label="Önceki dönem"
              >
                <ChevronLeft className="h-4 w-4" />
              </Link>
              <span className="min-w-[128px] px-2 text-center text-sm font-bold text-white first-letter:uppercase">
                {range.label}
              </span>
              {nextHref ? (
                <Link
                  href={nextHref}
                  className="focus-ring grid h-8 w-8 place-items-center rounded-[8px] border border-white/15 text-white/70 transition hover:bg-white/10 hover:text-white"
                  aria-label="Sonraki dönem"
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
              {!isCurrent ? (
                <Link
                  href={`/app/lig${branchId ? `?kapsam=${branchId}` : ""}`}
                  className="focus-ring ml-1 rounded-[8px] border border-white/15 px-2.5 py-1.5 text-[11px] font-semibold text-white/70 transition hover:bg-white/10 hover:text-white"
                >
                  Bu ay
                </Link>
              ) : null}
            </div>

            {/* Kapsam: yalnız birden çok şube varsa anlamlı */}
            {branches.length > 1 ? (
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <Link
                  href={`/app/lig?donem=${period}`}
                  className={`focus-ring rounded-full px-3 py-1 text-[11px] font-semibold transition ${
                    branchId === null ? "bg-white text-ink-950" : "border border-white/15 text-white/70 hover:bg-white/10"
                  }`}
                >
                  Tüm ofis
                </Link>
                {branches.map((b) => (
                  <Link
                    key={String(b.id)}
                    href={`/app/lig?donem=${period}&kapsam=${b.id}`}
                    className={`focus-ring rounded-full px-3 py-1 text-[11px] font-semibold transition ${
                      branchId === String(b.id) ? "bg-white text-ink-950" : "border border-white/15 text-white/70 hover:bg-white/10"
                    }`}
                  >
                    {String(b.name)}
                  </Link>
                ))}
              </div>
            ) : null}
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/app/danisman-kpi"
              className="focus-ring press rounded-[10px] border border-white/15 bg-white/5 px-3.5 py-2 text-xs font-semibold text-white/80 transition hover:bg-white/10 hover:text-white"
            >
              Danışman KPI karnesi
            </Link>
            <Link
              href={`/app/lig?donem=${period}${keepScope}&tv=1`}
              title="TV modu — ofis ekranı görünümü"
              aria-label="TV modunu aç"
              className="focus-ring press grid h-9 w-9 place-items-center rounded-[10px] border border-white/15 bg-white/5 text-white/75 transition hover:bg-white/10 hover:text-white"
            >
              <Tv className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {!hasActivity ? (
        <>
          <EmptyState
            icon={Trophy}
            title="Bu dönemde henüz aktivite yok"
            description={`${range.label} döneminde puan üreten bir kayıt bulunamadı. Aşağıdaki kalemlerden herhangi biri puan getirir.`}
            tone="amber"
            action={{ href: "/app/portfoyler", label: "Portföylere git" }}
          />
          <ScoreRulesCard />
        </>
      ) : (
        <>
          {/* ── PODYUM: ilk üç ─────────────────────────────────────────── */}
          {podium.length > 0 ? (
            <section className="dashboard-panel relative overflow-hidden rounded-[22px] border border-line bg-surface p-6">
              <div className="pointer-events-none absolute -left-10 -top-16 h-48 w-48 rounded-full bg-amber-400/15 blur-[70px]" />
              <div className="relative">
                <p className="flex items-center gap-2 text-xs font-semibold text-amber-600">
                  <Crown className="h-4 w-4" /> Podyum
                </p>
                <h2 className="mt-1 font-display text-lg font-bold text-ink-950 first-letter:uppercase">
                  {range.label} ilk üçü
                </h2>
                <div className="mt-6 grid gap-3 sm:grid-cols-3 sm:items-end">
                  {podium.map((r, i) => {
                    const s = podiumStyle[i];
                    return (
                      <Link
                        key={r.staffId}
                        href={`/app/ekip/${r.staffId}`}
                        className={`focus-ring press lift group flex flex-col rounded-[18px] border-2 bg-canvas/40 p-4 text-center transition hover:border-brand-300 ${s.tone} ${s.order}`}
                        aria-label={`${r.rank}. sıra: ${r.agent!.fullName} — ${r.total} puan`}
                      >
                        <span className={`mx-auto grid h-14 w-14 place-items-center rounded-full font-display text-base font-extrabold ${s.ring}`}>
                          {monogram(r.agent!.fullName)}
                        </span>
                        <p className="mt-2 flex items-center justify-center gap-1 truncate font-display text-sm font-bold text-ink-950 group-hover:text-brand-600">
                          <span aria-hidden="true">{s.medal}</span> {r.agent!.fullName}
                        </p>
                        <p className="numeric font-display text-2xl font-extrabold text-brand-600">{r.total}</p>
                        <p className="text-[11px] text-text-muted">
                          puan · {r.badges.length} rozet
                          {r.streak > 0 ? ` · 🔥 ${r.streak} gün` : ""}
                        </p>
                        <div className={`mt-3 w-full rounded-t-[10px] ${s.bar}`} aria-hidden="true" />
                      </Link>
                    );
                  })}
                </div>
              </div>
            </section>
          ) : null}

          {/* ── LİG TABLOSU ────────────────────────────────────────────── */}
          <TableFrame minWidth={980}>
            <Table>
              <THead>
                <TR>
                  <TH>#</TH>
                  <TH>Danışman</TH>
                  <TH align="right">Puan</TH>
                  <TH align="right">{SCORE_RULE_LABELS.deal_won}</TH>
                  <TH align="right">{SCORE_RULE_LABELS.property_new}</TH>
                  <TH align="right">{SCORE_RULE_LABELS.appointment_done}</TH>
                  <TH align="right">{SCORE_RULE_LABELS.nps_promoter}</TH>
                  <TH align="right">Seri</TH>
                  <TH>Rozetler</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((r) => {
                  const ben = r.staffId === userId;
                  return (
                    <TR key={r.staffId} interactive className={ben ? "bg-brand-600/[0.06]" : undefined}>
                      <TD>
                        <span
                          className={`numeric font-display font-bold ${
                            r.rank === 1 ? "text-amber-500" : r.rank === 2 ? "text-text-muted" : r.rank === 3 ? "text-amber-700" : "text-text-faint"
                          }`}
                        >
                          {r.rank}
                        </span>
                      </TD>
                      <TD>
                        <Link
                          href={`/app/ekip/${r.staffId}`}
                          className="absolute inset-0"
                          aria-label={`${r.agent!.fullName} danışman detayı`}
                        />
                        <p className="font-semibold text-ink-950 group-hover:text-brand-600">
                          {r.agent!.fullName}
                          {ben ? (
                            <span className="ml-1.5 rounded-full bg-brand-600/12 px-1.5 py-0.5 text-[10px] font-bold text-brand-700">
                              sen
                            </span>
                          ) : null}
                        </p>
                        <p className="text-[11px] capitalize text-text-faint">{r.agent!.role}</p>
                      </TD>
                      <TD align="right">
                        <span className="numeric font-display text-base font-extrabold text-brand-600">{r.total}</span>
                      </TD>
                      {/* Kırılım hücreleri: filtreyi destekleyen hedefte filtreli link */}
                      <Cell
                        href="/app/anlasmalar"
                        value={r.breakdown.deal_won.count}
                        label={`${r.agent!.fullName} kazanılan anlaşmaları`}
                      />
                      <Cell
                        href="/app/portfoyler"
                        value={r.breakdown.property_new.count}
                        label={`${r.agent!.fullName} portföyleri`}
                      />
                      <Cell
                        href={`/app/randevular?danisman=${r.staffId}`}
                        value={r.breakdown.appointment_done.count}
                        label={`${r.agent!.fullName} tamamlanan randevuları`}
                      />
                      <Cell
                        href="/app/raporlar/memnuniyet"
                        value={r.breakdown.nps_promoter.count}
                        label={`${r.agent!.fullName} NPS 9-10 anketleri`}
                      />
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
                          <span className="text-[11px] text-text-faint">—</span>
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
                              <span className="text-[11px] font-semibold text-text-muted">+{r.badges.length - 6}</span>
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

          <ScoreRulesCard />
        </>
      )}

      {/* ── ROZET GALERİSİ (kişisel) ─────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="flex items-center gap-2 text-xs font-semibold text-brand-600">
              <Award className="h-4 w-4" /> Rozet galerisi
            </p>
            <h2 className="mt-1 font-display text-lg font-bold text-ink-950">
              {myRow ? `${myRow.agent!.fullName} — rozetlerin` : "Rozetler"}
            </h2>
          </div>
          <p className="text-xs text-text-muted">
            <span className="numeric font-bold text-ink-950">{myEarned.size}</span> / {BADGES.length} rozet kazanıldı
          </p>
        </div>

        {!myStats ? (
          <p className="rounded-[14px] border border-line bg-canvas px-4 py-3 text-xs text-text-muted">
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
                className={`surface-card rounded-[16px] p-4 transition ${kazanildi ? "" : "opacity-55"}`}
              >
                <div className="flex items-start gap-3">
                  <span
                    className={`grid h-11 w-11 shrink-0 place-items-center rounded-[13px] ${
                      kazanildi ? "bg-amber-400/18 text-amber-700" : "bg-ink-950/6 text-text-faint"
                    }`}
                    aria-hidden="true"
                  >
                    <Icon className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 font-display text-sm font-bold text-ink-950">
                      {b.name}
                      <span className="rounded-full bg-ink-950/5 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] text-text-faint">
                        {b.scope === "monthly" ? "aylık" : "kalıcı"}
                      </span>
                    </p>
                    {kazanildi ? (
                      <>
                        <p className="mt-0.5 text-xs text-text-muted">{b.description}</p>
                        <p className="mt-1 text-[11px] font-semibold text-mint-700">
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
    </div>
  );
}

/** Puan tablosu kartı — kural şeffaflığı ligin güvenilirliğinin şartı. */
function ScoreRulesCard() {
  const items: Array<{ key: keyof typeof SCORE_RULES; hint: string }> = [
    { key: "deal_won", hint: "Kazanılan (won) anlaşma" },
    { key: "property_new", hint: "Yeni portföy kaydı" },
    { key: "appointment_done", hint: "Tamamlanan randevu" },
    { key: "task_done", hint: "Tamamlanan görev" },
    { key: "nps_promoter", hint: "Müşteriden 9-10 anket puanı" },
    { key: "leak_sla_response", hint: "Kayıp-kaçak SLA içinde yanıt" },
  ];
  return (
    <section className="surface-card rounded-[18px] p-5">
      <p className="flex items-center gap-2 text-xs font-semibold text-brand-600">
        <Target className="h-4 w-4" /> Nasıl puan kazanılır
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((it) => (
          <div key={it.key} className="flex items-center justify-between gap-3 rounded-[12px] bg-canvas px-3 py-2.5">
            <span className="text-xs text-text-muted">{it.hint}</span>
            <span className="numeric shrink-0 font-display text-sm font-extrabold text-ink-950">
              +{SCORE_RULES[it.key]}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11px] text-text-faint">
        Puanlar dönem başında sıfırlanır; rozetler kalıcıdır. Kırılım hücrelerine tıklayarak
        ilgili kayıtlara gidebilirsiniz. Rozet kataloğu: {BADGE_BY_CODE.size} rozet.
      </p>
    </section>
  );
}
